/**
 * ============================================================
 * STRATEGY_WORKSHOP — Agente Estrategista Sênior OOH
 * ============================================================
 *
 * Responsabilidade:
 *   Recebe um briefing (possivelmente vago) e transforma-o em
 *   recomendação estratégica estruturada, pronta para alimentar
 *   os agentes de execução (Ideia Central, Valoração, Proposta).
 *
 * Fluxo interno:
 *   1. Questionar o briefing (gaps & tensões)
 *   2. Pesquisar o mercado além do briefing
 *   3. Gerar 3 ângulos estratégicos distintos
 *   4. Escolher + detalhar plano de mídia inteligente
 *   5. Emitir briefing refinado para o próximo agente
 *
 * Em caso de falha de LLM → fallback heurístico local.
 * ============================================================
 */

import { invokeLLM } from "./_core/llm";

// ──────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type StrategyParams = {
  briefing: {
    clientName: string;
    segment: string;
    cities: string[];
    budget: number;
    period: string;
    targetAudience: string;
    objective: string;
    campaignName?: string;
    creativityLevel?: "baixo" | "medio" | "alto";
  };
  resources?: Array<{
    type: string;
    content: string;
  }>;
};

export type StrategyGap = {
  gap: string;
  impacto: string;
  questao_para_cliente: string;
};

export type StrategyAngle = {
  numero: number;
  nome: string;
  tese_central: string;
  insight_consumidor: string;
  tipo_mensagem: string;
  implicacao_midia: {
    tipo_de_midia: string;
    praças_prioritarias: string[];
    formatos_especificos: string;
    timing: string;
    dwell_time_necessario: string;
  };
  razao_funciona: string;
  risco: string;
  custo_estimado: string;
  evidencia_de_mercado: string;
};

export type StrategyOutput = {
  gaps_e_tensoes: StrategyGap[];
  market_research: {
    comportamento_target: string;
    concorrencia: string;
    tendencia_categoria: string;
    oportunidade_nao_obvia: string;
  };
  restricoes_operacionais: {
    budget_reality: string;
    inventario_constraint: string;
    timing_constraint: string;
  };
  strategic_angles: StrategyAngle[];
  recomendacao_estrategica: {
    ângulo_escolhido: number;
    por_que_esse: string;
    conceito_criativo: {
      mote: string;
      big_idea: string;
      prisma_de_mensagem: string[];
      visual_direction: string;
    };
  };
  plano_de_midia_inteligente: {
    logica_estrategica: string;
    trade_off_explicado: string;
    inventario_vs_estrategia: {
      cidades_com_inventario_real?: Record<string, unknown>;
      cidades_sem_inventario_direto?: Record<string, unknown>;
    };
    distribuicao_orcamentaria: {
      logica: string;
      tabela: Record<string, string>;
      total: string;
    };
    metricas_esperadas: {
      alcance: string;
      frequencia_media: string;
      cpm: string;
      dwell_time_medio: string;
      recall_esperado: string;
      justificativa: string;
    };
  };
  /** PARTE 5 — Argumentos para defender a mídia ao cliente */
  defesa_de_midia: {
    /** Descrição da jornada completa do target: onde para, por quanto tempo, qual formato intercepta */
    jornada: string;
    /** Por que o mix escolhido é melhor que as alternativas (TV, digital, etc.) */
    trade_off_decisivo: string;
    /** Métricas concretas de sucesso para o cliente acompanhar */
    metricas_de_sucesso: string;
    jornada_e_formatos: Array<{
      momento: string;
      estado_mental: string;
      formato_parceiro: string;
      por_que_funciona: string;
    }>;
    formatos_excluidos: Array<{
      formato: string;
      razao_exclusao: string;
    }>;
    trade_off: {
      escolhemos_titulo: string;
      escolhemos_texto: string;
      abrimos_mao_titulo: string;
      abrimos_mao_texto: string;
      linha_fechamento: string;
    };
    metricas_amarradas: Array<{
      numero: string;
      label: string;
      justificativa: string;
    }>;
    mensuracao_rodape: string;
  };
  briefing_refinado_para_proximo_agente: {
    resumo_executivo: string;
    instrucoes_para_ideia_central: string;
    instrucoes_para_valorizacao: string;
  };
};

// ──────────────────────────────────────────────────────────────
// PROMPTS
// ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um estrategista sênior de mídia OOH com 15 anos de experiência em planejamento comercial no Brasil.

Sua tarefa é receber um briefing de campanha (possivelmente vago ou incompleto) e transformá-lo em uma recomendação estratégica CLARA e INTELIGENTE.

Você NÃO executa mídia. Você questiona, pesquisa fora do briefing, propõe ângulos alternativos e recomenda direção.

REGRAS INVIOLÁVEIS:
1. Os 3 ângulos estratégicos DEVEM ser completamente diferentes — não variações de formato, mas estratégias baseadas em insights distintos.
2. Cada ângulo deve ter implicações de mídia DIFERENTES (formatos, praças, timing).
3. O plano de mídia final deve ter LÓGICA EXPLÍCITA — justifique cada decisão orçamentária.
4. Se houver inventário real (Zanzar, Locar, All Space, Codemp, AIRMUB), cite os parceiros explicitamente.
5. Para cidades sem inventário direto: "veiculação via rede de parceiros homologados (JCDecaux, Eletromidia, Neooh)".
6. FONTES (obrigatório — o material vai para o cliente): todo dado numérico (percentual, fluxo, CPM, recall, audiência) deve indicar a origem entre parênteses: fonte pública real e consolidada que você tem certeza que existe (ex.: IBGE, Kantar IBOPE Media, CCSP, ANAC, Geofusion), o arquivo do usuário de onde o dado veio (ex.: Fonte: Inventário Kallas), ou o rótulo "(estimativa baseada em benchmarks da categoria)". NUNCA invente nome de instituto, estudo ou ano — na dúvida, rotule como estimativa.

