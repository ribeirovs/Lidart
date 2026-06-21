import { storagePut } from "./storage";
import { generateProposalPDF, cleanText, cleanMarkdown } from "./pdf";

export async function exportProposalToPDF(proposal: {
  id: number;
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  createdAt: Date;
}): Promise<{ url: string; key: string }> {
  const pdfBuffer = await generateProposalPDF(proposal);
  const safeClientName = proposal.clientName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\.-]/g, "");
  const filename = `proposta_${safeClientName}_${proposal.id}.pdf`;
  const key = `proposals/${proposal.id}/${filename}`;

  const result = await storagePut(key, pdfBuffer, "application/pdf");
  return result;
}

export async function exportProposalToText(proposal: {
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  createdAt: Date;
}): Promise<{ url: string; key: string }> {
  const clientNameClean = cleanText(proposal.clientName);
  const companyClean = cleanText(proposal.clientCompany);
  const contactClean = proposal.clientContact ? cleanText(proposal.clientContact) : "";
  const scopeClean = cleanText(proposal.projectScope);
  const valuesClean = cleanText(proposal.values);
  const deadlineClean = proposal.deadline ? cleanText(proposal.deadline) : "";
  const termsClean = proposal.commercialTerms ? cleanText(proposal.commercialTerms) : "";
  const contentClean = cleanText(proposal.proposalContent);

  const textContent = `PROPOSTA COMERCIAL
Data: ${proposal.createdAt.toLocaleDateString("pt-BR")}

CLIENTE
Nome: ${clientNameClean}
Empresa: ${companyClean}
${contactClean ? `Contato: ${contactClean}` : ""}

INFORMAÇÕES DO PROJETO
Escopo: ${scopeClean}
Valores: ${valuesClean}
${deadlineClean ? `Prazo: ${deadlineClean}` : ""}
${termsClean ? `Condições Comerciais: ${termsClean}` : ""}

PROPOSTA
${contentClean}`;

  const textBuffer = Buffer.from(textContent, "utf-8");
  const safeClientName = clientNameClean
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\.-]/g, "");
  const filename = `proposta_${safeClientName}_${Date.now()}.txt`;
  const key = `proposals/text/${filename}`;

  const result = await storagePut(key, textBuffer, "text/plain");
  return result;
}

function parseMarkdownToHtml(markdown: string): string {
  let html = markdown;

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

  // Headers
  html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

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
        lines[i] = "<table>\n  <tr>\n" + cells.map(c => `    <th>${c}</th>`).join("\n") + "\n  </tr>";
      } else {
        if (tableHeader) {
          lines[i] = "  <tr>\n" + cells.map(c => `    <th>${c}</th>`).join("\n") + "\n  </tr>";
          tableHeader = false;
        } else {
          lines[i] = "  <tr>\n" + cells.map(c => `    <td>${c}</td>`).join("\n") + "\n  </tr>";
        }
      }
    } else {
      if (inTable) {
        inTable = false;
        lines[i] = "</table>\n" + lines[i];
      }
    }
  }
  html = lines.join("\n");

  // Lists
  html = html.replace(/^\s*[-*]\s+(.*?)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>(?:[\s\S]*?)<\/li>)+/g, (match) => `<ul>\n${match}\n</ul>`);

  // Paragraphs
  html = html.split("\n").map(line => {
    const trimmed = line.trim();
    if (trimmed === "") return "";
    if (trimmed.startsWith("<table") || trimmed.startsWith("</table") || trimmed.startsWith("<tr") || trimmed.startsWith("</tr") || trimmed.startsWith("<td") || trimmed.startsWith("<th") || trimmed.startsWith("<h") || trimmed.startsWith("</h") || trimmed.startsWith("<ul") || trimmed.startsWith("</ul") || trimmed.startsWith("<li") || trimmed.startsWith("</li") || trimmed.startsWith("<hr") || trimmed.startsWith("<div") || trimmed.startsWith("</div") || trimmed.startsWith("<p") || trimmed.startsWith("</p")) {
      return line;
    }
    return `<p>${trimmed}</p>`;
  }).join("\n");

  return html;
}

