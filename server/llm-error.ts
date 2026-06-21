import { TRPCError } from "@trpc/server";

// ─── LLM Error Types ─────────────────────────────────────────────────────────

export type LLMErrorType =
  | "invalid_key"     // 401 – chave de API inválida ou expirada
  | "quota_exhausted" // 402 / 412 / 429 – créditos ou limite de taxa esgotados
  | "timeout"         // ETIMEDOUT / AbortError – IA não respondeu a tempo
  | "parse_error"     // Resposta da IA não é JSON válido quando esperado
  | "unknown";        // Qualquer outro erro não mapeado

export class LLMError extends Error {
  public readonly errorType: LLMErrorType;
  public readonly detail: string;

  constructor(errorType: LLMErrorType, message: string, detail?: string) {
    super(message);
    this.name = "LLMError";
    this.errorType = errorType;
    this.detail = detail ?? "";
  }
}

// ─── Classify any thrown error into a typed LLMError ─────────────────────────

export function classifyLLMError(err: unknown): LLMError {
  const errMsg =
    err instanceof Error
      ? `${err.message} ${(err as any).cause ?? ""}`
      : String(err);

  if (/401|unauthorized|invalid.*key|api.?key/i.test(errMsg)) {
    return new LLMError(
      "invalid_key",
      "Chave de API inválida. Verifique as configurações de acesso.",
      errMsg
    );
  }

  if (/402|412|429|quota|credit|usage.*exhaust|rate.*limit|precondition/i.test(errMsg)) {
    return new LLMError(
      "quota_exhausted",
      "Créditos da IA esgotados. Recarregue sua conta Manus ou aguarde o reset do limite.",
      errMsg
    );
  }

  if (/timeout|ETIMEDOUT|ECONNRESET|aborted|abort/i.test(errMsg)) {
    return new LLMError(
      "timeout",
      "Tempo de resposta da IA excedido. Tente novamente.",
      errMsg
    );
  }

  if (/parse|JSON|invalid.*json|unexpected.*token/i.test(errMsg)) {
    return new LLMError(
      "parse_error",
      "A IA retornou uma resposta em formato inválido. Tente novamente.",
      errMsg
    );
  }

  return new LLMError(
    "unknown",
    "Erro desconhecido da IA. Tente novamente.",
    errMsg
  );
}

// ─── User-friendly label per error type ──────────────────────────────────────

export const LLM_ERROR_LABELS: Record<LLMErrorType, string> = {
  invalid_key:     "Chave de API inválida",
  quota_exhausted: "Créditos esgotados",
  timeout:         "Tempo de resposta excedido",
  parse_error:     "Resposta inválida da IA",
  unknown:         "Erro desconhecido",
};

// ─── Convert to TRPCError with structured JSON message ───────────────────────
//
// The frontend can parse error.message as JSON to get the structured payload:
// {
//   errorType: "llm_unavailable",
//   llmErrorType: LLMErrorType,
//   message: string,          ← user-facing
//   detail: string,           ← raw error for debugging
// }

export function throwLLMTRPCError(err: unknown): never {
  const classified =
    err instanceof LLMError ? err : classifyLLMError(err);

  let detailClassification = "instabilidade";
  if (classified.errorType === "invalid_key") {
    detailClassification = "chave inválida";
  } else if (classified.errorType === "quota_exhausted") {
    detailClassification = "crédito esgotado";
  }

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: JSON.stringify({
      success: false,
      errorType: "llm_unavailable",
      message: "IA temporariamente indisponível. Verifique seus créditos ou tente novamente.",
      detail: detailClassification,
    }),
  });
}
