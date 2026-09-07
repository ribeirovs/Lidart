/**
 * claude-deck.ts — "Deck Premium": Opus escreve o CONTEÚDO (estrategista), código renderiza.
 *
 * NOVA arquitetura (jun/2026): separa CONTEÚDO de DESIGN.
 *  1) O Opus 4.8 recebe briefing + plano validado + narrativa (matéria-prima) e devolve
 *     um JSON estruturado (DeckContent) — estratégia de verdade, NÃO reformatação, NÃO código.
 *  2) deck-render.ts monta o .pptx determinístico (design validado, qualidade Claude Design).
 *  3) Os slides de DINHEIRO (cobertura/priorização/plano) saem do MOTOR — número exato.
 *
 * Fala com a API por HTTP direto (sem o @anthropic-ai/sdk antigo do app). NÃO toca llm.ts.
 * Quem chama deve AINDA rodar o verificador na narrativa (gateNarrativeExport).
 */
import { randomUUID } from "node:crypto";
import { amplitudeAI, currentAiSession, proposalAgent } from "./_core/amplitude-ai";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { briefings } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { resolvePlanForPresentation, type PlanoResolvido } from "./valuation-builder";
import { generateMockupSlides } from "./mockup";
import { renderDeck, type DeckContent } from "./deck-render";

const BASE = "https://api.anthropic.com";
const DECK_MODEL = process.env.ANTHROPIC_MODEL_DECK || "claude-opus-4-8";

export type DeckProposalInput = {
  id: number;
  userId: number;
  clientName: string;
  values: string;
  proposalContent: string;
  mediaPlan?: string | null;
  createdAt?: Date;
};