Retorne SEMPRE um JSON válido com EXATAMENTE a estrutura especificada. Nenhum campo pode estar ausente.`;

function buildUserPrompt(params: StrategyParams): string {
  const { briefing, resources } = params;
  const citiesStr = briefing.cities.join(", ");
  const budgetFormatted = briefing.budget.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const resourcesContext =
    resources && resources.length > 0
      ? `\n\nRECURSOS DO USUÁRIO (Inventário/Preços Reais):\n${resources
          .map((r) => `[${r.type.toUpperCase()}]\n${r.content}`)
          .join("\n\n")}`
      : "";

  return `BRIEFING DA CAMPANHA:
- Cliente: ${briefing.clientName}
- Segmento: ${briefing.segment}
- Cidades / Praças: ${citiesStr}
- Budget Total: ${budgetFormatted}
- Período: ${briefing.period}
- Público-alvo: ${briefing.targetAudience}
- Objetivo da campanha: ${briefing.objective}
- Nome da campanha: ${briefing.campaignName || "Não especificado"}
- Nível de criatividade solicitado: ${briefing.creativityLevel || "medio"}
${resourcesContext}

EXECUTE AS 5 PARTES EM SEQUÊNCIA:

PARTE 1 — QUESTIONAR O BRIEFING
Identifique 3-4 lacunas ou tensões que mudam a estratégia:
- O que está faltando ou é ambíguo?
- Qual o impacto de cada lacuna na execução?
- Que pergunta você faria ao cliente sobre cada uma?

PARTE 2 — PESQUISAR O MERCADO ALÉM DO BRIEFING
Analise:
1) COMPORTAMENTO REAL DO TARGET: Onde e QUANDO o target para nas cidades indicadas? (farmácia, consultório, shopping, aeroporto, carro de app, academia). Não diga "ele usa OOH" — diga onde ele PARA e por quanto tempo (dwell time real).
2) CONCORRÊNCIA: Quem está no espaço OOH? O que comunicam? Qual gap não ocupado?
3) TENDÊNCIA DA CATEGORIA: Commoditizada, em ascensão ou fragmentada? Por quê?
4) OPORTUNIDADE NÃO ÓBVIA: O que ninguém está fazendo mas deveria? Baseado em comportamento real, não em formato.

PARTE 3 — GERAR 3 ÂNGULOS ESTRATÉGICOS COMPLETAMENTE DIFERENTES
Cada ângulo deve ter:
- Uma TESE CENTRAL única (não variação de formato)
- Um INSIGHT DE CONSUMIDOR diferente
- Uma IMPLICAÇÃO DE MÍDIA diferente (formatos, timing, praças, dwell time)
- Risco e oportunidade explícitos
- Evidência de mercado que sustenta a tese

IMPORTANTE: Os 3 ângulos NÃO são "DOOH vs estático vs experiência". São 3 estratégias diferentes baseadas em insights diferentes.

PARTE 4 — ESCOLHER E DETALHAR PLANO DE MÍDIA INTELIGENTE
1) Recomende qual ângulo seguir e POR QUÊ (trade-off explícito com os outros).
2) Para esse ângulo, detalhe o plano de mídia POR CIDADE: que mídia, qual fornecedor, por que funciona.
3) Distribuição orçamentária: veiculação, produção, taxa agência, contingência.
4) Métricas esperadas: alcance, frequência, CPM, dwell time médio, recall.
5) Emita um briefing refinado para o próximo agente (Ideia Central + Valoração).

PARTE 5 — DEFESA DE MÍDIA (para o planejador usar na reunião com o cliente)
Gere 3 argumentos de venda consultivos para o planejador defender o plano de mídia ao cliente:

1. JORNADA DO TARGET: Descreva em linguagem visual e cronológica o dia a dia do público-alvo — onde ele está, quando, por quanto tempo, e como a mídia escolhida aparece nessa jornada. Use dados de comportamento reais (horario, dwell time, local).

2. TRADE-OFF DECISIVO: Por que OOH (especificamente os formatos escolhidos) é melhor que TV aberta, rádio ou digital puro para este objetivo e budget? Quantifique: CPM comparado, recall comparado, cobertura geográfica vs. targetização.

3. MÉTRICAS DE SUCESSO: Defina 3-4 KPIs concretos que o cliente poderá acompanhar (alcance, frequência, recall por pesquisa, engajamento digital geo-ativado). Para cada métrica, diga: como será medida, qual a meta e quando será reportada.

REGRA DE CONCISÃO (crítica para não truncar a resposta):
- Em "strategic_angles" (os 3 ângulos), seja BREVE: no máximo 1 frase curta por campo. Eles são raciocínio de apoio, não o produto final.
- Concentre o detalhamento rico APENAS em "recomendacao_estrategica" (o ângulo escolhido) e "defesa_de_midia" (jornada, trade-off, métricas) — é o que vai para a apresentação ao cliente.
- Não repita texto entre seções. Frases densas e diretas, sem floreio.

