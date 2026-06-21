import pptxgen from "pptxgenjs";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { getDb } from "./db";
import { resources, briefings } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { storageGetSignedUrl, storagePut } from "./storage";
import { resolvePlanForPresentation, type PlanoResolvido } from "./valuation-builder";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Shadow helper for premium card visual effects
const mkShadow = () => ({ type: "outer" as const, color: "000000", blur: 7, offset: 2, angle: 45, opacity: 0.10 });

// Font faces matching on-screen design system
const F_HEAD = "Segoe UI";
const F_BODY = "Segoe UI";
const KALLAS_RED = "E20613";

type Palette = {
  accent: string;
  secondary: string;
  dark: string;
  tint: string;
  tintSec: string;
};

const PPTX_PALETTES: Record<string, Palette> = {
  default:    { accent: "E20613", secondary: "1C1510", dark: "1E1A17", tint: "FFFFFF", tintSec: "FAFAFA" }, // Kallas Red
  infantil:   { accent: "E20613", secondary: "0284C7", dark: "1C1510", tint: "FFFFFF", tintSec: "FAFAFA" }, // Kids (Vermelho/Azul)
  retail:     { accent: "D97706", secondary: "1C1510", dark: "1F2937", tint: "FFFFFF", tintSec: "FAFAFA" }, // Varejo (Laranja/Cinza)
  technology: { accent: "7C3AED", secondary: "0F172A", dark: "0F172A", tint: "FFFFFF", tintSec: "FAFAFA" }, // Tecnologia (Roxo/Azul)
  finance:    { accent: "1E3A8A", secondary: "1F2937", dark: "111827", tint: "FFFFFF", tintSec: "FAFAFA" }, // Financeiro (Azul Escuro)
};

function resolvePalette(paletteId?: string, segment?: string): Palette {
  if (paletteId && PPTX_PALETTES[paletteId]) {
    return PPTX_PALETTES[paletteId];
  }
  if (segment) {
    const k = segment.toLowerCase().replace(/[\s-]/g, "_");
    if (k.includes("infantil") || k.includes("baby")) return PPTX_PALETTES.infantil;
    if (k.includes("retail") || k.includes("varejo")) return PPTX_PALETTES.retail;
    if (k.includes("technology") || k.includes("tecnologia")) return PPTX_PALETTES.technology;
    if (k.includes("finance") || k.includes("financeiro")) return PPTX_PALETTES.finance;
  }
  return PPTX_PALETTES.default;
}

// Clean markdown characters from text
export function cleanText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/\*+/g, "") // asteriscos órfãos (ex.: "Praça**", "Justificativa*:")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    .replace(/^>+\s*/gm, "")
    .replace(/^\|.*\|$/gm, "")
    .replace(/^[-|:\s]+$/gm, "")
    // normaliza pontuação tipográfica ANTES de remover não-ASCII,
    // senão "7–9h" vira "79h" e aspas/reticências somem
    .replace(/[–—]/g, "-")
    .replace(/[→›»]/g, "->")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/·•/g, "-")
    .replace(/[^\x00-\x7E\xC0-\xFF]/g, "") // remove emojis
    .replace(/\r/g, "")
    .trim();
}

function truncClean(raw: string, maxLen: number): string {
  const c = cleanText(raw);
  return c.length <= maxLen ? c : c.slice(0, maxLen - 1) + "…";
}

// Resumo que termina SEMPRE em frase completa (sem "…"): o material vai pro cliente
// (PPT/HTML) e nada pode ficar cortado no meio. Acumula frases inteiras até ~softMax
// (garante pelo menos a 1ª frase).
function completo(raw: string, softMax: number): string {
  const c = cleanText(raw);
  if (c.length <= softMax) return c;
  const sentencas = c.match(/[^.!?]+[.!?]+/g) || [c];
  let out = "";
  for (const s of sentencas) {
    if (out && out.length + s.length > softMax) break;
    out += s;
    if (out.length >= softMax) break;
  }
  return (out || sentencas[0] || c).trim();
}

// Remove linhas com preços (R$) — para slides de argumento (defesa, conceito),
// onde valores comerciais não pertencem; preço fica nas tabelas do plano
function stripPriceLines(md: string): string {
  if (!md) return md;
  return md
    .split("\n")
    .filter((l) => !/R\$\s*[\d.,]+/.test(l))
    .join("\n");
}

// Extract list items or paragraphs, ignoring tables, headers, and quote markers
function extractListOrParagraphs(markdown: string, maxItems = 5): string[] {
  if (!markdown) return [];

  const lines = markdown.split("\n").map(l => l.trim());

  // Títulos soltos em negrito ("**Visão Geral da Cobertura**") são cabeçalhos de
  // subseção, não conteúdo — sem o texto abaixo, viram "perguntas sem resposta"
  const isBareHeading = (l: string) => /^\*\*[^*]{2,70}\*\*:?$/.test(l);

  // Try to find list items (lines starting with -, *, or numbers)
  const listItems = lines
    .filter(l => !isBareHeading(l))
    .filter(l => l.startsWith("-") || l.startsWith("*") || l.startsWith("+") || /^\d+\.\s+/.test(l))
    // remove só o marcador de lista ("- ", "* ", "1. "), preservando números do conteúdo (ex.: "72% utilizam")
    .map(l => l.replace(/^\s*(?:[-*+•]\s+|\d+[.)]\s+)/, "").trim())
    // pula bullets que eram só um título em negrito (sobra "Título**" após o strip)
    .filter(l => l.length > 3 && !/^[^*]{2,70}\*\*:?$/.test(l));

  // Parágrafos de conteúdo (frases completas sob os títulos)
  const paragraphs = lines
    .filter(l => l.length > 0 && !l.startsWith("#") && !l.startsWith("|") && !isBareHeading(l))
    .filter(l => !/^[-*+]/.test(l) && !/^\d+\.\s+/.test(l))
    .map(l => l.replace(/^>\s*/, "").trim())
    .filter(l => l.length > 20); // frases reais, não rótulos

  // Mistura: prioriza bullets; completa com parágrafos se faltarem itens
  const combined = [...listItems, ...paragraphs.filter(p => !listItems.includes(p))];
  if (combined.length > 0) return combined.slice(0, maxItems);

  // Último recurso: qualquer linha de texto
  return lines
    .filter(l => l.length > 5 && !l.startsWith("#") && !l.startsWith("|"))
    .map(l => l.replace(/^>\s*/, "").trim())
    .slice(0, maxItems);
}

function shortenText(text: string, maxLen: number): string {
  if (!text) return "";
  const cleaned = cleanText(text);
  if (cleaned.length <= maxLen) return cleaned;
  
  // Truncate at word boundary up to maxLen, adding ellipsis
  let truncated = cleaned.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 20) {
    truncated = truncated.slice(0, lastSpace);
  }
  return truncated.trim() + "...";
}

// Split text by newlines and add as formatted bullets (clamped for visual aesthetics)
function addBulletList(
  slide: any,
  rawText: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  color: string,
  maxItems = 5
) {
  const lines = extractListOrParagraphs(rawText, maxItems)
    .map(line => shortenText(line, 200)); // Limit to 200 chars for richer context

  if (lines.length === 0) {
    slide.addText("Sem conteúdo disponível.", { x, y, w, h: 0.5, fontSize, color, fontFace: F_BODY, italic: true });
    return;
  }

  // Smooth font scaling based on number of items and character counts to prevent card overflow
  let adjustedFontSize = fontSize;
  let adjustedParaSpace = 6;
  let adjustedLineSpacing = 15;

  const totalChars = lines.reduce((acc, line) => acc + line.length, 0);

  if (totalChars > 600 || lines.length > 5) {
    adjustedFontSize = fontSize - 3.5;
    adjustedParaSpace = 1;
    adjustedLineSpacing = 10;
  } else if (totalChars > 400 || lines.length > 4) {
    adjustedFontSize = fontSize - 2.5;
    adjustedParaSpace = 2;
    adjustedLineSpacing = 11;
  } else if (totalChars > 250 || lines.length > 3) {
    adjustedFontSize = fontSize - 1.5;
    adjustedParaSpace = 3;
    adjustedLineSpacing = 13;
  }

  adjustedFontSize = Math.max(8, Math.min(fontSize, adjustedFontSize));

  const textObjs = lines.map(line => ({
    text: line,
    options: { bullet: true, paraSpaceAfter: adjustedParaSpace }
  }));

  slide.addText(textObjs as any, {
    x, y, w, h,
    fontSize: adjustedFontSize, fontFace: F_BODY, color,
    valign: "top",
    lineSpacing: adjustedLineSpacing,
  });
}

