import { storageGetSignedUrl } from "./storage";
import ExcelJS from "exceljs";
import { getDb } from "./db";
import { resources } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function getParsedResourcesContext(
  userId: number,
  filterTypes?: string[],
  /** Praças do briefing: cidades listadas aqui recebem inventário COMPLETO; as demais, só um resumo de 1 linha. */
  cityFilter?: string[],
  /** Especificações de mídia do briefing: formatos citados pelo cliente entram SEMPRE, furando qualquer limite. */
  mediaSpecs?: string
): Promise<string> {
  const normalize = (s: string) =>
    (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  let cityFilterNorm = (cityFilter ?? [])
    .map(normalize)
    .filter((c) => c.length > 2);
  // Campanha nacional ("Brasil", "Nacional", "todas as capitais"): sem filtro
  // de praça — vale a regra padrão de 12 formatos por cidade (visão panorâmica)
  if (cityFilterNorm.some((c) => /\bbrasil\b|\bnacional\b|todas as (capitais|cidades|pracas)/.test(c))) {
    cityFilterNorm = [];
  }
  const isBriefingCity = (cidade: string) => {
    if (cityFilterNorm.length === 0) return false;
    const c = normalize(cidade);
    return cityFilterNorm.some((f) => c.includes(f) || f.includes(c));
  };
  // Palavras-chave dos formatos pedidos pelo cliente (ex.: "painel led", "busdoor")
  const STOPWORDS = new Set(["para", "como", "campanha", "formato", "formatos", "midia", "midias", "digital", "semanas", "periodo", "cliente", "veiculacao", "insercoes", "mensal", "semanal", "diario"]);
  const formatKeywords = mediaSpecs
    ? Array.from(new Set(
        normalize(mediaSpecs).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOPWORDS.has(w))
      )).slice(0, 30)
    : [];
  const isRequestedFormat = (itemDesc: string) => {
    if (formatKeywords.length === 0) return false;
    const d = normalize(itemDesc);
    return formatKeywords.some((k) => d.includes(k));
  };
  const db = await getDb();
  if (!db) {
    return "";
  }

  // Fetch all resources of the user ordered by id descending (most recent first)
  const userResources = await db
    .select()
    .from(resources)
    .where(eq(resources.userId, userId))
    .orderBy(desc(resources.id));

  if (userResources.length === 0) {
    return "";
  }

  // Filter resources by type if specified
  let filtered = filterTypes 
    ? userResources.filter(r => filterTypes.includes(r.type))
    : userResources;

  if (filtered.length === 0) {
    return "";
  }

  // Limit to most recent 5 resources to prevent token overflow and slow network requests
  filtered = filtered.slice(0, 5);

  let context = "\n### DADOS DE SUPORTE DOS RECURSOS ENVIADOS PELO USUÁRIO (Use APENAS estes dados para inventário, precificação e ideias):\n";

  // Parse resources in parallel
  const parsedPromises = filtered.map(async (resource) => {
    try {
      let resourceContext = `\n--- RECURSO: ${resource.name} (Tipo: ${resource.type}) ---\n`;
      const signedUrl = await storageGetSignedUrl(resource.fileKey);
      const resp = await fetch(signedUrl);
      if (!resp.ok) {
        return resourceContext + `[Erro ao baixar arquivo: ${resp.statusText}]\n`;
      }

      const buffer = await resp.arrayBuffer();
      const nodeBuffer = Buffer.from(buffer);
      const ext = path.extname(resource.name).toLowerCase();

      if (ext === ".xlsx" || ext === ".xls") {
        // Parse using exceljs
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(nodeBuffer as any);
        let sheetContext = "";

        const getRowArray = (row: ExcelJS.Row): string[] => {
          const rawValues = Array.isArray(row.values) ? row.values : [];
          const arr: string[] = [];
          for (let i = 1; i < rawValues.length; i++) {
            const v = rawValues[i];
            arr.push(v !== null && v !== undefined ? String(v) : "");
          }
          return arr;
        };

        workbook.eachSheet((sheet) => {
          sheetContext += `Planilha: ${sheet.name}\n`;
          if (sheet.rowCount === 0) return;

          let headerRow: ExcelJS.Row | null = null;
          let maxScore = -1;
          let ufIdx = -1;
          let munIdx = -1;
          let formatIdx = -1;
          let envIdx = -1;
          let partnerIdx = -1;
          let priceIdx = -1;
          let periodIdx = -1;

          // Scan the first 20 rows to find the headers row dynamically
          sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber > 20) return;
            const vals = getRowArray(row).map(v => String(v || "").toUpperCase());
            const curUfIdx = vals.findIndex(v => v === "UF" || v === "ESTADO");
            const curMunIdx = vals.findIndex(v => v && (v.includes("MUNIC") || v.includes("CIDADE") || v.includes("PRACA") || v.includes("PRAÇA") || v.includes("LOCALIDADE")));

            if (curUfIdx !== -1 && curMunIdx !== -1) {
              let score = 2; // matches UF and City
              
              let curFormatIdx = vals.findIndex(v => v && (v.includes("FORMATO") || v.includes("COMERCIAL") || v.includes("TIPO DE M") || v.includes("TIPOLOGIA")));
              if (curFormatIdx === -1) {
                curFormatIdx = vals.findIndex(v => v && v.includes("VERTICAL"));
              }

              let curEnvIdx = vals.findIndex(v => v && v.includes("AMBIENTE"));
              if (curEnvIdx === -1) {
                curEnvIdx = vals.findIndex(v => v && v.includes("LOCAL"));
              }
              if (curEnvIdx === -1) {
                curEnvIdx = vals.findIndex(v => v && v.includes("VERTICAL"));
              }

              const curPartnerIdx = vals.findIndex(v => v && (v.includes("PARCEIRO") || v.includes("RAZÃO SOCIAL") || v.includes("RAZAO SOCIAL") || v.includes("FORNECEDOR") || v.includes("EMPRESA")));

              const curPriceIdx = vals.findIndex(v => v && (v.includes("VALOR") || v.includes("CUSTO") || v.includes("PREÇO") || v.includes("PRECO") || v.includes("TABELA") || v.includes("UNITÁRIO") || v.includes("UNITARIO") || v.includes("R$") || v.includes("INVESTIMENTO")));
              const curPeriodIdx = vals.findIndex(v => v && (v.includes("PERÍODO") || v.includes("PERIODO") || v.includes("BISEMANA") || v.includes("VEICULA")));

              if (curFormatIdx !== -1) score++;
              if (curEnvIdx !== -1) score++;
              if (curPartnerIdx !== -1) score++;
              if (curPriceIdx !== -1) score += 2; // preço é o dado mais valioso

              if (score > maxScore) {
                maxScore = score;
                headerRow = row;
                ufIdx = curUfIdx;
                munIdx = curMunIdx;
                formatIdx = curFormatIdx;
                envIdx = curEnvIdx;
                partnerIdx = curPartnerIdx;
                priceIdx = curPriceIdx;
                periodIdx = curPeriodIdx;
              }
            }
          });

          if (headerRow && ufIdx !== -1 && munIdx !== -1) {
            // Smart parse: group and aggregate all rows to avoid truncation
            const groups: Record<string, { uf: string; cidade: string; items: Set<string> }> = {};

            sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
              if (rowNumber <= (headerRow as ExcelJS.Row).number) return; // Skip headers
              const vals = getRowArray(row);
              const uf = (vals[ufIdx] || "").trim();
              const cidade = (vals[munIdx] || "").trim();
              if (!uf || !cidade) return;

              const key = `${uf}-${cidade}`.toUpperCase();
              if (!groups[key]) {
                groups[key] = { uf, cidade, items: new Set() };
              }

              const format = formatIdx !== -1 ? (vals[formatIdx] || "").trim() : "";
              const env = envIdx !== -1 ? (vals[envIdx] || "").trim() : "";
              const partner = partnerIdx !== -1 ? (vals[partnerIdx] || "").trim() : "";
              const price = priceIdx !== -1 ? (vals[priceIdx] || "").trim() : "";
              const period = periodIdx !== -1 ? (vals[periodIdx] || "").trim() : "";

              let itemDesc = format || "Mídia OOH";
              const details: string[] = [];
              if (env) details.push(`Ambiente: ${env}`);
              if (partner) details.push(`Parceiro/Fonte: ${partner}`);
              if (price) {
                // Célula numérica do Excel chega como "15000.5" (ponto decimal US);
                // texto BR chega como "R$ 15.000,00" (ponto de milhar + vírgula decimal)
                const rawPrice = String(price).replace(/[^\d.,]/g, "");
                const priceNum = /^\d+(\.\d+)?$/.test(rawPrice)
                  ? parseFloat(rawPrice)
                  : parseFloat(rawPrice.replace(/\./g, "").replace(",", "."));
                const priceFmt = !isNaN(priceNum) && priceNum > 0
                  ? `R$ ${priceNum.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                  : price;
                details.push(`Preço Tabela: ${priceFmt}${period ? ` por ${period}` : ""}`);
              }
              if (details.length > 0) {
                itemDesc += ` (${details.join(", ")})`;
              }

              groups[key].items.add(itemDesc);
            });

            // Caps para não estourar o limite de contexto do LLM (com preços,
            // cada linha vira única — sem cap, 3000+ linhas = prompt gigante).
            // Praças do briefing (cityFilter) recebem inventário COMPLETO;
            // as demais, resumo de 1 linha.
            const MAX_ITEMS_BRIEFING_CITY = 60;
            const MAX_ITEMS_PER_CITY = 12;
            const MAX_SHEET_CHARS = 24000;
            sheetContext += `Resumo do Inventário de Mídia:\n`;
            // Praças do briefing primeiro, para nunca serem cortadas pelo teto de espaço
            const sortedKeys = Object.keys(groups).sort((a, b) => {
              const pa = isBriefingCity(groups[a].cidade) ? 0 : 1;
              const pb = isBriefingCity(groups[b].cidade) ? 0 : 1;
              return pa - pb || a.localeCompare(b);
            });
            for (const key of sortedKeys) {
              if (sheetContext.length > MAX_SHEET_CHARS) {
                sheetContext += `(... demais praças omitidas por limite de espaço ...)\n`;
                break;
              }
              const g = groups[key];
              const itemsArr = Array.from(g.items);
              const isPriority = isBriefingCity(g.cidade);
              // Formatos que o cliente pediu entram SEMPRE, em qualquer praça
              const requested = itemsArr.filter(isRequestedFormat);
              const others = itemsArr.filter((i) => !requested.includes(i));

              if (cityFilterNorm.length > 0 && !isPriority) {
                // Fora do briefing: 1 linha — mas formatos pedidos aparecem mesmo assim
                sheetContext += `- ${g.cidade.toUpperCase()} (${g.uf.toUpperCase()}): ${itemsArr.length} formatos disponíveis (fora das praças do briefing)\n`;
                requested.slice(0, 6).forEach(item => {
                  sheetContext += `  * [FORMATO SOLICITADO] ${item}\n`;
                });
                continue;
              }
              const cap = isPriority ? MAX_ITEMS_BRIEFING_CITY : MAX_ITEMS_PER_CITY;
              sheetContext += `- ${g.cidade.toUpperCase()} (${g.uf.toUpperCase()})${isPriority ? " [PRAÇA DO BRIEFING — inventário completo]" : ""}:\n`;
              // Pedidos primeiro (sem contar no cap), depois os demais até o cap
              requested.forEach(item => {
                sheetContext += `  * [FORMATO SOLICITADO] ${item}\n`;
              });
              others.slice(0, cap).forEach(item => {
                sheetContext += `  * ${item}\n`;
              });
              if (others.length > cap) {
                sheetContext += `  * (+${others.length - cap} outros formatos/cotas nesta praça)\n`;
              }
            }
          } else {
            // Fallback: raw print first 100 rows
            let rowCount = 0;
            sheet.eachRow({ includeEmpty: false }, (row) => {
              if (rowCount > 100) return;
              const vals = getRowArray(row);
              sheetContext += vals.join(" | ") + "\n";
              rowCount++;
            });
          }
        });
        return resourceContext + sheetContext.slice(0, 25000);
      } else if (ext === ".csv" || ext === ".txt" || ext === ".json" || ext === ".md") {
        // Read directly as string
        const text = nodeBuffer.toString("utf-8");
        return resourceContext + text.slice(0, 10000) + "\n"; // Limit to 10k chars
      } else if (ext === ".pdf" || ext === ".docx" || ext === ".doc" || ext === ".pptx") {
        // Run python parser
        const tempDir = path.join(__dirname, "temp_resources");
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        // Use a unique name for parallel processing safety
        const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
        fs.writeFileSync(tempFilePath, nodeBuffer);

        try {
          const parserScript = path.join(__dirname, "parse_file.py");
          const stdout = execSync(`"${process.env.PYTHON_CMD || "python"}" "${parserScript}" "${tempFilePath}"`, { encoding: "utf-8" });
          return resourceContext + stdout.slice(0, 10000) + "\n"; // Limit to 10k chars
        } catch (err: any) {
          console.error(`[Resource Parser] Python execution failed:`, err);
          return resourceContext + `[Erro ao extrair conteúdo do arquivo: ${err.message}]\n`;
        } finally {
          // Clean up temp file
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        }
      } else {
        return resourceContext + `[Formato não suportado para leitura direta: ${ext}]\n`;
      }
    } catch (err: any) {
      console.error(`[Resource Parser] Error processing resource ${resource.name}:`, err);
      return `\n--- RECURSO: ${resource.name} (Tipo: ${resource.type}) ---\n[Erro ao processar recurso: ${err.message}]\n`;
    }
  });

  const parsedResults = await Promise.all(parsedPromises);
  context += parsedResults.join("\n");

  // Adiciona um inventário padrão (fallback) caso o processamento tenha falhado ou retornado vazio
  if (context.includes("Erro ao processar recurso") || userResources.length === 0 || !context.includes("Resumo do Inventário de Mídia")) {
    context += `
\n--- INVENTÁRIO PADRÃO DE BACKUP KALLAS (FALLBACK DO SISTEMA) ---
Resumo do Inventário de Mídia:
- NATAL (RN):
  * Mídia Móvel Digital em Carros de Aplicativo (Zanzar/Locar)
  * Mídia Estática e Digital em Aeroportos (Codemp/AIRMUB)
  * Estações de VLT (Codemp)
- RECIFE (PE):
  * Mobiliário Urbano Premium (All Space Grande Recife)
  * MUBs Digitais e Abrigos de Ônibus
  * Mídia Móvel Digital em Carros de Aplicativo (Zanzar/Locar)
- SALVADOR (BA):
  * Mídia Móvel Digital em Carros de Aplicativo (Zanzar/Locar)
  * Mobiliário Urbano Premium (All Space)
  * Mídia Estática e Digital em Aeroportos (AIRMUB)
- BELO HORIZONTE (MG):
  * Mídia Estática e Digital em Aeroportos (AIRMUB - Confins)
- CURITIBA (PR):
  * Mídia Estática e Digital em Aeroportos (AIRMUB)
- PORTO ALEGRE (RS):
  * Mídia Estática e Digital em Aeroportos (AIRMUB)
`;
  }

  return context;
}
