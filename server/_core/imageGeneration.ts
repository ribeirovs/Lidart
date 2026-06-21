/**
 * Geração / edição de imagem.
 *
 * Provedor primário: nano-banana (Gemini Flash Image) — ótimo para MOCKUP:
 * "edite esta foto, troque o anúncio, mantenha o resto". Provado na proposta Heinz.
 * Fallback legado: Forge (Manus) — hoje esgotado; só usado se não houver GEMINI_API_KEY.
 *
 * Uso:
 *   // gerar do zero
 *   const { url } = await generateImage({ prompt: "..." });
 *   // editar / compor (mockup): foto do ponto de mídia + arte do cliente
 *   const { url } = await generateImage({
 *     prompt: "Troque o anúncio do painel por ...; mantenha painel, cena e iluminação.",
 *     originalImages: [{ b64Json, mimeType: "image/jpeg" }],
 *   });
 */
import { storagePut } from "server/storage";
import { ENV } from "./env";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
};

type RawImage = { b64: string; mime: string };

/** Resolve uma imagem de entrada (url ou b64) para base64. */
async function toInlineImage(img: {
  url?: string;
  b64Json?: string;
  mimeType?: string;
}): Promise<RawImage | null> {
  if (img.b64Json) return { b64: img.b64Json, mime: img.mimeType || "image/png" };
  if (img.url) {
    const r = await fetch(img.url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { b64: buf.toString("base64"), mime: img.mimeType || r.headers.get("content-type") || "image/png" };
  }
  return null;
}

/** Chama o nano-banana (Gemini Flash Image) e devolve a imagem gerada. */
async function generateViaGemini(options: GenerateImageOptions): Promise<RawImage> {
  const parts: any[] = [];
  for (const img of options.originalImages || []) {
    const inl = await toInlineImage(img);
    if (inl) parts.push({ inline_data: { mime_type: inl.mime, data: inl.b64 } });
  }
  parts.push({ text: options.prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${ENV.geminiImageModel}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": ENV.geminiApiKey, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`nano-banana (Gemini) falhou (${r.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const j: any = await r.json();
  const out = (j?.candidates?.[0]?.content?.parts || []).find(
    (p: any) => p.inlineData?.data || p.inline_data?.data
  );
  if (!out) {
    const txt = (j?.candidates?.[0]?.content?.parts || []).find((p: any) => p.text)?.text;
    throw new Error(`nano-banana não retornou imagem${txt ? `: ${String(txt).slice(0, 200)}` : ""}`);
  }
  return {
    b64: out.inlineData?.data || out.inline_data?.data,
    mime: out.inlineData?.mimeType || out.inline_data?.mime_type || "image/png",
  };
}

/** Fallback legado: serviço de imagem do Forge (Manus). */
async function generateViaForge(options: GenerateImageOptions): Promise<RawImage> {
  const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
  const fullUrl = new URL("images.v1.ImageService/GenerateImage", baseUrl).toString();
  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify({ prompt: options.prompt, original_images: options.originalImages || [] }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Forge image falhou (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
  }
  const result = (await response.json()) as { image: { b64Json: string; mimeType: string } };
  return { b64: result.image.b64Json, mime: result.image.mimeType };
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  let img: RawImage;
  if (ENV.geminiApiKey) {
    img = await generateViaGemini(options);
  } else if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    img = await generateViaForge(options);
  } else {
    throw new Error("Nenhum provedor de imagem configurado (defina GEMINI_API_KEY no .env)");
  }

  const ext = img.mime.includes("jpeg") || img.mime.includes("jpg") ? "jpg" : "png";
  const { url } = await storagePut(`generated/${Date.now()}.${ext}`, Buffer.from(img.b64, "base64"), img.mime);
  return { url };
}
