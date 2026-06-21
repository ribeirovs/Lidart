/**
 * ============================================================
 * BACKUP AUTOMÁTICO DE PROPOSTAS
 * ============================================================
 * Garantia de que nenhuma proposta se perde:
 *  1. Backup completo (propostas + briefings) na inicialização
 *     do servidor e a cada 6 horas.
 *  2. Cofre de exclusões: antes de apagar qualquer proposta,
 *     uma cópia integral é salva em backups/excluidas/.
 * Os arquivos ficam em <projeto>/backups/ (JSON legível).
 * ============================================================
 */

import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { proposals, briefings } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const BACKUP_DIR = path.join(process.cwd(), "backups");
const AUTO_DIR = path.join(BACKUP_DIR, "auto");
const DELETED_DIR = path.join(BACKUP_DIR, "excluidas");
const MAX_AUTO_BACKUPS = 48; // ~12 dias de histórico a 4 backups/dia

function ensureDirs() {
  for (const d of [BACKUP_DIR, AUTO_DIR, DELETED_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Backup completo de propostas + briefings em um arquivo JSON. */
export async function backupAllProposals(reason: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const allProposals = await db.select().from(proposals);
    const allBriefings = await db.select().from(briefings);
    if (allProposals.length === 0 && allBriefings.length === 0) {
      // Nada a salvar — não cria arquivo vazio (evita confundir o histórico)
      console.log(`[Backup] (${reason}) banco sem propostas — nada a copiar.`);
      return;
    }
    ensureDirs();
    const file = path.join(AUTO_DIR, `backup-${ts()}-${reason}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ geradoEm: new Date().toISOString(), reason, proposals: allProposals, briefings: allBriefings }, null, 2),
      "utf-8"
    );
    console.log(`[Backup] (${reason}) ${allProposals.length} propostas + ${allBriefings.length} briefings salvos em ${path.relative(process.cwd(), file)}`);

    // Mantém só os mais recentes
    const files = fs.readdirSync(AUTO_DIR).filter((f) => f.endsWith(".json")).sort();
    while (files.length > MAX_AUTO_BACKUPS) {
      const oldest = files.shift()!;
      fs.unlinkSync(path.join(AUTO_DIR, oldest));
    }
  } catch (err) {
    console.error("[Backup] Falha no backup automático:", err);
  }
}

/** Cofre: salva a proposta (e briefing) ANTES de ela ser apagada. */
export async function backupProposalBeforeDelete(id: number, userId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const rows = await db.select().from(proposals).where(eq(proposals.id, id));
    if (rows.length === 0) return;
    const briefingRows = await db.select().from(briefings).where(eq(briefings.proposalId, id));
    ensureDirs();
    const file = path.join(DELETED_DIR, `proposta-${id}-${ts()}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ apagadaEm: new Date().toISOString(), porUsuario: userId, proposal: rows[0], briefings: briefingRows }, null, 2),
      "utf-8"
    );
    console.warn(`[Backup] Cópia de segurança da proposta #${id} salva em ${path.relative(process.cwd(), file)} antes da exclusão.`);
  } catch (err) {
    console.error(`[Backup] Falha ao copiar proposta #${id} antes da exclusão:`, err);
  }
}

/** Agenda: backup na subida + a cada 6 horas. Chamar uma vez no boot do servidor. */
export function scheduleAutomaticBackups(): void {
  // backup inicial (não bloqueia o boot)
  setTimeout(() => { void backupAllProposals("boot"); }, 5_000);
  setInterval(() => { void backupAllProposals("periodico"); }, 6 * 60 * 60 * 1000);
}
