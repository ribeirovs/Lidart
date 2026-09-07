/**
 * amplitude-ai.ts — Agent Analytics (Amplitude) para o lado servidor.
 *
 * O `aiKeysSummary()` do env.ts te diz QUAL chave paga a IA. Este módulo diz QUANTO
 * ela gastou: cada chamada ao Anthropic vira um evento com modelo, tokens, custo
 * estimado e latência, agrupado por sessão do usuário.
 *
 * Ponto único de saída: quem fala com o Anthropic pelo SDK importa `anthropic` daqui.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { AIConfig, AmplitudeAI, Anthropic } from "@amplitude/ai";
import { ENV } from "./env";

if (!ENV.amplitudeAiApiKey) {
  console.warn("Amplitude API key missing — agent analytics disabled");
}

export const amplitudeAI = new AmplitudeAI({
  apiKey: ENV.amplitudeAiApiKey,
  config: new AIConfig({
    // `full` guarda prompt/resposta pra debug; redactPii limpa e-mail, telefone,
    // cartão e IP antes de sair daqui. Briefing de cliente costuma ter contato.
    contentMode: "full",
    redactPii: true,
  }),
});

/**
 * Agente como singleton de módulo. Recriar por request geraria um Agent ID novo a
 * cada turno e quebraria o agrupamento de sessão no Amplitude.
 */
export const proposalAgent = amplitudeAI.agent("lidart-proposal-agent", {
  description:
    "Gera propostas comerciais, planos de mídia OOH e decks a partir de briefing (Anthropic)",
});

/** Cliente Anthropic instrumentado — substitui `new Anthropic(...)` cru. */
export const anthropic = new Anthropic({
  apiKey: ENV.anthropicApiKey,
  amplitude: amplitudeAI,
});

export type AiSessionContext = {
  userId?: string;
  /** Id estável da conversa/trabalho — NÃO um uuid novo por request. */
  sessionId: string;
};

const aiSessionStore = new AsyncLocalStorage<AiSessionContext>();

/**
 * Abre um escopo de sessão. Tudo que chamar `invokeLLM` dentro do callback herda
 * userId/sessionId sem precisar passar parâmetro por toda a árvore de chamadas.
 */
export function runWithAiSession<T>(ctx: AiSessionContext, fn: () => Promise<T>): Promise<T> {
  return aiSessionStore.run(ctx, fn);
}

export function currentAiSession(): AiSessionContext | undefined {
  return aiSessionStore.getStore();
}
