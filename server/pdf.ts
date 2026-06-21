import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Puppeteer to use local Chrome/Edge if installed (bypasses missing Chromium download)
try {
  const username = os.userInfo().username;
  const possibleChromePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    `C:\\Users\\${username}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  for (const p of possibleChromePaths) {
    if (fs.existsSync(p)) {
      process.env.PUPPETEER_EXECUTABLE_PATH = p;
      break;
    }
  }
} catch (_) { /* ignore */ }

// ─── Segment palettes ─────────────────────────────────────────────────────────
type Palette = {
  accent: string;
  secondary: string;
  dark: string;
  tint: string;
  tintSec: string;
};

// Identidade visual KALLAS (espelha o deck/PPT): vermelho Kallas #E20613 + base escura
// quase-preta #1E1A17 + branco. `tint` aqui é um vermelho bem claro p/ fundos sutis (cards,
// linhas de tabela). Variações por segmento mantêm a base Kallas e só trocam o acento
// (igual ao deck): varejo laranja, tecnologia roxo, financeiro azul.
const PALETTES: Record<string, Palette> = {
  default:          { accent: "#E20613", secondary: "#1C1510", dark: "#1E1A17", tint: "#FBEAEA", tintSec: "#FAFAFA" },
  infantil:         { accent: "#E20613", secondary: "#1C1510", dark: "#1E1A17", tint: "#FBEAEA", tintSec: "#FAFAFA" },
  baby:             { accent: "#E20613", secondary: "#1C1510", dark: "#1E1A17", tint: "#FBEAEA", tintSec: "#FAFAFA" },
  higiene_infantil: { accent: "#E20613", secondary: "#1C1510", dark: "#1E1A17", tint: "#FBEAEA", tintSec: "#FAFAFA" },
  food_beverage:    { accent: "#E20613", secondary: "#1C1510", dark: "#1E1A17", tint: "#FBEAEA", tintSec: "#FAFAFA" },
  healthcare:       { accent: "#E20613", secondary: "#1C1510", dark: "#1E1A17", tint: "#FBEAEA", tintSec: "#FAFAFA" },
  automotive:       { accent: "#E20613", secondary: "#1C1510", dark: "#1E1A17", tint: "#FBEAEA", tintSec: "#FAFAFA" },
  retail:           { accent: "#D97706", secondary: "#1C1510", dark: "#1F2937", tint: "#FEF3E7", tintSec: "#FAFAFA" },
  technology:       { accent: "#7C3AED", secondary: "#0F172A", dark: "#0F172A", tint: "#F3EDFF", tintSec: "#FAFAFA" },
  finance:          { accent: "#1E3A8A", secondary: "#1F2937", dark: "#111827", tint: "#EAF0FB", tintSec: "#FAFAFA" },
  other:            { accent: "#E20613", secondary: "#1C1510", dark: "#1E1A17", tint: "#FBEAEA", tintSec: "#FAFAFA" },
};

const SEGMENT_NAMES: Record<string, string> = {
  retail: "Varejo",
  technology: "Tecnologia",
  finance: "Financeiro",
  automotive: "Automotivo",
  food_beverage: "Alimentos e Bebidas",
  healthcare: "Saúde",
  real_estate: "Imobiliário",
  education: "Educação",
  other: "",
};

function getPalette(segment: string): Palette {
  const k = segment.toLowerCase().replace(/[\s-]/g, "_");
  return PALETTES[k] ?? PALETTES.other;
}

function getSegmentName(segment: string): string {
  const k = segment.toLowerCase().replace(/[\s-]/g, "_");
  return SEGMENT_NAMES[k] ?? "";
}

// Logo Kallas (mesmo arquivo local que o deck/PPT usa). Opcional: se não achar, cai p/ texto.
function getKallasLogoBase64(): string | null {
  try {
    const p = path.join(process.cwd(), "scratch/pptx_extracted_media/image1.png");
    if (fs.existsSync(p)) return fs.readFileSync(p).toString("base64");
  } catch { /* logo é opcional */ }
  return null;
}

// ─── Text cleaners ─────────────────────────────────────────────────────────────
export function cleanMarkdown(raw: string): string {
  if (!raw) return "";
  return raw
    // Remove emojis and non-ASCII
    .replace(/[^\x00-\x7E\xC0-\xFF]/g, "")
    // Remove internal fallback phrases
    .replace(/.*(?:Ajuste Solicitado|IA Offline|Aplique manualmente|\[TEMPLATE\]).*\n?/gi, "")
    // Clean up extra blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanText(raw: string): string {
  if (!raw) return "";
  return cleanMarkdown(raw)
    // Strip markdown formatting for headers, bold, etc.
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    .replace(/^>+\s*/gm, "")
    .replace(/^[|\-:\s]+$/gm, "")
    .trim();
}

// Convert cleaned markdown to semantic HTML sections
function markdownToHtmlBody(markdown: string): string {
  const cleaned = cleanMarkdown(markdown);
  let html = cleaned;

  // Escape HTML tags
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold (**text** or __text__)
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.*?)__/g, "<strong>$1</strong>");

  // Italic (*text* or _text_)
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.*?)_/g, "<em>$1</em>");

  // Headers (converting to h2 and h3)
  html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*?)$/gm, "<h2>$1</h2>"); // map H1 to H2 to match our section layout

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Blockquotes -> Highlight cards
  html = html.replace(/^\s*>\s*(.*?)$/gm, '<div class="highlight-card">$1</div>');

  // Tables
  const lines = html.split("\n");
  let inTable = false;
  let tableHeader = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      
      const isSeparator = cells.every(c => c.match(/^:+|-+:*$/));
      if (isSeparator) {
        lines[i] = "";
        tableHeader = false;
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableHeader = true;
        lines[i] = "<table>\n  <thead>\n    <tr>\n" + cells.map(c => `      <th>${c}</th>`).join("\n") + "\n    </tr>\n  </thead>\n  <tbody>";
      } else {
        if (tableHeader) {
          lines[i] = "    <tr>\n" + cells.map(c => `      <th>${c}</th>`).join("\n") + "\n    </tr>\n  </thead>\n  <tbody>";
          tableHeader = false;
        } else {
          lines[i] = "    <tr>\n" + cells.map(c => `      <td>${c}</td>`).join("\n") + "\n    </tr>";
        }
      }
    } else {
      if (inTable) {
        inTable = false;
        lines[i] = "  </tbody>\n</table>\n" + lines[i];
      }
    }
  }
  html = lines.join("\n");

  // Lists
  html = html.replace(/^\s*[-*•]\s+(.*?)$/gm, "<li>$1</li>");
  // Wrap contiguous lists in <ul>
  html = html.replace(/(<li>(?:[\s\S]*?)<\/li>)+/g, (match) => `<ul>\n${match}\n</ul>`);

  // Paragraphs
  html = html.split("\n").map(line => {
    const trimmed = line.trim();
    if (trimmed === "") return "";
    if (
      trimmed.startsWith("<table") || trimmed.startsWith("</table") || 
      trimmed.startsWith("<tr") || trimmed.startsWith("</tr") || 
      trimmed.startsWith("<td") || trimmed.startsWith("<th") || 
      trimmed.startsWith("<thead") || trimmed.startsWith("</thead") || 
      trimmed.startsWith("<tbody") || trimmed.startsWith("</tbody") || 
      trimmed.startsWith("<h") || trimmed.startsWith("</h") || 
      trimmed.startsWith("<ul") || trimmed.startsWith("</ul") || 
      trimmed.startsWith("<li") || trimmed.startsWith("</li") || 
      trimmed.startsWith("<hr") || trimmed.startsWith("<div") || 
      trimmed.startsWith("</div") || trimmed.startsWith("<p") || 
      trimmed.startsWith("</p")
    ) {
      return line;
    }
    return `<p>${trimmed}</p>`;
  }).join("\n");

  return html;
}

// ─── Main HTML builder ────────────────────────────────────────────────────────
function buildProposalHtml(proposal: {
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  createdAt: Date;
}, segment: string): string {
  const P = getPalette(segment);
  const segName = getSegmentName(segment);
  const dateStr = proposal.createdAt.toLocaleDateString("pt-BR");
  const body = markdownToHtmlBody(proposal.proposalContent);
  const logoB64 = getKallasLogoBase64();

  const clientNameClean = cleanText(proposal.clientName);
  const companyClean = cleanText(proposal.clientCompany);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proposta Comercial — ${clientNameClean}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Arial', 'Helvetica Neue', system-ui, sans-serif;
    background-color: #FFFFFF;
    color: #2B3440;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Header ─────────────────────────────────────── */
  .header {
    background-color: ${P.dark};
    padding: 30px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
  }
  .header-left {
    flex: 1;
  }
  .header-client {
    font-family: 'Georgia', 'Times New Roman', serif;
    font-size: 28pt;
    font-weight: bold;
    color: #FFFFFF;
    line-height: 1.2;
    margin-bottom: 6px;
  }
  .header-subtitle {
    font-size: 14pt;
    font-weight: 300;
    color: ${P.tint};
    margin-bottom: 4px;
  }
  .header-segment {
    font-size: 12pt;
    color: ${P.tint};
    font-style: italic;
    opacity: 0.85;
  }
  .header-right {
    text-align: right;
    flex-shrink: 0;
  }
  .kallas-logo {
    font-size: 12pt;
    font-weight: bold;
    color: #E20613;
    letter-spacing: 1px;
    margin-bottom: 4px;
    text-align: right;
  }
  .header-date {
    font-size: 11pt;
    color: ${P.tint};
    opacity: 0.8;
  }

  /* ── Content ─────────────────────────────────────── */
  .content {
    padding: 0;
  }

  /* Meta info card */
  .meta-card {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    background-color: ${P.tint};
    border-left: 4px solid ${P.accent};
    border-radius: 4px;
    padding: 16px;
    margin-bottom: 24px;
    font-size: 11pt;
    color: #2B3440;
  }
  .meta-card strong {
    color: ${P.accent};
  }
  /* Escopo ocupa a largura inteira do card (texto longo não fica espremido em meia coluna) */
  .meta-escopo {
    grid-column: 1 / -1;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid ${P.accent}33;
    line-height: 1.6;
  }

  /* Sections and typography */
  h2, h3 {
    font-family: 'Arial', sans-serif;
    color: ${P.accent};
    font-size: 16pt;
    font-weight: bold;
    margin: 24px 0 12px 0;
    padding-bottom: 6px;
    border-bottom: 2px solid ${P.tint};
    page-break-after: avoid;
  }
  h3 {
    font-size: 13pt;
    border-bottom: 1px solid ${P.tint};
  }

  p, li {
    font-size: 11pt;
    color: #2B3440;
    line-height: 1.7;
    margin-bottom: 12px;
  }
  ul {
    margin: 8px 0 16px 24px;
  }
  li {
    margin-bottom: 6px;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    font-size: 11px;
    page-break-inside: avoid;
  }
  th, td {
    padding: 10px 12px;
    text-align: left;
    border: 1px solid #DFE6EC;
  }
  th {
    background-color: ${P.accent};
    color: #FFFFFF;
    font-weight: bold;
  }
  tbody tr:nth-child(even) {
    background-color: ${P.tint};
  }
  tbody tr:nth-child(odd) {
    background-color: #FFFFFF;
  }

  /* Highlight card */
  .highlight-card {
    background-color: ${P.tint};
    border-left: 4px solid ${P.accent};
    border-radius: 4px;
    padding: 16px;
    margin: 20px 0;
    color: #2B3440;
    page-break-inside: avoid;
  }
  .highlight-card .number {
    font-family: 'Georgia', serif;
    font-size: 28pt;
    font-weight: bold;
    color: ${P.accent};
    margin-bottom: 4px;
  }

  hr {
    border: none;
    border-top: 1px solid #DFE6EC;
    margin: 24px 0;
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="header-client">${clientNameClean}</div>
    <div class="header-subtitle">${companyClean}</div>
    ${segName ? `<div class="header-segment">${segName}</div>` : ""}
  </div>
  <div class="header-right">
    ${logoB64
      ? `<span style="display:inline-block;background:#FFFFFF;border-radius:4px;padding:5px 9px;margin-bottom:8px;"><img src="data:image/png;base64,${logoB64}" alt="Kallas" style="height:28px;display:block;"/></span>`
      : `<div class="kallas-logo">Kallas OOH</div>`}
    <div class="header-date">${dateStr}</div>
  </div>
</div>

<div class="content">
  <!-- Meta card -->
  <div class="meta-card">
    <div><strong>Cliente:</strong> ${clientNameClean}</div>
    <div><strong>Data:</strong> ${dateStr}</div>
    <div><strong>Empresa:</strong> ${companyClean}</div>
    ${proposal.clientContact ? `<div><strong>Contato:</strong> ${cleanText(proposal.clientContact)}</div>` : ""}
    ${proposal.deadline ? `<div><strong>Prazo:</strong> ${cleanText(proposal.deadline)}</div>` : ""}
    ${proposal.commercialTerms ? `<div><strong>Condições:</strong> ${cleanText(proposal.commercialTerms)}</div>` : ""}
    <div class="meta-escopo"><strong>Escopo:</strong> ${cleanText(proposal.projectScope)}</div>
  </div>

  <!-- Highlight: investment -->
  <div class="highlight-card">
    <div class="number">${cleanText(proposal.values)}</div>
    <div>Investimento total da campanha</div>
  </div>

  <!-- Proposal body -->
  <div class="proposal-body">
    ${body}
  </div>
</div>

</body>
</html>`;
}

