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

const IMG_RE = /\.(png|jpe?g|webp)$/i;

/**
 * Carrega o inventário de fotos. Duas fontes (o manifest é OPCIONAL):
 *  1) `inventory.json` — entradas curadas (formato/praça/labels) p/ casamento por formato.
 *  2) Auto: qualquer imagem na pasta entra como entrada nomeada pelo arquivo. Como o nome
 *     do arquivo é o mesmo da coluna "IMAGEM DO PRODUTO" da tabela, basta jogar as fotos na
 *     pasta que o casamento exato (item.imagem → arquivo) já funciona — sem precisar do manifest.
 */
export function loadInventory(dir = inventoryDir()): InventoryPhoto[] {
  try {
    const out: InventoryPhoto[] = [];
    const seen = new Set<string>();

    const manifest = path.join(dir, "inventory.json");
    if (fs.existsSync(manifest)) {
      const raw = JSON.parse(fs.readFileSync(manifest, "utf8"));
      const list: InventoryPhoto[] = Array.isArray(raw) ? raw : raw.fotos || [];
      for (const e of list) {
        if (e && e.formato && e.arquivo && fs.existsSync(path.join(dir, e.arquivo))) {
          out.push(e);
          seen.add(e.arquivo.toLowerCase());
        }
      }
    }

    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!IMG_RE.test(f) || seen.has(f.toLowerCase())) continue;
        out.push({ formato: f.replace(IMG_RE, ""), arquivo: f });
        seen.add(f.toLowerCase());
      }
    }
    return out;
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
/** Chave de arquivo: normaliza ignorando a extensão (casa .png com .jpg do mesmo ponto). */
const fileKey = (s: string) => norm((s || "").replace(IMG_RE, ""));

/**
 * Acha a melhor foto de inventário para um item do plano (ou null).
 * Prioridade: (1) casamento EXATO pelo nome do arquivo da coluna "IMAGEM DO PRODUTO"
 * (item.imagem) e, se não houver, (2) casamento aproximado pelo nome do formato.
 */
export function matchPhotoForItem(
  item: { nome?: string; vertical?: string; local?: string; cidade?: string; imagem?: string },
  inventory: InventoryPhoto[]
): InventoryPhoto | null {
  if (!inventory.length) return null;

  // (1) match exato pelo arquivo indicado na tabela de preços
  const want = fileKey(item.imagem || "");
  if (want) {
    const exact = inventory.find((p) => fileKey(p.arquivo) === want);
    if (exact) return exact;
  }

  // (2) fallback: aproximação pelo nome do formato
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
