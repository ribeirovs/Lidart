// Storage LOCAL (migração: tirou a dependência do Forge/Manus, que passou a dar 403).
// Grava os arquivos em <projeto>/local_storage e serve por /manus-storage/{key}
// (mesma URL de antes — frontend e proxy seguem iguais). Para mover p/ S3/R2 depois,
// basta reimplementar put/get/getSignedUrl mantendo o contrato { key, url }.

import fs from "fs";
import path from "path";
import crypto from "crypto";

const STORAGE_DIR =
  process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), "local_storage");
const PORT = process.env.PORT || "3200";
// URL absoluta p/ fetch server-side (ex.: loadFullCatalog) bater no próprio servidor.
const SELF_BASE = process.env.SELF_BASE_URL || `http://127.0.0.1:${PORT}`;

function normalizeKey(relKey: string): string {
  return relKey
    .replace(/^\/+/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-\.\/]/g, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

/** Caminho absoluto seguro dentro de STORAGE_DIR (bloqueia path traversal). */
export function storageLocalPath(key: string): string {
  const safe = normalizeKey(key).replace(/\.\.(\/|\\|$)/g, "");
  const full = path.resolve(STORAGE_DIR, safe);
  if (!full.startsWith(path.resolve(STORAGE_DIR))) {
    throw new Error("Invalid storage key");
  }
  return full;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const full = storageLocalPath(key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data as any);
  fs.writeFileSync(full, buf);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

/** URL absoluta servida pelo próprio servidor (p/ fetch interno funcionar). */
export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  return `${SELF_BASE}/manus-storage/${key}`;
}

/** Lê os bytes do arquivo direto do disco (sem round-trip HTTP). null se não existir. */
export async function storageReadBuffer(relKey: string): Promise<Buffer | null> {
  try {
    const full = storageLocalPath(relKey);
    return fs.existsSync(full) ? fs.readFileSync(full) : null;
  } catch {
    return null;
  }
}
