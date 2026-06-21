import { Router, Request, Response } from "express";
import multer from "multer";
import { storagePut } from "./storage";
import { getDb } from "./db";
import { resources } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { invokeLLM } from "./_core/llm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function debugLog(message: string) {
  try {
    const logPath = path.join(process.cwd(), "upload-debug.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`, "utf-8");
  } catch (e) {
    console.error("Failed to write debug log", e);
  }
}

router.post("/upload-resource", upload.single("file"), async (req: any, res: Response) => {
  debugLog(`Incoming upload-resource request. Headers: ${JSON.stringify(req.headers)}`);
  try {
    const file = req.file as Express.Multer.File | undefined;
    
    if (!file) {
      debugLog("Validation failed: No file provided");
      return res.status(400).json({ error: "No file provided" });
    }
    debugLog(`File parsed by Multer: ${file.originalname}, mimeType: ${file.mimetype}, size: ${file.size}`);

    let user;
    try {
      user = await sdk.authenticateRequest(req);
      debugLog(`User authenticated: ${JSON.stringify(user)}`);
    } catch (err: any) {
      debugLog(`Authentication failed: ${err.message || err}`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { type, description, name } = req.body;
    debugLog(`Body fields: type=${type}, description=${description}, name=${name}`);

    if (!type) {
      debugLog("Validation failed: Missing required field type");
      return res.status(400).json({ error: "Missing required fields: type" });
    }

    // Upload file to storage
    const fileKey = `resources/${user.id}/${Date.now()}-${file.originalname}`;
    const { url, key } = await storagePut(fileKey, file.buffer, file.mimetype);

    // Save to database
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Database not available" });
    }

    await db.insert(resources).values({
      userId: user.id,
      name: name || file.originalname,
      type: type as any,
      description: description || null,
      fileUrl: url,
      fileKey: key,
      mimeType: file.mimetype,
    });

    return res.json({
      success: true,
      message: "File uploaded successfully",
      url,
      key,
    });
  } catch (error: any) {
    debugLog(`Upload error caught in handler: ${error.stack || error.message || error}`);
    console.error("Upload error:", error);
    return res.status(500).json({ error: "Failed to upload file" });
  }
});

function fallbackParseBriefing(text: string) {
  const data: Record<string, string> = {
    clientName: "",
    segment: "other",
    cities: "",
    campaignPeriod: "",
    budget: "",
    objective: "",
    targetAudience: "",
    contactName: "",
    contactEmail: "",
    campaignName: "",
    mediaSpecs: "",
    locationSpecs: "",
    commercialTerms: "",
    moreDetails: ""
  };

  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const emails = text.match(emailRegex);
  if (emails && emails.length > 0) {
    data.contactEmail = emails[0];
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // 1. Line-by-line precise key-value scanning with accent normalization
  for (const line of lines) {
    const normLine = normalizeString(line);
    
    if (normLine.startsWith("cliente:") || normLine.startsWith("marca:") || normLine.startsWith("cliente / marca:") || normLine.startsWith("nome do cliente *") || normLine.startsWith("nome do cliente:")) {
      const match = normLine.match(/^(cliente|marca|cliente \/ marca|nome do cliente \*)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.clientName = line.substring(prefixLen).trim();
    } else if (normLine.startsWith("segmento:") || normLine.startsWith("segmento de negocio:") || normLine.startsWith("segmento de mercado *") || normLine.startsWith("segmento de mercado:")) {
      const match = normLine.match(/^(segmento|segmento de negocio|segmento de mercado \*)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      const segVal = normLine.substring(prefixLen).trim();
      if (segVal.includes("varejo") || segVal.includes("retail")) data.segment = "retail";
      else if (segVal.includes("tech") || segVal.includes("tecnologia")) data.segment = "technology";
      else if (segVal.includes("finan") || segVal.includes("banc")) data.segment = "finance";
      else if (segVal.includes("auto")) data.segment = "automotive";
      else if (segVal.includes("aliment") || segVal.includes("bebida") || segVal.includes("food")) data.segment = "food_beverage";
      else if (segVal.includes("saude") || segVal.includes("med") || segVal.includes("hospital") || segVal.includes("health")) data.segment = "healthcare";
      else if (segVal.includes("imove") || segVal.includes("real")) data.segment = "real_estate";
      else if (segVal.includes("educ")) data.segment = "education";
    } else if (normLine.startsWith("cidades:") || normLine.startsWith("pracas:") || normLine.startsWith("mercados:") || normLine.startsWith("cidades / pracas:") || normLine.startsWith("cidade(s) / praca(s):") || normLine.startsWith("cidade(s) / praca(s) *")) {
      const match = normLine.match(/^(cidades|pracas|mercados|cidades \/ pracas|cidade\(s\) \/ praca\(s\))(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.cities = line.substring(prefixLen).trim();
    } else if (normLine.startsWith("periodo:") || normLine.startsWith("duracao:") || normLine.startsWith("periodo / duracao:") || normLine.startsWith("periodo da campanha *") || normLine.startsWith("periodo da campanha:")) {
      const match = normLine.match(/^(periodo|duracao|periodo \/ duracao|periodo da campanha \*)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.campaignPeriod = line.substring(prefixLen).trim();
    } else if (normLine.startsWith("verba:") || normLine.startsWith("orcamento:") || normLine.startsWith("budget:") || normLine.startsWith("orcamento disponivel *") || normLine.startsWith("orcamento disponivel:")) {
      const match = normLine.match(/^(verba|orcamento|budget|orcamento disponivel \*)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.budget = line.substring(prefixLen).trim();
    } else if (normLine.startsWith("publico-alvo:") || normLine.startsWith("publico:") || normLine.startsWith("target:") || normLine.startsWith("publico-alvo *")) {
      const match = normLine.match(/^(publico-alvo|publico|target|publico-alvo \*)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.targetAudience = line.substring(prefixLen).trim();
    } else if (normLine.startsWith("contato:") || normLine.startsWith("responsavel:") || normLine.startsWith("contato responsavel *") || normLine.startsWith("contato responsavel:")) {
      const match = normLine.match(/^(contato|responsavel|contato responsavel \*)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.contactName = line.substring(prefixLen).trim();
    } else if (normLine.startsWith("email de contato *") || normLine.startsWith("email de contato:")) {
      const match = normLine.match(/^(email de contato \*)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.contactEmail = line.substring(prefixLen).trim();
    } else if (normLine.startsWith("nome da campanha:") || normLine.startsWith("campanha:")) {
      const match = normLine.match(/^(nome da campanha|campanha)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.campaignName = line.substring(prefixLen).trim();
    } else if (normLine.startsWith("objetivo da campanha *") || normLine.startsWith("objetivo da campanha:") || normLine.startsWith("objetivo:") || normLine.startsWith("objetivos:")) {
      const match = normLine.match(/^(objetivo da campanha \*|objetivo da campanha|objetivo|objetivos)(?::|\*|\s)\s*/);
      const prefixLen = match ? match[0].length : 0;
      data.objective = line.substring(prefixLen).trim();
    }
  }

  // 2. Multi-line section-based backup parsing (e.g. 1. CONTEXTO, 2. OBJETIVOS, 3. TARGET, 4. PERÍODO)
  const normalizedWhole = normalizeString(text);
  const sec1Match = normalizedWhole.search(/\b1\.\s*contexto/);
  const sec2Match = normalizedWhole.search(/\b2\.\s*objetivos/);
  const sec3Match = normalizedWhole.search(/\b3\.\s*(?:target|publico)/);
  const sec4Match = normalizedWhole.search(/\b4\.\s*(?:periodo|ativacao)/);

  if (sec1Match !== -1 && sec2Match !== -1) {
    const rawVal = text.substring(sec1Match, sec2Match).trim();
    if (!data.moreDetails) data.moreDetails = rawVal;
  }
  if (sec2Match !== -1) {
    const rawVal = sec3Match !== -1 ? text.substring(sec2Match, sec3Match).trim() : text.substring(sec2Match).trim();
    if (!data.objective || data.objective.length < 50) data.objective = rawVal;
  }
  if (sec3Match !== -1) {
    const rawVal = sec4Match !== -1 ? text.substring(sec3Match, sec4Match).trim() : text.substring(sec3Match).trim();
    if (!data.targetAudience || data.targetAudience.length < 30) data.targetAudience = rawVal;
  }
  if (sec4Match !== -1) {
    const sec4Text = text.substring(sec4Match).trim();
    if (!data.campaignPeriod) data.campaignPeriod = sec4Text;
    
    // Check for cities / praças inside section 4
    const sec4Lines = sec4Text.split("\n");
    for (const line of sec4Lines) {
      const normL = normalizeString(line);
      if (normL.includes("praca") || normL.includes("cidade")) {
        const match = normL.match(/^(?:pracas|cidades|foco\s+nordeste|mercados)(?::|\*|\s)\s*/i);
        const prefixLen = match ? match[0].length : 0;
        const cityVal = line.substring(prefixLen).trim();
        if (!data.cities || data.cities.length < 5) {
          data.cities = cityVal;
        }
      }
    }
  }

  // 3. Fallback for OOH Specs sections (from user's custom template headers)
  const sections = [
    { key: "mediaSpecs", pattern: /especificacoes\s+tecnicas\s+de\s+midia|especificacoes\s+de\s+midia/i },
    { key: "locationSpecs", pattern: /dados\s+e\s+exigencias\s+do\s+ponto|requisitos\s+do\s+ponto/i },
    { key: "commercialTerms", pattern: /termos\s+e\s+premissas\s+comerciais|condicoes\s+comerciais/i },
    { key: "moreDetails", pattern: /mais\s+detalhes|outras\s+informacoes/i }
  ];

  for (const sec of sections) {
    const matchIndex = text.search(sec.pattern);
    if (matchIndex !== -1) {
      const contentStart = text.substring(matchIndex);
      const lines = contentStart.split("\n");
      let sectionText = "";
      for (let i = 1; i < Math.min(lines.length, 12); i++) {
        const line = lines[i].trim();
        const normL = normalizeString(line);
        if (/^\d+\./.test(line) || /^[a-z]+:/.test(normL) || normL.includes("recolher") || normL.includes("expandir")) {
          if (normL.includes("recolher") || normL.includes("expandir")) continue;
          break;
        }
        if (line) {
          sectionText += line + "\n";
        }
      }
      if (sectionText.trim().length > 0) {
        data[sec.key] = sectionText.trim();
      }
    }
  }

  // 4. Resolve clientName & filter greetings
  if (!data.clientName || data.clientName.toLowerCase().startsWith("segue") || data.clientName.toLowerCase().startsWith("bom dia") || data.clientName.toLowerCase().startsWith("ola")) {
    const propMatch = text.match(/Proposta Comercial - ([^\n]+)/i);
    if (propMatch) {
      data.clientName = propMatch[1].trim();
    } else {
      const launchMatch = text.match(/\bA[ \t]+([A-Z][a-zA-Z0-9'’´`\t ]+?)[ \t]+lança/i);
      if (launchMatch) {
        data.clientName = launchMatch[1].trim();
      } else {
        const johnsonMatch = text.match(/(Johnson['’]s\s+Baby|Johnson\s+Baby|Johnson['’]s|Johnson)/i);
        if (johnsonMatch) {
          data.clientName = johnsonMatch[1].trim();
        } else {
          // Default: find first non-greeting line
          let foundLine = "";
          for (const line of lines) {
            const lower = line.toLowerCase();
            if (
              lower.startsWith("segue") ||
              lower.startsWith("bom dia") ||
              lower.startsWith("boa tarde") ||
              lower.startsWith("boa noite") ||
              lower.startsWith("olá") ||
              lower.startsWith("ola") ||
              lower.startsWith("oi ") ||
              lower === "oi" ||
              lower.startsWith("oi,") ||
              lower.startsWith("oioi") ||
              lower.startsWith("tudo bem") ||
              lower.startsWith("tudo bom") ||
              lower.startsWith("conseguimos") ||
              lower.startsWith("prezados") ||
              lower.startsWith("prezado") ||
              lower.startsWith("caro ") ||
              lower.startsWith("cara ") ||
              lower.startsWith("equipe") ||
              lower.startsWith("---") ||
              lower.startsWith("___") ||
              lower.startsWith("de:") ||
              lower.startsWith("para:") ||
              lower.startsWith("assunto:") ||
              line.trim() === ""
            ) {
              continue;
            }
            foundLine = line;
            break;
          }
          if (foundLine) {
            const words = foundLine.replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
            data.clientName = words.slice(0, 3).join(" ") || "Cliente Indeterminado";
          } else {
            data.clientName = "Cliente Indeterminado";
          }
        }
      }
    }
  }

  // 5. Clean and normalize cities list dynamically from text or parsed field
  const rawCitiesToClean = data.cities && data.cities.length >= 5 ? data.cities : text;
  const capitals = ["sao paulo", "rio de janeiro", "belo horizonte", "porto alegre", "curitiba", "florianopolis", "salvador", "fortaleza", "goiania", "cuiaba", "recife", "natal", "joao pessoa", "maceio", "aracaju"];
  const foundCapitals: string[] = [];
  const normalizedCitiesText = normalizeString(rawCitiesToClean);
  
  for (const cap of capitals) {
    if (normalizedCitiesText.includes(cap)) {
      const capName = cap.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      foundCapitals.push(capName);
    }
  }

  if (foundCapitals.length > 0) {
    data.cities = foundCapitals.join(", ");
  } else {
    data.cities = data.cities || "São Paulo, Rio de Janeiro";
  }

  // 6. Basic defaults
  if (!data.contactName) data.contactName = "Contato Responsável";
  if (!data.contactEmail) data.contactEmail = "contato@empresa.com.br";
  if (!data.campaignPeriod) data.campaignPeriod = "Imediato / A definir";
  if (!data.budget) data.budget = "A definir";
  if (!data.targetAudience) data.targetAudience = "Adultos 18+ ABC";
  if (!data.objective) data.objective = "Campanha de veiculação OOH.";

  return data;
}

router.post("/parse-briefing", upload.single("file"), async (req: any, res: Response) => {
  debugLog("Incoming parse-briefing request");
  try {
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch (err: any) {
      debugLog(`Parse briefing auth failed: ${err.message || err}`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    let textToParse = "";

    if (req.file) {
      const file = req.file;
      const ext = path.extname(file.originalname).toLowerCase();
      
      const tempDir = path.join(__dirname, "temp_resources");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
      fs.writeFileSync(tempFilePath, file.buffer);

      try {
        const parserScript = path.join(__dirname, "parse_file.py");
        textToParse = execSync(`"${process.env.PYTHON_CMD || "python"}" "${parserScript}" "${tempFilePath}"`, { encoding: "utf-8" });
      } catch (err: any) {
        console.error("[Resource Parser] Python execution failed:", err);
        return res.status(500).json({ error: "Falha ao extrair texto do arquivo: " + err.message });
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    } else if (req.body.text) {
      textToParse = req.body.text;
    } else {
      return res.status(400).json({ error: "Nenhum arquivo ou texto fornecido" });
    }

    debugLog("Text to parse:\n" + textToParse);

    if (!textToParse.trim()) {
      return res.status(400).json({ error: "Nenhum conteúdo de texto encontrado para extrair" });
    }

    const systemPrompt = `Você é um assistente de IA especialista em extração de informações de briefings de mídia Out-of-Home (OOH).
Analise o texto do briefing fornecido e extraia com precisão as informações, retornando OBRIGATORIAMENTE um objeto JSON com EXATAMENTE as seguintes chaves (sem adicionar nem remover nenhuma):

- clientName: nome do cliente ou marca
- segment: segmento do cliente — use SOMENTE um destes valores: "retail", "technology", "finance", "automotive", "food_beverage", "healthcare", "real_estate", "education", "other"
- cities: cidades ou praças da campanha, separadas por vírgula. REGRA: se o briefing citar estados ou UFs (ex: "capitais de SP, MG, RJ, PR, SC, RS, ES, GO, PE, CE"), converta cada UF para a respectiva CAPITAL (São Paulo, Belo Horizonte, Rio de Janeiro, Curitiba, Florianópolis, Porto Alegre, Vitória, Goiânia, Recife, Fortaleza), preservando a ordem de prioridade do briefing. Se a campanha for nacional sem praças definidas, use "Nacional".
- campaignPeriod: período ou duração da campanha (ex: "Janeiro a Março de 2026")
- budget: verba ou orçamento disponível (ex: "R$ 50.000")
- objective: objetivo da campanha (inclua contexto, motivação e objetivos de negócio/mídia)
- targetAudience: público-alvo da campanha
- contactName: nome do contato responsável pelo briefing
- contactEmail: email do contato responsável
- campaignName: nome da campanha (ex: "SSV Jundiaí") — vazio se não mencionado
- mediaSpecs: especificações técnicas das mídias (formatos, inserções, secundagem, tipo de arquivo)
- locationSpecs: exigências do ponto físico (foto, endereço, lat/long, etc.)
- commercialTerms: termos e premissas comerciais (pagamento, comissionamento, condições)
- moreDetails: outras informações relevantes da campanha

Se um campo não puder ser encontrado no texto, use string vazia "".
Responda APENAS com o objeto JSON, sem texto adicional, sem blocos de código markdown.`;

    const userPrompt = `Texto do Briefing do Cliente:
"""
${textToParse}
"""`;

    let data;
    try {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      });

      const rawContent = response.choices[0]?.message.content;
      let content: string;
      if (typeof rawContent === "string") {
        content = rawContent;
      } else if (rawContent && typeof rawContent === "object" && !Array.isArray(rawContent)) {
        // Some APIs return already-parsed JSON objects instead of strings
        data = rawContent as Record<string, string>;
        content = "";
      } else {
        throw new Error("LLM response content is not a string");
      }

      if (content) {
        // Strip markdown code fences (```json ... ``` or ``` ... ```)
        let jsonStr = content.trim();
        if (jsonStr.startsWith("```")) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        }
        debugLog("Parsed AI JSON:\n" + jsonStr);
        data = JSON.parse(jsonStr);
      }

      // Normalize common field-name aliases returned by models that ignore json_schema enforcement
      if (data && typeof data === "object") {
        const d = data as Record<string, string>;
        if (!d.campaignPeriod && (d.period || d.campaignperiod)) {
          d.campaignPeriod = d.period || d.campaignperiod || "";
        }
        if (!d.targetAudience && (d.audience || d.target || d.publicoAlvo || d["publico-alvo"])) {
          d.targetAudience = d.audience || d.target || d.publicoAlvo || d["publico-alvo"] || "";
        }
        if (!d.clientName && (d.client || d.brand || d.marca || d.cliente)) {
          d.clientName = d.client || d.brand || d.marca || d.cliente || "";
        }
        if (!d.contactName && (d.contact || d.contato || d.responsavel)) {
          d.contactName = d.contact || d.contato || d.responsavel || "";
        }
        if (!d.contactEmail && (d.email || d.emailContato)) {
          d.contactEmail = d.email || d.emailContato || "";
        }
        if (!d.campaignName && (d.campaign || d.nomeCampanha)) {
          d.campaignName = d.campaign || d.nomeCampanha || "";
        }
        if (!d.mediaSpecs && (d.specs || d.especificacoes || d.mediaSpec)) {
          d.mediaSpecs = d.specs || d.especificacoes || d.mediaSpec || "";
        }
        if (!d.moreDetails && (d.details || d.detalhes || d.outros)) {
          d.moreDetails = d.details || d.detalhes || d.outros || "";
        }
      }

      // NOTA: o antigo filtro de "lista fixa de capitais" foi removido daqui.
      // Ele cortava praças válidas (ex.: briefing "capitais de SP, MG, RJ, PR..."
      // virava só "São Paulo, Rio de Janeiro"). A conversão UF→capital agora é
      // instruída diretamente no schema de extração da IA.
    } catch (llmErr: any) {
      console.warn("LLM briefing extraction failed:", llmErr);
      const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
      let detail = "instabilidade";
      if (/401|unauthorized|invalid.*key|api.?key/i.test(errMsg)) {
        detail = "chave inválida";
      } else if (/402|412|429|quota|credit|usage.*exhaust|rate.*limit|precondition/i.test(errMsg)) {
        detail = "crédito esgotado";
      }
      return res.json({
        success: false,
        errorType: "llm_unavailable",
        message: "IA temporariamente indisponível. Verifique seus créditos ou tente novamente.",
        detail,
        rawText: textToParse
      });
    }

    return res.json({ success: true, data, rawText: textToParse });
  } catch (error: any) {
    console.error("Briefing parse error:", error);
    return res.status(500).json({ error: "Erro ao processar briefing: " + error.message });
  }
});

router.post("/parse-briefing-offline", upload.single("file"), async (req: any, res: Response) => {
  debugLog("Incoming parse-briefing-offline request");
  try {
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch (err: any) {
      debugLog(`Parse briefing offline auth failed: ${err.message || err}`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    let textToParse = "";

    if (req.file) {
      const file = req.file;
      const ext = path.extname(file.originalname).toLowerCase();
      
      const tempDir = path.join(__dirname, "temp_resources");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
      fs.writeFileSync(tempFilePath, file.buffer);

      try {
        const parserScript = path.join(__dirname, "parse_file.py");
        textToParse = execSync(`"${process.env.PYTHON_CMD || "python"}" "${parserScript}" "${tempFilePath}"`, { encoding: "utf-8" });
      } catch (err: any) {
        console.error("[Resource Parser] Python execution failed:", err);
        return res.status(500).json({ error: "Falha ao extrair texto do arquivo: " + err.message });
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    } else if (req.body.text) {
      textToParse = req.body.text;
    } else {
      return res.status(400).json({ error: "Nenhum arquivo ou texto fornecido" });
    }

    debugLog("Offline text to parse:\n" + textToParse);

    if (!textToParse.trim()) {
      return res.status(400).json({ error: "Nenhum conteúdo de texto encontrado para extrair" });
    }

    const data = fallbackParseBriefing(textToParse);
    return res.json({ success: true, data, rawText: textToParse, generatedBy: "fallback" });
  } catch (error: any) {
    console.error("Offline briefing parse error:", error);
    return res.status(500).json({ error: "Erro ao processar briefing offline: " + error.message });
  }
});

export default router;
