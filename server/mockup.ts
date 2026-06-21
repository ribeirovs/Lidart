/**
 * Engine de MOCKUP — aplica a campanha do cliente nas fotos reais dos pontos de mídia Kallas,
 * via nano-banana (Gemini Flash Image). Generalização do teste provado na Johnson's.
 *
 * Fluxo automático no deck: para cada item do plano com foto de inventário,
 *   foto real + prompt da campanha  ->  nano-banana  ->  imagem do mockup (b64)  ->  slide.
 *
 * Trabalha em base64 (não depende do storage/Forge): o resultado é embutido direto no .pptx.
 */
import fs from "fs";
import path from "path";
import { ENV } from "./_core/env";
import type { PlanoResolvido } from "./valuation-builder";
import { inventoryDir, loadInventory, matchPhotoForItem, type InventoryPhoto } from "./mockup-inventory";

export type MockupCriativo = {
  /** Marca do cliente, ex.: "Johnson's Baby". */
  marca: string;
  /** Mote/headline da campanha (vem do conceito da proposta), ex.: "Cuidado suave desde o primeiro dia". */
  mote?: string;
  /** Descrição opcional da arte (cores, elementos). Se ausente, é derivada da marca + mote. */
  descricaoArte?: string;
};

export type MockupSlide = { b64: string; mime: string; formato: string; local: string };

/** Monta o prompt de troca de anúncio (generalizado do teste Johnson's). */
export function buildMockupPrompt(formato: string, local: string, c: MockupCriativo): string {
  const criativo =
    c.descricaoArte ||
    `um anúncio publicitário fotorrealista, limpo e profissional da marca ${c.marca}` +
      (c.mote ? `, com o título "${c.mote}"` : "") +
      `, com o logotipo da ${c.marca} bem legível e identidade visual coerente da marca`;
  return (
    `Edite esta foto real de um ponto de mídia OOH (${formato}, em ${local}). ` +
    `TROQUE APENAS o anúncio exibido na tela/painel: remova o anúncio atual (seja qual for a marca) e coloque ${criativo}, ` +
    `adaptado ao formato e à orientação da tela. Mantenha EXATAMENTE iguais a moldura, o formato e a posição da tela, ` +
    `o ângulo e a perspectiva, a iluminação e os reflexos, e TODO o entorno (pessoas, carros, prédios, céu, piso, vegetação, placas). ` +
    `O resultado deve parecer uma fotografia real do mesmo ponto exibindo o novo anúncio da ${c.marca}. ` +
    `Não adicione bordas, molduras nem texto fora da tela.`
  );
}

/** Chama o nano-banana com a foto + prompt e devolve a imagem gerada (b64). */
export async function swapAdOnPhoto(photoB64: string, photoMime: string, prompt: string): Promise<{ b64: string; mime: string }> {
  if (!ENV.geminiApiKey) throw new Error("GEMINI_API_KEY não configurada");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${ENV.geminiImageModel}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": ENV.geminiApiKey, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: photoMime, data: photoB64 } }, { text: prompt }] }] }),
  });
  if (!r.ok) throw new Error(`nano-banana ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j: any = await r.json();
  const out = (j?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data || p.inline_data?.data);
  if (!out) throw new Error("nano-banana não retornou imagem");
  return { b64: out.inlineData?.data || out.inline_data?.data, mime: out.inlineData?.mimeType || out.inline_data?.mime_type || "image/png" };
}

function mimeFromExt(file: string): string {
  return /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
}

/**
 * Gera os slides de mockup para um plano: para cada item com foto de inventário,
 * compõe a campanha do cliente e devolve {b64, formato, local}. Limitado a `max`
 * para controlar custo. Falha de um item não derruba os outros.
 */
export async function generateMockupSlides(
  plano: PlanoResolvido,
  criativo: MockupCriativo,
  opts?: { max?: number; dir?: string; inventory?: InventoryPhoto[] }
): Promise<MockupSlide[]> {
  const dir = opts?.dir || inventoryDir();
  const inventory = opts?.inventory || loadInventory(dir);
  if (!inventory.length || plano.vazio) return [];

  const max = opts?.max ?? 6;
  // 1 item por praça primeiro (variedade), depois completa
  const itens: Array<{ it: any; cidade: string }> = [];
  for (const g of plano.porPraca) for (const it of g.itens) itens.push({ it, cidade: g.praca });

  const escolhidos: Array<{ photo: InventoryPhoto; formato: string; local: string }> = [];
  const usados = new Set<string>();
  for (const { it, cidade } of itens) {
    if (escolhidos.length >= max) break;
    const photo = matchPhotoForItem({ ...it, cidade }, inventory);
    if (!photo || usados.has(photo.arquivo)) continue;
    usados.add(photo.arquivo);
    // Rótulos do slide: prioriza o item do plano (nome/cidade·UF); usa os labels curados
    // do manifest quando existirem.
    const localPlano = `${cidade}${it.uf ? ` · ${it.uf}` : ""}`;
    escolhidos.push({
      photo,
      formato: photo.formatoLabel || it.nome || photo.formato,
      local: photo.localLabel || localPlano,
    });
  }

  const out: MockupSlide[] = [];
  for (const e of escolhidos) {
    try {
      const buf = fs.readFileSync(path.join(dir, e.photo.arquivo));
      const mime = mimeFromExt(e.photo.arquivo);
      const prompt = buildMockupPrompt(e.formato, e.local, criativo);
      const res = await swapAdOnPhoto(buf.toString("base64"), mime, prompt);
      out.push({ b64: res.b64, mime: res.mime, formato: e.formato, local: e.local });
    } catch {
      // pula este item; não derruba o deck
    }
  }
  return out;
}
