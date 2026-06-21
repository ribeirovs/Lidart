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
- NÃO invente valores de investimento (os números de verba são preenchidos pelo sistema a partir do plano — não os repita).
- Toda PROJEÇÃO de resultado (ROI, alcance, frequência, conversão, vendas, uplift) deve ser plausível e rotulada como estimativa no texto de apoio. Não apresente número de resultado como fato absoluto.
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
  try {
    const r = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": ENV.anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Claude API ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
    return j;
  } finally { clearTimeout(timer); }
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
  return content;
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