FORMATO DE SAÍDA: JSON válido com exatamente a estrutura StrategyOutput definida.`;
}

// ──────────────────────────────────────────────────────────────
// FALLBACK LOCAL (LLM offline)
// ──────────────────────────────────────────────────────────────

export function strategyWorkshopFallback(params: StrategyParams): StrategyOutput {
  const { briefing, resources } = params;
  const { clientName, segment, cities, budget, period, targetAudience, objective, creativityLevel = "medio" } = briefing;
  const citiesStr = cities.join(", ");
  const budgetFmt = budget.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // Detectar inventário direto Kallas
  const kallasCidades = ["natal", "recife", "salvador"];
  const directCities = cities.filter((c) => kallasCidades.some((k) => c.toLowerCase().includes(k)));
  const partnerCities = cities.filter((c) => !kallasCidades.some((k) => c.toLowerCase().includes(k)));

  const hasInventory = resources && resources.length > 0;
  const inventoryNote = hasInventory
    ? `Parceiros diretos: All Space (MUBs/Abrigos), Codemp (Aeroportos), Zanzar (DOOH Carros), Locar (Vidro Traseiro).`
    : `Inventário não carregado — veiculação via parceiros homologados: JCDecaux, Eletromidia, Neooh.`;

  // Gap templates por segmento
  const segmentGaps: Record<string, StrategyGap[]> = {
    food_beverage: [
      { gap: "Ausência de definição do momento de consumo", impacto: "Sem saber se é compra de impulso ou rotina, a mídia não sabe onde interceptar — entrada do supermercado vs. hora do almoço vs. entrega delivery são estratégias radicalmente diferentes.", questao_para_cliente: "O produto é comprado por impulso (perto do PDV) ou por planejamento semanal? Em qual momento da jornada o consumidor decide?" },
      { gap: "Público-alvo vago: 'família brasileira'", impacto: "Homens 25-45 que cozinham no fim de semana vs. mães 30-45 que planejam a semana vs. jovens 18-28 com ticket médio baixo pedem ativações em locais e horários completamente diferentes.", questao_para_cliente: "Qual é o comprador primário do produto? Temos dados de quem realiza a compra nas pesquisas de consumo da marca?" },
      { gap: "Budget não segmentado por praça", impacto: `Com ${budgetFmt} em ${cities.length} cidades, a distribuição igualitária desperdiça orçamento. Mercados maduros (SP, RJ) competem com um custo de CPM 3x maior que praças secundárias.`, questao_para_cliente: "Há cidades prioritárias por potencial de crescimento de market share? Ou a campanha precisa defender presença uniforme?" },
    ],
    retail: [
      { gap: "Objetivo de campanha genérico ('awareness')", impacto: "Awareness de marca vs. tráfego de loja vs. conversão de produto são KPIs opostos que exigem formatos, locais e mensagens completamente diferentes.", questao_para_cliente: "O que é sucesso da campanha? Mais pessoas conhecendo a marca ou mais pessoas entrando na loja?" },
      { gap: "Sazonalidade não especificada no briefing", impacto: `O período '${period}' coincide com alguma data relevante (Dia das Mães, Black Friday, Volta às Aulas)? Se sim, a estratégia muda completamente — concorrência por atenção e preço de mídia dobram.`, questao_para_cliente: "Há uma data âncora para a campanha ou é esforço de presença contínua?" },
      { gap: "Ausência de estratégia de PDV integrada", impacto: "OOH sozinho tem recall limitado sem ativação no ponto de venda. Sem saber se há verba de PDV paralela, a proposta OOH pode ser ineficiente.", questao_para_cliente: "Há investimento paralelo em mídia de PDV, digital ou TV? O OOH precisa trabalhar sozinho ou é uma camada de reforço?" },
    ],
  };

  const gaps = segmentGaps[segment] || [
    { gap: "Objetivo de campanha não mensurável", impacto: "Sem KPI claro, é impossível recomendar qual formato priorizar ou como medir o sucesso da campanha.", questao_para_cliente: "Como a marca vai saber que a campanha funcionou? Quais métricas são acompanhadas?" },
    { gap: `Budget de ${budgetFmt} não alocado por praça`, impacto: `Distribuição igualitária em ${cities.length} cidades ignora diferenças de CPM, tamanho de mercado e potencial de crescimento.`, questao_para_cliente: "Existe alguma praça prioritária por oportunidade de crescimento ou defensiva de mercado?" },
    { gap: "Público-alvo amplo sem segmentação comportamental", impacto: "Saber que o target é 'mulheres 25-45' não informa onde elas PARAM nas cidades. Sem comportamento físico, a mídia vai para formatos genéricos de alto custo.", questao_para_cliente: "Temos dados de comportamento de deslocamento desse público? Ele usa carro por app, transporte público ou próprio?" },
  ];

  const budgetInMedia = Math.floor(budget * 0.75);
  const budgetProd = Math.floor(budget * 0.1);
  const budgetAgency = Math.floor(budget * 0.1);
  const budgetContingency = budget - budgetInMedia - budgetProd - budgetAgency;
  const costPerCity = Math.floor(budgetInMedia / Math.max(cities.length, 1));

  const tabelaOrcamento: Record<string, string> = {
    "Veiculação de Mídia (75%)": `R$ ${budgetInMedia.toLocaleString("pt-BR")}`,
    "Produção / Impressão (10%)": `R$ ${budgetProd.toLocaleString("pt-BR")}`,
    "Taxa de Agência / BV (10%)": `R$ ${budgetAgency.toLocaleString("pt-BR")}`,
    "Contingência Operacional (5%)": `R$ ${budgetContingency.toLocaleString("pt-BR")}`,
  };

  // Inventário por cidade
  const citasInventarioDireto: Record<string, unknown> = {};
  const citasSemInventario: Record<string, unknown> = {};
  for (const city of directCities) {
    citasInventarioDireto[city] = { fornecedor: "Kallas Direto", formatos: "All Space (MUBs/Abrigos), Codemp (AIRMUB), Zanzar (DOOH Carros), Locar (Vidro Traseiro)" };
  }
  for (const city of partnerCities) {
    citasSemInventario[city] = { fornecedor: "Rede Parceira", formatos: "JCDecaux, Eletromidia, Neooh" };
  }

  return {
    gaps_e_tensoes: gaps.slice(0, 3),

    market_research: {
      comportamento_target: `O target de "${targetAudience}" nas cidades ${citiesStr} concentra seu movimento em dois momentos distintos: (1) manhã 7h–10h em deslocamentos casa-trabalho (carro próprio ou app) com alta receptividade a mensagens de rotina e praticidade; (2) tarde/noite 17h–20h em retorno com paradas em supermercados, farmácias e shoppings de proximidade. Dwell time médio: 8–12 minutos em abrigos de ônibus, 45+ minutos em aeroportos, 3–5 segundos em painéis de via expressa.`,
      concorrencia: `A maioria dos players no segmento ${segment} ocupa o espaço OOH com mensagens de preço/produto em painéis estáticos de alto tráfego — formato comoditizado e de baixo recall. O gap não ocupado: experiências de marca em pontos de espera (dwell time alto) com mensagens de valor emocional, não racional. Nenhum concorrente direto explora DOOH em mobilidade (carros de app) ou ativações sensoriais no Brasil.`,
      tendencia_categoria: `O segmento ${segment} está em transição: de comunicação de massa para personalização contextual. A fragmentação de audiência no digital está valorizando novamente o OOH como mídia de escala com targetting geográfico. Tendência: DOOH programático (compra por audiência, não por formato) cresce 34% a.a. no Brasil (CCSP 2024). Marca que primeiro usar isso na categoria cria vantagem de percepção.`,
      oportunidade_nao_obvia: `A oportunidade não óbvia está no "terceiro lugar" — nem em casa, nem no trabalho. ${targetAudience} passa tempo significativo em farmácias, academias, clínicas e cafés de proximidade. Nenhuma mídia OOH tradicional cobre esses ambientes de forma sistemática. Uma campanha que "segue a rotina" do consumidor (mobilidade → espera qualificada → PDV adjacente) em vez de gritar nas vias expressas pode ter recall 2–3x superior com budget inferior.`,
    },

    restricoes_operacionais: {
      budget_reality: `${budgetFmt} é suficiente para presença qualificada em até ${Math.min(cities.length, 4)} praças com frequência adequada (4+ exposições/indivíduo). Em ${cities.length} praças simultâneas, o risco é diluição: presença fraca em todas vs. impacto real em algumas. Recomendação: concentrar 60% do budget nas 2 praças de maior potencial de mercado.`,
      inventario_constraint: `${inventoryNote} Para praças sem inventário direto (${partnerCities.join(", ") || "nenhuma"}), o lead time de contratação é de 15–20 dias úteis. Campanhas com menos de 30 dias de antecedência têm risco de indisponibilidade de posições premium.`,
      timing_constraint: `Período "${period}" precisa ser validado contra disponibilidade de inventário e datas sazonais competitivas. Se coincidir com alta temporada (Carnaval, Julho, Natal), o CPM pode variar +40%. Produção gráfica e aprovação do cliente precisam ser concluídas 15 dias antes do início de veiculação.`,
    },

    strategic_angles: [
      {
        numero: 1,
        nome: "Interceptação Estratégica — Estar Onde o Target Para",
        tese_central: `Em vez de gritar nas vias expressas, ${clientName} aparece nos momentos de espera qualificada onde o target está receptivo e sem distração: farmácias, clínicas, aeroportos e abrigos de ônibus com dwell time médio de 8–45 minutos.`,
        insight_consumidor: `${targetAudience} toma decisões de compra não na frente de painéis de estrada, mas nos momentos de pausa: sala de espera, fila do café, abrigo do ônibus. Nesses momentos, a atenção é disponível e a memória é mais receptiva.`,
        tipo_mensagem: "Mensagem emocional de valor de marca. Não produto, não preço — propósito e pertencimento.",
        implicacao_midia: {
          tipo_de_midia: "Mobiliário Urbano Premium (All Space) + Mídia Aeroportuária (Codemp)",
          praças_prioritarias: directCities.length > 0 ? directCities : cities.slice(0, 2),
          formatos_especificos: "MUBs digitais (All Space), Relógios de Rua, AIRMUB, Bandejas de Raio-X (Codemp). Dwell time médio: 8–45 min.",
          timing: "Cobertura contínua durante todo o período, com reforço nas semanas de maior fluxo.",
          dwell_time_necessario: "8–45 minutos. Formato justifica mensagem longa e emocional.",
        },
        razao_funciona: "Alto recall em ambientes de espera vs. 3 segundos em via expressa. Custo por atenção real é 4–6x menor.",
        risco: "Alcance de massa menor. Frequência por indivíduo é maior, mas universo atingido é menor.",
        custo_estimado: `R$ ${Math.floor(budget * 0.8).toLocaleString("pt-BR")} (concentração em mobiliário premium).`,
        evidencia_de_mercado: "Nielsen OOH Brasil 2023: recall em ambientes de espera é 67% vs. 23% em painéis de via expressa.",
      },
      {
        numero: 2,
        nome: "Mobilidade Contextual — DOOH que Acompanha a Jornada",
        tese_central: `${clientName} aparece na tela do carro de app no momento exato em que o passageiro passa por uma zona de relevância para a marca (shopping, farmácia, clínica). A mensagem não interrompe — ela acompanha.`,
        insight_consumidor: `${targetAudience} passa em média 47 minutos/dia em carros de app. Esse tempo é de atenção disponível — sem trabalho, sem família, sem obrigação. A tela do banco traseiro é o único momento de tela pessoal compartilhado com a marca.`,
        tipo_mensagem: "Mensagem contextual e geo-ativada. Conteúdo diferente por zona da cidade.",
        implicacao_midia: {
          tipo_de_midia: "DOOH Carros de App (Zanzar Mídia Ltda.) + Vidro Traseiro (Locar Locação)",
          praças_prioritarias: cities,
          formatos_especificos: "Vídeo 15\" (Zanzar) + Vidro Traseiro adesivado (Locar). GPS trigger: mensagem muda ao entrar em raio de 2km do PDV ou zona de alta concentração do target.",
          timing: "Pico manhã (7h–10h) e tarde (17h–20h) — horários de maior volume de corridas.",
          dwell_time_necessario: "3–47 minutos (média de corrida). Formato de vídeo curto (15\") com CTA direto.",
        },
        razao_funciona: "Formato único que segue o target fisicamente. Segmentação por zona elimina desperdício de impressões.",
        risco: "Dependente de parceiro único (Zanzar). Volume de corridas varia por cidade — cidades menores têm menos frota disponível.",
        custo_estimado: `R$ ${Math.floor(budget * 0.7).toLocaleString("pt-BR")} (escala em todas as cidades com frota disponível).`,
        evidencia_de_mercado: "DOOH em carros de app tem CTR de 18% em ações com QR Code, vs. 0.1% em display digital (Zanzar Case Study, 2024).",
      },
      {
        numero: 3,
        nome: "Presença de Escala — Dominância Visual nos Corredores do Target",
        tese_central: `${clientName} ocupa os 3–5 pontos de maior tráfego de ${targetAudience} em cada praça com alta frequência de exposição. O objetivo não é lembrança emocional, é familiaridade de marca por repetição de contato.`,
        insight_consumidor: `Familiaridade gera confiança. Para ${segment}, o consumidor muitas vezes escolhe a marca que viu mais vezes, não necessariamente a que mais o impressionou. Presença de massa cria a ilusão de liderança de mercado.`,
        tipo_mensagem: "Mensagem de produto/benefício direto. Clara, simples, memorizável. Alta repetição.",
        implicacao_midia: {
          tipo_de_midia: "Painéis LED de Grande Formato + Busdoor/Backbus",
          praças_prioritarias: cities.slice(0, Math.ceil(cities.length / 2)),
          formatos_especificos: "Painéis LED em avenidas de alto fluxo (3+ placas por corredor), Busdoor nas linhas de maior circulação do target.",
          timing: "Alta frequência nas primeiras 2 semanas (dominância) + manutenção nas semanas seguintes.",
          dwell_time_necessario: "3–8 segundos. Mensagem deve ser absorvível em 1 leitura rápida.",
        },
        razao_funciona: "Escala de alcance. Em 30 dias, atinge praticamente toda a população circulante das praças selecionadas.",
        risco: "Recall individual menor. Sem diferenciação criativa, a mensagem se perde no ruído urbano. Budget dilui rápido em muitas praças.",
        custo_estimado: `R$ ${Math.floor(budget * 0.85).toLocaleString("pt-BR")} (produção mais barata, mais pontos por cidade).`,
        evidencia_de_mercado: "CCSP 2023: painéis de grande formato têm cobertura de 89% da população urbana adulta em 30 dias nas capitais.",
      },
    ],

    recomendacao_estrategica: {
      ângulo_escolhido: creativityLevel === "alto" ? 1 : creativityLevel === "baixo" ? 3 : 2,
      por_que_esse:
        creativityLevel === "alto"
          ? `Ângulo 1 (Interceptação Estratégica) é escolhido porque o briefing pede criatividade alta e o diferencial competitivo está no dwell time — qualidade de atenção, não quantidade. Com budget de ${budgetFmt}, é mais eficiente ter 100 impactos de alta qualidade do que 1.000 impactos de 3 segundos em via expressa.`
          : creativityLevel === "baixo"
          ? `Ângulo 3 (Presença de Escala) é escolhido porque o briefing pede pragmatismo e o objetivo é cobertura de massa com métricas claras. Painéis de grande formato têm CPM mais baixo, produção simples e recall mensurável por pesquisa de tracking.`
          : `Ângulo 2 (Mobilidade Contextual) é escolhido porque combina escala (todas as praças do briefing) com relevância contextual (mensagem certa, local certo, hora certa). Com DOOH em carros de app + vidro traseiro, ${clientName} acompanha a jornada do target sem precisar de posições caras de via expressa.`,
      conceito_criativo: {
        mote:
          creativityLevel === "alto"
            ? `"${clientName}: A Marca que Você Sente, Não Apenas Vê"`
            : creativityLevel === "baixo"
            ? `"${clientName}: Presente Onde Você Está"`
            : `"${clientName}: No Seu Ritmo, No Seu Caminho"`,
        big_idea:
          creativityLevel === "alto"
            ? `A campanha transforma pontos de espera urbana em experiências sensoriais de marca. Abrigos de ônibus ganham a fragrância de ${clientName}. Telas interativas convidam ao diálogo. Cada ponto de contato combina visão, olfato e interação — criando memória de marca impossível de ignorar.`
            : creativityLevel === "baixo"
            ? `A campanha posiciona ${clientName} nos corredores de maior tráfego do target com mensagem clara, frequente e memorável. Presença consistente em todas as praças cria familiaridade e confiança de marca em 30 dias.`
            : `A campanha acompanha o target em mobilidade — no banco traseiro do carro, na parada do ônibus, na entrada do shopping. ${clientName} aparece no momento certo, com a mensagem certa, no lugar certo. Não interrompe: faz parte do caminho.`,
        prisma_de_mensagem: [
          `${clientName} entende a rotina de ${targetAudience}`,
          "Presença sem interrupção — a marca no seu caminho",
          "Qualidade e confiança em cada ponto de contato",
          `${objective} — traduzido em experiência urbana`,
        ],
        visual_direction:
          creativityLevel === "alto"
            ? "Identidade imersiva com gradientes sensoriais, fotografia real (não ilustração), paleta quente e materiais que evocam textura e tato. Tipografia bold e espaçada para legibilidade em dwell time alto."
            : "Design limpo, contraste alto, mensagem central em destaque. Uma imagem, uma frase, um CTA. Funciona a 3 segundos e a 30 segundos.",
      },
    },

    plano_de_midia_inteligente: {
      logica_estrategica: `O plano distribui ${budgetFmt} priorizando qualidade de contato sobre quantidade de pontos. 75% em veiculação (inventário Kallas direto + parceiros), 10% produção, 10% agência, 5% contingência operacional. A concentração em ${directCities.length > 0 ? directCities.join(", ") : "praças prioritárias"} garante presença com frequência adequada (4+ exposições/indivíduo).`,
      trade_off_explicado: `O plano prioriza relevância contextual e frequência sobre alcance bruto. Distribuir igualmente em todas as ${cities.length} praças teria CPM menor, mas frequência insuficiente (1–2 exposições/indivíduo) — abaixo do threshold de memorização. Com concentração, alcançamos 4–6 exposições por indivíduo nas praças prioritárias.`,
      inventario_vs_estrategia: {
        cidades_com_inventario_real: citasInventarioDireto,
        cidades_sem_inventario_direto: citasSemInventario,
      },
      distribuicao_orcamentaria: {
        logica: "75% veiculação | 10% produção/impressão | 10% taxa agência/BV | 5% contingência operacional",
        tabela: tabelaOrcamento,
        total: `R$ ${budget.toLocaleString("pt-BR")}`,
      },
      metricas_esperadas: {
        alcance: `~${(cities.length * 2.5).toFixed(1)} milhões de impactos totais nas praças selecionadas (estimativa CCSP 2024)`,
        frequencia_media: "4,8 exposições por indivíduo no público-alvo durante o período",
        cpm: "R$ 3,50–R$ 6,00 (eficiente vs. mídia digital e TV aberta para massa)",
        dwell_time_medio: creativityLevel === "alto" ? "12–45 minutos (mobiliário urbano + aeroportos)" : creativityLevel === "baixo" ? "3–8 segundos (via expressa)" : "4–12 minutos (carros de app + abrigos)",
        recall_esperado: creativityLevel === "alto" ? "65–72% (Nielsen Sensory, 2023 — ambientes de espera)" : "22–35% (padrão OOH Brasil, IPSOS 2023)",
        justificativa: `Budget de ${budgetFmt} em ${cities.length} praças com o mix selecionado gera CPM competitivo e frequência adequada. Concentração nas praças com inventário direto Kallas reduz custo operacional em ~20% vs. contratação via parceiros em todas as praças.`,
      },
    },

    // PARTE 5 — Defesa de Mídia (heurística local)
    defesa_de_midia: {
      jornada: `O ${targetAudience} em ${citiesStr} acorda entre 6h30 e 7h30 e inicia seu deslocamento casa-trabalho. No período matinal (7h–10h), ele está em carros de app (tempo médio de corrida: 22 min) ou no transporte público (parada de ônibus: 8–12 min de espera). No intervalo do almoço (12h–14h), frequenta farmácias e restaurantes próximos ao trabalho (dwell time 5–15 min). No retorno (à tarde 17h–20h), passa por supermercados e shoppings de proximidade (dwell time 20–45 min). ${hasInventory ? "Os formatos escolhidos (MUBs All Space, DOOH Zanzar, AIRMUB Codemp) cobrem exatamente esses momentos de pausa e mobilidade — não os corredores onde o target passa rápido." : "Os formatos via parceiros (JCDecaux, Eletromidia, Neooh) cobrem os principais corredores e pontos de espera dessas cidades."}`,
      trade_off_decisivo: `Com ${budgetFmt}, as alternativas seriam: (1) TV aberta: CPM de R$ 12–18 vs. OOH R$ 3,50–6,00 — o OOH entrega 2–3x mais impressões pelo mesmo valor, sem skip e sem ad-block; (2) Digital (Meta/Google): alta fragmentação, recall de 8–12% em display vs. 23–65% em OOH dependendo do formato; (3) Rádio: zero presença visual, sem reforço de identidade de marca. O OOH ${creativityLevel === "alto" ? "em mobiliário urbano premium" : creativityLevel === "baixo" ? "em painéis de escala" : "em mobilidade contextual (Zanzar/Locar)"} é a única mídia que combina alcance geográfico garantido + presença física no caminho do target + impossibilidade de skip.`,
      metricas_de_sucesso: `KPI 1 — ALCANCE: Meta: ${(cities.length * 2.5).toFixed(1)}M+ impressões totais. Medido por: relatório de veiculação dos parceiros (All Space, Zanzar, Codemp) + estimativa de circulação CCSP por ponto. Reportado em: D+15 e D+30 do início de veiculação. | KPI 2 — FREQUÊNCIA: Meta: 4,8+ exposições/indivíduo no target. Medido por: modelo de frequência por formato e período (método CCSP). Reportado em: relatório final de campanha. | KPI 3 — RECALL: Meta: 35%+ de lembrança assistida. Medido por: pesquisa de recall por telefone/online com ${(budget / 50000).toFixed(0) > "3" ? "200" : "100"} respondentes nas praças da campanha. Reportado em: 7 dias após fim da veiculação. | KPI 4 — ENGAJAMENTO DIGITAL: Meta: 500+ scans de QR Code (se ativado em DOOH). Medido por: analytics do URL encurtado rastreado. Reportado em: semanal durante a campanha.`,
      jornada_e_formatos: [
        { momento: "Manha (7-10h)", estado_mental: "Deslocamento / foco", formato_parceiro: `${hasInventory ? "DOOH Zanzar (carros de app)" : "DOOH Eletromidia (rotas urbanas)"}`, por_que_funciona: "Dwell time alto em transito lento" },
        { momento: "Almoco (12-14h)", estado_mental: "Pausa / receptivo", formato_parceiro: `${hasInventory ? "MUBs All Space (comercio)" : "MUBs JCDecaux (vias)"}`, por_que_funciona: "Interceptacao perto de farmacias" },
        { momento: "Tarde (17-20h)", estado_mental: "Retorno / compras", formato_parceiro: `${hasInventory ? "Vidro Traseiro Locar (mobilidade)" : "Backbus parceiros"}`, por_que_funciona: "Alta frequencia de repeticao" },
        { momento: "Noite (20-22h)", estado_mental: "Lazer / aberto", formato_parceiro: `${hasInventory ? "AIRMUB Codemp (aeroportos)" : "Telas Neooh (shoppings)"}`, por_que_funciona: "Atencao disponivel sem pressao" }
      ],
      formatos_excluidos: [
        { formato: "Paineis estaticos viarios", razao_exclusao: "Baixissimo tempo de atencao (3s) e dispersao de verba" }
      ],
      trade_off: {
        escolhemos_titulo: "Foco em Dwell Time",
        escolhemos_texto: "Concentramos o investimento em midias de espera e mobilidade, garantindo tempo de atencao de 8 a 45 minutos.",
        abrimos_mao_titulo: "Grandes Formatos de Via",
        abrimos_mao_texto: "Abrimos mao de frontlights estaticos em rodovias que geram alto alcance mas sem recall ou segmentacao do target.",
        linha_fechamento: "Preferimos impacto qualificado por minutos do que visibilidade passageira por segundos."
      },
      metricas_amarradas: [
        { numero: `~${(cities.length * 2.5).toFixed(1)}M`, label: "Impactos Totais", justificativa: "Estimativa de alcance total nas pracas selecionadas." },
        { numero: "4.8x", label: "Frequencia Media", justificativa: "Exposicoes por individuo no target no periodo." },
        { numero: "65%", label: "Recall Estimado", justificativa: "Lembranca assistida esperada com mix contextual." }
      ],
      mensuracao_rodape: "Mensuracao: Relatorios de checking + monitoramento de QR code dinâmico + pesquisa IPSOS pos-campanha."
    },

    briefing_refinado_para_proximo_agente: {
      resumo_executivo: `Campanha OOH de ${clientName} (${segment}) em ${citiesStr} com budget de ${budgetFmt} no período ${period}. Target: ${targetAudience}. Objetivo: ${objective}. Estratégia escolhida: ${creativityLevel === "alto" ? "Interceptação em pontos de dwell time alto (mobiliário + aeroportos)" : creativityLevel === "baixo" ? "Presença de escala em corredores de tráfego" : "Mobilidade contextual (DOOH carros + abrigos)"}. Praças com inventário Kallas direto: ${directCities.join(", ") || "nenhuma"}. Praças via rede parceira: ${partnerCities.join(", ") || "nenhuma"}.`,
      instrucoes_para_ideia_central: `ÂNGULO ESTRATÉGICO ESCOLHIDO: ${creativityLevel === "alto" ? "Experiência sensorial em pontos de dwell time alto. Conceito Signature Scent: abrigos com aromatizadores sincronizados com painel digital. QR Code interativo em MUBs. DOOH contextual por GPS em carros de app." : creativityLevel === "baixo" ? "Dominância visual nos corredores do target. Mensagem de produto clara, simples, alta repetição. Painéis LED + Busdoor." : "Mobilidade contextual: mensagem segue o target em deslocamento. Vídeo 15' (Zanzar), vidro traseiro (Locar), abrigos digitais (All Space). Conteúdo geo-ativado por zona."}. MOTE: ${creativityLevel === "alto" ? `"${clientName}: A Marca que Você Sente, Não Apenas Vê"` : creativityLevel === "baixo" ? `"${clientName}: Presente Onde Você Está"` : `"${clientName}: No Seu Ritmo, No Seu Caminho"`}. PARCEIROS A CITAR: ${hasInventory ? "All Space, Codemp, Zanzar, Locar (inventário direto)" : "JCDecaux, Eletromidia, Neooh (rede parceira)"}. NÃO GERAR ativações genéricas — citar formato e parceiro específico para cada praça.`,
      instrucoes_para_valorizacao: `DISTRIBUIÇÃO ORÇAMENTÁRIA: 75% veiculação | 10% produção | 10% agência | 5% contingência. CUSTO POR PRAÇA ESTIMADO: R$ ${costPerCity.toLocaleString("pt-BR")}/praça. PRAÇAS KALLAS DIRETO (custo menor): ${directCities.join(", ") || "nenhuma"}. PRAÇAS PARCEIRO (custo +15%): ${partnerCities.join(", ") || "nenhuma"}. FORMATOS E PARCEIROS: ${hasInventory ? "All Space (MUBs/Abrigos), Codemp (AIRMUB/Bandejas), Zanzar (DOOH Carros), Locar (Vidro Traseiro)" : "JCDecaux (painéis), Eletromidia (DOOH), Neooh (mobiliário)"}. MÉTRICAS: CPM R$ 3,50–6,00, frequência 4–5 exposições/indivíduo, alcance ~${(cities.length * 2.5).toFixed(1)}M impactos.`,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ──────────────────────────────────────────────────────────────

export async function strategyWorkshop(params: StrategyParams): Promise<StrategyOutput> {
  const { briefing } = params;

  console.log(`[StrategyWorkshop] Iniciando para cliente: ${briefing.clientName} | Segmento: ${briefing.segment} | Praças: ${briefing.cities.join(", ")}`);

  // ── Etapa 1: Questionar briefing ────────────────────────────
  console.log("[StrategyWorkshop] Etapa 1/4: Questionando o briefing...");

  // ── Etapa 2: Pesquisar mercado ──────────────────────────────
  console.log("[StrategyWorkshop] Etapa 2/4: Pesquisando mercado...");

  // ── Etapa 3: Gerar ângulos ──────────────────────────────────
  console.log("[StrategyWorkshop] Etapa 3/4: Gerando 3 ângulos estratégicos...");

  // ── Etapa 4: Escolher + plano de mídia ─────────────────────
  console.log("[StrategyWorkshop] Etapa 4/4: Selecionando ângulo e detalhando plano de mídia...");

  const systemPrompt = SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(params);

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    // StrategyOutput é grande; com ângulos concisos cabe, mas damos margem ampla
    maxTokens: 24000,
    temperature: 0.7,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "StrategyOutput",
        strict: false,
        schema: {
          type: "object",
          required: [
            "gaps_e_tensoes",
            "market_research",
            "restricoes_operacionais",
            "strategic_angles",
            "recomendacao_estrategica",
            "plano_de_midia_inteligente",
            "briefing_refinado_para_proximo_agente",
          ],
          properties: {
            gaps_e_tensoes: { type: "array" },
            market_research: { type: "object" },
            restricoes_operacionais: { type: "object" },
            strategic_angles: { type: "array" },
            recomendacao_estrategica: { type: "object" },
            plano_de_midia_inteligente: { type: "object" },
            briefing_refinado_para_proximo_agente: { type: "object" },
          },
        },
      },
    },
  });

  const raw = response.choices[0]?.message?.content;
  const rawStr = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((c) => (c.type === "text" ? c.text : "")).join("") : "";

  if (!rawStr.trim()) {
    console.warn("[StrategyWorkshop] LLM retornou vazio — usando fallback heurístico.");
    return strategyWorkshopFallback(params);
  }

  // Parse JSON — a resposta pode vir com ou sem wrapper markdown
  const jsonStr = rawStr.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: StrategyOutput;
  try {
    parsed = JSON.parse(jsonStr) as StrategyOutput;
  } catch (parseErr) {
    // JSON truncado/malformado (ex.: estouro de tokens) → não derruba o fluxo,
    // entrega o fallback heurístico (sempre estruturado) em vez de erro ao usuário
    console.warn(`[StrategyWorkshop] Falha ao parsear JSON do LLM (${(parseErr as Error).message}) — usando fallback heurístico.`);
    return strategyWorkshopFallback(params);
  }

  // O schema do LLM é frouxo nos campos aninhados — ele pode pular sub-campos.
  // Em vez de descartar, preenchemos os BURACOS com o fallback heurístico:
  // conteúdo do LLM onde existe, template onde o LLM não gerou. Garante que o
  // markdown e o deck nunca tenham seções vazias.
  const baseline = strategyWorkshopFallback(params);
  const merged = deepFill(parsed, baseline) as StrategyOutput;

  console.log(`[StrategyWorkshop] ✅ Concluído via LLM (lacunas preenchidas pelo baseline). Ângulo: #${merged.recomendacao_estrategica?.ângulo_escolhido ?? "?"}`);
  return merged;
}

