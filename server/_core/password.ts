// Hash de senha com scrypt NATIVO do Node (sem dependência externa — importante p/ deploy).
// scrypt é memory-hard (resistente a brute force). Formato guardado: "scrypt$<salt>$<hash>".
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, PARAMS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  try {
    if (!stored) return false;
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, PARAMS);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Validação mínima de senha (ajustável). */
export function isPasswordAcceptable(p: string): boolean {
  return typeof p === "string" && p.length >= 8;
}
