import { describe, expect, it, beforeEach, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./_core/llm", () => {
  return {
    invokeLLM: vi.fn().mockImplementation(async (params) => {
      return {
        id: "mock-id",
        created: Date.now(),
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "# Mock Proposal\n\nThis is a mock proposal content generated in test.",
            },
            finish_reason: "stop",
          }
        ],
      };
    }),
  };
});

vi.mock("./resources-parser", () => {
  return {
    getParsedResourcesContext: vi.fn().mockResolvedValue(""),
  };
});

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

describe("proposals router", () => {
  describe("generate", () => {
    it("should generate a proposal with all fields", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.proposals.generate({
        clientName: "Acme Corp",
        clientCompany: "Acme Industries",
        projectScope: "Website development and maintenance",
        values: "R$ 10.000 - R$ 20.000",
        deadline: "30 days",
        commercialTerms: "50% upfront, 50% on delivery",
      });

      expect(result).toHaveProperty("proposalContent");
      expect(typeof result.proposalContent).toBe("string");
      expect(result.proposalContent.length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    it("should generate proposal without optional fields", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.proposals.generate({
        clientName: "Tech Startup",
        clientCompany: "TechCorp",
        projectScope: "Mobile app development",
        values: "R$ 50.000",
      });

      expect(result).toHaveProperty("proposalContent");
      expect(typeof result.proposalContent).toBe("string");
      expect(result.proposalContent.length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    it("should fail without required fields", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.proposals.generate({
          clientName: "",
          clientCompany: "Acme Industries",
          projectScope: "Website development",
          values: "R$ 10.000",
        });
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("create", () => {
    it("should create a proposal", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.proposals.create({
        clientName: "Test Client",
        clientCompany: "Test Company",
        projectScope: "Test Scope",
        values: "R$ 5.000",
        proposalContent: "# Test Proposal\n\nThis is a test proposal.",
      });

      expect(result).toBeDefined();
    });
  });

  describe("list", () => {
    it("should return list of proposals", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.proposals.list();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("auth", () => {
    it("should return current user info", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const user = await caller.auth.me();
      expect(user).toBeDefined();
      expect(user?.id).toBe(1);
      expect(user?.email).toBe("test1@example.com");
    });
  });
});