// Standard header helper to keep slides uniform
function addHeaderAndFooter(slide: any, pres: any, titleText: string, logoBase64: string | null, slideN: number, P: Palette) {
  // Small colored square
  slide.addShape(pres.ShapeType.rect, { x: 0.4, y: 0.25, w: 0.15, h: 0.3, fill: { color: P.accent }, line: { type: "none" } });
  
  // Title
  slide.addText(titleText.toUpperCase(), {
    x: 0.65, y: 0.25, w: 7.0, h: 0.3,
    fontSize: 18, bold: true, color: P.secondary, fontFace: F_HEAD
  });

  // Logo top-right
  if (logoBase64) {
    slide.addImage({ data: "image/png;base64," + logoBase64, x: 8.6, y: 0.15, w: 1.0, h: 0.45 });
  }

  // Divider
  slide.addShape(pres.ShapeType.line, { x: 0.4, y: 5.1, w: 9.2, h: 0, line: { color: P.secondary, width: 1, transparency: 85 } });

  // Footer text - only Kallas branding as requested
  slide.addText([
    { text: "Kallas OOH", options: { color: KALLAS_RED, bold: true } },
    { text: "  ·  Planejamento & Soluções OOH", options: { color: "6B7280" } },
  ], {
    x: 0.4, y: 5.25, w: 6.0, h: 0.28,
    fontSize: 8, fontFace: F_BODY, align: "left",
  });

  // Slide Number
  slide.addText(String(slideN), {
    x: 8.6, y: 5.25, w: 1.0, h: 0.28,
    fontSize: 8, fontFace: F_BODY, color: "9CA3AF", align: "right",
  });
}

// Fetch Kallas media assets
async function getKallasAssets(userId: number): Promise<{ logoBase64: string | null; bgBase64: string | null }> {
  let logoBase64: string | null = null;
  let bgBase64: string | null = null;

  const localLogo = path.join(process.cwd(), "scratch/pptx_extracted_media/image1.png");
  const localBg   = path.join(process.cwd(), "scratch/pptx_extracted_media/image2.jpeg");
  if (fs.existsSync(localLogo)) logoBase64 = fs.readFileSync(localLogo).toString("base64");
  if (fs.existsSync(localBg))   bgBase64   = fs.readFileSync(localBg).toString("base64");

  if (!logoBase64) {
    try {
      const db = await getDb();
      if (db) {
        const allRes = await db.select().from(resources).where(eq(resources.userId, userId)).orderBy(desc(resources.id));
        const logoRes = allRes.find(r =>
          r.name.toLowerCase().includes("logo") ||
          r.name.toLowerCase().includes("logotipo") ||
          r.name.toLowerCase().includes("kallas")
        );
        if (logoRes) {
          const url = await storageGetSignedUrl(logoRes.fileKey);
          const resp = await fetch(url);
          if (resp.ok) logoBase64 = Buffer.from(await resp.arrayBuffer()).toString("base64");
        }
      }
    } catch (_) { /* ignore */ }
  }
  return { logoBase64, bgBase64 };
}

// Parse markdown tables from text
function parseMarkdownTables(markdown: string): Array<{ headers: string[]; rows: string[][] }> {
  const lines = markdown.split("\n").map(l => l.trim());
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  let current: { headers: string[]; rows: string[][] } | null = null;
  for (const line of lines) {
    if (line.startsWith("|") && line.endsWith("|")) {
      const parts = line.split("|").map(p => p.trim()).slice(1, -1);
      if (line.includes("---")) continue;
      if (!current) { current = { headers: parts, rows: [] }; }
      else { current.rows.push(parts); }
    } else {
      if (current) { tables.push(current); current = null; }
    }
  }
  if (current) tables.push(current);
  return tables;
}