export async function exportProposalToHTML(proposal: {
  id: number;
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  createdAt: Date;
}): Promise<{ url: string; key: string }> {
  const clientNameClean = cleanText(proposal.clientName);
  const companyClean = cleanText(proposal.clientCompany);
  const contactClean = proposal.clientContact ? cleanText(proposal.clientContact) : "";
  const deadlineClean = proposal.deadline ? cleanText(proposal.deadline) : "";
  const termsClean = proposal.commercialTerms ? cleanText(proposal.commercialTerms) : "";

  const htmlBody = parseMarkdownToHtml(cleanMarkdown(proposal.proposalContent));
  const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proposta Comercial - ${proposal.clientName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet">
  <style>
    :root {
      --cream: #FAF6F0;
      --ink: #1C1917;
      --ink-light: #44403C;
      --primary: #C49A1A;
      --primary-dark: #A37F15;
      --border: rgba(28, 25, 23, 0.1);
    }
    body {
      font-family: 'Outfit', sans-serif;
      background-color: var(--cream);
      color: var(--ink);
      line-height: 1.6;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 800px;
      margin: 40px auto;
      background: #ffffff;
      padding: 60px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.05);
      border: 1px solid var(--border);
    }
    h1, h2, h3, h4 {
      font-family: 'Playfair Display', serif;
      color: var(--ink);
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }
    h1 {
      font-size: 2.5rem;
      border-bottom: 2px solid var(--primary);
      padding-bottom: 15px;
      margin-top: 0;
    }
    h2 {
      font-size: 1.8rem;
      color: var(--primary-dark);
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }
    p {
      margin-bottom: 1.25em;
      color: var(--ink-light);
    }
    ul, ol {
      margin-bottom: 1.5em;
      padding-left: 20px;
    }
    li {
      margin-bottom: 0.5em;
      color: var(--ink-light);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.95rem;
    }
    th, td {
      padding: 12px 15px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      background-color: rgba(196, 154, 26, 0.1);
      font-weight: 600;
      color: var(--ink);
    }
    tr:hover {
      background-color: rgba(0, 0, 0, 0.01);
    }
    .header-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 40px;
      padding: 20px;
      background: rgba(196, 154, 26, 0.05);
      border-radius: 8px;
      border-left: 4px solid var(--primary);
      font-size: 0.9rem;
    }
    .header-info div p {
      margin: 4px 0;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      max-width: 800px;
      margin: 20px auto 0 auto;
      padding: 0 10px;
    }
    .btn {
      font-family: 'Outfit', sans-serif;
      padding: 10px 20px;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background-color: var(--primary);
      color: #ffffff;
    }
    .btn-primary:hover {
      background-color: var(--primary-dark);
    }
    .btn-secondary {
      background-color: #ffffff;
      color: var(--ink);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover {
      background-color: rgba(0,0,0,0.02);
    }
    @media print {
      body {
        background-color: #ffffff;
      }
      .container {
        box-shadow: none;
        border: none;
        padding: 0;
        margin: 0;
      }
      .actions {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="actions">
    <button class="btn btn-secondary" onclick="window.close()">Fechar</button>
    <button class="btn btn-primary" onclick="window.print()">Imprimir / Salvar PDF</button>
  </div>
  <div class="container">
    <h1>Proposta Comercial</h1>
    <div class="header-info">
      <div>
        <p><strong>Cliente:</strong> ${clientNameClean}</p>
        <p><strong>Empresa:</strong> ${companyClean}</p>
        ${contactClean ? `<p><strong>Contato:</strong> ${contactClean}</p>` : ""}
      </div>
      <div>
        <p><strong>Data:</strong> ${proposal.createdAt.toLocaleDateString("pt-BR")}</p>
        ${deadlineClean ? `<p><strong>Prazo:</strong> ${deadlineClean}</p>` : ""}
        ${termsClean ? `<p><strong>Condições:</strong> ${termsClean}</p>` : ""}
      </div>
    </div>
    <div class="proposal-body">
      ${htmlBody}
    </div>
  </div>
</body>
</html>`;

  const htmlBuffer = Buffer.from(fullHtml, "utf-8");
  const safeClientName = clientNameClean
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\.-]/g, "");
  const filename = `proposta_${safeClientName}_${proposal.id}.html`;
  const key = `proposals/${proposal.id}/${filename}`;

  const result = await storagePut(key, htmlBuffer, "text/html");
  return result;
}
