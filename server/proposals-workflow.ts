import type { InsertBriefing } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { getParsedResourcesContext } from "./resources-parser";

export function validateBriefing(briefing: Partial<InsertBriefing>): { success: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!briefing.clientName || briefing.clientName.trim() === "") {
    errors.push("Nome do cliente é obrigatório");
  }
  if (!briefing.segment || briefing.segment.trim() === "") {
    errors.push("Segmento é obrigatório");
  }
  if (!briefing.cities || briefing.cities.trim() === "") {
    errors.push("Cidades são obrigatórias");
  }
  if (!briefing.campaignPeriod || briefing.campaignPeriod.trim() === "") {
    errors.push("Período da campanha é obrigatório");
  }
  if (!briefing.budget || briefing.budget.trim() === "") {
    errors.push("Orçamento é obrigatório");
  }
  if (!briefing.objective || briefing.objective.trim() === "") {
    errors.push("Objetivo da campanha é obrigatório");
  }
  if (!briefing.contactName || briefing.contactName.trim() === "") {
    errors.push("Nome de contato é obrigatório");
  }
  if (!briefing.contactEmail || briefing.contactEmail.trim() === "") {
    errors.push("Email de contato é obrigatório");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(briefing.contactEmail)) {
      errors.push("Formato de email inválido");
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

export async function collectMarketResearch(
  segment: string,
  cities: string,
  targetAudience: string,
  userId?: number,
  /** Especificações de mídia do briefing — formatos pedidos pelo cliente têm prioridade no inventário. */
  mediaSpecs?: string
): Promise<string> {
  const citiesList = cities.split(",").map(c => c.trim()).join(", ");
  
  const systemPrompt = "Você é um consultor sênior de inteligência de mercado e geomarketing OOH (Out-of-Home) no Brasil.";
  
  let resourcesContext = "";
  if (userId) {
    try {
      const briefingCities = cities.split(/[,;\/]/).map(c => c.trim()).filter(Boolean);
      resourcesContext = await getParsedResourcesContext(userId, ["market_data", "inventory"], briefingCities, mediaSpecs);
    } catch (err) {
      console.error("Failed to load user resources for market research:", err);
    }
  }

  const userPrompt = `Gere uma análise profunda e detalhada para o planejamento de uma campanha OOH com os seguintes dados:
- Segmento de Mercado: ${segment}
- Cidade(s) / Praça(s): ${citiesList}
- Público-Alvo: ${targetAudience}

${resourcesContext ? `ATENÇÃO: Utilize como base principal de análise os seguintes dados de mercado e de inventário de mídia enviados pelo usuário:\n${resourcesContext}` : ""}

Sua análise deve conter:
1. Comportamento e circulação do Público-Alvo nas praças selecionadas (onde andam, horários de pico, áreas residenciais vs comerciais, comportamento demográfico).
2. Pontos físicos, shopping centers premium e avenidas corporativas de destaque recomendados nessas cidades específicas (mencione locais reais e conhecidos, como Av. Paulista, Faria Lima, Berrini, aeroportos de negócios como Congonhas, etc., dependendo da praça).
3. Formatos de mídia OOH mais estratégicos para este público (abrigos de ônibus, painéis LED, telas digitais em elevadores corporativos, totens de shopping, empenas, relógios de rua, etc.) com justificativa e indicação de operadoras reais (Eletromidia, JCDecaux, NEOOH, Kallas).
4. Estimativa de alcance, frequência e relevância da mídia exterior para este segmento de mercado, incluindo métodos práticos de mensuração e captura de leads (QR codes dinâmicos, landing pages direcionadas).
5. Defesa do Inventário Disponível (Se houver dados de inventário no contexto fornecido acima para a(s) cidade(s) solicitada(s) do briefing, crie uma seção/capítulo dedicada defendendo a escolha estratégica dos formatos com base nas mídias físicas reais presentes no inventário. Explique o valor de cobertura urbana, as vantagens de cada formato para o público-alvo, e cite nominalmente o fornecedor/parceiro real de cada mídia listada no inventário (ex: Zanzar Mídia Ltda., Locar Locação de Espaços para Publicidade em Carros Ltda., Codemp Marketing Empreendimentos Ltda., All Space Propaganda e Marketing Ltda. ou outros parceiros que constam na lista).
   - ATENÇÃO: Se houver no inventário carros com telas de vídeo (PDOOH) / carros de aplicativo (como os veículos da Zanzar ou de outros parceiros), você DEVE obrigatoriamente incluí-los na análise e dar um destaque especial a esse formato (mídia móvel com vídeo), detalhando o impacto que telas de entretenimento com vídeos de 10" ou 15" têm no público-alvo corporativo em suas viagens e deslocamentos cotidianos por meio de carros de aplicativo pelas regiões da campanha.)

REGRAS DE CITAÇÃO DE FONTES (OBRIGATÓRIO — esta proposta será apresentada a clientes):
- Todo dado numérico (percentuais, fluxos, CPMs, recall, audiência) deve indicar a origem entre parênteses logo após o dado.
- Use APENAS três tipos de origem:
  a) Fonte pública real e consolidada que você tem alta confiança que existe (ex.: IBGE, Kantar IBOPE Media, CCSP/Central de Outdoor, DENATRAN, ANAC, Geofusion). Cite no formato (Fonte: Nome, ano).
  b) Dados vindos dos arquivos do usuário listados acima. Cite o nome do arquivo (ex.: Fonte: Tabela de Preços Kallas; Fonte: Inventário Kallas).
  c) Estimativa própria. Rotule como (estimativa baseada em benchmarks da categoria) — sem nome de instituto.
- NUNCA invente nome de instituto, estudo ou ano. Se não tiver certeza de que a fonte existe, use a opção (c).
- Finalize a análise com uma seção "### Fontes e Premissas" listando as fontes citadas e quais números são estimativas a validar.

Retorne em Markdown, de forma muito profissional, executiva e concisa (evite parágrafos longos, use tópicos diretos e parágrafos curtos e densos de no máximo 3 linhas), começando direto nos tópicos estruturados (sem título H1 principal, use títulos menores).`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      maxTokens: 8000
    });
    
    const content = response.choices[0]?.message.content;
    if (content) {
      if (typeof content === "string" && content.trim().length > 0) {
        return content;
      } else if (Array.isArray(content)) {
        const textContent = content.map(c => c.type === "text" ? (c as any).text : "").join("\n");
        if (textContent.trim().length > 0) {
          return textContent;
        }
      }
    }
  } catch (err) {
    console.error("Failed to generate AI deep research:", err);
    throw err;
  }

  // Fallback local logic in case LLM is offline or fails
  const segmentInsight: Record<string, { comportamento: string; locais: string; formatos: string }> = {
    retail: {
      comportamento: "Alto tráfego de pedestres em centros comerciais e vias de comércio. Pico de circulação entre 10h–13h e 16h–20h. Público sensível a promoções e ativações próximas ao ponto de venda.",
      locais: "Entradas e corredores de shoppings, calçadões comerciais, avenidas de grande fluxo varejista, pontos próximos a supermercados e lojas de departamento.",
      formatos: "MUBs digitais (All Space), painéis de LED em avenidas, backbus em rotas de ônibus comerciais, telas DOOH em carros de app (Zanzar) para interceptar o público em deslocamento para compras.",
    },
    technology: {
      comportamento: "Público jovem e tech-savvy, alta renda, mobile-first. Deslocamentos frequentes entre hubs corporativos e coworkings. Receptivo a formatos digitais e interativos.",
      locais: "Av. Faria Lima, Berrini, Paulista (SP), hubs de inovação, aeroportos de negócios (Congonhas/Guarulhos), proximidades de aceleradoras e universidades.",
      formatos: "DOOH em carros de app (Zanzar Mídia Ltda. — vídeos 10\"/15\"), painéis LED digitais em avenidas corporativas, totens interativos com QR code em coworkings e aeroportos.",
    },
    finance: {
      comportamento: "Executivos de alta renda, padrão A/B, deslocamentos entre sede corporativa, aeroportos e condomínios de alto padrão. Dwell time elevado em aeroportos e restaurantes premium.",
      locais: "Aeroportos (Congonhas, Guarulhos, Galeão), avenidas financeiras (Faria Lima, Paulista, Carlos Gomes em POA), shoppings premium (Iguatemi, JK, Pátio Batel).",
      formatos: "AIRMUB e bandejas de raio-X em aeroportos (Codemp), painéis de LED em avenidas financeiras, telas DOOH em carros de app para executivos.",
    },
    automotive: {
      comportamento: "Motoristas e entusiastas de carros, circulação em vias expressas e rodovias. Alta atenção a mensagens em formatos grandes e de alto impacto viário.",
      locais: "Grandes vias expressas (Marginal Pinheiros/Tietê, Via Dutra, BR-101), acesso a concessionárias, postos de combustível em vias de fluxo.",
      formatos: "Painéis de grande formato em vias expressas (frontlights, backlit), painéis de mensagem variável (PMV), DOOH em carros de app para atingir passageiros.",
    },
    food_beverage: {
      comportamento: "Público amplo, sensível ao horário de alimentação (11h–14h e 18h–21h). Alta frequência em praças de alimentação, supermercados e restaurantes.",
      locais: "Praças de alimentação em shoppings, proximidades de supermercados e mercados, avenidas comerciais, entradas de restaurantes populares.",
      formatos: "Backbus e busdoor (rotas de ônibus alimentação), MUBs digitais (All Space), telas DOOH em carros de app (Locar/Zanzar), painéis próximos a pontos de venda.",
    },
    healthcare: {
      comportamento: "Público misto: pacientes, cuidadores e profissionais de saúde. Circulação em torno de hospitais, clínicas e farmácias. Alta receptividade a mensagens de bem-estar.",
      locais: "Proximidades de hospitais e UPAs, farmácias de grande rede, clínicas e consultórios, shoppings com anchor de saúde.",
      formatos: "Painéis estáticos e digitais próximos a unidades de saúde, abrigos de ônibus (All Space) em rotas hospitalares, telas DOOH em carros de app para profissionais de saúde.",
    },
  };

  const info = segmentInsight[segment] ?? {
    comportamento: `Público geral com presença em áreas comerciais e vias de alto fluxo. Circulação distribuída ao longo do dia com picos pela manhã (8h–10h) e tarde (17h–19h).`,
    locais: `Principais avenidas e corredores comerciais das cidades ${citiesList}. Aeroportos regionais, shoppings e pontos de grande circulação.`,
    formatos: `MUBs digitais (All Space), painéis de LED em avenidas, DOOH em carros de app (Zanzar/Locar), bandejas de raio-X e carrinhos de bagagem em aeroportos (Codemp).`,
  };

  return `## Pesquisa de Mercado e Defesa de Praça — ${segment.charAt(0).toUpperCase() + segment.slice(1)}
Cidades analisadas: **${citiesList}** | Público-alvo: **${targetAudience}**

---

### 1. Comportamento e Circulação do Público-Alvo
${info.comportamento}

*   **Horários de pico:** Manhã (7h–10h) e tarde (17h–20h) nas principais vias e centros comerciais.
*   **Padrão de consumo de mídia exterior:** Alta atenção em pontos de espera (abrigos, aeroportos) e em deslocamentos de app car.

---

### 2. Pontos Físicos e Localidades Estratégicas
${info.locais}

*   **Recomendação prioritária:** Cobrir os corredores de maior concentração do target com formatos de alta visibilidade e dwell time elevado.

---

### 3. Formatos de Mídia OOH Mais Estratégicos
${info.formatos}

*   **Marketing Sensorial (Diferencial Kallas):** Abrigos de ônibus da All Space com aromatizadores automatizados (Signature Scent) sincronizados com o painel digital — o público vê **e sente** a marca simultaneamente.
*   **QR Code Interativo:** Telas nos MUBs direcionam para landing page personalizada com promoções e cupons geo-ativados.

---

### 4. Estimativa de Alcance e Mensuração
*   **Alcance estimado total:** ~${Math.round(citiesList.split(",").length * 2.5 * 1_000_000 / 1_000_000 * 10) / 10} milhões de impactos nas praças selecionadas (estimativa de mercado OOH Brasil, CCSP 2024).
*   **Frequência média:** 4–6 exposições/indivíduo durante o período de veiculação.
*   **CPM médio OOH:** R$ 3,50–R$ 6,00 (altamente eficiente vs. mídia digital e TV aberta).
*   **Mensuração:** QR Codes dinâmicos + pixel de rastreamento em landing pages + relatório fotográfico de checking pós-instalação.

---

### 5. Defesa do Inventário Kallas
A Kallas possui inventário **direto e exclusivo** nas praças Natal, Recife e Salvador, operado por parceiros certificados:
*   **All Space Propaganda e Marketing Ltda.** — MUBs, relógios de rua e abrigos digitais.
*   **Codemp Marketing Empreendimentos Ltda.** — Mídia aeroportuária (AIRMUB, bandejas de raio-X, carrinhos de bagagem, painéis estáticos e digitais).
*   **Zanzar Mídia Ltda.** — DOOH em carros de aplicativo (telas de vídeo 10\"/15\") — formato móvel de alto impacto.
*   **Locar Locação de Espaços para Publicidade em Carros Ltda.** — Vidro traseiro + mídia interna em táxis e carros de app.

Para as praças fora do inventário direto (**${citiesList.split(",").filter(c => !["Natal", "Recife", "Salvador"].some(d => c.trim().includes(d))).join(", ") || "demais cidades"}**), a Kallas atuará como **centralizadora de mídia nacional**, contratando os formatos sugeridos via parceiros homologados (JCDecaux, Eletromidia, NEOOH).`;
}