// Helper to search for a specific heading section in a markdown string (supporting levels 1, 2, 3 and reverse search)
function findSectionContent(markdown: string, headingRegex: RegExp, excludeRegex?: RegExp): string {
  const sections = markdown.split(/\n(?=##?#? )/);
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i];
    const lines = sec.trim().split("\n");
    if (lines.length === 0) continue;
    const heading = lines[0].replace(/^#+\s+\d*\.?\s*/, "").trim();
    if (headingRegex.test(heading)) {
      if (excludeRegex && excludeRegex.test(heading)) {
        continue;
      }
      return lines.slice(1).join("\n").trim();
    }
  }
  return "";
}

// Mede se uma seção tem prosa de verdade (descontando tabelas, separadores e títulos)
function sectionProseLength(content: string): number {
  return content
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("|") && !t.startsWith("---") && !t.startsWith("#");
    })
    .join(" ")
    .replace(/[*_>`]/g, "")
    .trim().length;
}

/**
 * Busca a melhor seção do markdown testando padrões EM ORDEM DE PRIORIDADE
 * (específicos primeiro, genéricos por último). A busca é HIERÁRQUICA: um
 * título absorve o conteúdo dos seus subtítulos (## engole os ### seguintes),
 * pois as propostas da IA colocam a prosa em subseções. Entre os títulos que
 * casam com o mesmo padrão, vence o de conteúdo mais rico — evita pegar
 * rodapés/apêndices que por acaso contêm a palavra-chave.
 */
export function findBestSection(
  markdown: string,
  patterns: RegExp[],
  excludeRegex?: RegExp,
  minProse = 40
): string {
  const parts = markdown.split(/\n(?=#{1,4} )/);
  const sections = parts.map((sec) => {
    const lines = sec.trim().split("\n");
    const m = lines[0]?.match(/^(#{1,4})\s+/);
    return {
      level: m ? m[1].length : 99,
      heading: (lines[0] || "").replace(/^#+\s+\d*\.?\s*/, "").trim(),
      body: lines.slice(1).join("\n").trim(),
    };
  });

  // Conteúdo hierárquico: corpo próprio + corpos das subseções até voltar ao mesmo nível
  const fullContentAt = (i: number): string => {
    const chunks = [sections[i].body];
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j].level <= sections[i].level) break;
      chunks.push(`**${sections[j].heading.replace(/\*\*/g, "")}**`, sections[j].body);
    }
    return chunks.filter(Boolean).join("\n\n").trim();
  };

  for (const pattern of patterns) {
    let best = "";
    let bestProse = 0;
    for (let i = 0; i < sections.length; i++) {
      const { heading } = sections[i];
      if (!heading || !pattern.test(heading)) continue;
      if (excludeRegex && excludeRegex.test(heading)) continue;
      const content = fullContentAt(i);
      const prose = sectionProseLength(content);
      if (prose < minProse) continue;
      if (prose > bestProse) {
        bestProse = prose;
        best = content;
      }
    }
    if (best) return best;
  }
  return "";
}

// Specialized table parser that locates the actual investment table (usually under section 5)
function parseInvestimentoTable(markdownContent: string): { headers: string[]; rows: string[][] } | null {
  // Tabela de cenários hipotéticos ("Conservador/Moderado/Agressivo") não é o plano
  const isScenarioTable = (t: { headers: string[]; rows: string[][] }) =>
    t.headers.some(h => /cen[áa]rio|perfil/i.test(h)) ||
    t.rows.some(r => /conservador|moderado|agressivo/i.test(r[0] || ""));

  const isValueTable = (t: { headers: string[]; rows: string[][] }) =>
    t.headers.some(h => /valor|custo|investimento|preço|total|budget/i.test(h)) &&
    t.rows.some(r => r.some(c => /R\$/.test(c)));

  // Busca seções por prioridade: resumo financeiro primeiro, genéricas depois
  const sections = markdownContent.split(/\n(?=##?#? )/);
  const headingPatterns = [
    /resumo financeiro/i,
    /investimento total|consolidado/i,
    /investimento|valoração|custos|planilha|mídia|preço|orçament/i,
  ];
  for (const pattern of headingPatterns) {
    for (const sec of sections) {
      const lines = sec.trim().split("\n");
      if (lines.length === 0) continue;
      const heading = lines[0].replace(/^#+\s+\d*\.?\s*/, "").trim();
      if (!pattern.test(heading)) continue;
      const tables = parseMarkdownTables(sec).filter(t => !isScenarioTable(t) && isValueTable(t));
      if (tables.length > 0) {
        // a de mais linhas tende a ser o plano detalhado/resumo, não um recorte
        return tables.sort((a, b) => b.rows.length - a.rows.length)[0];
      }
    }
  }

  // Fallback: qualquer tabela do documento com coluna de valor (e que não seja cenário)
  const allTables = parseMarkdownTables(markdownContent).filter(t => !isScenarioTable(t));
  const valued = allTables.filter(isValueTable);
  if (valued.length > 0) return valued.sort((a, b) => b.rows.length - a.rows.length)[0];
  if (allTables.length > 0) return allTables[0];
  return null;
}

// ─── Plano de mídia detalhado: uma tabela por bloco (Aeroportos, DOOH, etc.) ──
// Mesma detecção usada no Excel: tabelas com coluna "Valor Unit." e sem "%".
// Devolve cada tabela com o título da seção onde ela aparece.
export function parsePlanTables(markdownContent: string): Array<{ title: string; headers: string[]; rows: string[][] }> {
  const out: Array<{ title: string; headers: string[]; rows: string[][] }> = [];
  const lines = markdownContent.split("\n");
  let lastHeading = "Plano de Mídia";
  let current: { headers: string[]; rows: string[][] } | null = null;

  const flush = () => {
    if (!current) return;
    const hdrs = current.headers.map((h) => h.toLowerCase().replace(/\*/g, ""));
    // Aceita as variações de coluna de valor que a IA costuma gerar
    const hasValue = hdrs.some((h) =>
      h.includes("valor unit") || h.includes("custo unit") ||
      /valor (semanal|mensal|total)|investimento (semanal|mensal|total|estimado)|investimento \(?\d+/.test(h) ||
      h === "investimento" || h === "valor"
    );
    const hasItem = hdrs.some((h) => h.includes("formato") || h.includes("praca") || h.includes("praça") || h.includes("aeroporto") || h.includes("ativacao") || h.includes("ativação"));
    const hasPercent = hdrs.some((h) => h.includes("%"));
    if (hasValue && hasItem && !hasPercent && current.rows.length > 0) {
      out.push({ title: lastHeading, headers: current.headers, rows: current.rows });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,4}\s/.test(line)) {
      flush();
      const h = cleanText(line.replace(/^#+\s*/, "")).replace(/^[\d.\s]+/, "").trim();
      if (h) lastHeading = h;
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      const parts = line.split("|").map((p) => p.trim()).slice(1, -1);
      if (parts.every((p) => /^:?-+:?$/.test(p))) continue;
      if (!current) current = { headers: parts, rows: [] };
      else current.rows.push(parts);
    } else {
      flush();
    }
  }
  flush();
  return out;
}

// Parses metrics/objectives tables into Slide 8 cards
export function parseMetricsData(markdownContent: string): Array<{ label: string; val: string; desc: string }> {
  const sections = markdownContent.split(/\n(?=##?#? )/);
  let targetSection = "";
  for (const sec of sections) {
    const lines = sec.trim().split("\n");
    if (lines.length === 0) continue;
    const heading = lines[0].replace(/^#+\s+\d*\.?\s*/, "").trim();
    if (/objetivo|métrica|kpi|sucesso/i.test(heading)) {
      targetSection = sec;
      break;
    }
  }

  if (targetSection) {
    const tables = parseMarkdownTables(targetSection);
    if (tables.length > 0 && tables[0].rows.length > 0) {
      return tables[0].rows.slice(0, 3).map(row => {
        return {
          label: cleanText(row[0] || "").toUpperCase(),
          val: cleanText(row[1] || ""),
          desc: cleanText(row[2] || "")
        };
      });
    }
  }

  // Bullets "**Label:** valor" dentro da seção de KPIs (formato típico da proposta da IA)
  const kpiSection = findBestSection(markdownContent, [
    /kpis projetados|entreg[áa]veis da campanha/i,
    /m[ée]tricas\s*&?\s*roi|impactos projetados/i,
    /m[ée]trica|kpi|objetivos|sucesso/i,
  ], undefined, 20);
  if (kpiSection) {
    const labeled = Array.from(kpiSection.matchAll(/^[-*+]\s*\*{0,2}([^:*\n]{2,40})\*{0,2}:\s*(.+)$/gm))
      .map((m) => ({ label: cleanText(m[1]).toUpperCase(), rest: cleanText(m[2]) }))
      .filter((m) => m.label && m.rest);
    if (labeled.length >= 2) {
      return labeled.slice(0, 3).map((m) => {
        const valMatch = m.rest.match(/~?[\d.,]+\s*(?:%|MM|mm|milh[õo]es|mil|x|contatos?\/semana)?/);
        return {
          label: m.label,
          val: valMatch ? valMatch[0].trim() : "Meta",
          desc: m.rest,
        };
      });
    }
  }

  // Scanning for lines containing "KPI" or "Métrica" or "Objetivo" in the entire markdown
  const kpiLines: string[] = [];
  const lines = markdownContent.split("\n");
  for (const line of lines) {
    const cleanL = line.trim();
    if ((cleanL.startsWith("-") || cleanL.startsWith("*") || /^\d+\.\s+/.test(cleanL)) && /kpi|métrica|objetivo|alcance|frequência/i.test(cleanL)) {
      kpiLines.push(cleanL.replace(/^\s*(?:[-*+•]\s+|\d+[.)]\s+)/, "").trim());
    }
  }

  if (kpiLines.length >= 2) {
    return kpiLines.slice(0, 3).map((line, idx) => {
      const parts = line.split(/[:-]/);
      const title = parts[0]?.trim() || `KPI ${idx + 1}`;
      const desc = parts.slice(1).join(":")?.trim() || line;
      const valMatch = line.match(/\d+%/ ) || line.match(/R\$\s*[\d.,]+/ ) || line.match(/\d+\s*(?:dias|semanas|x|X)/ );
      const val = valMatch ? valMatch[0] : "Meta";

      return {
        label: title.toUpperCase(),
        val: val,
        desc: desc
      };
    });
  }

  // Default metrics fallback
  return [
    { label: "ALCANCE ESTIMADO", val: "70%+", desc: "Estimativa baseada no fluxo das praças e formatos selecionados." },
    { label: "OTS (OPPORTUNITY TO SEE)", val: "8x Mín.", desc: "Frequência média de impactos estimada por indivíduo na quinzena." },
    { label: "CPM (CUSTO POR MIL)", val: "Super Competitivo", desc: "Excelente relação custo-benefício comparado à mídia tradicional." }
  ];
}

function extractFormatsAndCities(markdownContent: string): { formats: string[]; cities: string[] } {
  const formats: string[] = [];
  const cities: string[] = [];
  const tables = parseMarkdownTables(markdownContent);
  
  // Find the media table
  const mediaTable = tables.find((t) => {
    const hdrs = t.headers.map((h) => h.toLowerCase());
    return (
      hdrs.some((h) => h.includes("item") || h.includes("nome") || h.includes("ativação") || h.includes("produto")) &&
      hdrs.some((h) => h.includes("valor") || h.includes("custo") || h.includes("r$") || h.includes("invest"))
    );
  }) ?? tables[0];

  if (mediaTable) {
    const hdrs = mediaTable.headers.map((h) => h.toLowerCase());
    const colItem = hdrs.findIndex((h) => ["item", "nome", "ativação", "produto", "ponto", "mídia"].some(k => h.includes(k)));
    const colCidade = hdrs.findIndex((h) => ["cidade", "city", "local", "localização", "praça"].some(k => h.includes(k)));
    
    mediaTable.rows.forEach(row => {
      const clean = (v: string | undefined) => (v ?? "").replace(/\*\*/g, "").trim();
      const itemVal = colItem >= 0 ? clean(row[colItem]) : clean(row[0]);
      if (itemVal && !itemVal.toLowerCase().includes("total") && itemVal.length > 3) {
        formats.push(itemVal);
      }
      const cityVal = colCidade >= 0 ? clean(row[colCidade]) : "";
      if (cityVal && !cityVal.toLowerCase().includes("total") && !cities.includes(cityVal) && cityVal.length > 2) {
        cities.push(cityVal);
      }
    });
  }
  return { formats, cities };
}

function generateDynamicJourney(markdownContent: string): Array<{ title: string; desc: string; step: string }> {
  const { formats, cities } = extractFormatsAndCities(markdownContent);
  const city = cities[0] || "principais praças";
  
  const f1 = formats[0] || "Painéis OOH";
  const f2 = formats[1] || formats[0] || "Abrigos de Ônibus";
  const f3 = formats[2] || formats[0] || "Totens UV";
  const f4 = formats[3] || formats[0] || "Painéis Digitais";

  return [
    { title: "01. Início do Trajeto", desc: `Impacto inicial na jornada com ${f1} localizados em vias de grande fluxo em ${city}.`, step: "01" },
    { title: "02. Deslocamento Diário", desc: `Presença marcante no tráfego do target com veiculações estratégicas em ${f2}.`, step: "02" },
    { title: "03. Ponto de Consumo", desc: `Conexão direta nos polos comerciais e de serviços usando formatos ${f3}.`, step: "03" },
    { title: "04. Retorno ao Lar", desc: `Fixação final da mensagem com impacto residencial em formatos ${f4} ao fim da jornada.`, step: "04" },
  ];
}

// Extracts journey steps into Slide 5 cards
function parseJornadaSteps(jornadaContent: string, fullProposalContent: string): Array<{ title: string; desc: string; step: string }> {
  const isFallback = !jornadaContent || 
    jornadaContent.includes("Planejamento dos pontos de contato") ||
    extractListOrParagraphs(jornadaContent, 4).length === 0;

  if (isFallback && fullProposalContent) {
    try {
      const dynamicItems = generateDynamicJourney(fullProposalContent);
      if (dynamicItems && dynamicItems.length > 0) {
        return dynamicItems;
      }
    } catch (e) {
      console.error("[PPTX Export] Error generating dynamic journey:", e);
    }
  }

  const lines = extractListOrParagraphs(jornadaContent, 4);
  const defaultItems = [
    { title: "Despertar & Trajeto", desc: "Digital OOH Móvel / App", step: "01" },
    { title: "Trabalho / Comercial", desc: "Painéis Corporativos / Mupis", step: "02" },
    { title: "Compras & Lazer", desc: "Abrigos de Ônibus / Relógios", step: "03" },
    { title: "Retorno ao Lar", desc: "Totens UV / Outdoors", step: "04" },
  ];

  if (lines.length > 0) {
    return lines.map((line, idx) => {
      const parts = line.split(/[:-]/);
      const title = parts[0]?.trim() || `Passo ${idx + 1}`;
      const desc = parts.slice(1).join(":")?.trim() || line;
      return {
        title: title.length > 30 ? title.slice(0, 27) + "..." : title,
        desc: desc.length > 100 ? desc.slice(0, 97) + "..." : desc,
        step: `0${idx + 1}`
      };
    });
  }

  return defaultItems;
}

interface SlideData {
  id: string;
  title: string;
  type: string;
  content: string;
}

// Dual-parsing logic that separates segments of the markdown (Strategy Workshop vs Final Proposal)
export function parseMarkdownToSlidesServer(
  markdownContent: string,
  projectScope: string
): SlideData[] {
  const fullContent = markdownContent || "";
  
  const R_DEFESA = /defesa|mercado|praça|inventário|cobertura|exclusividade|localização|geográfico/i;
  const R_EXCLUDE_DEFESA = /tabela|custo|preço|planilha|orçamento|valoração|valor/i;

  const R_CONCEITO = /conceito|criativo|ideia|mote|formato|ativação|proposta|mix|campanha/i;
  const R_EXCLUDE_CONCEITO = /defesa|cobertura|tabela|custo|preço|planilha|orçamento|valoração|valor|timeline|cronograma|calendário/i;

  const R_INVESTIMENTO = /investimento|valoração|custos|planilha|mídia|preço|orçamento|tabela|valor/i;
  const R_CRONOGRAMA = /cronograma|calendário|fechamento|prazos|comerciais|fase|etapa|implantação/i;
  const R_INSIGHT = /insight|comportamento|público/i;
  const R_JORNADA = /jornada/i;
  const R_TRADEOFF = /trade-off|tradeoff|porque/i;
  const R_METRICAS = /métrica|kpi|objetivos|sucesso/i;

  // Padrões específicos primeiro (estrutura típica das propostas geradas pela IA),
  // genéricos como rede de segurança. Seções sem prosa real (só tabela) são puladas.
  // Insight = a tese/oportunidade (a seção de comportamento agora alimenta a Defesa)
  const insightText = findBestSection(fullContent, [
    /insight/i,
    /oportunidade n[ãa]o [óo]bvia/i,
    /tend[êe]ncia da categoria/i,
    R_INSIGHT,
  ]);
  const jornadaText = findBestSection(fullContent, [R_JORNADA]);
  const tradeoffText = findBestSection(fullContent, [
    /estrat[ée]gia de m[íi]dia/i,
    R_TRADEOFF,
    /estrat[ée]gia recomendada|racional estrat[ée]gico/i,
    /por que este conceito/i,
    /formatos.*estrat[ée]gicos/i,
    /formatos|estratégicos/i,
  ]);
  const metricasText = findBestSection(fullContent, [
    /kpis projetados|m[ée]tricas\s*&?\s*roi|entreg[áa]veis/i,
    R_METRICAS,
  ]);
  // Defesa de praça = ARGUMENTO COMPORTAMENTAL (quem é o público, onde circula,
  // por que esses formatos o interceptam) — nunca lista de preços (preço é papel
  // das tabelas do plano de mídia)
  let defesaText = findBestSection(fullContent, [
    /comportamento e circula|comportamento do p[úu]blico/i,
    /perfil demogr[áa]fico/i,
    /defesa (do|de) (invent[áa]rio|m[ií]dia|pra[çc]a)/i,
    /cobertura por pra[çc]a/i,
    /pesquisa de mercado/i,
    R_DEFESA,
  ], R_EXCLUDE_DEFESA);
  defesaText = stripPriceLines(defesaText);
  let conceitoText = findBestSection(fullContent, [
    /ideia central/i,
    /conceito criativo/i,
    /ativa[çc][ãa]o.*recomendada|ativa[çc][õo]es ooh/i,
    R_CONCEITO,
  ], new RegExp(R_EXCLUDE_CONCEITO.source + "|bonifica|incluso|diferenciais", "i"));
  // Pilares do conceito: títulos das ATIVAÇÕES propostas viram bullets
  const ativacoes = Array.from(fullContent.matchAll(/^#{2,4}\s+\*{0,2}ATIVA[ÇC][ÃA]O\s*\d+\s*[:.]?\s*(.+?)\*{0,2}\s*$/gim))
    .map((m) => m[1].replace(/\*+/g, "").trim())
    .filter(Boolean);
  if (ativacoes.length > 0) {
    conceitoText += "\n\n" + ativacoes.map((a) => `- ${a}`).join("\n");
  }
  const investimentoText = findBestSection(fullContent, [
    /resumo financeiro/i,
    /plano de m[ií]dia detalhado/i,
    R_INVESTIMENTO,
  ], undefined, 0 /* tabelas valem como conteúdo aqui */);
  const cronogramaText = findBestSection(fullContent, [
    /cronograma|calend[áa]rio|implanta[çc][ãa]o|fases? d[ae]|etapas? d[ae]/i,
    /fechamento|prazos/i,
  ]);

  return [
    {
      id: "capa",
      title: "01. Capa da Proposta",
      type: "capa",
      content: projectScope || "Campanha de Mídia OOH",
    },
    {
      id: "defesa",
      title: "02. Defesa de Praça",
      type: "defesa",
      content: defesaText || "Análise detalhada das praças de veiculação e seleção de inventário premium.",
    },
    {
      id: "insight",
      title: "03. Insight de Mercado",
      type: "insight",
      content: insightText || "Estudo do comportamento do público-alvo nos trajetos diários para máxima conversão.",
    },
    {
      id: "conceito",
      title: "04. Conceito Criativo",
      type: "conceito",
      content: conceitoText || "A proposta criativa visa conectar a rotina das pessoas à marca através de estímulos sensoriais.",
    },
    {
      id: "jornada",
      title: "05. Jornada do Público",
      type: "jornada",
      content: jornadaText || "Planejamento dos pontos de contato ao longo da rotina diária do público-alvo.",
    },
    {
      id: "tradeoff",
      title: "06. Estratégia de Mídia",
      type: "tradeoff",
      content: tradeoffText || "Definição de prioridades de canais, formatos de alto impacto e cobertura ampla.",
    },
    {
      id: "investimento",
      title: "07. Plano de Investimentos",
      type: "investimento",
      content: investimentoText || "Distribuição orçamentária por praça, formatos de mídia e prazos comerciais.",
    },
    {
      id: "metricas",
      title: "08. Métricas e KPIs",
      type: "metricas",
      content: metricasText || "Objetivos numéricos de alcance, frequência de impactos e ROI projetado.",
    },
    {
      id: "cronograma",
      title: "09. Cronograma e Fechamento",
      type: "cronograma",
      content: cronogramaText || "Etapas de contratação, produção, veiculação de mídia e relatórios de acompanhamento.",
    },
  ];
}

interface SlideSelections {
  capa?: boolean;
  defesa?: boolean;
  conceito?: boolean;
  detalhes?: boolean;
  valoracao?: boolean;
  cronograma?: boolean;
  formatos?: boolean; // slide "Formatos por Cidade" (default ligado); chat liga/desliga
}

export async function exportProposalToPPTX(
  proposal: {
    id: number;
    userId: number;
    clientName: string;
    clientCompany: string;
    projectScope: string;
    values: string;
    deadline?: string | null;
    commercialTerms?: string | null;
    proposalContent: string;
    createdAt: Date;
    mediaPlan?: string | null;
  },
  selections: SlideSelections,
  paletteId?: string
): Promise<{ url: string; key: string }> {
  const PptxGenJS = (pptxgen as any).default || pptxgen;
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";

  const { logoBase64, bgBase64 } = await getKallasAssets(proposal.userId);
  // FONTE: plano validado (motor) p/ investimento; narrativa endurecida do
  // proposal_final p/ insight/conceito/jornada; dados Kallas FIXOS p/ credenciais.
  const planoResolvido = await resolvePlanForPresentation(proposal.userId, proposal.mediaPlan);
  const dateStr = proposal.createdAt.toLocaleDateString("pt-BR");

  // Briefing (capa, "por que agora", próximos passos)
  let br: any = null;
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(briefings).where(eq(briefings.proposalId, proposal.id)).limit(1);
      if (rows.length) br = rows[0];
    }
  } catch { /* briefing é opcional */ }

  // Paleta por segmento
  const segSlug = (br?.segment || proposal.proposalContent.match(/[Ss]egmento[:\s]+([\w_]+)/)?.[1] || "other").toLowerCase();
  const P = resolvePalette(paletteId, segSlug);

  const slides = parseMarkdownToSlidesServer(proposal.proposalContent, proposal.projectScope);
  const parseSlide = (id: string) => slides.find((s) => s.id === id);
  let slideN = 1;
  const pageNum = (slide: any, num: number, dark = false) =>
    slide.addText(String(num), { x: 8.6, y: 5.25, w: 1.0, h: 0.28, fontSize: 8, fontFace: F_BODY, color: dark ? "94A3B8" : "9CA3AF", align: "right" });

  // Formato dominante (p/ dado fixo Kallas dos slides 2 e 6) pela maior soma de subtotal
  const tipoTot: Record<string, number> = { carros_app: 0, aeroporto: 0, metro_transporte: 0, outro: 0 };
  for (const g of planoResolvido.porPraca) for (const it of g.itens) {
    const t = `${it.nome} ${it.local} ${it.veiculacao} ${it.razao}`.toLowerCase();
    if (/zanzar|carro.*app|carros de app|pdooh/.test(t)) tipoTot.carros_app += it.subtotal;
    else if (/aeroporto|check.?in|embarque|desembarque/.test(t)) tipoTot.aeroporto += it.subtotal;
    else if (/metr|busdoor|onibus|ônibus|abrigo|placa de rua|empena|banca/.test(t)) tipoTot.metro_transporte += it.subtotal;
    else tipoTot.outro += it.subtotal;
  }
  const dominante = Object.entries(tipoTot).sort((a, b) => b[1] - a[1])[0][0];

  // ── DADOS FIXOS KALLAS — nunca alterados pelo agente (dado fixo prevalece) ──
  const FIX_PORQUE: Record<string, string> = {
    carros_app: "Famílias AB passam 90-120 minutos por dia em deslocamentos. A Zanzar alcança 5,8 milhões de passageiros AB por mês em São Paulo, com tempo médio de exposição de 25 minutos.",
    aeroporto: "31% dos passageiros dos aeroportos Kallas têm renda acima de 10 salários mínimos. 66% têm ensino superior completo.",
    metro_transporte: "O metrô de Recife move 7 milhões de usuários por mês. 54% têm entre 18 e 39 anos.",
    outro: "A Kallas é a 3ª maior empresa de OOH do Brasil: 88 mil oportunidades de mídia e 6 mil telas digitais em 9 estados.",
  };
  const FIX_BLOCO2: Record<string, string> = {
    aeroporto: "29 aeroportos master exclusivos. 87 milhões de passageiros por ano. 31% com renda acima de 10 salários mínimos. 66% com ensino superior completo.",
    metro_transporte: "Metrô de Recife: 7 milhões de usuários por mês. 54% entre 18 e 39 anos.",
    carros_app: "Zanzar: 5,8 milhões de passageiros por mês em São Paulo. Maior tempo de exposição DOOH do mercado.",
    outro: "29 aeroportos master exclusivos. 87 milhões de passageiros por ano. 31% com renda acima de 10 salários mínimos. 66% com ensino superior completo.",
  };
  const FIX_COBERTURA = "3ª maior empresa de OOH do Brasil. 88 mil oportunidades de mídia. 6 mil telas digitais. Presença em 9 estados.";
  const FIX_PDOOH = "Zanzar Mídia, parceira exclusiva Kallas. 5,8 milhões de passageiros por mês em São Paulo. Maior tempo de exposição DOOH do mercado. Expansão para 8 mil telas em 9 capitais até julho de 2026.";
  const FIX_CONTATO = "Av. Anápolis, 100 - Bethaville - Barueri - SP    ·    (11) 4134-2700    ·    www.kallas.com.br";

  // SLIDE 1 — CAPA (nunca omitida; sem texto de corpo; placeholders se vazio)
  {
    const s = pres.addSlide();
    if (bgBase64) {
      s.addImage({ data: "image/jpeg;base64," + bgBase64, x: 0, y: 0, w: 10, h: 5.625 });
      s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: P.dark, transparency: 20 }, line: { type: "none" } });
    } else {
      s.background = { color: P.dark };
    }
    if (logoBase64) s.addImage({ data: "image/png;base64," + logoBase64, x: 8.4, y: 0.3, w: 1.2, h: 0.5 });

    s.addText("PROPOSTA COMERCIAL DE MÍDIA OOH", { x: 0.8, y: 1.0, w: 8.0, h: 0.35, fontSize: 12, fontFace: F_BODY, color: P.accent, charSpacing: 2, bold: true });

    const cliente = cleanText(br?.clientName || proposal.clientName) || "Cliente";
    const campanha = cleanText(br?.campaignName || "") || "Campanha";
    s.addText(cliente.toUpperCase(), { x: 0.8, y: 1.55, w: 8.4, h: 1.0, fontSize: 36, fontFace: F_HEAD, color: "FFFFFF", bold: true, valign: "top" });
    s.addText(campanha, { x: 0.8, y: 2.75, w: 8.4, h: 0.6, fontSize: 18, fontFace: F_BODY, color: "E2E8F0", valign: "top" });

    const meta: string[] = [];
    const periodo = cleanText(br?.campaignPeriod || "");
    const pracas = cleanText(br?.cities || planoResolvido.porPraca.map((g) => g.praca).join(", ") || "");
    if (periodo) meta.push("Período: " + periodo);
    if (pracas) {
      // Lista da capa: se passar de 90, corta no FIM de uma praça (última vírgula), nunca com "…".
      let pl = pracas;
      if (pl.length > 90) { const cut = pl.slice(0, 90); const v = cut.lastIndexOf(","); pl = (v > 0 ? cut.slice(0, v) : cut).trim(); }
      meta.push("Praças: " + pl);
    }
    meta.push("Data: " + dateStr);
    s.addText(meta.join("\n"), { x: 0.8, y: 3.7, w: 8.4, h: 1.0, fontSize: 11, fontFace: F_BODY, color: "CBD5E1", valign: "top", lineSpacing: 16 });

    s.addText([
      { text: "Kallas OOH", options: { color: KALLAS_RED, bold: true } },
      { text: "  ·  Planejamento & Soluções OOH", options: { color: "94A3B8" } },
    ], { x: 0.8, y: 4.95, w: 8.0, h: 0.3, fontSize: 9, fontFace: F_BODY });

    pageNum(s, slideN++, true);
  }

  // SLIDE 2 — POR QUE AGORA (nunca omitida; Bloco 2 é dado FIXO Kallas)
  if (selections.defesa !== false) {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    addHeaderAndFooter(s, pres, "02. Por Que Agora", logoBase64, slideN++, P);

    // Bloco 1 — comportamento do público (briefing) / fallback à narrativa
    const bloco1 = completo(br?.targetAudience || parseSlide("defesa")?.content || "Público-alvo a definir no briefing.", 300);
    s.addShape(pres.ShapeType.roundRect, { x: 0.4, y: 0.9, w: 9.2, h: 1.75, fill: { color: "FAFAFA" }, line: { color: "E5E7EB", width: 1 }, rectRadius: 0.08, shadow: mkShadow() });
    s.addText("O PÚBLICO", { x: 0.6, y: 1.05, w: 8.8, h: 0.3, fontSize: 10, bold: true, color: P.accent, fontFace: F_BODY });
    s.addText(bloco1, { x: 0.6, y: 1.4, w: 8.8, h: 1.15, fontSize: 12.5, color: P.secondary, fontFace: F_BODY, valign: "top", lineSpacing: 17 });

    // Bloco 2 — dado FIXO Kallas pelo formato dominante (ponte mercado -> inventário)
    s.addShape(pres.ShapeType.roundRect, { x: 0.4, y: 2.85, w: 9.2, h: 1.95, fill: { color: P.dark }, line: { type: "none" }, rectRadius: 0.08 });
    s.addShape(pres.ShapeType.rect, { x: 0.4, y: 2.85, w: 0.1, h: 1.95, fill: { color: P.accent }, line: { type: "none" } });
    s.addText("A MÍDIA KALLAS ENTREGA", { x: 0.65, y: 3.0, w: 8.7, h: 0.3, fontSize: 10, bold: true, color: P.accent, fontFace: F_BODY });
    s.addText(FIX_PORQUE[dominante], { x: 0.65, y: 3.4, w: 8.7, h: 1.3, fontSize: 13, color: "FFFFFF", fontFace: F_BODY, valign: "top", lineSpacing: 18 });
  }

  // SLIDE 3 — INSIGHT (nunca omitida; placeholder se vazio; afirmação máx. 2 linhas, sem bullets)
  if (selections.defesa !== false) {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    addHeaderAndFooter(s, pres, "03. Insight", logoBase64, slideN++, P);

    const insRaw = cleanText(parseSlide("insight")?.content || "");
    // Frase completa (sem "…"); fonte menor se for longa, p/ caber sem cortar.
    const afirm = insRaw ? completo(insRaw, 180) : "Insight a definir";
    s.addText(afirm, { x: 0.7, y: 1.15, w: 8.6, h: 1.9, fontSize: afirm.length > 180 ? 18 : afirm.length > 110 ? 22 : 28, bold: true, color: P.secondary, fontFace: F_HEAD, valign: "middle" });
    s.addShape(pres.ShapeType.line, { x: 0.7, y: 3.25, w: 1.0, h: 0, line: { color: P.accent, width: 3 } });

    const sup = extractListOrParagraphs(parseSlide("insight")?.content || "", 4).filter((l) => cleanText(l) !== afirm).slice(0, 2);
    sup.forEach((l, i) => s.addText(completo(l, 160), { x: 0.7, y: 3.55 + i * 0.62, w: 8.6, h: 0.58, fontSize: 11.5, color: "6B7280", fontFace: F_BODY, valign: "top" }));
  }

  // SLIDE 4 — CONCEITO (omitida se não houver mote; máx. 3 cards, sem inventar)
  if (selections.conceito !== false) {
    const cont = parseSlide("conceito")?.content || "";
    const linhas = cont.split("\n").map((l) => l.trim()).filter(Boolean);
    const quoted = linhas.map(cleanText).find((l) => /^["'].+["']$/.test(l) && l.length < 90);
    const moteCand = quoted || linhas.map(cleanText).find((l) => l.length > 8 && l.length < 80 && !/^[-*+#|>]/.test(l));
    const mote = moteCand ? cleanText(moteCand).replace(/^["']|["']$/g, "") : "";
    if (mote) {
      const s = pres.addSlide();
      s.background = { color: "FFFFFF" };
      addHeaderAndFooter(s, pres, "04. Conceito Criativo", logoBase64, slideN++, P);

      s.addText(truncClean(mote, 90), { x: 0.5, y: 1.0, w: 9.0, h: 1.1, fontSize: 30, bold: true, color: P.accent, fontFace: F_HEAD, align: "center", valign: "middle" });

      // Pilares = a lista NUMERADA "Pilares criativos" (concisa); se não houver, usa bullets.
      // Cada card termina em frase completa (sem "…"). Evita pegar bullet de ativação solto.
      const numerados = linhas.filter((l) => /^\d+[.)]\s/.test(l)).map((l) => l.replace(/^\d+[.)]\s*/, ""));
      const bullets = linhas.filter((l) => /^[-*+]\s/.test(l)).map((l) => l.replace(/^[-*+\s]+/, ""));
      const pilares = (numerados.length >= 2 ? numerados : bullets)
        .map((l) => cleanText(l)).filter((l) => l.length > 3 && !/R\$\s*[\d.,]/.test(l))
        .map((l) => completo(l, 150)).slice(0, 3);
      const n = pilares.length;
      if (n > 0) {
        const cardW = n === 1 ? 6.0 : n === 2 ? 4.4 : 2.95;
        const gap = 0.25;
        const x0 = (10 - (n * cardW + (n - 1) * gap)) / 2;
        pilares.forEach((p, i) => {
          const x = x0 + i * (cardW + gap);
          s.addShape(pres.ShapeType.roundRect, { x, y: 2.5, w: cardW, h: 2.2, fill: { color: "FAFAFA" }, line: { color: "E5E7EB", width: 1 }, rectRadius: 0.08, shadow: mkShadow() });
          s.addShape(pres.ShapeType.rect, { x, y: 2.5, w: cardW, h: 0.1, fill: { color: P.accent }, line: { type: "none" } });
          s.addText(p, { x: x + 0.2, y: 2.8, w: cardW - 0.4, h: 1.7, fontSize: 11, color: P.secondary, fontFace: F_BODY, valign: "top", lineSpacing: 15 });
        });
      }
    }
  }

  // SLIDE 5 — JORNADA DO TARGET (omitida se vazio; SEM rodapé de exclusões — regra Vivi; sem preços)
  if (selections.detalhes !== false) {
    const cont = parseSlide("jornada")?.content || "";
    // Corta no FIM DA PALAVRA (não no meio, como o "...tra…" que ficava cortado),
    // com texto mais completo — a tabela tem espaço. Fonte 9 + altura automática = cabe.
    // Termina SEMPRE em frase completa (com ponto), NUNCA com "…": o cliente só recebe o
    // PPT/HTML, então nada pode ficar cortado no meio. Acumula frases inteiras até ~softMax
    // (garante pelo menos a 1ª frase inteira).
    const frase = (s: string, softMax: number) => {
      const c = cleanText(stripPriceLines(s));
      if (c.length <= softMax) return c;
      const sentencas = c.match(/[^.!?]+[.!?]+/g) || [c];
      let out = "";
      for (const sent of sentencas) {
        if (out && out.length + sent.length > softMax) break;
        out += sent;
        if (out.length >= softMax) break;
      }
      return (out || sentencas[0] || c).trim();
    };
    const paras = extractListOrParagraphs(cont, 8).map((p) => cleanText(stripPriceLines(p)));
    const rows: string[][] = [["Momento", "Como a campanha intercepta"]];
    for (const p of paras) {
      const m = p.match(/^([^:]{3,45}):\s*(.+)$/); // "Em São Paulo: <descrição>"
      if (!m) continue;
      rows.push([m[1], frase(m[2], 220)]);
      if (rows.length > 4) break; // cabeçalho + 4 momentos
    }
    if (rows.length === 1) for (const p of paras.slice(0, 4)) rows.push(["—", frase(p, 220)]);

    if (rows.length > 1) {
      const s = pres.addSlide();
      s.background = { color: "FFFFFF" };
      addHeaderAndFooter(s, pres, "05. Jornada do Target", logoBase64, slideN++, P);
      const tableRows = rows.map((row, idx) => row.map((cell) => ({
        text: cell,
        options: { fill: idx === 0 ? { color: P.accent } : { color: idx % 2 === 0 ? "FAFAFA" : "FFFFFF" }, color: idx === 0 ? "FFFFFF" : P.secondary, bold: idx === 0, fontFace: F_BODY },
      })));
      s.addTable(tableRows as any, { x: 0.4, y: 1.0, w: 9.2, colW: [2.6, 6.6], border: { type: "solid", color: "E5E7EB", pt: 1 }, fontSize: 9, fontFace: F_BODY, align: "left", valign: "top" });
    }
  }

  // SLIDE 6 — POR QUE A KALLAS (nunca omitida; dados 100% FIXOS — agente não contribui)
  {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    addHeaderAndFooter(s, pres, "06. Por Que a Kallas", logoBase64, slideN++, P);
    const blocos = [
      { t: "COBERTURA NACIONAL", d: FIX_COBERTURA },
      { t: "INVENTÁRIO PREMIUM", d: FIX_BLOCO2[dominante] },
      { t: "PDOOH MÓVEL — ZANZAR", d: FIX_PDOOH },
    ];
    blocos.forEach((b, i) => {
      const x = 0.4 + i * 3.1;
      s.addShape(pres.ShapeType.roundRect, { x, y: 0.95, w: 2.9, h: 3.9, fill: { color: "FAFAFA" }, line: { color: "E5E7EB", width: 1 }, rectRadius: 0.08, shadow: mkShadow() });
      s.addShape(pres.ShapeType.rect, { x, y: 0.95, w: 2.9, h: 0.1, fill: { color: P.accent }, line: { type: "none" } });
      s.addText(b.t, { x: x + 0.2, y: 1.2, w: 2.5, h: 0.6, fontSize: 11, bold: true, color: P.accent, fontFace: F_HEAD, valign: "top" });
      s.addText(b.d, { x: x + 0.2, y: 1.95, w: 2.5, h: 2.8, fontSize: 11, color: P.secondary, fontFace: F_BODY, valign: "top", lineSpacing: 16 });
    });
  }

  // SLIDE 7 — O PLANO (omitida se não há plano). Sem gráfico falso: total + nota Excel + direcionamento positivo.
  if (selections.valoracao !== false && !planoResolvido.vazio) {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    addHeaderAndFooter(s, pres, "07. O Plano", logoBase64, slideN++, P);

    s.addShape(pres.ShapeType.roundRect, { x: 0.4, y: 0.95, w: 5.8, h: 3.9, fill: { color: P.dark }, line: { type: "none" }, rectRadius: 0.08 });
    s.addText("INVESTIMENTO EM VEICULAÇÃO", { x: 0.7, y: 1.25, w: 5.2, h: 0.3, fontSize: 11, bold: true, color: P.accent, fontFace: F_BODY });
    s.addText("R$ " + planoResolvido.totalVeiculacao.toLocaleString("pt-BR"), { x: 0.7, y: 1.7, w: 5.2, h: 0.9, fontSize: 40, bold: true, color: "FFFFFF", fontFace: F_HEAD });
    s.addText("Produção, instalação e taxa de agência a preencher pelo planner. Distribuição detalhada por categoria disponível na valoração em Excel.", { x: 0.7, y: 2.95, w: 5.2, h: 1.7, fontSize: 11, color: "D1D5DB", fontFace: F_BODY, valign: "top", lineSpacing: 16 });

    s.addShape(pres.ShapeType.roundRect, { x: 6.5, y: 0.95, w: 3.1, h: 3.9, fill: { color: "FAFAFA" }, line: { color: P.accent, width: 1 }, rectRadius: 0.08, shadow: mkShadow() });
    s.addText("DIRECIONAMENTO", { x: 6.7, y: 1.2, w: 2.7, h: 0.3, fontSize: 10, bold: true, color: P.accent, fontFace: F_BODY });
    const direc = completo(parseSlide("tradeoff")?.content || "Concentração de impacto nas praças e formatos do plano.", 280);
    s.addText(direc, { x: 6.7, y: 1.6, w: 2.7, h: 3.1, fontSize: 11, color: P.secondary, fontFace: F_BODY, valign: "top", lineSpacing: 15 });
  }

  // SLIDE 8 — INVESTIMENTO (omitida se não há plano). Praça | Veiculação + linhas a preencher.
  // SEM coluna "Status": todo o plano vem do catálogo Kallas, então seria sempre "Confirmado"
  // (coluna inútil, repetia a mesma palavra em toda linha).
  if (selections.valoracao !== false && !planoResolvido.vazio) {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    addHeaderAndFooter(s, pres, "08. Investimento", logoBase64, slideN++, P);

    const rows: string[][] = [["Praça", "Veiculação"]];
    planoResolvido.porPraca.forEach((g) => rows.push([`${g.praca} (${g.uf})`, "R$ " + g.subtotal.toLocaleString("pt-BR")]));
    rows.push(["TOTAL VEICULAÇÃO", "R$ " + planoResolvido.totalVeiculacao.toLocaleString("pt-BR")]);
    rows.push(["Produção de Peças", "A preencher — planner"]);
    rows.push(["Instalação e Manutenção", "A preencher — planner"]);
    rows.push(["Taxa de Agência", "A preencher — planner"]);

    const tableRows = rows.map((row, idx) => {
      const isHeader = idx === 0;
      const isTotal = /total/i.test(row[0]);
      return row.map((cell) => ({
        text: cell,
        options: { fill: isHeader ? { color: P.accent } : isTotal ? { color: P.tintSec } : { color: idx % 2 === 0 ? "FAFAFA" : "FFFFFF" }, color: isHeader ? "FFFFFF" : isTotal ? P.accent : P.secondary, bold: isHeader || isTotal, fontFace: F_BODY },
      }));
    });
    const many = rows.length > 9;
    s.addTable(tableRows as any, { x: 0.4, y: 1.0, w: 9.2, colW: [6.4, 2.8], border: { type: "solid", color: "E5E7EB", pt: 1 }, fontSize: many ? 9 : 10, fontFace: F_BODY, align: "left", valign: "middle", rowH: many ? 0.32 : 0.4 });
    s.addText("Veiculação conforme plano validado (Tabela de Preços Kallas). Produção, instalação e taxa de agência a preencher pelo planner.", { x: 0.4, y: 4.95, w: 9.2, h: 0.3, fontSize: 7.5, italic: true, color: "9CA3AF", fontFace: F_BODY });
  }

  // SLIDE 9(+) — FORMATOS POR CIDADE (paginado; omitida se não há plano). Detalha os formatos
  // do plano agrupados por praça. Dados do MOTOR (plano validado), nunca da IA. No HTML isso
  // sai com fotos reais; aqui é tabela. PAGINA automaticamente p/ NUNCA estourar a altura do
  // slide (o cliente não pode ver corte). (Pedido da Viviane.)
  // Chave PRÓPRIA `formatos` (default ligado) p/ o chat poder ligar/desligar SÓ este slide.
  if (selections.formatos !== false && !planoResolvido.vazio) {
    // Parceiro: o campo cru (razão social) é longo/sujo ("Locar Locação de Espaços... Ltda.",
    // e às vezes vem instrução de faturamento "EMITIR PARA X"). Reduz ao nome de marca.
    const limparParceiro = (raw: string): string => {
      let s = cleanText(raw || "").replace(/^emitir\s+para\s+/i, "");
      s = s.split(/\s+(?:loca[çc][ãa]o|propaganda|marketing|veicula[çc][ãa]o|publicit[áa]ri|empreendimentos|ltda|s\.?a\.?|spe|epp|eireli|matriz)\b/i)[0];
      s = s.split(/\s+e\s+/i)[0].replace(/[.,;]+$/, "").trim();
      if (s && s === s.toUpperCase()) s = s.toLowerCase().split(/\s+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
      return s || cleanText(raw);
    };
    const linhas = planoResolvido.porPraca.flatMap((g) =>
      g.itens.map((it) => ({
        praca: `${g.praca} (${g.uf})`,
        formato: cleanText(it.nome),
        parceiro: limparParceiro(it.razao || it.vertical || ""),
        veic: cleanText(it.veiculacao || ""),
      }))
    );
    const PorPag = 13;
    const paginas = Math.max(1, Math.ceil(linhas.length / PorPag));
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let pg = 0; pg < paginas; pg++) {
      const fatia = linhas.slice(pg * PorPag, (pg + 1) * PorPag);
      const s = pres.addSlide();
      s.background = { color: "FFFFFF" };
      const titulo = `${pad(slideN)}. Formatos por Cidade${paginas > 1 ? ` (${pg + 1}/${paginas})` : ""}`;
      addHeaderAndFooter(s, pres, titulo, logoBase64, slideN++, P);

      const head = ["Praça", "Formato", "Parceiro", "Veiculação"].map((h) => ({
        text: h, options: { fill: { color: P.accent }, color: "FFFFFF", bold: true, fontFace: F_BODY },
      }));
      const rows: any[][] = [head];
      let pracaAnt = "", banda = 0;
      fatia.forEach((l) => {
        const nova = l.praca !== pracaAnt;
        if (nova) banda++;
        const fill = { color: banda % 2 === 1 ? "FAFAFA" : "FFFFFF" };
        rows.push([
          { text: nova ? l.praca : "", options: { fill, color: P.accent, bold: true, fontFace: F_BODY } },
          { text: l.formato, options: { fill, color: P.secondary, fontFace: F_BODY } },
          { text: l.parceiro, options: { fill, color: P.secondary, fontFace: F_BODY } },
          { text: l.veic, options: { fill, color: P.secondary, fontFace: F_BODY } },
        ]);
        pracaAnt = l.praca;
      });
      s.addTable(rows as any, { x: 0.4, y: 0.95, w: 9.2, colW: [1.7, 4.2, 2.1, 1.2], border: { type: "solid", color: "E5E7EB", pt: 1 }, fontSize: 8.5, fontFace: F_BODY, align: "left", valign: "top", rowH: 0.27 });
      s.addText("Detalhamento dos formatos do plano por praça. A versão HTML traz as fotos reais de cada formato.", { x: 0.4, y: 4.85, w: 9.2, h: 0.3, fontSize: 7.5, italic: true, color: "9CA3AF", fontFace: F_BODY });
    }
  }

  // SLIDE FINAL — PRÓXIMOS PASSOS (nunca omitida; 3 ações; contato Kallas FIXO; sem promessa de ROI)
  {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    addHeaderAndFooter(s, pres, `${String(slideN).padStart(2, "0")}. Próximos Passos`, logoBase64, slideN++, P);

    const acoes = [
      ["Semana 1-2", "Aprovação do cenário de budget e reserva de inventário nas praças confirmadas."],
      ["Semana 3", "Cotação final para praças sem inventário direto Kallas e briefing criativo detalhado por formato."],
      ["Semana 4", "Kick-off de produção e cronograma de instalação."],
    ];
    acoes.forEach((a, i) => {
      const y = 1.0 + i * 1.15;
      s.addShape(pres.ShapeType.roundRect, { x: 0.4, y, w: 2.0, h: 0.95, fill: { color: P.accent }, line: { type: "none" }, rectRadius: 0.06 });
      s.addText(a[0], { x: 0.4, y, w: 2.0, h: 0.95, fontSize: 14, bold: true, color: "FFFFFF", fontFace: F_HEAD, align: "center", valign: "middle" });
      s.addText(a[1], { x: 2.7, y, w: 6.9, h: 0.95, fontSize: 12, color: P.secondary, fontFace: F_BODY, valign: "middle", lineSpacing: 16 });
    });

    const deadline = cleanText(br?.deadline || "");
    if (deadline) s.addText("Prazo do cliente: " + deadline, { x: 0.4, y: 4.5, w: 9.2, h: 0.3, fontSize: 9, italic: true, color: "6B7280", fontFace: F_BODY });
    s.addText([
      { text: "Kallas OOH", options: { color: KALLAS_RED, bold: true } },
      { text: "   ·   " + FIX_CONTATO, options: { color: "6B7280" } },
    ], { x: 0.4, y: 4.82, w: 9.2, h: 0.3, fontSize: 9, fontFace: F_BODY, align: "center" });
  }

  // Write & upload PPTX
  const outBuffer = await pres.write({ outputType: "nodebuffer" });
  const safe = proposal.clientName
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "");
  const filename = `apresentacao_${safe}_${proposal.id}.pptx`;
  const key = `proposals/${proposal.id}/${filename}`;
  return storagePut(key, outBuffer as Buffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
}