function buildContentPrompt(p: DeckProposalInput, plano: PlanoResolvido, br: any): string {
  const brief = [
    `Cliente: ${p.clientName}`,
    br?.segment ? `Segmento: ${br.segment}` : "",
    br?.objective ? `Objetivo: ${br.objective}` : "",
    br?.targetAudience ? `Público-alvo: ${br.targetAudience}` : "",
    br?.campaignPeriod ? `Período: ${br.campaignPeriod}` : "",
    br?.mediaSpecs ? `KPIs/metas do briefing: ${br.mediaSpecs}` : "",
    `Budget total: ${p.values || br?.budget || "(ver plano)"}`,
  ].filter(Boolean).join("\n");

  const planoTxt = plano.vazio
    ? "(sem plano validado)"
    : plano.porPraca
        .map((g) => `- ${g.praca} (${g.uf}): ` + g.itens.map((it: any) => `${it.nome} · ${it.local}`).join(" | "))
        .join("\n") + `\nTOTAL VEICULAÇÃO: R$ ${plano.totalVeiculacao.toLocaleString("pt-BR")}`;

  const narrativa = (p.proposalContent || "").slice(0, 16000);

  return `Você é um ESTRATEGISTA de mídia OOH sênior da Kallas, montando um PITCH DECK de agência premiada para "${p.clientName}". Sua tarefa é ESCREVER O CONTEÚDO do deck (texto estratégico), devolvido como JSON. NÃO escreva código. NÃO desenhe slides. O design é feito por outro sistema — você só entrega o conteúdo.

PENSE COMO ESTRATEGISTA, NÃO PREENCHA MODELO:
- Cada campo carrega UMA ideia forte e ESPECÍFICA desta campanha — nada genérico que serviria pra qualquer marca.
- ELEVE a matéria-prima (briefing/narrativa), não reformate: insight de mercado afiado; um INSIGHT CENTRAL memorável (uma frase que vira o conceito); CONCEITO com mote + 2-3 variações (cada uma com uma headline curta e poderosa); PILARES de estratégia que se reforçam; JORNADA concreta do público (hora a hora); MÉTRICAS e ROI.
- Profundidade do nível do MELHOR deck de agência.

FIDELIDADE (CRÍTICO — não pode violar):
- Use SOMENTE praças/formatos do PLANO VALIDADO abaixo. PROIBIDO citar praça, formato, ambiente ou ponto de contato fora do plano.
- NÚMEROS — REGRA DE OURO, ZERO INVENÇÃO (a mais importante): é TERMINANTEMENTE PROIBIDO inventar qualquer número. Todo número (alcance, impactos, pessoas, frequência, cobertura, %, VTR, CTR, CPM, ROI, uplift, conversão, vendas, audiência) só pode aparecer se estiver EXPLÍCITO no BRIEFING abaixo ou vier do PLANO VALIDADO. Não há fonte real? NÃO escreva o número — descreva de forma QUALITATIVA, sem cifra, ou OMITA o campo. NUNCA preencha "meta"/"projecao" com número que o briefing não deu. NUNCA rotule invenção como "estimativa" — estimativa sem base real continua proibida. Prefira SEMPRE o campo vazio a um número falso. Os números nos exemplos do schema são só ILUSTRAÇÃO de formato — não os copie.
- Os valores de investimento são preenchidos pelo sistema a partir do plano — não os repita nem invente.
- Não use linguagem de exclusão/sacrifício ("abrimos mão", "trade-off", "ficou de fora").

FORMATO DE SAÍDA — responda APENAS com JSON válido (sem markdown, sem \`\`\`, sem comentários), exatamente neste schema (omita campos sem conteúdo real; arrays podem ter menos itens):
{
  "capa": {"eyebrow":"Proposta comercial · mídia OOH","titulo":"<nome curto da campanha/produto>","subtitulo":"<uma linha CURTA, no máx ~60 caracteres: o que é o plano>"},
  "visaoGeral": {"titulo":"<headline>","descricao":"<2 linhas>","stats":[{"num":"85","unidade":"mi","label":"Impactos projetados"}, ... até 4]},
  "desafio": {"titulo":"<headline do desafio de mercado>","stats":[{"num":"7×","label":"<dado de mercado>"}, ... até 3],"consumidorTitulo":"O que o consumidor quer","consumidor":[{"num":"41%","label":"<comportamento>"}, ... até 3]},
  "insight": {"frase":"<o insight central, memorável, 1-2 frases>","apoio":"<2 linhas que explicam a virada>"},
  "objetivos": {"titulo":"<headline>","linhas":[{"metrica":"Cobertura do target","meta":"40%","projecao":"42%"}, ... do briefing]},
  "conceito": {"mote":"<mote do conceito, pode ter \\n>","descricao":"<1 linha>","variacoes":[{"titulo":"<headline curta>","texto":"<1 linha>"}, ... 2-3]},
  "pilares": [{"num":"01","kicker":"Pilar · <nome>","titulo":"<headline>","corpo":"<2-3 linhas>","stats":[{"num":"5,8%","label":"<o que é>"}, ... 1-2],"formatos":"<formatos do plano>","praca":"<praças do plano>"}, ... 2-3],
  "ativacoes": {"titulo":"<headline>","cards":[{"titulo":"<formato>","sub":"<detalhe curto>"}, ... até 4]},
  "jornada": {"eyebrow":"Jornada · <perfil>","titulo":"<headline>","passos":[{"hora":"7h15","local":"<contexto>","texto":"<o que acontece>"}, ... até 5]},
  "metricas": {"titulo":"Mensuração de ponta a ponta","stats":[{"num":"42%","label":"<kpi>"}, ... até 4],"conversaoTitulo":"Conversão por formato","conversao":[{"valor":"5,8%","label":"<formato>","pct":5.8}, ... até 4]},
  "roi": {"numero":"144","unidade":"%","descricao":"<1 linha, dizer que é estimativa conservadora>","blocos":[{"label":"Investimento","valor":"R$..."},{"label":"Retorno total estimado","valor":"R$..."}]},
  "cronograma": [{"periodo":"Junho","texto":"<etapa>"},{"periodo":"Jul → Set","texto":"Veiculação contínua","destaque":true}, ... até 4],
  "fecho": {"eyebrow":"Vamos lançar juntos","titulo":"<mote do conceito>","subtitulo":"<chamada para ação CURTA, no máx ~60 caracteres>"}
}

BRIEFING:
${brief}

PLANO VALIDADO (única fonte de praças e formatos; os VALORES são preenchidos pelo sistema):
${planoTxt}

NARRATIVA APROVADA (matéria-prima — ELEVE e aprofunde, obedecendo a fidelidade; NÃO copie literalmente):
"""
${narrativa}
"""

Lembre: responda SOMENTE com o JSON. Comece com { e termine com }.`;
}

