/**
 * Inventário de fotos dos pontos de mídia da Kallas (para mockup).
 *
 * Convenção: uma pasta com as fotos + um manifest `inventory.json`.
 * Cada entrada associa uma FOTO real de um ponto/formato a um nome de formato
 * (que casa com o formato do plano validado). Quando as fotos chegarem, basta
 * colocá-las na pasta e preencher o manifest — o resto do código já está pronto.
 *
 * Pasta padrão: <projeto>/mockup_inventory  (override por MOCKUP_INVENTORY_DIR)
 */
import fs from "fs";
import path from "path";

export type InventoryPhoto = {
  /** Nome do formato — deve casar com o formato do plano (ex.: "Big Mupi Digital", "Painel de LED Desembarque"). */
  formato: string;
  /** Praça opcional, para desempatar quando o mesmo formato existe em várias cidades (ex.: "São Paulo"). */
  praca?: string;
  /** Nome do arquivo da foto dentro da pasta de inventário (ex.: "big-mupi-santo-andre.jpg"). */
  arquivo: string;
  /** Rótulos para a legenda do slide (se ausentes, usa formato/praça). */
  formatoLabel?: string;
  localLabel?: string;
};

export function inventoryDir(): string {
  return process.env.MOCKUP_INVENTORY_DIR || path.join(process.cwd(), "mockup_inventory");
}

export function loadInventory(dir = inventoryDir()): InventoryPhoto[] {
  try {
    const manifest = path.join(dir, "inventory.json");
    if (!fs.existsSync(manifest)) return [];
    const raw = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const list: InventoryPhoto[] = Array.isArray(raw) ? raw : raw.fotos || [];
    // só mantém entradas cujo arquivo existe de fato
    return list.filter((e) => e && e.formato && e.arquivo && fs.existsSync(path.join(dir, e.arquivo)));
  } catch {
    return [];
  }
}

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const cidadeBase = (s: string) => norm(s).split(/ e | rm|\//)[0].trim();

/** Acha a melhor foto de inventário para um item do plano (ou null). */
export function matchPhotoForItem(
  item: { nome?: string; vertical?: string; local?: string; cidade?: string },
  inventory: InventoryPhoto[]
): InventoryPhoto | null {
  if (!inventory.length) return null;
  const itemTxt = norm(`${item.nome || ""} ${item.vertical || ""} ${item.local || ""}`);
  const itemTokens = new Set(itemTxt.split(" ").filter((t) => t.length > 2));
  const itemCidade = cidadeBase(item.cidade || "");

  let best: { photo: InventoryPhoto; score: number } | null = null;
  for (const photo of inventory) {
    const fmtTokens = norm(photo.formato).split(" ").filter((t) => t.length > 2);
    if (!fmtTokens.length) continue;
    const hits = fmtTokens.filter((t) => itemTokens.has(t)).length;
    let score = hits / fmtTokens.length; // fração do nome do formato que bate
    if (score < 0.6) continue; // precisa casar a maioria dos tokens do formato
    // bônus se a praça também casa (desempata mesmo formato em cidades diferentes)
    if (photo.praca && itemCidade && cidadeBase(photo.praca) === itemCidade) score += 0.5;
    if (!best || score > best.score) best = { photo, score };
  }
  return best ? best.photo : null;
}

export const _internal = { norm, cidadeBase };
