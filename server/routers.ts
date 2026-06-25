import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createProposal, deleteProposal, getProposalById, getProposalsByUserId, updateProposal, getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { exportProposalToPDF, exportProposalToText, exportProposalToHTML } from "./proposal-export";
import { exportProposalToExcel } from "./excel-export";
import { exportProposalToPPTX, findBestSection } from "./pptx-export";
import { briefings, resources } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getParsedResourcesContext } from "./resources-parser";
import { strategyWorkshop, strategyWorkshopFallback, formatStrategyOutputAsMarkdown } from "./strategy-workshop";
import { loadFullCatalog, listCotaOptions, resolveFromOption, planCompleteness, resolvePlanForPresentation, verifyNarrativeAgainstPlan, NARRATIVE_BLOCKERS } from "./valuation-builder";
import { throwLLMTRPCError } from "./llm-error";
function normalizeString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanCitiesString(citiesStr: string): string {
  const normCitiesStr = normalizeString(citiesStr);
  const knownCities = [
    { name: "São Paulo", norm: "sao paulo" },
    { name: "Rio de Janeiro", norm: "rio de janeiro" },
    { name: "Fortaleza", norm: "fortaleza" },
    { name: "Recife", norm: "recife" },
    { name: "Salvador", norm: "salvador" },
    { name: "Natal", norm: "natal" },
    { name: "Belo Horizonte", norm: "belo horizonte" },
    { name: "Curitiba", norm: "curitiba" },
    { name: "Porto Alegre", norm: "porto alegre" },
    { name: "Goiânia", norm: "goiania" },
    { name: "Cuiabá", norm: "cuiaba" }
  ];

  const detected: string[] = [];

  for (const kc of knownCities) {
    if (normCitiesStr.includes(kc.norm)) {
      detected.push(kc.name);
    }
  }

  const splitItems = citiesStr
    .split(/[,;|/\n\(\)\+]+| e /i)
    .map(c => c.trim())
    .filter(Boolean);

  for (const item of splitItems) {
    const normItem = normalizeString(item);
    if (!normItem) continue;
    
    if (
      normItem.length < 3 || 
      normItem.includes("pensar") || 
      normItem.includes("campanha") || 
      normItem.includes("foco") || 
      normItem.includes("nacional") || 
      normItem.includes("nordeste") ||
      normItem.includes("atividades") ||
      normItem.includes("ativacoes") ||
      normItem.includes("mencionadas") ||
      normItem.includes("pracas")
    ) {
      continue;
    }

    const capitalized = item.charAt(0).toUpperCase() + item.slice(1);
    if (!detected.some(d => normalizeString(d) === normItem)) {
      detected.push(capitalized);
    }
  }

  return detected.length > 0 ? detected.join(", ") : citiesStr;
}

function matchCitiesWithInventory(citiesStr: string, inventoryText: string) {
  const normInventory = normalizeString(inventoryText);
  const normCitiesStr = normalizeString(citiesStr);
  
  // Lista de cidades conhecidas para buscar no texto de entrada
  const knownCities = [
    { name: "São Paulo", norm: "sao paulo" },
    { name: "Rio de Janeiro", norm: "rio de janeiro" },
    { name: "Fortaleza", norm: "fortaleza" },
    { name: "Recife", norm: "recife" },
    { name: "Salvador", norm: "salvador" },
    { name: "Natal", norm: "natal" },
    { name: "Belo Horizonte", norm: "belo horizonte" },
    { name: "Curitiba", norm: "curitiba" },
    { name: "Porto Alegre", norm: "porto alegre" },
    { name: "Goiânia", norm: "goiania" },
    { name: "Cuiabá", norm: "cuiaba" }
  ];

  const detected: string[] = [];

  // 1. Verificar se alguma cidade conhecida está explicitamente contida no texto de entrada
  for (const kc of knownCities) {
    if (normCitiesStr.includes(kc.norm)) {
      detected.push(kc.name);
    }
  }

  // 2. Fazer um split secundário para capturar cidades customizadas que não estão na lista de conhecidas
  const splitItems = citiesStr
    .split(/[,;|/\n\(\)\+]+| e /i)
    .map(c => c.trim())
    .filter(Boolean);

  for (const item of splitItems) {
    const normItem = normalizeString(item);
    if (!normItem) continue;
    
    // Ignorar palavras muito curtas ou termos comuns de instruções do briefing
    if (
      normItem.length < 3 || 
      normItem.includes("pensar") || 
      normItem.includes("campanha") || 
      normItem.includes("foco") || 
      normItem.includes("nacional") || 
      normItem.includes("nordeste") ||
      normItem.includes("atividades") ||
      normItem.includes("ativacoes") ||
      normItem.includes("mencionadas") ||
      normItem.includes("pracas")
    ) {
      continue;
    }

    const capitalized = item.charAt(0).toUpperCase() + item.slice(1);
    if (!detected.some(d => normalizeString(d) === normItem)) {
      detected.push(capitalized);
    }
  }

  const direct: string[] = [];
  const partner: string[] = [];

  for (const item of detected) {
    const normItem = normalizeString(item);
    
    // Verificar se existe no inventário (se o inventário estiver disponível e populado)
    let found = false;
    if (normInventory && normInventory.includes(normItem)) {
      found = true;
    } else {
      // Fallback robusto caso o inventário esteja inacessível (ex: erro de storage) ou vazio
      // Kallas tem operação direta histórica e exclusiva em Natal, Recife e Salvador
      const hardcodedDirectList = ["natal", "recife", "salvador"];
      if (hardcodedDirectList.some(d => normItem.includes(d) || d.includes(normItem))) {
        found = true;
      }
    }

    if (found) {
      direct.push(item);
    } else {
      partner.push(item);
    }
  }

  return { direct, partner };
}

function generateIdeaCentralFallback(clientName: string, citiesStr: string, inventoryText: string, creativityLevel: string = "medio") {
  const { direct, partner } = matchCitiesWithInventory(citiesStr, inventoryText);
  const allCities = [...direct, ...partner];

  // ── Mote & Big Idea ───────────────────────────────────────────────────────
  const mote = `"${clientName}: Presença que Marca, Experiência que Conecta"`;
  const bigIdea = `A campanha OOH de ${clientName} não é sobre estar no caminho do consumidor — é sobre fazer parte do seu dia. Cada ponto de contato urbano se transforma em uma experiência sensorial memorável: o cheiro certo no momento certo, a tela interativa no espaço certo, a mensagem emocional que atravessa o ruído da cidade e toca o cotidiano de quem importa.`;
  const territorioEmocional = creativityLevel === "alto"
    ? `**Território Emocional (Alto Impacto Sensorial):** A campanha explora o marketing multissensorial — integrando fragrâncias ambientais em abrigos de ônibus (Signature Scent Technology), sons ativados por presença e telas interativas com gatilhos táteis para criar uma experiência imersiva única no OOH brasileiro.`
    : creativityLevel === "baixo"
    ? `**Território Emocional:** Clareza, confiança e presença. A campanha reforça a autoridade da marca nos pontos de maior concentração do público-alvo com mensagens diretas e formatos de alta visibilidade.`
    : `**Território Emocional:** A campanha combina presença de massa com momentos de intimidade: de painéis de LED em grandes avenidas a telas interativas nos abrigos de ônibus com QR code, criando uma jornada de marca coerente do movimento ao engajamento.`;

  // ── Ativações sensoriais inovadoras ──────────────────────────────────────
  const atv1_titulo = creativityLevel === "alto" ? "Signature Scent Activation — Abrigos de Ônibus Aromáticos (All Space)" : "Mobiliário Urbano Interativo — Abrigos e MUBs (All Space)";
  const atv1_desc = creativityLevel === "alto"
    ? `Aromatizadores automatizados instalados nos abrigos de ônibus da All Space liberam a fragrância assinatura de ${clientName} sincronizada com os criativos exibidos nos painéis digitais MUB. O consumidor vê, sente e se lembra. Cada exposição ativa dois sentidos simultaneamente — visão e olfato — ampliando o recall em até 65% (Nielsen Sensory Marketing, 2023).\n  *   **QR Code Interativo:** Telas touchscreen nos abrigos com QR dinâmico direcionam para landing page exclusiva com conteúdo personalizado, amostras digitais e cupons de desconto geo-ativados.\n  *   **Cobertura:** ${direct.length > 0 ? `Mídia Direta Kallas — ${direct.join(", ")}` : "Via rede parceira homologada"}.`
    : `Exibição dinâmica nos MUBs Digitais, Relógios de Rua e Painéis de LED próximos a pontos comerciais estratégicos. Utilização de QR Codes nas telas direcionando para landing pages exclusivas com promoções geo-ativadas.\n  *   **Cobertura:** ${direct.length > 0 ? `Mídia Direta Kallas — ${direct.join(", ")}` : "Via rede parceira homologada"}.`;

  const atv2_titulo = "DOOH em Mobilidade — Telas Interativas em Carros de App (Zanzar / Locar)";
  const atv2_desc = creativityLevel === "alto"
    ? `Vídeos de 15" com gatilho sensorial de áudio ativado pelo GPS do veículo: quando o passageiro passa por uma zona de alta relevância para ${clientName} (shoppings, farmácias, clínicas), a tela exibe um conteúdo hiperpersonalizado com call-to-action direto. Formato exclusivo PDOOH da Zanzar Mídia Ltda.\n  *   **Cidades:** ${allCities.join(", ") || "Principais capitais"}.`
    : `Telas digitais interativas de 10" ou 15" com vídeo (Zanzar Mídia Ltda.) e Vidro Traseiro + Mídia Interna (Locar) engajam o público em deslocamentos cotidianos com mensagens contextualizadas.\n  *   **Cidades:** ${allCities.join(", ") || "Principais capitais"}.`;

  const atv3_titulo = creativityLevel === "alto" ? "Dwell Time Premium — Experiência Imersiva em Aeroportos (Codemp)" : "Aeroportos — Alta Qualidade em Espera (Codemp)";
  const atv3_desc = creativityLevel === "alto"
    ? `Bandejas de Raio-X adesivadas com o conceito da campanha criam o primeiro impacto de chegada. Carrinhos de Bagagem com mídia envolvente e painéis digitais (AIRMUB) completam a jornada sensorial no embarque e desembarque. O tempo de espera médio de 47 minutos garante exposição prolongada e memorização profunda.\n  *   **Cobertura:** ${direct.length > 0 ? `Kallas Direta — ${direct.join(", ")}` : "Via rede parceira"}.`
    : `Bandejas de Raio-X, Carrinhos de Bagagem e Painéis AIRMUB capturam a atenção qualificada durante o dwell time nos aeroportos. Alta renda e atenção disponível = ambiente ideal para mensagem de marca premium.\n  *   **Cobertura:** ${direct.length > 0 ? `Kallas Direta — ${direct.join(", ")}` : "Via rede parceira"}.`;

  // ── Estratégia de praças ──────────────────────────────────────────────────
  const estrategiaPracas = [
    direct.length > 0
      ? `*   **Inventário Kallas Direto (${direct.join(", ")}):** Cobertura via All Space, Codemp, Zanzar e Locar — garantindo eficiência de custo, checking direto e exclusividade de posições.`
      : null,
    partner.length > 0
      ? `*   **Rede Parceira Homologada (${partner.join(", ")}):** A Kallas atua como centralizadora nacional, contratando formatos via JCDecaux, Eletromidia e Neooh para garantir a cobertura solicitada sem perda de qualidade ou rastreabilidade.`
      : null,
  ].filter(Boolean).join("\n");

  return `### Conceito Criativo e Ideia Central — ${clientName}

---

#### 🎯 Mote da Campanha
> ${mote}

#### 💡 Big Idea
${bigIdea}

#### ❤️ ${territorioEmocional}

---

### Ativações OOH Recomendadas

#### 1. ${atv1_titulo}
${atv1_desc}

#### 2. ${atv2_titulo}
${atv2_desc}

#### 3. ${atv3_titulo}
${atv3_desc}

---

### Estratégia de Cobertura de Praças
${estrategiaPracas || "*   Cobertura nacional via rede parceira homologada da Kallas.*"}`;
}

