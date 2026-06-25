import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, mediumtext } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  /** Hash scrypt da senha (login interno e-mail+senha). Null = usuário sem senha local (ex.: legado Manus). */
  passwordHash: text("passwordHash"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Proposals table for storing commercial proposals
 */
export const proposals = mysqlTable("proposals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  clientCompany: varchar("clientCompany", { length: 255 }).notNull(),
  clientContact: varchar("clientContact", { length: 255 }),
  projectScope: text("projectScope").notNull(),
  values: varchar("values", { length: 255 }).notNull(),
  deadline: varchar("deadline", { length: 255 }),
  commercialTerms: text("commercialTerms"),
  proposalContent: mediumtext("proposalContent").notNull(),
  status: mysqlEnum("status", ["draft", "sent", "accepted", "rejected", "archived"]).default("draft").notNull(),
  currentStage: mysqlEnum("currentStage", [
    "briefing",
    "validation",
    "research",
    "inventory",
    "pricing",
    "product_content",
    "strategy_workshop",
    "idea_central",
    "idea_validation",
    "valuation",
    "valuation_validation",
    "proposal_final",
    "customization",
    "approval",
    "delivery"
  ]).default("briefing").notNull(),
  chatHistory: text("chatHistory"),
  generatedBy: varchar("generatedBy", { length: 50 }).default("ai"),
  mediaPlan: text("mediaPlan"), // Etapa 2: plano de mídia escolhido pelo planner (JSON de linhas selecionadas do catálogo)
  slideSelections: text("slideSelections"), // Preferências de slides liga/desliga geridas pelo chat (JSON: {"formatos":false,...}); precedência sobre os checkboxes da UI no export

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Proposal = typeof proposals.$inferSelect;
export type InsertProposal = typeof proposals.$inferInsert;

/**
 * Resources table for storing uploaded files (inventory, pricing, product content)
 */
export const resources = mysqlTable("resources", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["inventory", "pricing", "product_content", "market_data"]).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Resource = typeof resources.$inferSelect;
export type InsertResource = typeof resources.$inferInsert;

/**
 * Approvals table for tracking approval workflow
 */
export const approvals = mysqlTable("approvals", {
  id: int("id").autoincrement().primaryKey(),
  proposalId: int("proposalId").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  stage: mysqlEnum("stage", ["idea", "pricing", "final"]).notNull(),
  reviewerId: int("reviewerId").notNull().references(() => users.id),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  comments: text("comments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Approval = typeof approvals.$inferSelect;
export type InsertApproval = typeof approvals.$inferInsert;

/**
 * Briefing table for storing OOH campaign briefings
 */
export const briefings = mysqlTable("briefings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  proposalId: int("proposalId").references(() => proposals.id, { onDelete: "cascade" }),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  segment: varchar("segment", { length: 255 }).notNull(),
  cities: text("cities").notNull(),
  campaignPeriod: text("campaignPeriod").notNull(),
  budget: varchar("budget", { length: 255 }).notNull(),
  objective: text("objective").notNull(),
  targetAudience: text("targetAudience").notNull(),
  contactName: varchar("contactName", { length: 255 }).notNull(),
  contactEmail: varchar("contactEmail", { length: 320 }).notNull(),
  campaignName: varchar("campaignName", { length: 255 }),
  mediaSpecs: text("mediaSpecs"),
  locationSpecs: text("locationSpecs"),
  commercialTerms: text("commercialTerms"),
  moreDetails: text("moreDetails"),
  creativityLevel: mysqlEnum("creativityLevel", ["baixo", "medio", "alto"]).default("medio").notNull(),
  generatedBy: varchar("generatedBy", { length: 50 }).default("ai"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Briefing = typeof briefings.$inferSelect;
export type InsertBriefing = typeof briefings.$inferInsert;