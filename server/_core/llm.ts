import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { amplitudeAI, anthropic, currentAiSession, proposalAgent } from "./amplitude-ai";
import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  model?: string;
  thinking?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  temperature?: number;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

function contentToText(content: MessageContent | MessageContent[]): string {
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      if (p.type === "text") return p.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function resolveModel(temperature?: number, maxTokens?: number): string {
  const needsSmart =
    (typeof temperature === "number" && temperature > 0.5) ||
    (typeof maxTokens === "number" && maxTokens > 4000);
  return needsSmart ? ENV.anthropicModelSmart : ENV.anthropicModelFast;
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  console.log("[LLM RUNTIME] invokeLLM called!", {
    model: params.model,
    messagesCount: params.messages?.length,
    hasApiKey: !!ENV.anthropicApiKey,
  });

  if (!ENV.anthropicApiKey) {
    console.error("[LLM RUNTIME] Error: ANTHROPIC_API_KEY is not configured!");
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const {
    messages,
    model,
    temperature,
    maxTokens,
    max_tokens,
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  } = params;

  const resolvedMaxTokens = max_tokens ?? maxTokens ?? 2000;
  const resolvedModel = model || resolveModel(temperature, resolvedMaxTokens);

  const fmt = responseFormat || response_format;
  const schema =
    outputSchema ||
    output_schema ||
    (fmt && fmt.type === "json_schema" ? fmt.json_schema : undefined);
  const wantsJson =
    !!schema || (fmt ? fmt.type === "json_object" || fmt.type === "json_schema" : false);

  const systemParts: string[] = [];
  const turns: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    const text = contentToText(m.content);
    if (m.role === "system") {
      systemParts.push(text);
    } else if (m.role === "assistant") {
      turns.push({ role: "assistant", content: text });
    } else {
      turns.push({ role: "user", content: text });
    }
  }

  if (wantsJson) {
    let instruction =
      "Responda APENAS com um objeto JSON válido. Não use blocos de markdown, " +
      "não use cercas ```json, não escreva texto antes ou depois. Apenas o JSON.";
    if (schema && schema.schema) {
      instruction +=
        "\nO JSON deve seguir exatamente este JSON Schema:\n" + JSON.stringify(schema.schema);
    }
    systemParts.push(instruction);
  }

  const system = systemParts.join("\n\n").trim() || undefined;

  const resolvedTemperature = typeof temperature === "number" ? Math.max(0, Math.min(temperature, 1)) : undefined;

  // Sessão do Agent Analytics: herda userId/sessionId de quem abriu o escopo
  // (runWithAiSession, no middleware do tRPC). Sem escopo, a chamada vira sessão própria.
  const aiSession = currentAiSession();
  const session = proposalAgent.session({
    sessionId: aiSession?.sessionId ?? `llm-${randomUUID()}`,
    userId: aiSession?.userId,
  });
  const startedAt = Date.now();

  try {
    return await session.run(async s => {
      try {
      console.log(`[LLM RUNTIME] Sending request to Anthropic with model: ${resolvedModel}...`);
      // O wrapper do Amplitude tipa create() como `AnthropicResponse | AsyncIterable`
      // porque também cobre streaming. Aqui nunca passamos stream:true, então o
      // retorno é sempre uma Message do SDK — estreitamos pro tipo real.
      const resp = (await anthropic.messages.create({
        model: resolvedModel,
        max_tokens: resolvedMaxTokens,
        ...(typeof resolvedTemperature === "number" ? { temperature: resolvedTemperature } : {}),
        ...(system ? { system } : {}),
        messages: turns.length > 0 ? turns : [{ role: "user", content: "" }],
      })) as Anthropic.Message;
      console.log(`[LLM RUNTIME] Received response from Anthropic. ID: ${resp.id}, Model used: ${resp.model}`);

      let text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (wantsJson) {
        text = text.trim();
        const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) text = fence[1].trim();
      }

      return {
        id: resp.id,
        created: Math.floor(Date.now() / 1000),
        model: resp.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: text,
            },
            finish_reason: resp.stop_reason ?? null,
          },
        ],
        usage: {
          prompt_tokens: resp.usage.input_tokens,
          completion_tokens: resp.usage.output_tokens,
          total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
        },
      };
      } catch (err: any) {
        // Sem isto, uma chamada que falha não gera [Agent] AI Response e o turno
        // some das métricas de erro/latência — justamente o que você quer ver.
        s.trackAiMessage("", resolvedModel, "anthropic", Date.now() - startedAt, {
          isError: true,
          errorMessage: err?.message || String(err),
        });
        throw err;
      }
    });
  } catch (err: any) {
    console.error("[LLM RUNTIME] Error in invokeLLM:", err);
    const status = err?.status ?? err?.statusCode;
    const baseMsg = err?.message || String(err);
    if (status) {
      throw new Error(`LLM invoke failed: ${status} – ${baseMsg}`);
    }
    if (/timeout|ETIMEDOUT|ECONNRESET|aborted/i.test(baseMsg)) {
      throw new Error(`LLM invoke failed: timeout – ${baseMsg}`);
    }
    throw new Error(`LLM invoke failed: ${baseMsg}`);
  } finally {
    // Express é processo longo: session.run() só auto-flusha em serverless.
    // Sem este flush os eventos ficam na fila em memória e somem num restart.
    await amplitudeAI.flush();
  }
}

export type ModelInfo = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
};

export type ModelsResponse = {
  object: string;
  data: ModelInfo[];
};

export async function listLLMModels(): Promise<ModelsResponse> {
  return {
    object: "list",
    data: [
      {
        id: ENV.anthropicModelSmart,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "anthropic",
      },
      {
        id: ENV.anthropicModelFast,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "anthropic",
      },
    ],
  };
}