function generateValuationFallback(clientName: string, budget: string, citiesStr: string, inventoryText: string) {
  const { direct, partner } = matchCitiesWithInventory(citiesStr, inventoryText);
  const cleanBudget = budget.replace(/[^\d]/g, "");
  const totalVal = cleanBudget ? parseInt(cleanBudget) : 500000;
  
  const allCities = [...direct, ...partner];
  const numCities = allCities.length || 1;
  const costPerCity = Math.floor((totalVal * 0.8) / numCities);
  
  let tableRows = "";
  let currentSum = 0;
  
  for (const city of direct) {
    tableRows += `| **${city}** | Mídia Direta Kallas (All Space/Codemp) | MUBs / Painéis / Aeroportos | R$ ${costPerCity.toLocaleString("pt-BR")},00 |\n`;
    currentSum += costPerCity;
  }
  
  for (const city of partner) {
    tableRows += `| **${city}** | Rede Parceira Homologada (JCDecaux/Eletromidia) | MUBs / Abrigos / Telas | R$ ${costPerCity.toLocaleString("pt-BR")},00 |\n`;
    currentSum += costPerCity;
  }
  
  const productionCost = Math.floor(totalVal * 0.1);
  const agencyCost = totalVal - currentSum - productionCost;

  return `### Plano de Custos e Valoração OOH - ${clientName}

A valoração da campanha foi dimensionada considerando as praças solicitadas no briefing. As tarifas foram distribuídas entre o inventário direto da Kallas e a rede de parceiros homologados.

#### Tabela de Custos e Investimento Estimado

| Praça | Meio de Veiculação / Fornecedor | Formato de Mídia Recomendado | Investimento Est. (R$) |
| :--- | :--- | :--- | :---: |
${tableRows}| **Nacional** | Produção e Instalação Física | Impressão e Montagem de Campanha | R$ ${productionCost.toLocaleString("pt-BR")},00 |
| **Nacional** | Taxa de Agência / BV (10%) | General Planning and Campaign Setup | R$ ${agencyCost.toLocaleString("pt-BR")},00 |
| **TOTAL** | **Investimento Consolidado** | | **R$ ${totalVal.toLocaleString("pt-BR")},00** |

#### Estimativa de ROI e Impacto
*   **Alcance Total Estimado:** ~${((totalVal / 500000) * 12.5).toFixed(1)} milhões de impactos nas praças selecionadas.
*   **Frequência Média:** 4,8 exposições por indivíduo no público-alvo.
*   **Custo por Mil (CPM) Médio:** R$ 4,00 (Altamente eficiente para campanhas de OOH integradas).
*   **ROI Qualitativo:** Aumento no recall da marca e ativação de audiência qualificada nas praças prioritárias.`;
}

function generateProposalFinalFallback(clientName: string, projectScope: string, budget: string, citiesStr: string, inventoryText: string) {
  const { direct, partner } = matchCitiesWithInventory(citiesStr, inventoryText);
  const isJohnson = clientName.toLowerCase().includes("johnson");
  const cleanBudget = budget.replace(/[^\d]/g, "");
  const totalVal = cleanBudget ? parseInt(cleanBudget) : 500000;
  
  const allCities = [...direct, ...partner];
  const numCities = allCities.length || 1;
  const costPerCity = Math.floor((totalVal * 0.8) / numCities);
  
  let tableRows = "";
  let currentSum = 0;
  
  for (const city of direct) {
    tableRows += `| **${city}** | Mídia Direta Kallas (All Space/Codemp) | MUBs / Painéis / Aeroportos | R$ ${costPerCity.toLocaleString("pt-BR")},00 |\n`;
    currentSum += costPerCity;
  }
  
  for (const city of partner) {
    tableRows += `| **${city}** | Rede Parceira Homologada (JCDecaux/Eletromidia) | MUBs / Abrigos / Telas | R$ ${costPerCity.toLocaleString("pt-BR")},00 |\n`;
    currentSum += costPerCity;
  }
  
  const productionCost = Math.floor(totalVal * 0.1);
  const agencyCost = totalVal - currentSum - productionCost;

  return `# Proposta Comercial OOH Final Consolidada - ${clientName}

## 1. Sumário Executivo
Esta proposta apresenta o plano estratégico de mídia exterior para a campanha de **${clientName}**. Focada no alcance qualificado do público-alvo, a campanha será distribuída de forma inteligente nas praças solicitadas: **${allCities.join(", ") || "Brasil"}**. A cobertura nacional é garantida pela combinação sinérgica do inventário direto da Kallas com a contratação de redes parceiras homologadas nas capitais e grandes polos regionais.

## 2. Defesa da Campanha & Análise de Mídia
O plano de mídia foi desenhado com foco em três pilares essenciais de contato:
1. **Rotina diária em deslocamento:** Mídia móvel digital em carros de aplicativo (Zanzar/Locar) para capturar a atenção exclusiva dos consumidores em trânsito.
2. **Momentos de lazer e compras:** Mobiliário urbano premium (All Space / All Space Abrigos Grande Recife) em pontos comerciais estratégicos.
3. **Espera qualificada (Dwell Time):** Mídia nos aeroportos de negócios e turismo (Codemp) para consolidar a presença da marca com alto impacto visual.

## 3. Conceito Criativo e Ideia Central
*   **Mote da Campanha:** ${isJohnson ? `"Signature Scents: O Aroma do Cuidado na Jornada do Banho"` : `"Conectando Caminhos com ${clientName}"`}
*   **Conceito:** ${isJohnson ? "Transformar o momento do banho em um ritual inesquecível de afeto e conexão multessensorial, levando o aconchego da nova linha ao dia a dia das famílias brasileiras." : `Aproximar a marca do cotidiano do público por meio de uma cobertura de alta visibilidade nas vias urbanas mais movimentadas.`}

## 4. Plano de Mídia e Valoração Consolidada

| Praça | Meio de Veiculação / Fornecedor | Formato de Mídia Recomendado | Investimento Est. (R$) |
| :--- | :--- | :--- | :---: |
${tableRows}| **Nacional** | Produção, Impressão e Instalação | Mídia estática e digital | R$ ${productionCost.toLocaleString("pt-BR")},00 |
| **Nacional** | Taxa de Agência / BV (10%) | Planejamento e Veiculação | R$ ${agencyCost.toLocaleString("pt-BR")},00 |
| **TOTAL** | **Investimento Consolidado** | | **R$ ${totalVal.toLocaleString("pt-BR")},00** |

## 5. Cronograma e Condições Comerciais
*   **Prazos de Produção:** Envio das artes até 15 dias antes do início de cada bi-semana.
*   **Relatórios de Checking:** Envio de checking fotográfico digital das praças físicas em até 72h após a instalação.
*   **Premissas Comerciais:** Condições padrão de agência (30 DFM) e faturamento direto por veículo parceiro.

---
*Esta proposta está estruturada de acordo com os requisitos e premissas indicados no briefing.*`;
}

