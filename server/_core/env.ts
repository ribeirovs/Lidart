import crypto from "crypto";

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  forgeModel: process.env.BUILT_IN_FORGE_MODEL ?? "",

  // Anthropic API configuration
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModelSmart: process.env.ANTHROPIC_MODEL_SMART ?? "claude-sonnet-4-5",
  anthropicModelFast: process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5",

  // Geração de imagem (nano-banana / Gemini Flash Image) — mockups e edição de imagem
  geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "",
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",

  // Recuperação de emergência — requer ENABLE_RECOVERY=true + RECOVERY_SECRET (≥24 chars)
  recoverySecret: process.env.RECOVERY_SECRET ?? "",
  enableRecovery: process.env.ENABLE_RECOVERY === "true",
};

/**
 * Resumo das chaves de IA no boot — SEM expor o valor. Mostra a "impressão digital"
 * (sha256 curta) pra você confirmar QUAL conta está pagando: na produção da Kallas a
 * fp tem que ser a da chave da Kallas, não a sua. Custo de IA = dono da chave.
 */
export function aiKeysSummary(): string {
  const fp = (k: string) => (k ? crypto.createHash("sha256").update(k).digest("hex").slice(0, 8) : "");
  const part = (name: string, k: string) => `${name}: ${k ? `OK (fp ${fp(k)})` : "⚠️ FALTANDO"}`;
  return `[Config IA — quem paga] ${part("ANTHROPIC", ENV.anthropicApiKey)} · ${part("GEMINI", ENV.geminiApiKey)}`;
}
