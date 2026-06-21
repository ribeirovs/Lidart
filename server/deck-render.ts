/**
 * deck-render.ts — Renderizador DETERMINÍSTICO do "Deck Premium" (identidade Claude Design / Kallas).
 *
 * Arquitetura: o Opus escreve só o CONTEÚDO (DeckContent, JSON); este módulo monta o PPT
 * com o sistema de design validado. Os slides de DINHEIRO (cobertura/priorização/plano)
 * saem do PlanoResolvido (motor) — número exato, fidelidade por construção.
 *
 * IDENTIDADE (igual ao Claude Design da Kallas): páginas internas CLARAS com moldura vermelha
 * fininha; cards brancos arredondados com sombra + UM card vermelho de destaque; títulos
 * semibold; números vermelhos. Escuro SÓ em divisores de seção e, no máximo, um card de acento.
 */
import pptxgen from "pptxgenjs";
import path from "path";
import fs from "fs";
import type { PlanoResolvido } from "./valuation-builder";

// ───────────────────────── Tipos de conteúdo (vindos do Opus) ─────────────────────────
export interface DeckContent {
  capa?: { eyebrow?: string; titulo: string; subtitulo?: string };
  visaoGeral?: { titulo?: string; descricao?: string; stats?: { num: string; unidade?: string; label: string }[] };
  desafio?: { titulo?: string; stats?: { num: string; label: string }[]; consumidorTitulo?: string; consumidor?: { num: string; label: string }[] };
  insight?: { frase: string; apoio?: string };
  objetivos?: { titulo?: string; linhas?: { metrica: string; meta: string; projecao: string }[] };
  conceito?: { mote: string; descricao?: string; variacoes?: { titulo: string; texto: string }[] };
  pilares?: { num?: string; kicker: string; titulo: string; corpo: string; stats?: { num: string; label: string }[]; formatos?: string; praca?: string }[];
  ativacoes?: { titulo?: string; descricao?: string; cards?: { titulo: string; sub: string }[] };
  jornada?: { eyebrow?: string; titulo?: string; passos?: { hora: string; local: string; texto: string }[] };
  metricas?: { titulo?: string; stats?: { num: string; label: string }[]; conversaoTitulo?: string; conversao?: { valor: string; label: string; pct: number }[] };
  roi?: { numero: string; unidade?: string; descricao?: string; blocos?: { label: string; valor: string }[] };
  cronograma?: { periodo: string; texto: string; destaque?: boolean }[];
  fecho?: { eyebrow?: string; titulo: string; subtitulo?: string };
}

export interface RenderOpts {
  clientName: string;
  dateStr?: string;
  contato?: string;
  assetDir?: string;
  /** Mockups (campanha do cliente aplicada nas fotos reais dos pontos Kallas). */
  mockups?: { b64: string; mime: string; formato: string; local: string }[];
}

// ───────────────────────── Paleta / fontes ─────────────────────────
const RED = "E20613";        // vermelho Kallas (igual ao deck dela)
const REDS = "C20511";       // vermelho um tom abaixo p/ acentos
const DARK = "1E1A17";       // marrom-quase-preto quente (divisores + 1 card de acento)
const INKTX = "1A1A1A";      // texto título
const WHITE = "FFFFFF";
const PAGE = "FBF8F6";       // fundo claro quente das páginas internas
const MUTE = "6E6E6E", MUTE2 = "B8B0AB", LINE = "ECE6E2", TRACK = "EFEAE6";
const NUM = "Arial Black";              // números (pesados, vermelhos)
const TIT = "Segoe UI Semibold";        // títulos (leves)
const COVERB = "Segoe UI Semibold", COVERF = "Segoe UI Semilight";
const BODY = "Segoe UI";
const W = 13.333, H = 7.5, M = 0.85;
const SH = () => ({ type: "outer" as const, color: "7A2018", blur: 9, offset: 3, angle: 90, opacity: 0.16 });

function loadB64(dir: string, file: string): string | null {
  try { const p = path.join(dir, file); if (fs.existsSync(p)) return fs.readFileSync(p).toString("base64"); } catch { /* */ }
  return null;
}
// corta no limite de palavra (sem reticências) — trava p/ subtítulo da capa não bater na onda
function cap(txt: string, n: number): string {
  if (!txt || txt.length <= n) return txt || "";
  const cut = txt.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trim();
}
function brl(n: number): string { return "R$" + Math.round(n).toLocaleString("pt-BR"); }
function brlK(n: number): string {
  if (n >= 1000) return "R$" + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k";
  return "R$" + Math.round(n).toLocaleString("pt-BR");
}
function limparParceiro(razao: string): string {
  if (!razao) return "";
  const r = razao.toUpperCase();
  for (const [k, v] of [["LOCAR", "Locar"], ["ZANZAR", "Zanzar"], ["CODEMP", "Codemp"], ["ALL SPACE", "All Space"], ["PONTO KA", "Ponto Ka"], ["MUPI", "Mupi Brasil"], ["DESTAQUE", "Destaque"], ["ALL ", "All Space"]] as const) {
    if (r.includes(k)) return v;
  }
  return razao.split(/\s+/).slice(0, 2).join(" ").replace(/[.,]/g, "");
}