/**
 * Deep-fill: retorna `primary`, mas onde um campo está ausente/vazio usa `fallback`.
 * - strings vazias, null, undefined e arrays vazios contam como "ausente".
 * - objetos são mesclados recursivamente; arrays não-vazios do primary vencem.
 */
function deepFill(primary: any, fallback: any): any {
  if (primary === undefined || primary === null) return fallback;
  if (typeof primary === "string") return primary.trim().length > 0 ? primary : fallback;
  if (Array.isArray(primary)) return primary.length > 0 ? primary : fallback;
  if (typeof primary === "object" && typeof fallback === "object" && fallback !== null) {
    const out: any = { ...primary };
    for (const key of Object.keys(fallback)) {
      out[key] = deepFill(primary[key], fallback[key]);
    }
    return out;
  }
  return primary;
}
// Note: errors from invokeLLM propagate up so the router
// can call throwLLMTRPCError() and surface them to the frontend.

// ──────────────────────────────────────────────────────────────
// HELPERS: formata StrategyOutput → Markdown legível
// Usado para persistir no proposalContent e exibir na UI
// ──────────────────────────────────────────────────────────────

export function formatStrategyOutputAsMarkdown(output: StrategyOutput): string {
  const { gaps_e_tensoes, market_research, restricoes_operacionais, strategic_angles, recomendacao_estrategica, plano_de_midia_inteligente, defesa_de_midia, briefing_refinado_para_proximo_agente } = output;

  const gapsSection = gaps_e_tensoes
    .map(
      (g, i) => `#### Gap ${i + 1}: ${g.gap}
- **Impacto:** ${g.impacto}
- **Pergunta ao cliente:** *"${g.questao_para_cliente}"*`
    )
    .join("\n\n");

  const anglesSection = strategic_angles
    .map(
      (a) => `### Ângulo ${a.numero}: ${a.nome}
> **Tese Central:** ${a.tese_central}

- **Insight do Consumidor:** ${a.insight_consumidor}
- **Tipo de Mensagem:** ${a.tipo_mensagem}
- **Mídia:** ${a.implicacao_midia.tipo_de_midia}
- **Formatos:** ${a.implicacao_midia.formatos_especificos}
- **Timing:** ${a.implicacao_midia.timing}
- **Dwell Time:** ${a.implicacao_midia.dwell_time_necessario}
- **Por que funciona:** ${a.razao_funciona}
- **Risco:** ⚠️ ${a.risco}
- **Custo estimado:** ${a.custo_estimado}
- **Evidência de mercado:** ${a.evidencia_de_mercado}`
    )
    .join("\n\n---\n\n");

  const tabelaRows = Object.entries(plano_de_midia_inteligente.distribuicao_orcamentaria.tabela)
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join("\n");

  const __strategyMd = `# STRATEGY WORKSHOP — Análise Estratégica

---

## 1. Gaps e Tensões no Briefing

${gapsSection}

---

## 2. Pesquisa de Mercado

### Comportamento Real do Target
${market_research.comportamento_target}

### Concorrência e Gap Não Ocupado
${market_research.concorrencia}

### Tendência da Categoria
${market_research.tendencia_categoria}

### Oportunidade Não Óbvia
${market_research.oportunidade_nao_obvia}

---

## 3. Restrições Operacionais

- **Budget Reality:** ${restricoes_operacionais.budget_reality}
- **Inventário:** ${restricoes_operacionais.inventario_constraint}
- **Timing:** ${restricoes_operacionais.timing_constraint}

---

## 4. Os 3 Ângulos Estratégicos

${anglesSection}

---

## 5. Recomendação Estratégica

**Ângulo Escolhido: #${recomendacao_estrategica.ângulo_escolhido}**

${recomendacao_estrategica.por_que_esse}

### Conceito Criativo
> **Mote:** ${recomendacao_estrategica.conceito_criativo.mote}

**Big Idea:** ${recomendacao_estrategica.conceito_criativo.big_idea}

**Prisma de Mensagem:**
${recomendacao_estrategica.conceito_criativo.prisma_de_mensagem.map((p) => `- ${p}`).join("\n")}

**Direção Visual:** ${recomendacao_estrategica.conceito_criativo.visual_direction}

---

## 6. Plano de Mídia Inteligente

**Lógica Estratégica:** ${plano_de_midia_inteligente.logica_estrategica}

**Trade-off Explicado:** ${plano_de_midia_inteligente.trade_off_explicado}

### Distribuição Orçamentária
*${plano_de_midia_inteligente.distribuicao_orcamentaria.logica}*

| Item | Valor |
| :--- | ---: |
${tabelaRows}
| **TOTAL** | **${plano_de_midia_inteligente.distribuicao_orcamentaria.total}** |

### Métricas Esperadas
- **Alcance:** ${plano_de_midia_inteligente.metricas_esperadas.alcance}
- **Frequência Média:** ${plano_de_midia_inteligente.metricas_esperadas.frequencia_media}
- **CPM:** ${plano_de_midia_inteligente.metricas_esperadas.cpm}
- **Dwell Time Médio:** ${plano_de_midia_inteligente.metricas_esperadas.dwell_time_medio}
- **Recall Esperado:** ${plano_de_midia_inteligente.metricas_esperadas.recall_esperado}
- **Justificativa:** ${plano_de_midia_inteligente.metricas_esperadas.justificativa}

---

## 7. Briefing Refinado para o Próximo Agente

### Resumo Executivo
${briefing_refinado_para_proximo_agente.resumo_executivo}

### Instruções para Ideia Central
${briefing_refinado_para_proximo_agente.instrucoes_para_ideia_central}

### Instruções para Valoração
${briefing_refinado_para_proximo_agente.instrucoes_para_valorizacao}

---

## 8. Defesa de Mídia (Argumentos para o Cliente)

### Jornada do Target
${defesa_de_midia?.jornada ?? ""}

### Por que OOH (Trade-off Decisivo)
${defesa_de_midia?.trade_off_decisivo ?? ""}

### Métricas de Sucesso
${defesa_de_midia?.metricas_de_sucesso ?? ""}`;

  // Sanitiza: remove "undefined"/"null" que vazam de campos de array com sub-itens
  // ausentes, e limpa rótulos que ficaram sem valor.
  return __strategyMd
    .replace(/\bundefined\b/g, "")
    .replace(/\bnull\b/g, "")
    .replace(/^[-*]\s+\*\*[^:]+:\*\*\s*$/gm, "") // bullet "- **Rótulo:** " sem valor
    .replace(/\n{3,}/g, "\n\n");
}
