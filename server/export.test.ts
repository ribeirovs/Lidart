import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId: number = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `test${userId}@example.com`,
    name: `Test User ${userId}`,
    loginMethod: "test",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("export functionality", () => {
  describe("exportPDF", () => {
    it("should export proposal to PDF", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // First create a proposal
      const createResult = await caller.proposals.create({
        clientName: "Test Client",
        clientCompany: "Test Company",
        projectScope: "Test Scope",
        values: "R$ 5.000",
        proposalContent: "# Test Proposal\n\nThis is a test proposal.",
      });

      if (!createResult || !createResult.id) {
        throw new Error("Failed to create proposal");
      }

      // Then export it to PDF
      const exportResult = await caller.proposals.exportPDF({
        id: createResult.id,
      });

      expect(exportResult).toHaveProperty("success");
      expect(exportResult.success).toBe(true);
      expect(exportResult).toHaveProperty("url");
      expect(exportResult).toHaveProperty("key");
      expect(exportResult).toHaveProperty("filename");
      expect(exportResult.filename).toContain(".pdf");
    }, { timeout: 15000 });
  });

  describe("exportText", () => {
    it("should export proposal to text", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // First create a proposal
      const createResult = await caller.proposals.create({
        clientName: "Text Export Test",
        clientCompany: "Test Company",
        projectScope: "Test Scope",
        values: "R$ 5.000",
        proposalContent: "# Test Proposal\n\nThis is a test proposal.",
      });

      if (!createResult || !createResult.id) {
        throw new Error("Failed to create proposal");
      }

      // Then export it to text
      const exportResult = await caller.proposals.exportText({
        id: createResult.id,
      });

      expect(exportResult).toHaveProperty("success");
      expect(exportResult.success).toBe(true);
      expect(exportResult).toHaveProperty("url");
      expect(exportResult).toHaveProperty("key");
      expect(exportResult).toHaveProperty("filename");
      expect(exportResult.filename).toContain(".txt");
    }, { timeout: 15000 });
  });
});