// ─── Generate PDF buffer ───────────────────────────────────────────────────────
export async function generateProposalPDF(proposal: {
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  createdAt: Date;
}): Promise<Buffer> {
  // Detect segment from proposalContent
  const segMatch = proposal.proposalContent.match(/[Ss]egmento[:\s]+([\w_]+)/);
  const segment = segMatch ? segMatch[1].toLowerCase() : "other";

  const html = buildProposalHtml(proposal, segment);

  const clientNameClean = cleanText(proposal.clientName);
  const dateStr = proposal.createdAt.toLocaleDateString("pt-BR");

  // Try html-pdf-node (puppeteer-based)
  try {
    const requireFn = createRequire(import.meta.url);
    const htmlPdf = requireFn("html-pdf-node");

    const file = { content: html };
    const options = {
      format: "A4",
      margin: { top: "40px", bottom: "60px", left: "40px", right: "40px" },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="font-family: Arial, sans-serif; font-size: 9pt; color: #9CA3AF; width: 100%; padding: 0 40px; box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #DFE6EC;">
          <div>
            <span style="color: #E20613; font-weight: bold;">Kallas</span> &middot; Mídia OOH &middot; ${clientNameClean} &middot; ${dateStr}
          </div>
          <div>
            Página <span class="pageNumber"></span> de <span class="totalPages"></span>
          </div>
        </div>
      `
    };

    const pdfBuffer: Buffer = await htmlPdf.generatePdf(file, options);
    return pdfBuffer;
  } catch (puppeteerErr) {
    console.warn("[PDF] html-pdf-node indisponivel, usando HTML buffer como fallback:", puppeteerErr);
    // Fallback: return the HTML as a buffer (will be served as PDF content-type anyway)
    return Buffer.from(html, "utf-8");
  }
}
