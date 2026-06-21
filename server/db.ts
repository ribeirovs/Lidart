import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, InsertProposal, InsertResource, InsertApproval, InsertBriefing, proposals, users, resources, approvals, briefings } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createProposal(data: InsertProposal) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(proposals).values(data);
  // Get the inserted proposal
  const inserted = await db
    .select()
    .from(proposals)
    .where(eq(proposals.userId, data.userId))
    .orderBy(desc(proposals.createdAt))
    .limit(1);
  return inserted.length > 0 ? inserted[0] : null;
}

export async function getProposalsByUserId(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .select()
    .from(proposals)
    .where(eq(proposals.userId, userId))
    .orderBy(desc(proposals.createdAt));
  return result;
}

export async function getProposalById(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.userId, userId)))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateProposal(
  id: number,
  userId: number,
  data: Partial<Omit<InsertProposal, 'userId'>>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(proposals)
    .set(data)
    .where(and(eq(proposals.id, id), eq(proposals.userId, userId)));
}

export async function deleteProposal(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // COFRE: salva cópia integral da proposta ANTES de apagar — nada se perde
  const { backupProposalBeforeDelete } = await import("./backup");
  await backupProposalBeforeDelete(id, userId);
  // Auditoria: registra toda exclusão (console + arquivo) para rastrear perda de dados
  const auditMsg = `[AUDIT] deleteProposal: proposta #${id} apagada pelo usuário #${userId} em ${new Date().toISOString()}`;
  console.warn(auditMsg);
  try {
    const fsMod = await import("fs");
    fsMod.appendFileSync("delete-audit.log", auditMsg + "\n", "utf-8");
  } catch { /* log em arquivo é melhor-esforço */ }
  await db
    .delete(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.userId, userId)));
}

// Resources helpers
export async function createResource(resource: InsertResource) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(resources).values(resource);
  const created = await db.select().from(resources).where(eq(resources.userId, resource.userId)).orderBy(desc(resources.id)).limit(1);
  return created[0];
}

export async function getResourcesByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(resources).where(eq(resources.userId, userId));
}

export async function deleteResource(id: number) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(resources).where(eq(resources.id, id));
  return true;
}

// Approvals helpers
export async function createApproval(approval: InsertApproval) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(approvals).values(approval);
}

export async function getApprovalsByProposalId(proposalId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(approvals).where(eq(approvals.proposalId, proposalId));
}

export async function updateApprovalStatus(id: number, status: string, comments?: string) {
  const db = await getDb();
  if (!db) return false;
  await db.update(approvals).set({ status: status as any, comments }).where(eq(approvals.id, id));
  return true;
}

// Briefings helpers
export async function createBriefing(briefing: InsertBriefing) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(briefings).values(briefing);
  const created = await db.select().from(briefings).where(eq(briefings.userId, briefing.userId)).orderBy(desc(briefings.id)).limit(1);
  return created[0];
}

export async function getBriefingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(briefings).where(eq(briefings.userId, userId));
}

export async function getBriefingById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(briefings).where(eq(briefings.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}