/** Renderiza o deck e devolve o Buffer (.pptx). */
export async function renderDeck(content: DeckContent, plano: PlanoResolvido, opts: RenderOpts): Promise<Buffer> {
  const PptxGenJS: any = (pptxgen as any).default || pptxgen;
  const p = new PptxGenJS();
  p.defineLayout({ name: "K", width: W, height: H });
  p.layout = "K";
  p.author = "Kallas Mídia OOH";

  const dir = opts.assetDir || path.join(process.cwd(), "scratch/pptx_extracted_media");
  const COVER = loadB64(dir, "kallas_cover.png");
  const KWHT = loadB64(dir, "k_white.png");
  const KRED = loadB64(dir, "k_red.png");
  const pimg = (s: any, b64: string | null, o: any) => { if (b64) s.addImage({ data: "image/png;base64," + b64, x: o.x, y: o.y, w: o.w, h: o.h, transparency: o.transparency }); };

  const dateStr = opts.dateStr || new Date().toLocaleDateString("pt-BR");
  const contato = opts.contato || "Av. Anápolis, 100 - Bethaville - Barueri - SP    ·    (11) 4134-2700    ·    www.kallas.com.br";

  let page = 0;
  const RR = () => p.ShapeType.roundRect;

  // página clara com moldura vermelha (assinatura)
  const lightPage = () => {
    page++;
    const s = p.addSlide(); s.background = { color: PAGE };
    s.addShape(p.ShapeType.roundRect, { x: 0.1, y: 0.1, w: W - 0.2, h: H - 0.2, fill: { color: PAGE }, line: { color: RED, width: 1.25 }, rectRadius: 0.14 });
    return s;
  };
  const card = (s: any, x: number, y: number, w: number, h: number, fill: string, shadow = true) =>
    s.addShape(p.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { type: "none" }, rectRadius: 0.07, ...(shadow ? { shadow: SH() } : {}) });
  const eyebrow = (s: any, txt: string, x: number, y: number, color = RED) => {
    s.addShape(p.ShapeType.rect, { x, y: y + 0.13, w: 0.32, h: 0.035, fill: { color } });
    s.addText((txt || "").toUpperCase(), { x: x + 0.45, y, w: 9, h: 0.3, fontFace: BODY, bold: true, fontSize: 12, color, charSpacing: 3, valign: "middle" });
  };
  const title = (s: any, txt: string, x: number, y: number, w: number, o: any = {}) =>
    s.addText(txt, { x, y, w, h: o.h || 1.0, fontFace: TIT, fontSize: o.size || 28, color: o.color || INKTX, bold: true, align: "left", valign: "top", lineSpacingMultiple: 1.0, ...o });
  const footer = (s: any) => {
    s.addText("KALLAS · MÍDIA OOH  —  " + (opts.clientName || "").toUpperCase(), { x: M, y: H - 0.55, w: 9, h: 0.3, fontFace: BODY, fontSize: 9.5, color: MUTE, charSpacing: 1.2, valign: "middle" });
    pimg(s, KRED, { x: W - M - 0.78, y: H - 0.6, w: 0.28, h: 0.21 });
    s.addText(String(page).padStart(2, "0"), { x: W - M - 0.44, y: H - 0.6, w: 0.44, h: 0.3, fontFace: NUM, fontSize: 12, color: INKTX, align: "right", valign: "middle" });
  };
  const divider = (kicker: string, big: string, sub: string) => {
    const s = lightPage(); // página clara com moldura (sem preto)
    pimg(s, KRED, { x: 8.9, y: 1.9, w: 4.7, h: 3.61, transparency: 85 });
    eyebrow(s, kicker, M, 2.35, RED);
    s.addText(big, { x: M - 0.04, y: 2.75, w: 9.3, h: 2.0, fontFace: COVERB, fontSize: 52, color: RED, bold: true, valign: "top", lineSpacingMultiple: 1.0 });
    if (sub) s.addText(sub, { x: M, y: 4.95, w: 8.0, h: 1.3, fontFace: BODY, fontSize: 15.5, color: MUTE, valign: "top", lineSpacingMultiple: 1.18 });
  };

  // ───── 01 CAPA ─────
  {
    page++;
    const s = p.addSlide(); s.background = { color: WHITE };
    pimg(s, COVER, { x: 0, y: 0, w: W, h: H });
    const c = content.capa || ({ titulo: opts.clientName } as any);
    s.addText((c.eyebrow || "PROPOSTA COMERCIAL · MÍDIA OOH").toUpperCase(), { x: 1, y: 2.55, w: W - 2, h: 0.4, fontFace: BODY, bold: true, fontSize: 14, color: MUTE, charSpacing: 4, align: "center" });
    s.addText(c.titulo || opts.clientName, { x: 1, y: 3.05, w: W - 2, h: 1.6, fontFace: COVERB, fontSize: 48, bold: true, color: INKTX, align: "center", valign: "top", lineSpacingMultiple: 1.0 });
    if (c.subtitulo) s.addText(cap(c.subtitulo, 60), { x: 3.5, y: 4.55, w: W - 7.0, h: 0.8, fontFace: COVERF, fontSize: 13, color: "5A5A5A", align: "center", lineSpacingMultiple: 1.15 });
    s.addText([
      { text: "Cliente: ", options: { color: "FFD9D6" } }, { text: (opts.clientName || "") + "       ", options: { color: WHITE, bold: true } },
      { text: "|       ", options: { color: "FFB0AB" } }, { text: "Kallas Mídia OOH       ", options: { color: WHITE, bold: true } },
      { text: "|       ", options: { color: "FFB0AB" } }, { text: dateStr, options: { color: WHITE, bold: true } },
    ], { x: 1, y: 6.82, w: W - 2, h: 0.4, fontFace: BODY, fontSize: 13, align: "center", valign: "middle" });
  }

  // ───── 02 VISÃO GERAL ─────
  if (content.visaoGeral && (content.visaoGeral.stats?.length || content.visaoGeral.descricao)) {
    const v = content.visaoGeral; const s = lightPage();
    eyebrow(s, "Visão geral da campanha", M, M);
    if (v.titulo) title(s, v.titulo, M, M + 0.45, 11.5, { size: 27, h: 1.4 });
    if (v.descricao) s.addText(v.descricao, { x: M, y: M + 1.85, w: 11.0, h: 0.8, fontFace: BODY, fontSize: 14.5, color: MUTE, lineSpacingMultiple: 1.18 });
    const st = (v.stats || []).slice(0, 4);
    const cw = 2.72, gap = (11.63 - cw * st.length) / Math.max(1, st.length - 1);
    st.forEach((d, i) => {
      const x = M + i * (cw + gap), redCard = i === st.length - 1;
      card(s, x, 4.5, cw, 2.1, redCard ? RED : WHITE);
      const nc = redCard ? WHITE : RED, lc = redCard ? "FFE3E0" : INKTX;
      const ns = d.num.length > 6 ? 30 : 40;
      s.addText([{ text: d.num, options: { fontFace: NUM, fontSize: ns, color: nc } }, { text: d.unidade || "", options: { fontFace: NUM, fontSize: ns * 0.42, color: nc } }],
        { x: x + 0.28, y: 4.72, w: cw - 0.4, h: 0.9, align: "left", valign: "bottom", margin: 0 });
      s.addText(d.label, { x: x + 0.28, y: 5.68, w: cw - 0.5, h: 0.75, fontFace: BODY, fontSize: 12, color: lc, bold: true, valign: "top", lineSpacingMultiple: 1.05 });
    });
    footer(s);
  }

  // ───── 03 DESAFIO / INSIGHT DE MERCADO ─────
  if (content.desafio && (content.desafio.stats?.length || content.desafio.consumidor?.length)) {
    const d = content.desafio; const s = lightPage();
    eyebrow(s, "O desafio · insight de mercado", M, M);
    if (d.titulo) title(s, d.titulo, M, M + 0.45, 11, { size: 26, h: 1.3 });
    (d.stats || []).slice(0, 3).forEach((it, i) => {
      const y = 2.7 + i * 1.25;
      s.addText(it.num, { x: M, y, w: 2.5, h: 0.85, fontFace: NUM, fontSize: 34, color: RED, valign: "middle", margin: 0 });
      s.addText(it.label, { x: M + 2.7, y, w: 3.6, h: 1.0, fontFace: BODY, fontSize: 12.5, color: MUTE, valign: "middle", lineSpacingMultiple: 1.12, margin: 0 });
    });
    const cons = (d.consumidor || []).slice(0, 3);
    if (cons.length) {
      card(s, 7.2, 2.55, 5.3, 4.0, RED);
      s.addText((d.consumidorTitulo || "O que o consumidor quer").toUpperCase(), { x: 7.55, y: 2.85, w: 4.6, h: 0.4, fontFace: BODY, bold: true, fontSize: 12, color: "FFE3E0", charSpacing: 2, valign: "middle" });
      cons.forEach((it, i) => {
        const y = 3.45 + i * 0.98;
        s.addText(it.num, { x: 7.55, y, w: 1.4, h: 0.75, fontFace: NUM, fontSize: 30, color: WHITE, valign: "middle", margin: 0 });
        s.addText(it.label, { x: 9.0, y, w: 3.3, h: 0.9, fontFace: BODY, fontSize: 12, color: "FFF0EE", valign: "middle", lineSpacingMultiple: 1.08, margin: 0 });
      });
    }
    footer(s);
  }

  // ───── 04 INSIGHT CENTRAL (statement vermelho — assinatura da marca) ─────
  if (content.insight?.frase) {
    page++;
    const s = p.addSlide(); s.background = { color: RED };
    pimg(s, KWHT, { x: 9.0, y: 3.6, w: 5.0, h: 3.84, transparency: 90 });
    eyebrow(s, "O insight central", M, 1.15, WHITE);
    s.addText(content.insight.frase, { x: M, y: 1.75, w: 11.4, h: 2.6, fontFace: "Georgia", italic: true, fontSize: 36, color: WHITE, valign: "top", lineSpacingMultiple: 1.06 });
    s.addShape(p.ShapeType.line, { x: M, y: 4.95, w: 2.4, h: 0, line: { color: WHITE, width: 1.5 } });
    if (content.insight.apoio) s.addText(content.insight.apoio, { x: M, y: 5.2, w: 10.2, h: 1.2, fontFace: BODY, fontSize: 16.5, color: "FFE3E0", lineSpacingMultiple: 1.2 });
  }

  // ───── 05 OBJETIVOS & KPIS (tabela, cabeçalho vermelho) ─────
  if (content.objetivos?.linhas?.length) {
    const o = content.objetivos; const s = lightPage();
    eyebrow(s, "Objetivos & KPIs", M, M);
    if (o.titulo) title(s, o.titulo, M, M + 0.45, 11, { size: 26, h: 1.2 });
    const rows = [["Métrica", "Meta briefing", "Projeção Kallas"], ...(o.linhas || []).slice(0, 7).map((l) => [l.metrica, l.meta, l.projecao])];
    const tbl = rows.map((r, ri) => r.map((c, ci) => {
      if (ri === 0) return { text: c, options: { fill: { color: RED }, color: WHITE, bold: true, fontFace: BODY, fontSize: 14, align: ci === 0 ? "left" : "center", valign: "middle", margin: [6, 12, 6, 12] } };
      const last = ci === 2;
      return { text: c, options: { fill: { color: ri % 2 ? WHITE : "F6F0EC" }, color: last ? RED : INKTX, bold: last, fontFace: ci === 0 ? BODY : NUM, fontSize: ci === 0 ? 13.5 : 15, align: ci === 0 ? "left" : "center", valign: "middle", margin: [6, 12, 6, 12] } };
    }));
    s.addTable(tbl, { x: M, y: 2.65, w: 11.63, colW: [5.83, 2.9, 2.9], rowH: new Array(rows.length).fill(0.52), border: { type: "solid", color: LINE, pt: 1 } });
    footer(s);
  }

  // ───── CONCEITO (divisor + variações claras) ─────
  if (content.conceito?.mote) {
    divider("01 · Conceito criativo", content.conceito.mote, content.conceito.descricao || "");
    (content.conceito.variacoes || []).slice(0, 3).forEach((vr, i) => {
      const s = lightPage();
      eyebrow(s, `Conceito · variação 0${i + 1}`, M, M);
      pimg(s, KRED, { x: 10.4, y: 4.7, w: 2.4, h: 1.84, transparency: 82 });
      s.addText(vr.titulo, { x: M, y: 2.4, w: 11.4, h: 2.2, fontFace: COVERB, fontSize: 52, bold: true, color: RED, align: "left", valign: "middle", lineSpacingMultiple: 1.0 });
      if (vr.texto) s.addText(vr.texto, { x: M, y: 5.0, w: 9.5, h: 1.1, fontFace: "Georgia", italic: true, fontSize: 20, color: INKTX, lineSpacingMultiple: 1.15 });
      footer(s);
    });
  }

  // ───── ESTRATÉGIA (divisor + pilares CLAROS) ─────
  if (content.pilares?.length) {
    divider("02 · Estratégia de mídia", "Os pilares\nque se reforçam", "Presença contextual repetida — entendimento, lembrança e conversão. Não bombardeio.");
    content.pilares.slice(0, 3).forEach((pil, i) => {
      const s = lightPage();
      s.addText(pil.num || `0${i + 1}`, { x: M, y: 0.75, w: 2.0, h: 1.0, fontFace: NUM, fontSize: 46, color: RED, valign: "middle", margin: 0 });
      s.addText((pil.kicker || "").toUpperCase(), { x: M + 1.35, y: 0.95, w: 6, h: 0.5, fontFace: BODY, bold: true, fontSize: 13, color: RED, charSpacing: 2, valign: "middle" });
      title(s, pil.titulo, M, 1.85, 11.2, { size: 27, h: 0.95 });
      if (pil.corpo) s.addText(pil.corpo, { x: M, y: 2.85, w: 11.2, h: 1.2, fontFace: BODY, fontSize: 14.5, color: MUTE, lineSpacingMultiple: 1.2 });
      // linha de cards: formatos (branco) + praça (branco) + stat (vermelho)
      const by = 4.75, ch = 1.75;
      if (pil.formatos) {
        card(s, M, by, 3.7, ch, WHITE);
        s.addText("FORMATOS", { x: M + 0.3, y: by + 0.25, w: 3, h: 0.3, fontFace: BODY, bold: true, fontSize: 10.5, color: RED, charSpacing: 1.5 });
        s.addText(pil.formatos, { x: M + 0.3, y: by + 0.62, w: 3.1, h: 1.0, fontFace: BODY, fontSize: 12.5, color: INKTX, valign: "top", lineSpacingMultiple: 1.1 });
      }
      if (pil.praca) {
        card(s, M + 3.95, by, 3.7, ch, WHITE);
        s.addText("PRAÇAS", { x: M + 4.25, y: by + 0.25, w: 3, h: 0.3, fontFace: BODY, bold: true, fontSize: 10.5, color: RED, charSpacing: 1.5 });
        s.addText(pil.praca, { x: M + 4.25, y: by + 0.62, w: 3.1, h: 1.0, fontFace: BODY, fontSize: 12.5, color: INKTX, valign: "top", lineSpacingMultiple: 1.1 });
      }
      const st0 = (pil.stats || [])[0];
      if (st0) {
        card(s, M + 7.9, by, 3.73, ch, RED);
        s.addText(st0.num, { x: M + 8.2, y: by + 0.22, w: 3.1, h: 0.8, fontFace: NUM, fontSize: 34, color: WHITE, valign: "middle", margin: 0 });
        s.addText(st0.label, { x: M + 8.2, y: by + 1.02, w: 3.2, h: 0.6, fontFace: BODY, fontSize: 11.5, color: "FFE3E0", valign: "top", lineSpacingMultiple: 1.05 });
      }
      footer(s);
    });
  }

  // ───── ATIVAÇÕES POR FORMATO (cards brancos) ─────
  if (content.ativacoes?.cards?.length) {
    const a = content.ativacoes; const s = lightPage();
    eyebrow(s, "Ativações por formato", M, M);
    if (a.titulo) title(s, a.titulo, M, M + 0.45, 11, { size: 26, h: 1.2 });
    const cards = a.cards!.slice(0, 4);
    const cw = (11.63 - 0.3 * (cards.length - 1)) / cards.length;
    cards.forEach((d, i) => {
      const x = M + i * (cw + 0.3);
      card(s, x, 2.7, cw, 3.5, WHITE);
      s.addShape(p.ShapeType.roundRect, { x, y: 2.7, w: cw, h: 0.14, fill: { color: RED }, line: { type: "none" }, rectRadius: 0.05 });
      pimg(s, KRED, { x: x + 0.3, y: 3.1, w: 0.7, h: 0.54 });
      s.addText("0" + (i + 1), { x: x + cw - 1.0, y: 3.05, w: 0.8, h: 0.7, fontFace: NUM, fontSize: 26, color: "E6DED9", align: "right" });
      s.addText(d.titulo, { x: x + 0.3, y: 4.2, w: cw - 0.55, h: 0.95, fontFace: TIT, bold: true, fontSize: 16, color: INKTX, valign: "top", lineSpacingMultiple: 1.0 });
      s.addText(d.sub, { x: x + 0.3, y: 5.2, w: cw - 0.55, h: 0.8, fontFace: BODY, fontSize: 12, color: MUTE, valign: "top", lineSpacingMultiple: 1.08 });
    });
    footer(s);
  }

  // ───── PRAÇAS & INVESTIMENTO (divisor) — só se houver plano ─────
  if (!plano.vazio && plano.porPraca.length) {
    divider("03 · Praças & investimento", "Onde a verba\ntrabalha mais", `${plano.porPraca.length} ${plano.porPraca.length > 1 ? "praças" : "praça"}, hierarquizadas por volume de público e complexidade geográfica.`);

    // COBERTURA (grid de cards brancos)
    {
      const s = lightPage();
      eyebrow(s, `Cobertura · ${plano.porPraca.length} ${plano.porPraca.length > 1 ? "praças" : "praça"}`, M, M);
      title(s, "Presença capilar onde o público circula", M, M + 0.45, 12, { size: 26, h: 0.9 });
      const caps = plano.porPraca.slice(0, 10);
      const cols = caps.length <= 4 ? caps.length : 5;
      const cwd = (11.63 - (cols - 1) * 0.25) / cols, chh = 1.85;
      caps.forEach((g, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = M + col * (cwd + 0.25), y = 2.55 + row * (chh + 0.25);
        const desc = g.itens[0] ? (g.itens[0].nome.split("·")[0].trim()) : "";
        card(s, x, y, cwd, chh, WHITE);
        s.addShape(p.ShapeType.roundRect, { x, y, w: cwd, h: 0.12, fill: { color: RED }, line: { type: "none" }, rectRadius: 0.04 });
        s.addText(String(i + 1).padStart(2, "0"), { x: x + 0.22, y: y + 0.2, w: 1, h: 0.5, fontFace: NUM, fontSize: 18, color: "E6DED9" });
        s.addText(g.praca, { x: x + 0.22, y: y + 0.72, w: cwd - 0.4, h: 0.6, fontFace: TIT, bold: true, fontSize: 13, color: INKTX, valign: "top", lineSpacingMultiple: 0.98 });
        s.addText(desc, { x: x + 0.22, y: y + 1.3, w: cwd - 0.4, h: 0.45, fontFace: BODY, fontSize: 10.5, color: MUTE, valign: "top", lineSpacingMultiple: 1.0 });
      });
      footer(s);
    }

    // PRIORIZAÇÃO (barras vermelhas)
    {
      const s = lightPage();
      eyebrow(s, "Priorização de investimento", M, M);
      title(s, "Verba alocada por prioridade de mercado", M, M + 0.45, 12, { size: 26, h: 0.9 });
      const ord = [...plano.porPraca].sort((a, b) => b.subtotal - a.subtotal);
      const top = ord.slice(0, 5);
      const restoVal = ord.slice(5).reduce((s2, g) => s2 + g.subtotal, 0);
      const bars: { nome: string; val: number }[] = top.map((g) => ({ nome: g.praca, val: g.subtotal }));
      if (restoVal > 0) bars.push({ nome: "Demais praças", val: restoVal });
      const total = plano.totalVeiculacao || bars.reduce((s2, b) => s2 + b.val, 0);
      const maxV = Math.max(...bars.map((b) => b.val), 1);
      const bx = M + 2.7, bmax = 7.8, by0 = 2.7, bhh = 0.5;
      bars.forEach((d, i) => {
        const y = by0 + i * 0.62, pct = Math.round((d.val / total) * 100);
        s.addText(d.nome, { x: M, y: y - 0.05, w: 2.5, h: bhh, fontFace: BODY, bold: true, fontSize: 13, color: INKTX, align: "right", valign: "middle" });
        s.addShape(p.ShapeType.roundRect, { x: bx, y, w: bmax, h: bhh, fill: { color: TRACK }, line: { type: "none" }, rectRadius: 0.04 });
        s.addShape(p.ShapeType.roundRect, { x: bx, y, w: Math.max(0.3, bmax * (d.val / maxV)), h: bhh, fill: { color: i < 2 ? RED : (i < 3 ? "D14037" : "B8AEA8") }, line: { type: "none" }, rectRadius: 0.04 });
        s.addText([{ text: brlK(d.val) + "  ", options: { bold: true, color: i < 3 ? WHITE : INKTX } }, { text: pct + "%", options: { color: i < 3 ? "FFD9D6" : MUTE } }],
          { x: bx + 0.18, y, w: bmax, h: bhh, fontFace: BODY, fontSize: 12, valign: "middle" });
      });
      footer(s);
    }

    // PLANO DE VEICULAÇÃO (tabela, cabeçalho vermelho + card total vermelho)
    {
      const s = lightPage();
      eyebrow(s, "Plano de veiculação", M, M);
      title(s, "Investimento por praça e formato", M, M + 0.45, 8.2, { size: 26, h: 0.9 });
      card(s, 9.1, 0.75, 3.4, 1.2, RED);
      s.addText("TOTAL EM VEICULAÇÃO", { x: 9.4, y: 0.9, w: 3, h: 0.3, fontFace: BODY, bold: true, fontSize: 10, color: "FFD9D6", charSpacing: 1 });
      s.addText(brl(plano.totalVeiculacao), { x: 9.4, y: 1.18, w: 3, h: 0.6, fontFace: NUM, fontSize: 28, color: WHITE, valign: "middle" });
      const ord = [...plano.porPraca].sort((a, b) => b.subtotal - a.subtotal).slice(0, 9);
      const rows = [["Praça", "Formatos", "Parceiro", "Subtotal"], ...ord.map((g) => {
        const formatos = Array.from(new Set(g.itens.map((it) => it.nome.split("·")[0].trim()))).slice(0, 3).join(" · ");
        const parceiro = Array.from(new Set(g.itens.map((it) => limparParceiro(it.razao)).filter(Boolean))).slice(0, 2).join(" · ");
        return [g.praca, formatos, parceiro, brl(g.subtotal)];
      })];
      const tbl = rows.map((r, ri) => r.map((c, ci) => {
        const align = ci === 3 ? "right" : "left";
        if (ri === 0) return { text: c, options: { fill: { color: RED }, color: WHITE, bold: true, fontFace: BODY, fontSize: 12.5, align, valign: "middle", margin: [3, 9, 3, 9] } };
        const last = ci === 3;
        return { text: c, options: { fill: { color: ri % 2 ? WHITE : "F6F0EC" }, color: last ? RED : (ci === 0 ? INKTX : MUTE), bold: last || ci === 0, fontFace: last ? NUM : BODY, fontSize: last ? 12 : (ci === 1 ? 11.5 : 12), align, valign: "middle", margin: [3, 9, 3, 9] } };
      }));
      s.addTable(tbl, { x: M, y: 2.5, w: 11.63, colW: [2.4, 5.23, 2.3, 1.7], rowH: new Array(rows.length).fill(0.44), border: { type: "solid", color: LINE, pt: 1 } });
      s.addText("Valores líquidos · desconto de agência já incluído.", { x: M, y: 6.5, w: 11, h: 0.3, fontFace: BODY, italic: true, fontSize: 11.5, color: MUTE });
      footer(s);
    }
  }

  // ───── JORNADA (divisor + timeline clara) ─────
  if (content.jornada?.passos?.length) {
    divider("04 · Jornada do público", content.jornada.titulo || "Pontos de contato\nao longo do dia", "Mensagens complementares em contextos variados constroem familiaridade sem saturação.");
    const j = content.jornada; const s = lightPage();
    eyebrow(s, j.eyebrow || "Jornada do público", M, M);
    title(s, j.titulo || "Da manhã à conversão", M, M + 0.45, 12, { size: 26, h: 0.9 });
    const passos = j.passos!.slice(0, 5);
    const jw = (11.63 - (passos.length - 1) * 0.2) / passos.length, jy = 2.85;
    s.addShape(p.ShapeType.line, { x: M + 0.2, y: jy + 0.32, w: 11.2, h: 0, line: { color: "E0D8D2", width: 2 } });
    passos.forEach((d, i) => {
      const x = M + i * (jw + 0.2), last = i === passos.length - 1;
      s.addShape(p.ShapeType.ellipse, { x: x + 0.02, y: jy + 0.1, w: 0.44, h: 0.44, fill: { color: RED } });
      s.addText(String(i + 1), { x: x + 0.02, y: jy + 0.1, w: 0.44, h: 0.44, fontFace: NUM, fontSize: 13, color: WHITE, align: "center", valign: "middle" });
      s.addText(d.hora, { x: x + 0.55, y: jy + 0.1, w: jw - 0.55, h: 0.44, fontFace: NUM, fontSize: 16, color: RED, valign: "middle", margin: 0 });
      card(s, x, jy + 0.8, jw, 2.7, last ? RED : WHITE);
      const tc = last ? WHITE : INKTX, sc = last ? "FFE3E0" : MUTE;
      s.addText(d.local, { x: x + 0.25, y: jy + 1.0, w: jw - 0.45, h: 0.85, fontFace: TIT, bold: true, fontSize: 13, color: tc, valign: "top", lineSpacingMultiple: 0.98 });
      s.addText(d.texto, { x: x + 0.25, y: jy + 1.9, w: jw - 0.45, h: 1.4, fontFace: BODY, fontSize: 11.5, color: sc, valign: "top", lineSpacingMultiple: 1.1 });
    });
    footer(s);
  }

  // ───── MÉTRICAS & RESULTADOS (claro, barras vermelhas) ─────
  if (content.metricas && (content.metricas.stats?.length || content.metricas.conversao?.length)) {
    const m = content.metricas; const s = lightPage();
    eyebrow(s, "Métricas & resultados projetados", M, M);
    title(s, m.titulo || "Mensuração de ponta a ponta", M, M + 0.45, 12, { size: 26, h: 0.9 });
    (m.stats || []).slice(0, 4).forEach((d, i) => {
      const x = M + i * 2.95;
      s.addText(d.num, { x, y: 2.5, w: 2.7, h: 0.9, fontFace: NUM, fontSize: 40, color: RED, valign: "bottom", margin: 0 });
      s.addText(d.label, { x, y: 3.5, w: 2.7, h: 0.6, fontFace: BODY, bold: true, fontSize: 12, color: INKTX, valign: "top", lineSpacingMultiple: 1.05, margin: 0 });
    });
    const conv = (m.conversao || []).slice(0, 4);
    if (conv.length) {
      const maxP = Math.max(...conv.map((c) => c.pct), 1);
      card(s, M, 4.5, 11.63, 2.1, WHITE);
      s.addText((m.conversaoTitulo || "Conversão por formato").toUpperCase(), { x: M + 0.3, y: 4.65, w: 6, h: 0.3, fontFace: BODY, bold: true, fontSize: 11.5, color: RED, charSpacing: 1.5 });
      conv.forEach((d, i) => {
        const y = 5.05 + i * 0.35;
        s.addText(d.valor, { x: M + 0.3, y, w: 1.0, h: 0.3, fontFace: NUM, fontSize: 13, color: RED, valign: "middle", margin: 0 });
        s.addText(d.label, { x: M + 1.35, y, w: 3.0, h: 0.3, fontFace: BODY, fontSize: 12, color: INKTX, valign: "middle" });
        s.addShape(p.ShapeType.roundRect, { x: M + 4.5, y: y + 0.06, w: 6.6, h: 0.18, fill: { color: TRACK }, line: { type: "none" }, rectRadius: 0.03 });
        s.addShape(p.ShapeType.roundRect, { x: M + 4.5, y: y + 0.06, w: Math.max(0.1, 6.6 * (d.pct / maxP)), h: 0.18, fill: { color: RED }, line: { type: "none" }, rectRadius: 0.03 });
      });
    }
    footer(s);
  }

  // ───── ROI (statement vermelho) ─────
  if (content.roi?.numero) {
    page++;
    const r = content.roi; const s = p.addSlide(); s.background = { color: RED };
    pimg(s, KWHT, { x: 8.7, y: 3.4, w: 5.3, h: 4.07, transparency: 90 });
    eyebrow(s, "ROI consolidado", M, 1.1, WHITE);
    s.addText([{ text: r.numero, options: { fontFace: NUM, fontSize: 150, color: WHITE } }, { text: r.unidade || "", options: { fontFace: NUM, fontSize: 70, color: WHITE } }],
      { x: M - 0.1, y: 1.5, w: 8, h: 2.6, valign: "middle", margin: 0 });
    if (r.descricao) s.addText(r.descricao, { x: M, y: 4.25, w: 7.4, h: 0.8, fontFace: BODY, fontSize: 18, color: "FFE3E0", lineSpacingMultiple: 1.15 });
    (r.blocos || []).slice(0, 3).forEach((d, i) => {
      const x = M + i * 4.0;
      s.addShape(p.ShapeType.line, { x, y: 5.5, w: 3.6, h: 0, line: { color: WHITE, width: 1, transparency: 50 } });
      s.addText(d.label.toUpperCase(), { x, y: 5.62, w: 3.6, h: 0.35, fontFace: BODY, bold: true, fontSize: 11.5, color: "FFD9D6", charSpacing: 1 });
      s.addText(d.valor, { x, y: 5.95, w: 3.6, h: 0.7, fontFace: NUM, fontSize: 28, color: WHITE, valign: "middle" });
    });
  }

  // ───── CRONOGRAMA (cards claros; o destaque é vermelho) ─────
  if (content.cronograma?.length) {
    const s = lightPage();
    eyebrow(s, "Cronograma de veiculação", M, M);
    title(s, "Da aprovação ao relatório final", M, M + 0.45, 12, { size: 26, h: 0.9 });
    const cron = content.cronograma.slice(0, 4); const cy = 3.0;
    s.addShape(p.ShapeType.line, { x: M + 0.25, y: cy + 0.3, w: 11.1, h: 0, line: { color: "E0D8D2", width: 2 } });
    const cwd = (11.63 - (cron.length - 1) * 0.3) / cron.length;
    cron.forEach((d, i) => {
      const x = M + i * (cwd + 0.3), hot = !!d.destaque;
      s.addShape(p.ShapeType.ellipse, { x: x + 0.05, y: cy + 0.1, w: 0.4, h: 0.4, fill: { color: RED } });
      card(s, x, cy + 0.75, cwd, 2.3, hot ? RED : WHITE);
      s.addText(d.periodo, { x: x + 0.28, y: cy + 0.95, w: cwd - 0.5, h: 0.6, fontFace: TIT, bold: true, fontSize: 17, color: hot ? WHITE : INKTX, valign: "top" });
      s.addText(d.texto, { x: x + 0.28, y: cy + 1.6, w: cwd - 0.5, h: 1.2, fontFace: BODY, fontSize: 12.5, color: hot ? "FFE3E0" : MUTE, valign: "top", lineSpacingMultiple: 1.12 });
    });
    footer(s);
  }

  // ───── MOCKUPS (campanha do cliente nas fotos reais dos pontos Kallas) ─────
  if (opts.mockups?.length) {
    divider("Sua campanha no mundo real", "Sua marca onde o\npúblico circula", "Mockups reais dos pontos de mídia Kallas com a sua campanha aplicada.");
    for (const mk of opts.mockups) {
      page++;
      const s = p.addSlide(); s.background = { color: DARK };
      s.addImage({ data: `${mk.mime || "image/png"};base64,${mk.b64}`, x: 0, y: 0, w: W, h: H });
      const cw = Math.max(3.6, mk.formato.length * 0.16 + 1.2);
      s.addShape(p.ShapeType.roundRect, { x: 0.5, y: 6.05, w: cw, h: 0.92, fill: { color: RED }, line: { type: "none" }, rectRadius: 0.07, shadow: { type: "outer", color: "000000", blur: 8, offset: 3, angle: 90, opacity: 0.35 } });
      s.addText(mk.formato, { x: 0.75, y: 6.14, w: cw - 0.4, h: 0.42, fontFace: TIT, bold: true, fontSize: 16, color: WHITE, valign: "middle" });
      s.addText((mk.local || "").toUpperCase(), { x: 0.75, y: 6.56, w: cw - 0.4, h: 0.3, fontFace: BODY, fontSize: 10.5, color: "FFD9D6", charSpacing: 1.5, valign: "middle" });
      s.addShape(p.ShapeType.roundRect, { x: W - 3.05, y: 0.45, w: 2.55, h: 0.5, fill: { color: WHITE }, line: { type: "none" }, rectRadius: 0.06, shadow: { type: "outer", color: "000000", blur: 6, offset: 2, angle: 90, opacity: 0.25 } });
      s.addText([{ text: `${opts.clientName} `, options: { color: INKTX, bold: true } }, { text: "· Kallas", options: { color: RED, bold: true } }], { x: W - 3.05, y: 0.45, w: 2.55, h: 0.5, fontFace: BODY, fontSize: 11, align: "center", valign: "middle" });
      s.addText(String(page).padStart(2, "0"), { x: W - 0.95, y: H - 0.55, w: 0.5, h: 0.3, fontFace: NUM, fontSize: 12, color: WHITE, align: "right", valign: "middle" });
    }
  }

  // ───── FECHO ─────
  {
    page++;
    const f = content.fecho || ({ titulo: "Vamos lançar juntos" } as any);
    const s = p.addSlide(); s.background = { color: WHITE };
    pimg(s, COVER, { x: 0, y: 0, w: W, h: H });
    s.addText((f.eyebrow || "Vamos lançar juntos").toUpperCase(), { x: 1, y: 2.4, w: W - 2, h: 0.4, fontFace: BODY, bold: true, fontSize: 14, color: MUTE, charSpacing: 4, align: "center" });
    s.addText(f.titulo || "Vamos lançar juntos", { x: 1, y: 2.9, w: W - 2, h: 1.4, fontFace: COVERB, fontSize: 52, bold: true, color: INKTX, align: "center", valign: "top" });
    if (f.subtitulo) s.addText(cap(f.subtitulo, 60), { x: 3.5, y: 4.5, w: W - 7.0, h: 1.0, fontFace: COVERF, fontSize: 13, color: "5A5A5A", align: "center", lineSpacingMultiple: 1.2 });
    s.addText([{ text: "Kallas Mídia OOH       ", options: { color: WHITE, bold: true } }, { text: "|       ", options: { color: "FFB0AB" } }, { text: contato, options: { color: WHITE, bold: true } }],
      { x: 0.6, y: 6.82, w: W - 1.2, h: 0.4, fontFace: BODY, fontSize: 11, align: "center", valign: "middle" });
  }

  const out = await p.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
