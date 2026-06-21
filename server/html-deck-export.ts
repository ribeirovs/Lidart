/**
 * ============================================================
 * HTML DECK EXPORT — Apresentação interativa em HTML (estilo PPT)
 * ============================================================
 * Gera um deck navegável (bolinhas, setas, teclado) com a
 * identidade Kallas, estrutura dinâmica (nº de slides acompanha
 * o plano de mídia) e imagens reais dos formatos OOH extraídas
 * do mídia kit (.pptx) enviado nos recursos.
 * Arquivo final é autocontido (imagens embutidas em base64).
 * ============================================================
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import JSZip from "jszip";
import { storagePut } from "./storage";
import {
  parseMarkdownToSlidesServer,
  parsePlanTables,
  parseMetricsData,
  findBestSection,
  cleanText,
} from "./pptx-export";
import { resolvePlanForPresentation } from "./valuation-builder";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Identidade Kallas ────────────────────────────────────────
const C_RED = "#E20613";
const C_DARK = "#1C1510";
const C_DARK2 = "#141414";
const C_CREAM = "#FAFAFA";

// ─── Imagens dos formatos (extraídas do mídia kit pptx) ───────
type FormatImage = { keywords: string; dataUri: string };

function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Abre o mídia kit local (scratch/Modelo_-_ppt_para_apresentaAAo_Kallas.pptx),
 * associa o texto de cada slide às imagens daquele slide e devolve a lista.
 */
async function loadFormatImages(): Promise<FormatImage[]> {
  const candidates = [
    path.join(__dirname, "../scratch/Modelo_-_ppt_para_apresentaAAo_Kallas.pptx"),
  ];
  const pptxPath = candidates.find((p) => fs.existsSync(p));
  if (!pptxPath) return [];

  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
    const out: FormatImage[] = [];

    const slideNames = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10));

    for (const slideName of slideNames) {
      const slideXml = await zip.file(slideName)!.async("string");
      const texts = Array.from(slideXml.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => m[1]);
      const slideText = norm(texts.join(" "));
      if (!slideText.trim()) continue;

      const relsName = slideName.replace("slides/", "slides/_rels/") + ".rels";
      const relsFile = zip.file(relsName);
      if (!relsFile) continue;
      const relsXml = await relsFile.async("string");
      const mediaTargets = Array.from(relsXml.matchAll(/Target="\.\.\/media\/([^"]+)"/g)).map((m) => m[1]);
      if (mediaTargets.length === 0) continue;

      // Maior imagem do slide (foto do ponto, não ícone)
      let best: { name: string; size: number } | null = null;
      for (const t of mediaTargets) {
        const f = zip.file(`ppt/media/${t}`);
        if (!f) continue;
        const size = (f as any)._data?.uncompressedSize ?? 0;
        if (!best || size > best.size) best = { name: t, size };
      }
      if (!best || best.size < 25_000 || best.size > 1_200_000) continue; // ignora ícones e gigantes

      const buf = await zip.file(`ppt/media/${best.name}`)!.async("nodebuffer");
      const ext = best.name.split(".").pop()!.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
      out.push({ keywords: slideText, dataUri: `data:${mime};base64,${buf.toString("base64")}` });
    }
    console.log(`[HTML Deck] ${out.length} imagens de formato carregadas do mídia kit.`);
    return out;
  } catch (err) {
    console.error("[HTML Deck] Falha ao extrair imagens do mídia kit:", err);
    return [];
  }
}

/** Casa o nome do formato com a imagem de slide mais parecida do mídia kit. */
function matchFormatImage(formatName: string, images: FormatImage[], used: Set<string>): string | null {
  const tokens = norm(formatName).split(/\W+/).filter((t) => t.length > 3);
  if (tokens.length === 0) return null;
  let best: FormatImage | null = null;
  let bestScore = 0;
  for (const img of images) {
    let score = 0;
    for (const t of tokens) if (img.keywords.includes(t)) score++;
    if (score > bestScore || (score === bestScore && best && used.has(best.dataUri) && !used.has(img.dataUri))) {
      bestScore = score;
      best = img;
    }
  }
  if (best && bestScore >= 1) {
    used.add(best.dataUri);
    return best.dataUri;
  }
  return null;
}