async function callMessages(body: any): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000); // 5 min
  // Hop HTTP cru — nenhum wrapper de provider tem o que interceptar aqui, então o
  // turno vai à mão pro Agent Analytics com o usage que a própria API devolve.
  const aiSession = currentAiSession();
  const session = proposalAgent.session({
    sessionId: aiSession?.sessionId ?? `deck-${randomUUID()}`,
    userId: aiSession?.userId,
  });
  const startedAt = Date.now();
  try {
    return await session.run(async s => {
      // Linha curta e legível: é ela que vira o título da sessão no dashboard.
      // O prompt inteiro (16k de briefing) como corpo quebraria a leitura lá.
      s.trackUserMessage("Escrever o conteúdo estratégico do deck premium a partir do briefing e do plano validado");
      try {
        const r = await fetch(`${BASE}/v1/messages`, {
          method: "POST",
          headers: { "x-api-key": ENV.anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(`Claude API ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
        const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        s.trackAiMessage(text, j.model || body.model, "anthropic", Date.now() - startedAt, {
          // input_tokens cru do Anthropic NÃO inclui cache — sem somar, o custo sai subestimado.
          inputTokens:
            (j.usage?.input_tokens ?? 0) +
            (j.usage?.cache_read_input_tokens ?? 0) +
            (j.usage?.cache_creation_input_tokens ?? 0),
          outputTokens: j.usage?.output_tokens ?? null,
          cacheReadTokens: j.usage?.cache_read_input_tokens ?? null,
          cacheCreationTokens: j.usage?.cache_creation_input_tokens ?? null,
          finishReason: j.stop_reason ?? null,
          maxOutputTokens: body.max_tokens ?? null,
        });
        return j;
      } catch (err: any) {
        s.trackAiMessage("", body.model, "anthropic", Date.now() - startedAt, {
          isError: true,
          errorMessage: err?.message || String(err),
        });
        throw err;
      }
    });
  } finally {
    clearTimeout(timer);
    await amplitudeAI.flush();
  }
}

/** Extrai o primeiro objeto JSON balanceado do texto (tolerante a cercas/markdown). */
function extractJson(text: string): any {
  let t = (text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = t.indexOf("{");
  if (start < 0) throw new Error("Sem JSON na resposta da IA");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return JSON.parse(t.slice(start, i + 1)); }
  }
  throw new Error("JSON incompleto na resposta da IA");
}

// ── TRAVA: ZERO número inventado ──────────────────────────────────────────────
// Princípio (Vivi): nenhum número pode ir ao cliente sem fonte. Toda cifra do deck
// tem que vir do BRIEFING (explícito) ou do PLANO (motor/tabela de preços real).
// Este filtro REMOVE deterministicamente qualquer número que não case com essas
// fontes — é a garantia programada, além da instrução no prompt.
function parseNum(raw?: string): number | null {
  if (raw == null) return null;
  let s = String(raw).toLowerCase().replace(/×/g, " ").replace(/r\$/g, " ");
  let mult = 1;
  if (/(milh[õo]es|\bmi\b|\bmm\b)/.test(s)) mult = 1e6;
  else if (/(\bmil\b|\bk\b)/.test(s)) mult = 1e3;
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * mult : null;
}

function briefingNumbers(br: any): Set<number> {
  const set = new Set<number>();
  const add = (v: any) => { if (typeof v === "number" && Number.isFinite(v)) set.add(Math.round(v)); };
  let corpus = [br?.objective, br?.targetAudience, br?.mediaSpecs, br?.campaignPeriod, br?.budget, br?.segment, br?.kpis]
    .filter(Boolean).join("  ");
  // remove faixas DEMOGRÁFICAS (idade) p/ não validarem KPIs por coincidência (ex.: "18-55 anos" não autoriza "VTR 55%").
  corpus = corpus.replace(/\d+\s*[-–a]+\s*\d+\s*anos/gi, " ").replace(/\d+\s*anos/gi, " ");
  for (const m of Array.from(corpus.matchAll(/(\d[\d.,]*)\s*(milh[õo]es|mi|mil|k|%)?/gi))) {
    const v = parseNum(`${m[1]} ${m[2] || ""}`); if (v !== null) add(v);
  }
  return set;
}

function planNumbers(plano: PlanoResolvido): Set<number> {
  const set = new Set<number>();
  const add = (v: any) => { if (typeof v === "number" && Number.isFinite(v)) set.add(Math.round(v)); };
  for (const it of plano.itens || []) {
    add(it.custoUnitario); add(it.subtotal); add((it as any).periodos);
    add(it.qtd); add(it.insPorDia); add(it.impactoEstimado);
  }
  for (const g of plano.porPraca || []) add(g.subtotal);
  add(plano.totalVeiculacao); add((plano.porPraca || []).length); add((plano.itens || []).length);
  add((plano.itens || []).reduce((s, it) => s + (it.impactoEstimado || 0) * ((it as any).periodos || 1) * (it.qtd || 1), 0));
  add((plano.itens || []).reduce((s, it) => s + (it.insPorDia || 0), 0));
  return set;
}

export function scrubUnsourcedNumbers(content: DeckContent, br: any, plano: PlanoResolvido): DeckContent {
  const briefSet = briefingNumbers(br);
  const planSet = planNumbers(plano);
  const removed: string[] = [];
  const inSet = (set: Set<number>, v: number) => {
    for (const a of Array.from(set)) if (Math.abs(a - v) <= Math.max(1, Math.abs(v) * 0.02)) return true;
    return false;
  };
  // Extrai TODOS os números do texto (trata faixas "1–2", "3,0–3,2 mi") e exige que CADA um tenha fonte.
  // briefOnly=true: só o briefing autoriza (p/ a coluna "meta de briefing").
  const okIn = (raw: string | undefined, unidade: string | undefined, briefOnly: boolean): boolean => {
    const text = `${raw ?? ""} ${unidade ?? ""}`;
    const toks = Array.from(text.matchAll(/(\d[\d.,]*)\s*(milh[õo]es|mi|mil|k|%)?/gi));
    if (toks.length === 0) return true;                // sem número → texto qualitativo, mantém
    for (const t of toks) {
      const v = parseNum(`${t[1]} ${t[2] || ""}`);
      if (v === null) continue;
      if (Number.isInteger(v) && v >= 1990 && v <= 2100) continue; // ano
      if (inSet(briefSet, v)) continue;
      if (!briefOnly && inSet(planSet, v)) continue;
      return false;                                    // este número não tem fonte → reprova
    }
    return true;
  };
  const ok = (raw?: string, unidade?: string) => okIn(raw, unidade, false);
  const filt = (arr: any, numKey = "num", uKey = "unidade") =>
    Array.isArray(arr) ? arr.filter((x: any) => { const k = ok(x?.[numKey], x?.[uKey]); if (!k) removed.push(`${x?.[numKey]}`); return k; }) : arr;
  const c: any = content;
  if (c.visaoGeral) c.visaoGeral.stats = filt(c.visaoGeral.stats);
  if (c.desafio) { c.desafio.stats = filt(c.desafio.stats); c.desafio.consumidor = filt(c.desafio.consumidor); }
  if (c.metricas) { c.metricas.stats = filt(c.metricas.stats); c.metricas.conversao = filt(c.metricas.conversao, "valor"); }
  if (Array.isArray(c.pilares)) c.pilares.forEach((p: any) => { if (p) p.stats = filt(p.stats); });
  if (c.objetivos && Array.isArray(c.objetivos.linhas)) {
    c.objetivos.linhas = c.objetivos.linhas.filter((l: any) => {
      if (!l) return false;
      if (!okIn(l.meta, undefined, true)) { removed.push(`meta:${l.meta}`); return false; } // meta de briefing só do briefing
      if (!ok(l.projecao)) { removed.push(`proj:${l.projecao}`); l.projecao = ""; }
      return true;
    });
  }
  if (c.roi && !ok(c.roi.numero, c.roi.unidade)) { removed.push(`roi:${c.roi.numero}`); delete c.roi; }
  if (removed.length) console.warn(`[deck] ${removed.length} número(s) SEM FONTE removido(s):`, removed.slice(0, 25).join(" | "));
  return content;
}

/** Gera só o CONTEÚDO estruturado do deck (sem renderizar). */
export async function generateDeckContent(p: DeckProposalInput, opts?: { model?: string }): Promise<DeckContent> {
  if (!ENV.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY não configurada");
  const plano = await resolvePlanForPresentation(p.userId, p.mediaPlan);
  let br: any = null;
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(briefings).where(eq(briefings.proposalId, p.id)).limit(1);
      if (rows.length) br = rows[0];
    }
  } catch { /* briefing opcional */ }

  const resp = await callMessages({
    model: opts?.model || DECK_MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: buildContentPrompt(p, plano, br) }],
  });
  const text = (resp.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const content = extractJson(text) as DeckContent;
  if (!content || typeof content !== "object") throw new Error("Conteúdo do deck inválido");
  // TRAVA programada: remove qualquer número sem fonte (briefing/plano) antes de renderizar.
  return scrubUnsourcedNumbers(content, br, plano);
}

/** Gera o deck completo (conteúdo Opus + render determinístico) e devolve o Buffer (.pptx). */
export async function generateDeckViaClaude(p: DeckProposalInput, opts?: { model?: string }): Promise<Buffer> {
  const plano = await resolvePlanForPresentation(p.userId, p.mediaPlan);
  const content = await generateDeckContent(p, opts);

  // Mockups automáticos: aplica a campanha do cliente nas fotos reais dos pontos Kallas.
  // No-op (rápido/grátis) enquanto não houver fotos no inventário; gera quando houver.
  let mockups: { b64: string; mime: string; formato: string; local: string }[] = [];
  try {
    mockups = await generateMockupSlides(plano, {
      marca: p.clientName,
      mote: content.conceito?.mote,
    }, { max: 6 });
  } catch { /* mockup é opcional — não derruba o deck */ }

  return renderDeck(content, plano, {
    clientName: p.clientName,
    dateStr: (p.createdAt || new Date()).toLocaleDateString("pt-BR"),
    mockups,
  });
}