// BLOQUEIO DO VERIFICADOR: recusa exportar artefato client-facing se a narrativa tiver
// pontos CRÍTICOS fora do plano. A IA não decide — o planner confirma "exportar mesmo
// assim" (force). Sem plano (vazio) ou com force=true, não bloqueia.
async function gateNarrativeExport(userId: number, id: number, force?: boolean): Promise<void> {
  if (force) return;
  const proposal = await getProposalById(id, userId) as any;
  if (!proposal) return;
  const plano = await resolvePlanForPresentation(userId, proposal.mediaPlan);
  if (plano.vazio) return;
  const check = verifyNarrativeAgainstPlan(proposal.proposalContent || "", plano);
  const blk = check.flags.filter((f) => NARRATIVE_BLOCKERS.includes(f.tipo));
  if (blk.length === 0) return;
  const LBL: Record<string, string> = {
    praca_fora_plano: "praça fora do plano",
    formato_fora_plano: "formato fora do plano",
    ambiente_fora_plano: "ambiente/cena fora do plano",
    linguagem_exclusao: "linguagem de exclusão",
    modelo_valoracao: 'menção a "Modelo Valoração"',
    calculo_rascunhado: "cálculo rascunhado",
  };
  const cont: Record<string, number> = {};
  for (const f of blk) cont[f.tipo] = (cont[f.tipo] || 0) + 1;
  const resumo = Object.entries(cont).map(([t, n]) => `${n} ${LBL[t] || t}`).join(", ");
  throw new Error(`[VERIFICADOR] ${blk.length} ponto(s) crítico(s) fora do plano: ${resumo}. Revise no painel do verificador antes de enviar ao cliente — ou exporte mesmo assim.`);
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  proposals: router({
    create: protectedProcedure
      .input(
        z.object({
          clientName: z.string().min(1),
          clientCompany: z.string().min(1),
          clientContact: z.string().optional(),
          projectScope: z.string().min(1),
          values: z.string().min(1),
          deadline: z.string().optional(),
          commercialTerms: z.string().optional(),
          proposalContent: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await createProposal({
          userId: ctx.user.id,
          ...input,
        });
        return result;
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const proposals = await getProposalsByUserId(ctx.user.id);
      return proposals;
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (proposal) {
          const db = await getDb();
          let linkedBriefing: any[] = [];
          if (db) {
            linkedBriefing = await db
              .select()
              .from(briefings)
              .where(eq(briefings.proposalId, proposal.id))
              .limit(1);
          }
          return {
            ...proposal,
            briefing: linkedBriefing.length > 0 ? linkedBriefing[0] : null,
          };
        }
        return proposal;
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          clientName: z.string().optional(),
          clientCompany: z.string().optional(),
          clientContact: z.string().optional(),
          projectScope: z.string().optional(),
          values: z.string().optional(),
          deadline: z.string().optional(),
          commercialTerms: z.string().optional(),
          proposalContent: z.string().optional(),
          status: z.enum(["draft", "sent", "accepted", "rejected", "archived"]).optional(),
          currentStage: z.enum([
            "briefing",
            "validation",
            "research",
            "inventory",
            "pricing",
            "product_content",
            "strategy_workshop",
            "idea_central",
            "idea_validation",
            "valuation",
            "valuation_validation",
            "proposal_final",
            "customization",
            "approval",
            "delivery"
          ]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateProposal(id, ctx.user.id, data);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteProposal(input.id, ctx.user.id);
        return { success: true };
      }),

    deleteProposal: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteProposal(input.id, ctx.user.id);
        return { success: true };
      }),

    generate: protectedProcedure
      .input(
        z.object({
          clientName: z.string().min(1),
          clientCompany: z.string().min(1),
          projectScope: z.string().min(1),
          values: z.string().min(1),
          deadline: z.string().optional(),
          commercialTerms: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const systemPrompt = `Você é um especialista em propostas comerciais profissionais. Sua tarefa é gerar uma proposta comercial elegante, bem estruturada e persuasiva em português.

A proposta deve incluir:
1. Cabeçalho com dados do cliente
2. Sumário executivo
3. Escopo do projeto
4. Metodologia
5. Timeline e prazos
6. Investimento e condições comerciais
7. Termos e condições
8. Próximos passos

Formate a resposta em Markdown com estrutura clara e profissional.`;

        const resourcesContext = await getParsedResourcesContext(ctx.user.id);

        const userPrompt = `Gere uma proposta comercial para:

Cliente: ${input.clientName}
Empresa: ${input.clientCompany}
Escopo do Projeto: ${input.projectScope}
Valores: ${input.values}
${input.deadline ? `Prazo: ${input.deadline}` : ""}
${input.commercialTerms ? `Condições Comerciais: ${input.commercialTerms}` : ""}

${resourcesContext ? `ATENÇÃO: Baseie a proposta estritamente nos recursos e dados fornecidos pelo usuário a seguir (tabelas de preços, inventário, etc):\n${resourcesContext}` : ""}

Gere uma proposta profissional, elegante e persuasiva em Markdown.`;

        let content = "";
        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            maxTokens: 8000,
          });

          const rawContent = response.choices[0]?.message.content;
          if (typeof rawContent === "string") {
            content = rawContent;
          } else if (Array.isArray(rawContent)) {
            content = rawContent.map(c => c.type === "text" ? c.text : "").join("\n");
          }
          if (!content) {
            throw new Error("Failed to generate proposal");
          }
        } catch (err) {
          throwLLMTRPCError(err);
        }

        return { proposalContent: content };
      }),

    exportPDF: protectedProcedure
      .input(z.object({ id: z.number(), force: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }
        await gateNarrativeExport(ctx.user.id, input.id, input.force);

        const { url, key } = await exportProposalToPDF(proposal);
        return {
          success: true,
          url,
          key,
          filename: `proposta_${proposal.clientName.replace(/\s+/g, "_")}.pdf`,
        };
      }),

    exportText: protectedProcedure
      .input(z.object({ id: z.number(), force: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }
        await gateNarrativeExport(ctx.user.id, input.id, input.force);

        const { url, key } = await exportProposalToText(proposal);
        return {
          success: true,
          url,
          key,
          filename: `proposta_${proposal.clientName.replace(/\s+/g, "_")}.txt`,
        };
      }),

    exportHTML: protectedProcedure
      .input(z.object({ id: z.number(), force: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }
        await gateNarrativeExport(ctx.user.id, input.id, input.force);

        const { exportProposalToHTMLDeck } = await import("./html-deck-export");
        const { url, key } = await exportProposalToHTMLDeck(proposal);
        return {
          success: true,
          url,
          key,
          filename: `apresentacao_${proposal.clientName.replace(/\s+/g, "_")}.html`,
        };
      }),

    generateStageContent: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          stageToGenerate: z.enum(["idea_central", "valuation", "proposal_final"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }

        // ENFORCEMENT DE SEQUÊNCIA: só gera a etapa em que a proposta REALMENTE está.
        // Impede pular (ex.: briefing direto p/ proposal_final, pulando aprovações).
        if (proposal.currentStage !== input.stageToGenerate) {
          throw new Error(
            `Etapa fora de ordem: a proposta está em "${proposal.currentStage}", não em "${input.stageToGenerate}". ` +
            `Conclua as etapas anteriores na sequência (cada uma exige a aprovação da anterior).`
          );
        }

        const db = await getDb();
        let briefing: any = null;
        if (db) {
          const briefingResult = await db
            .select()
            .from(briefings)
            .where(eq(briefings.proposalId, proposal.id))
            .limit(1);
          if (briefingResult.length > 0) {
            briefing = briefingResult[0];
          }
        }

        // Let the LLM handle inventory availability and partner networks dynamically without throwing hard errors.

        const briefingDetails = briefing
          ? `\n--- DADOS OFICIAIS DO BRIEFING DO CLIENTE ---\n` +
            `- Cliente / Marca: ${briefing.clientName}\n` +
            `- Campanha: ${briefing.campaignName || "Não especificado"}\n` +
            `- Segmento de Negócio: ${briefing.segment}\n` +
            `- Cidades / Praças da Campanha: ${briefing.cities}\n` +
            `- Período / Duração da Campanha: ${briefing.campaignPeriod}\n` +
            `- Verba / Orçamento Total: ${briefing.budget}\n` +
            `- Objetivo da Campanha: ${briefing.objective}\n` +
            `- Público-Alvo Principal: ${briefing.targetAudience}\n` +
            `- Especificações Técnicas de Mídia: ${briefing.mediaSpecs || "Não especificado"}\n` +
            `- Requisitos e Dados do Ponto: ${briefing.locationSpecs || "Não especificado"}\n` +
            `- Termos e Premissas Comerciais: ${briefing.commercialTerms || "Não especificado"}\n` +
            `- Mais Detalhes / Outras Informações da Campanha: ${briefing.moreDetails || "Não especificado"}\n` +
            `- Contato Responsável: ${briefing.contactName} (${briefing.contactEmail})\n` +
            `---------------------------------------------\n`
          : `\n--- DADOS DA PROPOSTA ---\n` +
            `- Cliente / Marca: ${proposal.clientName}\n` +
            `- Empresa: ${proposal.clientCompany}\n` +
            `- Escopo do Projeto: ${proposal.projectScope}\n` +
            `- Orçamento / Verba: ${proposal.values}\n` +
            `-------------------------\n`;

        const creativityLevel = briefing?.creativityLevel || "medio";
        let temperature = 0.7;
        let systemContent = "Você é um consultor especialista em planejamento comercial e mídia OOH.";
        let creativityDirective = "";
        
        if (creativityLevel === "baixo") {
          temperature = 0.3;
          systemContent = "Você é um consultor especialista em planejamento comercial de OOH, focado em pragmatismo, dados exatos, custos e formatos tradicionais de mídia.";
          creativityDirective = "\n\nDIRETRIZ DE CRIATIVIDADE: Seja pragmático, objetivo, técnico e convencional. Evite ativações caras, complexas ou extravagantes.";
        } else if (creativityLevel === "alto") {
          temperature = 1.15;
          systemContent = "Você é um Diretor de Criação de OOH renomado mundialmente, focado em inovação disruptiva, guerrilha urbana, experiências sensoriais fora da caixa e alto impacto tecnológico.";
          creativityDirective = "\n\nDIRETRIZ DE CRIATIVIDADE: Seja extremamente inovador, criativo e 'fora da caixa'. Proponha ativações sensoriais inovadoras (aromas, sons, texturas, interações táteis), uso criativo de mídias de vídeo digital em trânsito (PDOOH Zanzar) e formatos digitais 3D interativos e surpreendentes.";
        }

        let prompt = "";
        let nextStage: any = "briefing";
        let planSectionToAppend = ""; // D: seção determinística do plano (texto = planilha)
        let substituirConteudo = false; // PASSO 2: proposal_final c/ plano REESCREVE (não acumula)

        if (input.stageToGenerate === "idea_central") {
          const resourcesContext = await getParsedResourcesContext(ctx.user.id, ["inventory", "product_content"]);
          prompt = `Gere um conceito criativo de Campanha OOH (Ideia Central) para a marca.
          
${briefingDetails}

Forneça um mote criativo marcante, um conceito principal e 3 sugestões de ativações de OOH (ex: outdoors, leds, abrigos de ônibus interativos) alinhadas com o objetivo e o público-alvo da campanha.

ATENÇÃO IMPORTANTE PARA ATIVAÇÕES & INVENTÁRIO:
- Alinhe as ativações com os formatos de mídia reais disponíveis no inventário fornecido abaixo para a(s) cidade(s) solicitada(s).
- Se houver no inventário carros equipados com aplicativos/telas de vídeo (ex: Zanzar, Carros de App, CarTaxi), você deve obrigatoriamente considerar esse formato e integrá-lo de forma destacada como uma das ativações recomendadas para mídia móvel de vídeo digital (DOOH).
- Sempre cite explicitamente o parceiro/veículo fornecedor real de cada mídia recomendada (ex: Zanzar Mídia Ltda., Locar, Codemp, All Space) como a fonte e garantia de viabilidade da veiculação.

DIRETRIZES DE TRATAMENTO DE PRAÇAS (INVENTÁRIO VS REDE PARCEIRA):
- Verifique quais das cidades solicitadas no briefing ("${briefing?.cities || "Não especificado"}") possuem mídias no inventário fornecido abaixo.
- Para as cidades com mídias disponíveis no inventário (ex: Natal, Recife, Salvador): você DEVE priorizar e basear suas recomendações estritamente nessas mídias físicas reais e seus respectivos fornecedores/parceiros listados.
- Para as cidades que NÃO possuem mídias no inventário (ex: Fortaleza, São Paulo capital, Rio de Janeiro capital): NÃO aborte a geração. Gere o conceito e as ativações de mídia para elas normalmente, mas adicione uma nota clara informando que a veiculação nessas praças específicas será feita via rede de parceiros homologados (como JCDecaux, Eletromidia, Neooh, etc.) para garantir a cobertura nacional solicitada pelo cliente.

${resourcesContext ? `DADOS DE INVENTÁRIO DO USUÁRIO:\n${resourcesContext}` : ""}${creativityDirective}`;
          nextStage = "idea_validation";
        } else if (input.stageToGenerate === "valuation") {
          const resourcesContext = await getParsedResourcesContext(ctx.user.id, ["inventory", "pricing"]);
          prompt = `Com base no orçamento e verba da campanha, calcule a valoração do plano de mídia de forma estruturada.

${briefingDetails}

Distribua os custos entre: veiculação (tabelas de preços, impressão e produção), taxas de instalação e taxas de agência. Forneça uma tabela formatada em Markdown com o resumo de custos e o ROI estimado.

FORMATO OBRIGATÓRIO DA TABELA DO PLANO DE MÍDIA (será lida por sistemas automáticos — siga À RISCA):
Toda tabela de itens de mídia deve usar EXATAMENTE estas colunas, nesta ordem:
| Praça | Formato | Local/Ambiente | Período | Qtd | Valor Unit. | Subtotal | Parceiro |
- "Período" em número de semanas (ex.: "10 semanas").
- "Valor Unit." = valor por unidade por período, em R$ (ex.: R$ 12.000).
- "Subtotal" = Qtd × Períodos × Valor Unit., em R$.
- Linha final de cada tabela: | TOTAL | | | | | | R$ ... | |
- Tabelas-resumo percentuais (ex.: distribuição % do budget) são permitidas SEPARADAMENTE, mas nunca substituem as tabelas de itens neste formato.

DIRETRIZES DE VALORAÇÃO DE PRAÇAS (INVENTÁRIO VS REDE PARCEIRA):
- Para as cidades que possuem tarifas no inventário/tabela de preços: use os custos e dados reais do arquivo.
- Para as cidades que NÃO possuem tarifas diretas no inventário (ex: Fortaleza, São Paulo, Rio de Janeiro): estime os custos com base em tarifas de referência de mercado de parceiros para as mídias sugeridas, adicionando uma observação na tabela ou nota de que os valores para essas praças são baseados em custos estimados de parceiros.

${resourcesContext ? `DADOS DE INVENTÁRIO E PREÇOS DO USUÁRIO:\n${resourcesContext}` : ""}`;
          nextStage = "valuation_validation";
        } else if (input.stageToGenerate === "proposal_final") {
          // FONTE ÚNICA: o texto deriva do PLANO VALIDADO (mesma fonte do Excel e PPT).
          const plano = await resolvePlanForPresentation(ctx.user.id, (proposal as any).mediaPlan);

          if (!plano.vazio) {
            substituirConteudo = true; // PASSO 2: com plano, a narrativa é REESCRITA (não acumula)
            // Monta a seção determinística (praças/preços/total) — será anexada APÓS a narrativa nova
            const fmtBRL = (n: number) => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
            let planoMd = "## Plano de Veiculação OOH\n";
            for (const g of plano.porPraca) {
              planoMd += `\n### ${g.praca} (${g.uf})\n\n`;
              planoMd += `| Formato | Local/Ambiente | Cota/Veiculação | Qtd | Subtotal | Parceiro |\n`;
              planoMd += `| :--- | :--- | :--- | ---: | ---: | :--- |\n`;
              for (const it of g.itens) planoMd += `| ${it.nome} | ${it.local} | ${it.cota}/${it.veiculacao} | ${it.qtd} | ${fmtBRL(it.subtotal)} | ${it.razao} |\n`;
              planoMd += `| **SUBTOTAL ${g.praca}** | | | | **${fmtBRL(g.subtotal)}** | |\n`;
            }
            planoMd += `\n## Resumo de Investimento\n\n| Praça | Subtotal Veiculação |\n| :--- | ---: |\n`;
            for (const g of plano.porPraca) planoMd += `| ${g.praca} (${g.uf}) | ${fmtBRL(g.subtotal)} |\n`;
            planoMd += `| **TOTAL VEICULAÇÃO** | **${fmtBRL(plano.totalVeiculacao)}** |\n`;
            planoMd += `| Produção de Peças | A preencher — planner |\n| Instalação e Manutenção | A preencher — planner |\n| Taxa de Agência | A preencher — planner |\n`;
            planoMd += `\n*Fonte: Tabela de Preços Kallas (plano validado). Valores sujeitos a confirmação de disponibilidade no fechamento.*\n`;
            planSectionToAppend = planoMd;

            const pracasPlano = plano.porPraca.map((g) => g.praca).join(", ");

            // PASSO 1 — LISTA BRANCA por praça: os ÚNICOS formatos/produtos que a narrativa
            // pode citar como mídia/ativação vendida. Lista do PERMITIDO (não do proibido).
            const listaBranca = plano.porPraca.map((g) => {
              const formatos = Array.from(new Set(g.itens.map((it) => `${it.nome}${it.local ? ` em ${it.local}` : ""}`.trim()).filter(Boolean)));
              return `- ${g.praca} (${g.uf}): ${formatos.join("; ")}`;
            }).join("\n");

            prompt = `Gere a Proposta Comercial de OOH final consolidada para o cliente — esta é a versão DEFINITIVA, que SUBSTITUI qualquer rascunho anterior.

${briefingDetails}

⚠️ REGRA ABSOLUTA — O PLANO É O UNIVERSO COMPLETO DA CAMPANHA:
- O ESCOPO da campanha é EXATAMENTE as praças do plano: ${pracasPlano}. Trate isso como o todo. Se o briefing mencionar qualquer outra cidade, IGNORE — ela não existe para esta proposta.

LISTA BRANCA — ÚNICOS formatos/produtos por praça que a narrativa pode citar:
${listaBranca}

- A narrativa fala SÓ do que ESTÁ no plano. É PROIBIDO, em QUALQUER seção (Insight, Defesa, Conceito, Jornada, Estratégia, Métricas), citar praça, formato, AMBIENTE ou PONTO DE CONTATO que não esteja no plano — nem para vender, nem como "contexto de mercado", nem como cena, exemplo ou dado de suporte, nem para dizer que ficou de fora.
- AMBIENTES/CENAS: toda cena, jornada, exemplo e estatística de suporte acontece NO ambiente do formato daquela praça (placa de rua → na rua; busdoor → no ônibus/trajeto; carros de app → dentro do carro; empena → no entorno do prédio). NUNCA invente aeroporto, metrô, terminal, shopping ou qualquer ponto de contato fora do plano daquela praça — se NENHUMA praça tem mídia de aeroporto, NÃO escreva cena no aeroporto NEM cite dado de passageiros de aeroporto. Os únicos ambientes permitidos são os que aparecem na lista branca acima.
- PROIBIDO POR CONSTRUÇÃO (não gere esse raciocínio): "formatos sacrificados", "o que abrimos mão", "trade-off aceito/de exclusão", "ausência em [praça]", "não cobrimos X", "menor alcance/ROI por não incluir Y", ou QUALQUER frase que descreva o que a campanha NÃO faz. A estratégia explica por que o que ESTÁ no plano vence — jamais o que ficou fora. Não existe seção/bloco de sacrifício, descarte ou exclusão.
- As palavras "trade-off" e "sacrifício" (em qualquer forma) são PROIBIDAS no texto. E NUNCA descreva uma praça do plano de forma minimizada ou negativa (ex.: "Natal representa apenas 0,6% do alcance", "menor alcance absoluto"): TODA praça do plano entra pelo papel POSITIVO que entrega (proximidade, frequência, contexto premium, fidelização), nunca pelo tamanho que não tem.
- NÃO escreva a tabela de Plano de Veiculação nem a de Investimento — serão inseridas automaticamente do plano validado. NÃO invente preços, totais nem outras praças.
- É PROIBIDO citar "Modelo Valoração Kallas" como fonte ou metodologia. A fonte de preço é a Tabela de Preços Kallas (plano validado).
- ⭐ REGRA Nº 1 — NÚMEROS COM LASTRO (a mais importante): nenhum número vai ao cliente sem origem. Todo número vem de (a) PLANO/Tabela de Preços real, (b) FONTE pública real citada NA própria frase, ou (c) ESTIMATIVA com a LÓGICA explícita e LIMPA — a premissa e a base de onde saiu, em UMA linha (ex.: "alcance estimado ~X — base: inserções/dia do plano × dias de campanha; estimativa"). É PROIBIDO número "pelado" (sem fonte e sem mostrar a base). Na dúvida, escreva qualitativo, sem cifra. A lógica é LIMPA (premissa + resultado) — NÃO é rascunho: nada de "Correção:", duas versões do número ou valores intermediários soltos.

Escreva TODAS as seções NARRATIVAS abaixo (sem tabela de preços) — use EXATAMENTE estes títulos em Markdown, nesta ordem:
## Sumário Executivo
(Visão geral da campanha, focada nas praças do plano.)
## Defesa de Praça & Análise de Inventário
(Argumento comportamental por praça: quem é o público, onde circula, por que os formatos do plano o interceptam. Cite os parceiros reais conforme o plano. SEM preços.)
## Insight de Mercado
(A oportunidade não óbvia / tendência da categoria que sustenta a campanha. TODA estatística numérica — %, CAGR, "X% superior", "Y vezes mais" — exige FONTE REAL citada na própria frase, OU, se estimativa, a BASE explícita (premissa de onde saiu) rotulada como estimativa/hipótese. Número sem fonte E sem base é PROIBIDO — é material para o cliente.)
## Conceito Criativo e Ideia Central
(PRESERVE o mote e o conceito criativo já desenvolvidos no rascunho anterior. As ativações devem usar APENAS formatos da lista branca — não proponha mídia fora dela.)
## Jornada do Público
(Pontos de contato ao longo da rotina do público, usando APENAS os formatos/praças/ambientes do plano. A jornada de cada praça acontece no ambiente do formato daquela praça — sem aeroporto, metrô ou qualquer cenário que não esteja no plano.)
## Estratégia de Mídia
(Racional POSITIVO: por que ESTE mix de praças e formatos do plano entrega o objetivo — priorização, concentração de impacto e sinergia entre os formatos escolhidos. Fale só do que está no plano e por que vence; sem comparar com alternativas não escolhidas.)
## Métricas e KPIs
(Objetivos de alcance/frequência/ROI como ESTIMATIVAS — cada KPI: UM número final + a BASE em UMA linha limpa, ou seja a premissa/cálculo de onde saiu (ex.: "frequência ~4–6/sem — base: concentração do plano nas praças prioritárias"), rotulado como estimativa/projeção. REGRA Nº 1: número sem base é proibido. NUNCA invente instituto de pesquisa. A base é LIMPA (premissa + resultado), NUNCA rascunho: nada de valores intermediários soltos, duas versões do número, "Correção:", "ajustar meta para…", "ou R$…".)
## Cronograma e Condições Comerciais
(${proposal.commercialTerms || "Padrão"}.)
## Fontes e Premissas
(Liste as fontes reais usadas e as premissas; se for estimativa, escreva "estimativa baseada em benchmarks". NÃO cite dados, perfis ou fontes de praças/formatos/ambientes que NÃO estão no plano — ex.: se nenhuma praça do plano tem mídia de aeroporto, não mencione "passageiros de aeroporto". Cite só o que sustenta o que ESTÁ no plano.)

(A tabela de Plano de Veiculação e o Resumo de Investimento NÃO entram no seu texto — serão anexadas automaticamente do plano validado.)
ESTILO: prefira "sem X" a "ausência de X" (ex.: escreva "sem call-to-action", não "ausência de call-to-action").
NUNCA inclua raciocínio rascunhado, variantes, autocorreção ou "pensar em voz alta" em NENHUMA seção — entregue só a versão final, limpa (um número final por métrica; nada de "Correção:"/"ajustar meta").
Formate em Markdown profissional.

PLANO VALIDADO (para você conhecer praças/formatos/parceiros — NÃO reescreva como tabela):
${planoMd}

RASCUNHO ANTERIOR DA PROPOSTA (use SOMENTE para preservar o mote e o conceito criativo já aprovados — IGNORE completamente quaisquer praças, formatos, preços e tabelas dele; a mídia válida é EXCLUSIVAMENTE a lista branca acima):
${proposal.proposalContent}`;
          } else {
            // Sem plano de cotas: caminho antigo (texto do inventário), mas avisando
            const resourcesContext = await getParsedResourcesContext(ctx.user.id);
            prompt = `Gere a Proposta Comercial de OOH final consolidada para o cliente.

${briefingDetails}

ATENÇÃO: não há plano de cotas selecionado. Gere a narrativa estratégica, mas indique que a valoração final depende da seleção de cotas (não invente preços definitivos).

Seções: 1. Sumário Executivo; 2. Defesa da Campanha; 3. Escopo e Objetivos; 4. Conceito Criativo e Ideia Central; 5. Cronograma e Condições Comerciais (${proposal.commercialTerms || "Padrão"}). Formate em Markdown.

${resourcesContext ? `DADOS DE INVENTÁRIO DE SUPORTE:\n${resourcesContext}` : ""}`;
          }
          nextStage = "customization";
        }

        let generatedText = "";
        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemContent },
              { role: "user", content: prompt },
            ],
            maxTokens: input.stageToGenerate === "proposal_final" ? 16000 : 8000,
            temperature,
          });
          const content = response?.choices?.[0]?.message?.content;
          if (typeof content === "string") {
            generatedText = content;
          } else if (Array.isArray(content)) {
            generatedText = content.map(c => c.type === "text" ? c.text : "").join("\n");
          }
        } catch (err) {
          throwLLMTRPCError(err);
        }

        // D: a seção determinística do plano (números exatos, não da IA)
        const planoBloco = planSectionToAppend ? `\n\n---\n\n${planSectionToAppend}` : "";
        // PASSO 2 — SUBSTITUIR, não acumular: no proposal_final COM plano a proposta é
        // REESCRITA (narrativa nova ancorada no plano + seção determinística). Antes ANEXAVA
        // ao texto velho e acumulava ("duas campanhas"). Demais etapas seguem anexando.
        // ANTI-DUPLICAÇÃO: se a IA escreveu a tabela de Plano/Investimento por conta própria
        // (copiando o plano que vai no prompt como referência, apesar da instrução), corta a
        // partir daí — senão duplica com a seção determinística anexada (planoBloco).
        let narrativaFinal = generatedText;
        if (substituirConteudo) {
          const corte = narrativaFinal.search(/^#{1,4}\s*(Plano de Veicula|Resumo de Investimento|Plano de M[íi]dia)/im);
          if (corte >= 0) narrativaFinal = narrativaFinal.slice(0, corte).replace(/\s*-{3,}\s*$/, "").trimEnd();
        }
        const newContent = substituirConteudo
          ? `${narrativaFinal}${planoBloco}`
          : `${proposal.proposalContent}\n\n---\n\n${generatedText}${planoBloco}`;
        await updateProposal(proposal.id, ctx.user.id, {
          proposalContent: newContent,
          currentStage: nextStage,
        });

        return { success: true, nextStage };
      }),

    validateIdea: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await updateProposal(input.id, ctx.user.id, {
          currentStage: "valuation",
        });
        return { success: true, nextStage: "valuation" };
      }),

    validateValuation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await updateProposal(input.id, ctx.user.id, {
          currentStage: "proposal_final",
        });
        return { success: true, nextStage: "proposal_final" };
      }),

    approveFinal: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await updateProposal(input.id, ctx.user.id, {
          status: "accepted",
          currentStage: "delivery",
        });
        return { success: true, nextStage: "delivery" };
      }),

    deliver: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) throw new Error("Proposal not found");
        
        const deliveredContent = `${proposal.proposalContent}\n\n---\n\n## status: Proposta Concluída e Baixada ✅`;
        await updateProposal(input.id, ctx.user.id, {
          proposalContent: deliveredContent,
          status: "sent",
        });
        return { success: true };
      }),
      
    advanceFromUploads: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await updateProposal(input.id, ctx.user.id, {
          currentStage: "idea_central",
        });
        return { success: true, nextStage: "idea_central" };
      }),

    /**
     * STRATEGY_WORKSHOP — Agente Estrategista Sênior OOH
     *
     * Chame APÓS o estágio de upload de recursos (inventory / pricing).
     * Transição de estágio: inventory → strategy_workshop (persiste como "validation")
     *
     * Fluxo:
     *   1. Busca proposta e briefing no banco
     *   2. Carrega recursos do usuário (inventário + preços)
     *   3. Chama strategyWorkshop() → LLM ou fallback heurístico
     *   4. Formata o output como Markdown e persiste em proposalContent
     *   5. Avança currentStage para "idea_central" (pronto para o próximo agente)
     *   6. Retorna o StrategyOutput estruturado + o markdown gerado
     */
    generateStrategyWorkshop: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // ── 1. Buscar proposta ────────────────────────────────────
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }

        // ── 2. Buscar briefing vinculado ──────────────────────────
        const db = await getDb();
        let briefingRow: any = null;
        if (db) {
          const briefingResult = await db
            .select()
            .from(briefings)
            .where(eq(briefings.proposalId, proposal.id))
            .limit(1);
          if (briefingResult.length > 0) {
            briefingRow = briefingResult[0];
          }
        }

        // ── 3. Carregar recursos do usuário (inventário + preços) ─
        let resourcesList: Array<{ type: string; content: string }> = [];
        if (db) {
          try {
            const userResources = await db
              .select()
              .from(resources)
              .where(eq(resources.userId, ctx.user.id));

            // Carregar conteúdo textual de cada recurso via getParsedResourcesContext
            const inventoryText = await getParsedResourcesContext(ctx.user.id, ["inventory"]);
            const pricingText = await getParsedResourcesContext(ctx.user.id, ["pricing"]);
            const productText = await getParsedResourcesContext(ctx.user.id, ["product_content"]);

            if (inventoryText) resourcesList.push({ type: "inventory", content: inventoryText });
            if (pricingText) resourcesList.push({ type: "pricing", content: pricingText });
            if (productText) resourcesList.push({ type: "product_content", content: productText });
          } catch (err) {
            console.error("[generateStrategyWorkshop] Falha ao carregar recursos:", err);
          }
        }

        // ── 4. Montar parâmetros do agente ────────────────────────
        const citiesArray = briefingRow?.cities
          ? briefingRow.cities.split(/[,;|\n]+/).map((c: string) => c.trim()).filter(Boolean)
          : [proposal.clientCompany || "São Paulo"];

        const budgetRaw = briefingRow?.budget || proposal.values || "500000";
        const budgetNum = parseInt(budgetRaw.replace(/[^\d]/g, ""), 10) || 500000;

        const strategyParams = {
          briefing: {
            clientName: briefingRow?.clientName || proposal.clientName,
            segment: briefingRow?.segment || "retail",
            cities: citiesArray,
            budget: budgetNum,
            period: briefingRow?.campaignPeriod || proposal.deadline || "A definir",
            targetAudience: briefingRow?.targetAudience || "Público geral",
            objective: briefingRow?.objective || proposal.projectScope,
            campaignName: briefingRow?.campaignName || undefined,
            creativityLevel: (briefingRow?.creativityLevel as "baixo" | "medio" | "alto") || "medio",
          },
          resources: resourcesList.length > 0 ? resourcesList : undefined,
        };

        // ── 5. Executar o agente (LLM — sem fallback automático) ──
        console.log(`[generateStrategyWorkshop] Iniciando para proposta #${input.id}`);
        let strategyOutput;
        try {
          strategyOutput = await strategyWorkshop(strategyParams);
        } catch (err) {
          throwLLMTRPCError(err);
        }

        // ── 6. Formatar e persistir resultado ─────────────────────
        const strategyMarkdown = formatStrategyOutputAsMarkdown(strategyOutput!);
        const newContent = `${proposal.proposalContent}\n\n---\n\n${strategyMarkdown}`;

        await updateProposal(proposal.id, ctx.user.id, {
          proposalContent: newContent,
          currentStage: "idea_central",
        });

        console.log(`[generateStrategyWorkshop] ✅ Concluído. Proposta #${input.id} avançada para idea_central.`);

        return {
          success: true,
          nextStage: "idea_central",
          strategyOutput: strategyOutput!,
          strategyMarkdown,
        };
      }),

    /**
     * generateOffline — Geração explícita via template local (fallback)
     *
     * Só é chamado quando o usuário clicar em "Gerar versão offline (template básico)".
     * Conteúdo é marcado com banner de aviso para diferenciar de conteúdo gerado por IA.
     */
    generateOffline: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          stageToGenerate: z.enum(["idea_central", "valuation", "proposal_final"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) throw new Error("Proposal not found");

        const db = await getDb();
        let briefing: any = null;
        if (db) {
          const br = await db.select().from(briefings).where(eq(briefings.proposalId, proposal.id)).limit(1);
          if (br.length > 0) briefing = br[0];
        }

        const citiesStr = briefing?.cities || proposal.projectScope || "São Paulo";
        const budgetStr = briefing?.budget || proposal.values || "500000";
        const creativityLevel = briefing?.creativityLevel || "medio";
        const rawInventoryText = await getParsedResourcesContext(ctx.user.id, ["inventory"]);

        const OFFLINE_BANNER = `\n> ⚠️ **CONTEÚDO GERADO OFFLINE — TEMPLATE BÁSICO (não é IA)**\n> Este conteúdo foi gerado por um template local enquanto a IA estava indisponível.\n> Revise e personalize antes de enviar ao cliente.\n\n`;

        let generatedText = OFFLINE_BANNER;
        let nextStage: string = "briefing";

        if (input.stageToGenerate === "idea_central") {
          generatedText += generateIdeaCentralFallback(proposal.clientName, citiesStr, rawInventoryText, creativityLevel);
          nextStage = "idea_validation";
        } else if (input.stageToGenerate === "valuation") {
          generatedText += generateValuationFallback(proposal.clientName, budgetStr, citiesStr, rawInventoryText);
          nextStage = "valuation_validation";
        } else {
          generatedText += generateProposalFinalFallback(proposal.clientName, proposal.projectScope, budgetStr, citiesStr, rawInventoryText);
          nextStage = "customization";
        }

        const newContent = `${proposal.proposalContent}\n\n---\n\n${generatedText}`;
        await updateProposal(proposal.id, ctx.user.id, {
          proposalContent: newContent,
          currentStage: nextStage as any,
          generatedBy: "fallback",
        });

        return { success: true, nextStage, generatedBy: "fallback" };
      }),

    refineContent: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          stage: z.enum(["idea_central", "valuation", "proposal_final"]),
          instruction: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }

        const systemPrompt = `Você é um consultor especialista em planejamento comercial e mídia OOH. Sua tarefa é revisar a proposta comercial de OOH a seguir, aplicando as alterações solicitadas pelo usuário.
        
IMPORTANTE: Altere APENAS a seção correspondente à etapa "${input.stage}" (ex: se for 'idea_central', altere a Ideia Central/Conceito; se for 'valuation', altere a tabela de custos/valoração; se for 'proposal_final', faça a alteração solicitada de forma integrada). Mantenha as outras seções da proposta e sua estrutura de Markdown intactas. Retorne a proposta inteira, atualizada.`;

        const userPrompt = `Instrução de ajuste do usuário: "${input.instruction}"

Conteúdo atual da proposta comercial em Markdown:
${proposal.proposalContent}`;

        let refinedText = proposal.proposalContent;
        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            maxTokens: 8000,
          });
          const content = response?.choices?.[0]?.message?.content;
          if (typeof content === "string" && content.trim().length > 0) {
            refinedText = content;
          }
        } catch (err) {
          throwLLMTRPCError(err);
        }

        await updateProposal(proposal.id, ctx.user.id, {
          proposalContent: refinedText,
        });

        return { success: true, proposalContent: refinedText };
      }),

    exportExcel: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }

        const { url, key } = await exportProposalToExcel(proposal);
        return {
          success: true,
          url,
          key,
          filename: `valoracao_${proposal.clientName.replace(/\s+/g, "_")}.xlsx`,
        };
      }),

    // ── ETAPA 2: campo de cota — lista opções REAIS do catálogo p/ o planner ──
    // Read-only. Sem cidade → usa as praças do briefing. Cada opção é um irmão
    // distinto da fonte (local/cota/veiculação), p/ desfazer a ambiguidade.
    listMediaOptions: protectedProcedure
      .input(z.object({ id: z.number(), cidade: z.string().optional(), termo: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) throw new Error("Proposal not found");

        const catalog = await loadFullCatalog(ctx.user.id);
        if (catalog.length === 0) return { pracas: [], options: [], semCatalogo: true };

        // Praças SEMPRE vêm do briefing (lista completa p/ os chips), independente
        // da praça selecionada. input.cidade só escolhe QUAL praça listar as opções.
        let pracas: string[] = [];
        const db = await getDb();
        if (db) {
          const br = await db.select().from(briefings).where(eq(briefings.proposalId, proposal.id)).limit(1);
          if (br.length > 0 && br[0].cities) {
            pracas = br[0].cities.split(/[,;\/\n]+/).map((c) => c.trim()).filter(Boolean);
          }
        }

        const cidadeAlvo = input.cidade || pracas[0] || "";
        const options = cidadeAlvo ? listCotaOptions(catalog, cidadeAlvo, input.termo) : [];
        return { pracas, cidadeAlvo, options, semCatalogo: false };
      }),

    // Recomendação ESTRATÉGICA da IA p/ o seletor de cotas: dado o briefing + as opções REAIS
    // da praça, devolve quais chaves formam o melhor mix. A IA só escolhe ENTRE as opções
    // listadas (chaves validadas) — nunca inventa. Só destaca; o planner é quem adiciona.
    recommendCotas: protectedProcedure
      .input(z.object({ id: z.number(), cidade: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id) as any;
        if (!proposal) throw new Error("Proposal not found");
        const catalog = await loadFullCatalog(ctx.user.id);
        if (catalog.length === 0) return { recomendadas: [] as Array<{ chave: string; motivo: string }> };
        const options = listCotaOptions(catalog, input.cidade);
        if (options.length === 0) return { recomendadas: [] as Array<{ chave: string; motivo: string }> };

        let brief = "";
        const db = await getDb();
        if (db) {
          const br = await db.select().from(briefings).where(eq(briefings.proposalId, input.id)).limit(1);
          if (br.length > 0) {
            const b = br[0];
            brief = [
              `Segmento: ${b.segment}`,
              `Objetivo: ${b.objective}`,
              `Público-alvo: ${b.targetAudience}`,
              `Formatos citados no briefing: ${b.mediaSpecs || "(não especificado)"}`,
              `Budget total da campanha: ${proposal.values || b.budget}`,
              `Período: ${b.campaignPeriod}`,
            ].join("\n");
          }
        }

        // Pesquisa (de mercado) e Ideia criativa: extraídas do texto da proposta (geradas nas
        // etapas anteriores à valoração). Alimentam as prioridades 2 e 3 da recomendação.
        const conteudo = proposal.proposalContent || "";
        const pesquisa = findBestSection(conteudo, [/insight/i, /pesquisa/i, /comportamento/i, /mercado/i, /tend[êe]ncia/i]).slice(0, 1200);
        const ideia = findBestSection(conteudo, [/ideia central/i, /conceito criativ/i, /conceito/i, /criativ/i]).slice(0, 1200);

        const opts = options.slice(0, 80); // limita o prompt
        // Numerado: a IA devolve NÚMEROS (robusto), e o código mapeia número -> chave real.
        const lista = opts.map((o: any, i: number) => `${i + 1}. ${o.nome} — ${o.local} — ${o.veiculacao} — R$ ${o.custoUnitario}${o.ehCircuito ? " (circuito)" : ""}`).join("\n");
        const sys = `Você é um planejador de mídia OOH sênior da Kallas. Dada a estratégia e a LISTA NUMERADA de opções desta praça, recomende quais opções formam o melhor mix.

PRIORIZE NESTA ORDEM (a 1ª manda mais que a 2ª, e assim por diante):
1º BRIEFING: formatos que o cliente pediu (formatos citados) e aderência a objetivo/público/budget do briefing.
2º PESQUISA: o que a pesquisa de mercado aponta como mais eficaz para esse público/contexto.
3º IDEIA CRIATIVA: o que melhor serve ao conceito/ideia criativa da campanha.
4º DIVERSIDADE: entre opções IGUALMENTE aderentes às 3 diretrizes acima, prefira VARIAR os tipos de formato — não concentre tudo num único tipo.

REGRAS:
- Escolha SOMENTE entre os NÚMEROS da lista. NUNCA invente opção.
- TAMANHOS: se o MESMO formato aparece em tamanhos diferentes (ex.: "… - M" e "… - G"), recomende APENAS UM tamanho por praça — nunca os dois.
- Conjunto ENXUTO e coerente (em geral 3 a 8 opções).
- Motivo curto (1 linha), específico — diga qual diretriz pesou (ex.: "briefing pediu", "pesquisa indica", "serve à ideia").
- Responda APENAS com JSON, sem cercas de código: {"recomendadas":[{"n":<número da opção>,"motivo":"..."}]}`;
        const userMsg = `BRIEFING:\n${brief}\n\nPESQUISA DE MERCADO:\n${pesquisa || "(sem pesquisa registrada)"}\n\nIDEIA CRIATIVA:\n${ideia || "(sem ideia registrada)"}\n\nPRAÇA: ${input.cidade}\n\nOPÇÕES DISPONÍVEIS (escolha pelos números):\n${lista}`;

        let recomendadas: Array<{ chave: string; motivo: string }> = [];
        try {
          const resp = await invokeLLM({ messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }], maxTokens: 1500, temperature: 0.4 });
          const raw = resp?.choices?.[0]?.message?.content;
          if (typeof raw === "string") {
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) {
              const parsed = JSON.parse(m[0]);
              if (Array.isArray(parsed?.recomendadas)) {
                const vistos = new Set<string>();
                // Dedup por FORMATO-BASE+local: mesmo formato em tamanhos (M/G/P) diferentes
                // na mesma praça → só UM (Vivi: "precisa ser um ou outro"). Mantém o 1º que a IA escolheu.
                const sizeRe = /\s*[-–]\s*(PP|GG|XG|P|M|G)\s*$/i;
                const formatosBase = new Set<string>();
                for (const r of parsed.recomendadas) {
                  const n = Number(r?.n);
                  if (!Number.isInteger(n) || n < 1 || n > opts.length) continue;
                  const o = opts[n - 1] as any;
                  const chave = o.chave;
                  if (vistos.has(chave)) continue;
                  const baseFmt = String(o.nome || "").replace(sizeRe, "").trim().toLowerCase()
                    + "|" + String(o.local || "").trim().toLowerCase();
                  if (formatosBase.has(baseFmt)) continue; // já recomendou outro tamanho desse formato
                  vistos.add(chave);
                  formatosBase.add(baseFmt);
                  recomendadas.push({ chave, motivo: String(r?.motivo || "").slice(0, 160) });
                  if (recomendadas.length >= 12) break;
                }
              }
            }
          }
          if (recomendadas.length === 0) console.warn("[recommendCotas] IA não retornou recomendações úteis. Bruto:", String(raw).slice(0, 300));
        } catch (e) {
          console.error("[recommendCotas] falhou:", e);
        }
        return { recomendadas };
      }),

    // Salva o plano de mídia escolhido pelo planner (linhas exatas do catálogo).
    saveMediaPlan: protectedProcedure
      .input(z.object({
        id: z.number(),
        linhas: z.array(z.object({ chave: z.string(), campanhaSemanas: z.number().default(1), qtd: z.number().default(1) })),
      }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) throw new Error("Proposal not found");
        await updateProposal(input.id, ctx.user.id, { mediaPlan: JSON.stringify(input.linhas) } as any);
        return { success: true, total: input.linhas.length };
      }),

    // Lê o plano salvo e RESOLVE cada linha no catálogo (preço, subtotal, alerta).
    // Linhas que não casam mais viram "sem_lastro" (catálogo mudou) — nunca inventa.
    getMediaPlan: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id) as any;
        if (!proposal) throw new Error("Proposal not found");
        let linhas: Array<{ chave: string; campanhaSemanas: number; qtd: number }> = [];
        try { linhas = proposal.mediaPlan ? JSON.parse(proposal.mediaPlan) : []; } catch { linhas = []; }
        if (linhas.length === 0) return { itens: [], total: 0 };

        const catalog = await loadFullCatalog(ctx.user.id);
        let total = 0;
        const itens = linhas.map((l) => {
          const res = resolveFromOption(catalog, l.chave, l.campanhaSemanas || 1);
          if (res.status === "ok") {
            const qtd = l.qtd || 1;
            const subtotal = Math.round(res.subtotal * qtd * 100) / 100;
            total += subtotal;
            return { status: "ok" as const, chave: l.chave, qtd, campanhaSemanas: l.campanhaSemanas, row: res.row, periodos: res.periodos, subtotal, ufAlerta: res.ufAlerta };
          }
          return { status: "sem_lastro" as const, chave: l.chave, motivo: (res as any).motivo || "linha não encontrada no catálogo" };
        });

        // Reverificação de completude (Erro 7): verticais da fonte ausentes do plano, por praça do briefing
        let completude: Array<{ praca: string; verticaisFaltando: string[]; verticaisNoPlano: string[] }> = [];
        try {
          const db = await getDb();
          let pracas: string[] = [];
          if (db) {
            const br = await db.select().from(briefings).where(eq(briefings.proposalId, input.id)).limit(1);
            if (br.length > 0 && br[0].cities) pracas = br[0].cities.split(/[,;\/\n]+/).map((c) => c.trim()).filter(Boolean);
          }
          if (pracas.length > 0) completude = planCompleteness(catalog, pracas, linhas.map((l) => l.chave));
        } catch { /* completude é informativa */ }

        return { itens, total: Math.round(total * 100) / 100, completude };
      }),

    // PASSO 3: verificador determinístico da narrativa vs plano (marca p/ humano, não conserta)
    verifyNarrative: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id) as any;
        if (!proposal) throw new Error("Proposal not found");
        const plano = await resolvePlanForPresentation(ctx.user.id, proposal.mediaPlan);
        if (plano.vazio) {
          return { ok: true, flags: [], resumo: { modelo_valoracao: 0, preco_na_prosa: 0, praca_fora_plano: 0, formato_fora_plano: 0, linguagem_exclusao: 0, estatistica_sem_fonte: 0, ambiente_fora_plano: 0, calculo_rascunhado: 0 }, semPlano: true };
        }
        return { ...verifyNarrativeAgainstPlan(proposal.proposalContent || "", plano), semPlano: false };
      }),

    exportPPTX: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          selections: z.object({
            capa: z.boolean().optional(),
            defesa: z.boolean().optional(),
            conceito: z.boolean().optional(),
            detalhes: z.boolean().optional(),
            valoracao: z.boolean().optional(),
            cronograma: z.boolean().optional(),
            formatos: z.boolean().optional(),
          }),
          paletteId: z.string().optional(),
          force: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }
        await gateNarrativeExport(ctx.user.id, input.id, input.force);

        // Preferências de slide geridas pelo CHAT (gravadas na proposta) têm precedência
        // sobre os checkboxes da UI — é o que faz "pedir no chat e funcionar" valer no export.
        let persistedSel: Record<string, boolean> = {};
        try { persistedSel = proposal.slideSelections ? JSON.parse(proposal.slideSelections) : {}; } catch { /* ignora JSON inválido */ }
        const effSelections = { ...input.selections, ...persistedSel };

        const { url, key } = await exportProposalToPPTX(proposal, effSelections, input.paletteId);
        return {
          success: true,
          url,
          key,
          filename: `apresentacao_${proposal.clientName.replace(/\s+/g, "_")}.pptx`,
        };
      }),

    // DECK PREMIUM (IA): Opus escreve o CONTEÚDO estruturado; render determinístico monta
    // o design (qualidade Claude Design). Dinheiro vem do motor (números exatos).
    exportPremiumDeck: protectedProcedure
      .input(z.object({ id: z.number(), force: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) throw new Error("Proposal not found");
        await gateNarrativeExport(ctx.user.id, input.id, input.force);

        const { generateDeckViaClaude } = await import("./claude-deck");
        const { storagePut } = await import("./storage");
        const buf = await generateDeckViaClaude({
          id: proposal.id,
          userId: ctx.user.id,
          clientName: proposal.clientName,
          values: proposal.values,
          proposalContent: proposal.proposalContent,
          mediaPlan: proposal.mediaPlan,
          createdAt: proposal.createdAt,
        });
        const safe = proposal.clientName
          .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "")
          .replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "");
        const key = `proposals/${proposal.id}/deck_premium_${safe}_${proposal.id}.pptx`;
        const { url } = await storagePut(
          key, buf as Buffer,
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );
        return { success: true, url, key, filename: `deck_premium_${safe}.pptx` };
      }),

    refineWithNewBriefing: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          briefingText: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }

        const systemPrompt = `Você é um consultor especialista em planejamento comercial e mídia OOH.
Sua tarefa é ler um briefing de campanha atualizado (com novos ajustes, como mudança de orçamento, troca de praça, alteração de público-alvo ou cronograma) e atualizar a proposta comercial existente refletindo APENAS esses ajustes afetados.
Preserve todo o restante da proposta original (como estilo de texto, conceito criativo não afetado, formatação geral em Markdown, etc.). Não reescreva partes que não foram alteradas.
Retorne o texto completo da proposta atualizada em Markdown.`;

        const userPrompt = `Briefing Atualizado/Novos Ajustes:
"""
${input.briefingText}
"""

Proposta Comercial Atual:
"""
${proposal.proposalContent}
"""`;

        let refinedText = proposal.proposalContent;
        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            maxTokens: 8000,
          });

          const content = response?.choices?.[0]?.message?.content;
          if (typeof content === "string" && content.trim().length > 0) {
            refinedText = content;
          } else if (Array.isArray(content)) {
            refinedText = content.map(c => c.type === "text" ? (c as any).text : "").join("\n");
          }
        } catch (err) {
          throwLLMTRPCError(err);
        }

        await updateProposal(proposal.id, ctx.user.id, {
          proposalContent: refinedText,
        });

        return { success: true, proposalContent: refinedText };
      }),

    chatRefine: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          message: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }

        let history: Array<{ role: "user" | "assistant"; content: string }> = [];
        if (proposal.chatHistory) {
          try {
            history = JSON.parse(proposal.chatHistory);
          } catch (e) {
            console.error("Failed to parse chat history:", e);
          }
        }

        history.push({ role: "user", content: input.message });

        let resourcesContext = "";
        try {
          resourcesContext = await getParsedResourcesContext(ctx.user.id, ["market_data", "inventory", "pricing"]);
        } catch (err) {
          console.error("Failed to load user resources for chat refine:", err);
        }

        const systemPrompt = `Você é um consultor especialista em planejamento comercial e mídia OOH da Kallas.
O usuário quer conversar com você ou refinar a proposta comercial atual através do chat.

CAPACIDADES DA PLATAFORMA (use para responder com precisão o que é possível):
- Este chat faz DUAS coisas: (a) altera o TEXTO da proposta (valores, praças, termos, redação, inclusão/exclusão de itens do plano); (b) LIGA/DESLIGA slides prontos do PPT.
- O PPT tem um conjunto FIXO de slides prontos: Capa · Por Que Agora · Insight · Conceito · Jornada · Por Que a Kallas · O Plano · Investimento · Formatos por Cidade · Próximos Passos. Você NÃO cria slides novos de conteúdo livre nem reordena slides.
- VOCÊ PODE LIGAR/DESLIGAR pelo chat o slide "Formatos por Cidade" (chave "formatos"; ligado por padrão) — é a tabela de formato/parceiro/veiculação por praça. Quando o usuário pedir p/ incluir ou remover ESSE slide, use a diretiva de toggle (abaixo) e confirme com honestidade.
- Os DEMAIS slides (Conceito, Por Que a Kallas, O Plano/Investimento etc.) são ligados/desligados pelos CHECKBOXES da janela de exportação, NÃO pelo chat. Se o usuário quiser incluir/remover esses, oriente a marcar/desmarcar na hora de exportar — não use a diretiva pra eles e não diga que você os ligou/desligou.
- Formatos por Cidade JÁ é um slide do PPT e também aparece no Exportar HTML com as FOTOS reais dos formatos. Fotos só saem no HTML — nunca finja inserir imagens no texto.
- Excel de valoração: gerado pelo botão de exportação, lendo as tabelas do plano de mídia da proposta + tabela de preços real dos recursos.

PARA LIGAR/DESLIGAR UM SLIDE: ao final da resposta, inclua a diretiva (true = liga, false = desliga; pode combinar chaves):
<<<SLIDE_TOGGLE>>>{"formatos": false}<<<END_TOGGLE>>>
Só emita a diretiva quando o usuário REALMENTE pedir para incluir/remover um slide. Ao fazê-lo, confirme com honestidade o que foi ligado/desligado e que passa a valer na próxima exportação do PPT.

⛔ HONESTIDADE (regra de ouro): nunca diga que "criou um slide novo" de conteúdo livre — isso não existe. Se o pedido for um slide FORA da lista acima (conteúdo totalmente novo), diga a verdade: dá pra ligar/desligar os slides prontos da lista, ajustar o TEXTO, ou usar o Exportar HTML (que tem as fotos) — um slide inteiramente novo não é possível hoje. Só descreva como "feito" aquilo que você de fato alterou (texto editado, ou slide ligado/desligado via diretiva). É sempre melhor dizer "isso não dá hoje" do que fingir que fez.

Sua tarefa:
1. Analisar a mensagem do usuário e o histórico de conversa.
2. SEMPRE escreva primeiro uma resposta rica e consultiva no bloco <<<ASSISTANT_RESPONSE>>>.
3. Se o usuário pediu para LIGAR/DESLIGAR um slide pronto: emita a diretiva <<<SLIDE_TOGGLE>>>{...}<<<END_TOGGLE>>> (e normalmente use <<<SEM_ALTERACOES>>> no lugar da proposta, pois ligar/desligar slide NÃO muda o texto).
4. Se o usuário solicitou alteração NO TEXTO da proposta: aplique e retorne a proposta inteira atualizada no bloco <<<UPDATED_PROPOSAL_CONTENT>>>, terminando com o marcador <<<END_OF_PROPOSAL>>>.
5. Se NÃO houver alteração de texto (pergunta, conversa, ou apenas toggle de slide): retorne o marcador <<<SEM_ALTERACOES>>> no lugar do bloco de proposta. NÃO reescreva a proposta nesse caso.

FORMATO EXATO DA RESPOSTA (sem JSON solto, sem cercas de código):

<<<ASSISTANT_RESPONSE>>>
[sua resposta detalhada ao usuário]

<<<UPDATED_PROPOSAL_CONTENT>>>
[proposta inteira atualizada em Markdown — SOMENTE se houve alteração de texto]
<<<END_OF_PROPOSAL>>>

ou, se nada mudou no texto (incl. quando foi só ligar/desligar slide):

<<<ASSISTANT_RESPONSE>>>
[sua resposta]

<<<SEM_ALTERACOES>>>
[se houve toggle: <<<SLIDE_TOGGLE>>>{"formatos": true}<<<END_TOGGLE>>>]`;

        const userPrompt = `Histórico do Chat:
${history.map(h => `${h.role === 'user' ? 'Usuário' : 'IA'}: ${h.content}`).join("\n")}

${resourcesContext ? `Fontes de Dados do Usuário (Briefing, Planilhas de Preços, Inventários de Mídia OOH Kallas etc.):\n"""\n${resourcesContext}\n"""\n` : ""}

Proposta Comercial Atual:
"""
${proposal.proposalContent}
"""

Instrução do usuário: "${input.message}"`;

        let updatedContent = proposal.proposalContent;
        let assistantMsg = "Peço desculpas, mas o serviço de inteligência artificial está temporariamente indisponível no momento. Não consegui realizar as alterações na proposta comercial.";
        let slideToggle: Record<string, boolean> | null = null; // liga/desliga slides prontos pedido no chat

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            // Margem para devolver a proposta inteira + resposta sem truncar
            maxTokens: 16000,
            temperature: 0.7,
          });

          const rawContent = response?.choices?.[0]?.message?.content;
          if (typeof rawContent !== "string") {
            throw new Error("Failed to get response from LLM or response is not a string");
          }

          let parsed: any = null;
          const cleaned = rawContent.trim();

          // 0. Diretiva de LIGA/DESLIGA de slides prontos (independe da alteração de texto).
          //    Só chaves conhecidas e booleanas entram — protege contra "slide inventado".
          // Só "formatos" é controlável pelo chat (é o único slide pronto SEM checkbox na UI;
          // os demais têm checkbox na exportação, então deixá-los só pra lá evita conflito).
          const SLIDES_TOGGLAVEIS = ["formatos"];
          const mToggle = cleaned.match(/<<<SLIDE_TOGGLE>>>([\s\S]*?)<<<END_TOGGLE>>>/);
          if (mToggle) {
            try {
              const obj = JSON.parse(mToggle[1].trim());
              const limpo: Record<string, boolean> = {};
              for (const k of Object.keys(obj)) {
                if (SLIDES_TOGGLAVEIS.includes(k) && typeof obj[k] === "boolean") limpo[k] = obj[k];
              }
              if (Object.keys(limpo).length > 0) slideToggle = limpo;
            } catch (e) {
              console.warn("[chatRefine] SLIDE_TOGGLE com JSON inválido — ignorado.");
            }
          }

          // 1. Protocolo novo: resposta PRIMEIRO, proposta depois (com marcador de fim).
          //    A proposta só é aceita se vier COMPLETA (<<<END_OF_PROPOSAL>>> presente) —
          //    isso impede que uma resposta truncada pelo limite de tokens sobrescreva
          //    a proposta original com uma versão cortada.
          if (cleaned.includes("<<<ASSISTANT_RESPONSE>>>")) {
            const afterResp = cleaned.split("<<<ASSISTANT_RESPONSE>>>")[1] ?? "";
            let responsePart = afterResp;
            let contentPart = "";

            if (afterResp.includes("<<<UPDATED_PROPOSAL_CONTENT>>>")) {
              const [resp, rest] = afterResp.split("<<<UPDATED_PROPOSAL_CONTENT>>>");
              responsePart = resp.trim();
              if (rest.includes("<<<END_OF_PROPOSAL>>>")) {
                contentPart = rest.split("<<<END_OF_PROPOSAL>>>")[0].trim();
              } else {
                // Proposta veio cortada (estourou o limite de saída) — NÃO salvar
                console.warn("[chatRefine] Proposta truncada na resposta da IA — mantendo a versão original.");
                responsePart = responsePart.trim() +
                  "\n\n⚠️ Observação: a alteração gerada veio incompleta (limite de tamanho) e NÃO foi aplicada para proteger a proposta. Tente pedir a alteração em partes menores.";
              }
            } else if (afterResp.includes("<<<SEM_ALTERACOES>>>")) {
              responsePart = afterResp.split("<<<SEM_ALTERACOES>>>")[0].trim();
            }

            // Sanidade: proposta nova não pode encolher drasticamente (sinal de corte/erro)
            if (contentPart && contentPart.length < proposal.proposalContent.length * 0.4 && proposal.proposalContent.length > 2000) {
              console.warn(`[chatRefine] Proposta retornada suspeita (${contentPart.length} vs ${proposal.proposalContent.length} chars) — mantendo original.`);
              responsePart = (responsePart || "").trim() +
                "\n\n⚠️ Observação: a versão alterada veio muito menor que a original e NÃO foi aplicada por segurança.";
              contentPart = "";
            }

            parsed = {
              updatedProposalContent: contentPart || proposal.proposalContent,
              assistantResponse: responsePart?.trim() || "Pronto! Me diga se quer ajustar mais alguma coisa.",
            };
          }
          // 1b. Compatibilidade com o formato antigo (proposta antes da resposta)
          else if (cleaned.includes("<<<UPDATED_PROPOSAL_CONTENT>>>")) {
            const contentPart = cleaned.replace("<<<UPDATED_PROPOSAL_CONTENT>>>", "").split("<<<END_OF_PROPOSAL>>>")[0].trim();
            const ok = contentPart.length >= proposal.proposalContent.length * 0.4;
            parsed = {
              updatedProposalContent: ok ? contentPart : proposal.proposalContent,
              assistantResponse: ok ? "Ajustes aplicados na proposta." : "A alteração veio incompleta e não foi aplicada por segurança. Tente pedir em partes menores.",
            };
          }

          // 2. Fallback to standard JSON parsing if tags are missing or failed
          if (!parsed) {
            try {
              parsed = JSON.parse(cleaned);
            } catch (_) {
              const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
              if (fence) {
                try {
                  parsed = JSON.parse(fence[1].trim());
                } catch (_) {}
              }
              if (!parsed) {
                const start = cleaned.indexOf("{");
                const end = cleaned.lastIndexOf("}");
                if (start !== -1 && end !== -1 && end > start) {
                  const candidate = cleaned.slice(start, end + 1);
                  try {
                    parsed = JSON.parse(candidate);
                  } catch (_) {}
                }
              }
              if (!parsed) {
                const extractStringField = (jsonStr: string, fieldName: string): string => {
                  const idx = jsonStr.indexOf(`"${fieldName}"`);
                  if (idx === -1) return "";
                  const colonIdx = jsonStr.indexOf(":", idx);
                  if (colonIdx === -1) return "";
                  const startQuote = jsonStr.indexOf('"', colonIdx);
                  if (startQuote === -1) return "";
                  let val = "";
                  let i = startQuote + 1;
                  let escaped = false;
                  while (i < jsonStr.length) {
                    const char = jsonStr[i];
                    if (escaped) {
                      if (char === '"') val += '"';
                      else if (char === '\\') val += '\\';
                      else if (char === 'n') val += '\n';
                      else if (char === 't') val += '\t';
                      else val += '\\' + char;
                      escaped = false;
                      i++;
                    } else if (char === '\\') {
                      escaped = true;
                      i++;
                    } else if (char === '"') {
                      break;
                    } else {
                      val += char;
                      i++;
                    }
                  }
                  return val;
                };
                const updatedProposalContent = extractStringField(cleaned, "updatedProposalContent");
                const assistantResponse = extractStringField(cleaned, "assistantResponse");
                if (updatedProposalContent || assistantResponse) {
                  parsed = { updatedProposalContent, assistantResponse };
                }
              }
            }
          }

          if (!parsed || !parsed.updatedProposalContent) {
            console.error("[chatRefine] Raw content from LLM was:", rawContent);
            throw new Error("Não foi possível processar a resposta da IA. A resposta da IA não continha a proposta atualizada no formato esperado.");
          }

          updatedContent = parsed.updatedProposalContent;
          // tira a diretiva de toggle da mensagem visível ao usuário (é controle, não texto)
          assistantMsg = (parsed.assistantResponse || "Ajustes aplicados com sucesso.")
            .replace(/<<<SLIDE_TOGGLE>>>[\s\S]*?<<<END_TOGGLE>>>/g, "").trim() || "Pronto!";
        } catch (err) {
          throwLLMTRPCError(err);
        }

        history.push({ role: "assistant", content: assistantMsg });

        // Liga/desliga de slides prontos: funde com o que já estava salvo e grava na proposta.
        // No export, essa preferência tem precedência sobre os checkboxes da UI.
        let novoSlideSel: string | undefined;
        if (slideToggle) {
          let cur: Record<string, boolean> = {};
          try { cur = proposal.slideSelections ? JSON.parse(proposal.slideSelections) : {}; } catch { /* ignora JSON inválido */ }
          novoSlideSel = JSON.stringify({ ...cur, ...slideToggle });
        }

        await updateProposal(proposal.id, ctx.user.id, {
          proposalContent: updatedContent,
          chatHistory: JSON.stringify(history),
          ...(novoSlideSel !== undefined ? { slideSelections: novoSlideSel } : {}),
        });

        return {
          success: true,
          proposalContent: updatedContent,
          assistantResponse: assistantMsg,
          chatHistory: history,
        };
      }),
  }),

  resources: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getResourcesByUserId } = await import("./db");
      return getResourcesByUserId(ctx.user.id);
    }),

    upload: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          type: z.enum(["inventory", "pricing", "product_content", "market_data"]),
          description: z.string().optional(),
          fileUrl: z.string().min(1),
          fileKey: z.string().min(1),
          mimeType: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createResource } = await import("./db");
        return createResource({
          userId: ctx.user.id,
          ...input,
        });
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { deleteResource } = await import("./db");
        return deleteResource(input.id);
      }),

    deleteResource: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { deleteResource } = await import("./db");
        return deleteResource(input.id);
      }),
  }),

  briefings: router({
    create: protectedProcedure
      .input(
        z.object({
          clientName: z.string().min(1),
          segment: z.string().min(1),
          cities: z.string().min(1),
          campaignPeriod: z.string().min(1),
          budget: z.string().min(1),
          objective: z.string().min(1),
          targetAudience: z.string().min(1),
          contactName: z.string().min(1),
          contactEmail: z.string().email(),
          campaignName: z.string().optional().nullable(),
          mediaSpecs: z.string().optional().nullable(),
          locationSpecs: z.string().optional().nullable(),
          commercialTerms: z.string().optional().nullable(),
          moreDetails: z.string().optional().nullable(),
          creativityLevel: z.enum(["baixo", "medio", "alto"]).optional().default("medio"),
          generatedBy: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createBriefing, createProposal, updateProposal } = await import("./db");
        const { validateBriefing, collectMarketResearch } = await import("./proposals-workflow");

        // 1. Create a proposal associated with the user
        const initialContent = `# Proposta Comercial - ${input.clientName}\n\n## Status do Processo\n- Briefing cadastrado com sucesso.`;
        const proposal = await createProposal({
          userId: ctx.user.id,
          clientName: input.clientName,
          clientCompany: input.segment.charAt(0).toUpperCase() + input.segment.slice(1),
          projectScope: input.objective,
          values: input.budget,
          proposalContent: initialContent,
          currentStage: "briefing",
          generatedBy: input.generatedBy || "ai",
        });

        if (!proposal) {
          throw new Error("Failed to create proposal");
        }

        // 2. Create the briefing and link to proposal
        const cleanedCities = cleanCitiesString(input.cities);
        const { generatedBy, ...briefingData } = input;
        const briefing = await createBriefing({
          userId: ctx.user.id,
          proposalId: proposal.id,
          ...briefingData,
          cities: cleanedCities,
          generatedBy: generatedBy || "ai",
        });

        // 3. Automated Validation Stage
        const validationResult = validateBriefing(input);
        if (!validationResult.success) {
          const errorContent = `# Proposta Comercial - ${input.clientName}\n\n## Falha na Validação do Briefing ❌\n\nOcorreram os seguintes erros na validação do briefing:\n${validationResult.errors.map(e => `- ${e}`).join("\n")}\n\nPor favor, crie um novo briefing com os dados corrigidos.`;
          await updateProposal(proposal.id, ctx.user.id, {
            currentStage: "validation",
            proposalContent: errorContent,
          });
          return { briefing, proposalId: proposal.id, stage: "validation", errors: validationResult.errors };
        }
        await updateProposal(proposal.id, ctx.user.id, {
          currentStage: "validation",
        });

        // 4. Automated Research Stage
        let researchData = "";
        try {
          researchData = await collectMarketResearch(input.segment, input.cities, input.targetAudience, ctx.user.id, input.mediaSpecs ?? undefined);
        } catch (err) {
          await updateProposal(proposal.id, ctx.user.id, {
            currentStage: "briefing",
          });
          throwLLMTRPCError(err);
        }
        
        const updatedContent = `${initialContent}\n\n## Pesquisa de Mercado Coletada\n${researchData}`;
        
        await updateProposal(proposal.id, ctx.user.id, {
          proposalContent: updatedContent,
          currentStage: "research",
        });

        // 5. Advance to Inventory upload wait stage
        await updateProposal(proposal.id, ctx.user.id, {
          currentStage: "inventory",
        });

        return { briefing, proposalId: proposal.id, stage: "inventory" };
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const { getBriefingsByUserId } = await import("./db");
      return getBriefingsByUserId(ctx.user.id);
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const { getBriefingById } = await import("./db");
        return getBriefingById(input.id);
      }),
  }),
});

export type AppRouter = typeof appRouter;