// ─── Helpers de render ────────────────────────────────────────
function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mdLinesToHtml(md: string, maxItems = 8): string {
  const lines = (md || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets: string[] = [];
  const paras: string[] = [];
  for (const l of lines) {
    if (/^[-*+]\s/.test(l)) bullets.push(cleanText(l.replace(/^[-*+\s]+/, "")));
    else if (!/^[#|>]/.test(l)) {
      const c = cleanText(l);
      if (c.length > 5) paras.push(c);
    }
  }
  let html = "";
  for (const p of paras.slice(0, 3)) html += `<p>${esc(p)}</p>`;
  if (bullets.length > 0) {
    html += "<ul>" + bullets.slice(0, maxItems).map((b) => `<li>${esc(b)}</li>`).join("") + "</ul>";
  }
  return html || "<p class='muted'>—</p>";
}

function mdTableToHtml(headers: string[], rows: string[][], maxRows = 12): string {
  const th = headers.map((h) => `<th>${esc(cleanText(h))}</th>`).join("");
  const trs = rows.slice(0, maxRows).map((r) => {
    const isTotal = r.some((c) => /total/i.test(c));
    const tds = r.map((c) => `<td>${esc(cleanText(c))}</td>`).join("");
    return `<tr${isTotal ? ' class="total"' : ""}>${tds}</tr>`;
  }).join("");
  const more = rows.length > maxRows ? `<tr><td colspan="${headers.length}" class="muted">… +${rows.length - maxRows} itens (ver Excel de valoração)</td></tr>` : "";
  return `<table>${"<thead><tr>" + th + "</tr></thead>"}<tbody>${trs}${more}</tbody></table>`;
}

// ─── Geração do deck ──────────────────────────────────────────
export async function exportProposalToHTMLDeck(proposal: {
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
}): Promise<{ url: string; key: string }> {
  const content = proposal.proposalContent || "";
  const slides = parseMarkdownToSlidesServer(content, proposal.projectScope);
  const byId = (id: string) => slides.find((s) => s.id === id)?.content || "";
  // FONTE ÚNICA: plano validado quando existe; senão, fallback ao texto.
  const plano = await resolvePlanForPresentation(proposal.userId, proposal.mediaPlan);
  const planTables = !plano.vazio
    ? plano.porPraca.map((g) => ({
        title: `${g.praca} (${g.uf})`,
        headers: ["Formato", "Local/Ambiente", "Cota/Veic.", "Qtd", "Subtotal", "Parceiro"],
        rows: [
          ...g.itens.map((it) => [it.nome, it.local, `${it.cota}/${it.veiculacao}`, String(it.qtd), `R$ ${it.subtotal.toLocaleString("pt-BR")}`, it.razao]),
          ["SUBTOTAL", "", "", "", `R$ ${g.subtotal.toLocaleString("pt-BR")}`, ""],
        ],
      }))
    : parsePlanTables(content);
  const metrics = parseMetricsData(content);
  const fontesSection = findBestSection(content, [/fontes e premissas/i, /fontes$/i], undefined, 10);
  // Investimento: do plano validado quando existe; senão, do texto.
  const investimentoMd = !plano.vazio
    ? "| Praça | Subtotal Veiculação |\n| :--- | ---: |\n"
      + plano.porPraca.map((g) => `| ${g.praca} (${g.uf}) | R$ ${g.subtotal.toLocaleString("pt-BR")} |`).join("\n")
      + `\n| **TOTAL VEICULAÇÃO** | **R$ ${plano.totalVeiculacao.toLocaleString("pt-BR")}** |`
      + "\n| Produção de Peças | A preencher — planner |\n| Instalação e Manutenção | A preencher — planner |\n| Taxa de Agência | A preencher — planner |"
    : findBestSection(content, [/resumo financeiro/i, /investimento total|consolidado/i], undefined, 0);
  const formatImages = await loadFormatImages();
  const usedImages = new Set<string>();
  const dateStr = proposal.createdAt.toLocaleDateString("pt-BR");

  // ── Monta os slides em HTML ──
  const slideHtml: Array<{ label: string; html: string }> = [];

  // 1. CAPA
  slideHtml.push({
    label: "Capa",
    html: `<section class="sl capa">
      <div class="capa-bg"></div>
      <div class="capa-inner">
        <div class="kicker">PROPOSTA COMERCIAL DE MÍDIA OOH</div>
        <h1>${esc(proposal.clientName)}</h1>
        <p class="capa-scope">${esc(cleanText(proposal.projectScope).slice(0, 380))}</p>
        <div class="capa-meta"><span class="kallas">Kallas</span> Mídia OOH &nbsp;·&nbsp; ${dateStr}</div>
      </div>
    </section>`,
  });

  // 2. DEFESA
  if (byId("defesa")) slideHtml.push({
    label: "Defesa",
    html: `<section class="sl light"><div class="head"><span class="sq"></span><h2>Defesa de Praça &amp; Inventário</h2></div>
      <div class="cols-2">${mdLinesToHtml(byId("defesa"), 10)}</div></section>`,
  });

  // 3. INSIGHT
  if (byId("insight")) slideHtml.push({
    label: "Insight",
    html: `<section class="sl dark"><div class="head"><span class="sq"></span><h2>Insight de Mercado</h2></div>
      <div class="quotebox">${mdLinesToHtml(byId("insight"), 6)}</div></section>`,
  });

  // 4. CONCEITO
  if (byId("conceito")) slideHtml.push({
    label: "Conceito",
    html: `<section class="sl light"><div class="head"><span class="sq"></span><h2>Conceito Criativo</h2></div>
      <div class="cols-2">${mdLinesToHtml(byId("conceito"), 8)}</div></section>`,
  });

  // 5. ESTRATÉGIA
  if (byId("tradeoff")) slideHtml.push({
    label: "Estratégia",
    html: `<section class="sl light"><div class="head"><span class="sq"></span><h2>Estratégia de Mídia</h2></div>
      <div class="cols-2">${mdLinesToHtml(byId("tradeoff"), 10)}</div></section>`,
  });

  // 6..N PLANO DE MÍDIA — um slide por tabela, com imagem do formato
  for (const pt of planTables) {
    // imagem: tenta casar com o formato da primeira linha relevante
    const hdrsNorm = pt.headers.map((h) => norm(h));
    const fmtCol = hdrsNorm.findIndex((h) => h.includes("formato"));
    const firstFormats = pt.rows.slice(0, 3).map((r) => (fmtCol >= 0 ? r[fmtCol] : r[0]) || "").join(" ");
    const img = matchFormatImage(`${pt.title} ${firstFormats}`, formatImages, usedImages);
    slideHtml.push({
      label: "Plano",
      html: `<section class="sl light plan"><div class="head"><span class="sq"></span><h2>${esc(cleanText(pt.title).slice(0, 70))}</h2></div>
        <div class="plan-grid${img ? " with-img" : ""}">
          <div class="plan-table">${mdTableToHtml(pt.headers, pt.rows)}</div>
          ${img ? `<figure class="plan-img"><img src="${img}" alt="Formato OOH"/><figcaption>Referência visual do formato — mídia kit Kallas</figcaption></figure>` : ""}
        </div>
        <div class="fonte">Fonte: plano de mídia da proposta · Valores de tabela Kallas sujeitos a confirmação de disponibilidade.</div>
      </section>`,
    });
  }

  // INVESTIMENTO
  if (investimentoMd) {
    const tbl = investimentoMd.split("\n").filter((l) => l.trim().startsWith("|"));
    let invTable = "";
    if (tbl.length > 2) {
      const parse = (l: string) => l.split("|").map((p) => p.trim()).slice(1, -1);
      const headers = parse(tbl[0]);
      const rows = tbl.slice(1).filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim())).map(parse);
      invTable = mdTableToHtml(headers, rows, 14);
    }
    slideHtml.push({
      label: "Investimento",
      html: `<section class="sl light"><div class="head"><span class="sq"></span><h2>Plano de Investimentos</h2></div>
        ${invTable || `<div class="cols-2">${mdLinesToHtml(investimentoMd, 10)}</div>`}</section>`,
    });
  }

  // MÉTRICAS
  if (metrics.length > 0) slideHtml.push({
    label: "Métricas",
    html: `<section class="sl dark"><div class="head"><span class="sq"></span><h2>Métricas &amp; KPIs</h2></div>
      <div class="cards">${metrics.slice(0, 3).map((m) => `
        <div class="card"><div class="card-label">${esc(m.label)}</div><div class="card-val">${esc(m.val)}</div><div class="card-desc">${esc(m.desc.slice(0, 160))}</div></div>`).join("")}
      </div></section>`,
  });

  // FONTES E PREMISSAS
  if (fontesSection) slideHtml.push({
    label: "Fontes",
    html: `<section class="sl light"><div class="head"><span class="sq"></span><h2>Fontes &amp; Premissas</h2></div>
      <div class="cols-2 small">${mdLinesToHtml(fontesSection, 16)}</div></section>`,
  });

  // FECHAMENTO
  slideHtml.push({
    label: "Contato",
    html: `<section class="sl capa"><div class="capa-bg"></div>
      <div class="capa-inner">
        <h1 style="font-size:48px">Obrigado!</h1>
        <p class="capa-scope"><span class="kallas">Kallas</span> Mídia OOH · Av. Anápolis, 100 - 19º Andar · Bethaville - Barueri - SP<br/>(11) 4134-2700 · www.kallas.com.br</p>
      </div></section>`,
  });

  const total = slideHtml.length;
  const dots = slideHtml.map((_, i) => `<button class="dot${i === 0 ? " active" : ""}" data-i="${i}">${i + 1}</button>`).join("");
  const sections = slideHtml.map((s, i) => `<div class="slide${i === 0 ? " active" : ""}" id="sl${i}">${s.html}</div>`).join("\n");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proposta OOH · ${esc(proposal.clientName)} · Kallas</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=Inter:wght@300;400;600&display=swap" rel="stylesheet">
<style>
:root{--red:${C_RED};--dark:${C_DARK};--dark2:${C_DARK2};--cream:${C_CREAM};}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;overflow:hidden;font-family:'Inter',sans-serif;background:var(--dark2);}
.nav{position:fixed;top:0;left:0;right:0;height:54px;z-index:100;display:flex;justify-content:space-between;align-items:center;padding:0 32px;background:rgba(20,20,20,.94);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.06);}
.logo{font-family:'Archivo';font-weight:900;font-size:20px;color:var(--red);}.logo small{color:#bbb;font-weight:500;font-size:11px;letter-spacing:2px;margin-left:8px;}
.dots{display:flex;gap:5px;flex-wrap:wrap;max-width:560px;justify-content:center;}
.dot{width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:transparent;color:rgba(255,255,255,.4);font-size:9px;cursor:pointer;transition:.2s;}
.dot.active,.dot:hover{border-color:var(--red);color:#fff;background:rgba(226,6,19,.25);}
.arrows{display:flex;gap:8px;}.arrow{width:32px;height:32px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#999;font-size:14px;cursor:pointer;border-radius:3px;transition:.2s;}.arrow:hover{border-color:var(--red);color:#fff;}
.slides{position:fixed;top:54px;left:0;right:0;bottom:0;}
.slide{display:none;position:absolute;inset:0;overflow:auto;}
.slide.active{display:block;}
.counter{position:fixed;bottom:14px;right:32px;font-size:10px;letter-spacing:2px;color:rgba(255,255,255,.25);z-index:200;}
.sl{min-height:100%;padding:48px 60px 60px;}
.sl.light{background:var(--cream);color:#222;}
.sl.dark{background:var(--dark);color:#eee;}
.head{display:flex;align-items:center;gap:12px;margin-bottom:28px;}
.sq{width:14px;height:28px;background:var(--red);display:inline-block;}
.head h2{font-family:'Archivo';font-weight:700;font-size:26px;letter-spacing:-0.01em;}
.sl.dark .head h2{color:#fff;}
p{font-size:15px;line-height:1.7;margin-bottom:12px;max-width:1100px;}
ul{margin:8px 0 0 20px;}li{font-size:14px;line-height:1.7;margin-bottom:7px;max-width:1050px;}
.cols-2{columns:2;column-gap:48px;}.cols-2.small li{font-size:12.5px;}
.muted{color:#999;font-style:italic;}
.quotebox{border-left:4px solid var(--red);padding:8px 0 8px 28px;max-width:980px;}
.quotebox p{font-size:19px;font-weight:300;color:#f0f0f0;}
.quotebox li{color:#ddd;}
table{border-collapse:collapse;width:100%;font-size:12.5px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.06);}
th{background:var(--red);color:#fff;padding:9px 10px;text-align:left;font-weight:600;font-size:12px;}
td{padding:8px 10px;border-bottom:1px solid #eee;color:#333;}
tr:nth-child(even) td{background:#fafafa;}
tr.total td{background:#FDEBEC;color:var(--red);font-weight:700;}
.plan-grid{display:block;}
.plan-grid.with-img{display:grid;grid-template-columns:1.6fr 1fr;gap:32px;align-items:start;}
.plan-img img{width:100%;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.18);}
.plan-img figcaption{font-size:10.5px;color:#888;margin-top:8px;font-style:italic;}
.fonte{margin-top:18px;font-size:10.5px;color:#999;font-style:italic;}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:1100px;}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-top:3px solid var(--red);border-radius:8px;padding:24px;}
.card-label{font-size:11px;letter-spacing:1.5px;color:#aaa;font-weight:600;}
.card-val{font-family:'Archivo';font-weight:900;font-size:42px;color:#fff;margin:8px 0;}
.card-desc{font-size:12.5px;color:#bbb;line-height:1.6;}
.sl.capa{display:flex;align-items:center;justify-content:center;text-align:center;background:var(--dark);position:relative;}
.capa-bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(226,6,19,.16) 0%,transparent 60%);}
.capa-inner{position:relative;max-width:860px;padding:0 40px;}
.kicker{font-size:12px;letter-spacing:5px;color:var(--red);font-weight:600;margin-bottom:22px;}
.capa h1{font-family:'Archivo';font-weight:900;font-size:64px;color:#fff;letter-spacing:-0.02em;margin-bottom:24px;}
.capa-scope{font-size:15px;color:#ccc;line-height:1.8;}
.capa-meta{margin-top:34px;font-size:12px;letter-spacing:2px;color:#999;}
.kallas{color:var(--red);font-weight:700;}
@media print{.nav,.counter{display:none;}.slide{display:block!important;position:relative;page-break-after:always;}}
</style></head>
<body>
<nav class="nav">
  <div class="logo">Kallas<small>MÍDIA OOH</small></div>
  <div class="dots">${dots}</div>
  <div class="arrows"><button class="arrow" id="prev">‹</button><button class="arrow" id="next">›</button></div>
</nav>
<main class="slides">
${sections}
</main>
<div class="counter"><span id="cur">1</span> / ${total}</div>
<script>
let i=0;const n=${total};
function go(k){i=(k+n)%n;document.querySelectorAll('.slide').forEach((s,j)=>s.classList.toggle('active',j===i));document.querySelectorAll('.dot').forEach((d,j)=>d.classList.toggle('active',j===i));document.getElementById('cur').textContent=i+1;}
document.getElementById('prev').onclick=()=>go(i-1);
document.getElementById('next').onclick=()=>go(i+1);
document.querySelectorAll('.dot').forEach(d=>d.onclick=()=>go(+d.dataset.i));
document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')go(i+1);if(e.key==='ArrowLeft')go(i-1);});
</script>
</body></html>`;

  const safeName = proposal.clientName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "");
  const key = `proposals/${proposal.id}/apresentacao_${safeName}_${proposal.id}.html`;
  return storagePut(key, html, "text/html; charset=utf-8");
}
