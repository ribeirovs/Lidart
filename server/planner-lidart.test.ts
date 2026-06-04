import { describe, expect, it, beforeEach, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-planner",
    email: "planner@test.com",
    name: "Test Planner",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

describe("Planner Lídart - Briefings", () => {
  it("should create a briefing successfully", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const briefingData = {
      clientName: `Empresa XYZ ${Date.now()}`,
      segment: "retail",
      cities: "São Paulo, Rio de Janeiro",
      campaignPeriod: "Janeiro a Março 2026",
      budget: "R$ 50.000",
      objective: "Aumentar awareness da marca",
      contactName: "João Silva",
      contactEmail: `joao-${Date.now()}@empresa.com`,
    };

    const result = await caller.briefings.create(briefingData);
    
    expect(result).toBeDefined();
    expect(result.userId).toBe(ctx.user.id);
    expect(result.clientName).toBe(briefingData.clientName);
    expect(result.segment).toBe(briefingData.segment);
  });

  it("should list briefings for authenticated user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a briefing first
    const briefingData = {
      clientName: `Test Client ${Date.now()}`,
      segment: "technology",
      cities: "São Paulo",
      campaignPeriod: "Fevereiro 2026",
      budget: "R$ 100.000",
      objective: "Lançar novo produto",
      contactName: "Maria Santos",
      contactEmail: `maria-${Date.now()}@test.com`,
    };

    const created = await caller.briefings.create(briefingData);

    // List briefings
    const briefings = await caller.briefings.list();
    
    expect(Array.isArray(briefings)).toBe(true);
    expect(briefings.length).toBeGreaterThan(0);
    const found = briefings.find(b => b.id === created.id);
    expect(found?.clientName).toBe(briefingData.clientName);
  });

  it("should validate email format in briefing", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const invalidBriefing = {
      clientName: `Test ${Date.now()}`,
      segment: "retail",
      cities: "São Paulo",
      campaignPeriod: "Janeiro 2026",
      budget: "R$ 50.000",
      objective: "Test",
      contactName: "Test",
      contactEmail: "invalid-email", // Invalid email
    };

    try {
      await caller.briefings.create(invalidBriefing as any);
      expect.fail("Should have thrown validation error");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });}
});

describe("Planner Lídart - Resources", () => {
  it("should create a resource successfully", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const resourceData = {
      name: `Tabela de Preços ${Date.now()}`,
      type: "pricing" as const,
      description: "Tabela de preços atualizada",
      fileUrl: `/manus-storage/pricing-${Date.now()}.xlsx`,
      fileKey: `pricing-${Date.now()}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    const result = await caller.resources.upload(resourceData);
    
    expect(result).toBeDefined();
    expect(result.userId).toBe(ctx.user.id);
    expect(result.name).toBe(resourceData.name);
    expect(result.type).toBe(resourceData.type);
  });

  it("should list resources for authenticated user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a resource first
    const resourceData = {
      name: `Inventário OOH ${Date.now()}`,
      type: "inventory" as const,
      description: "Inventário de mídia OOH",
      fileUrl: `/manus-storage/inventory-${Date.now()}.xlsx`,
      fileKey: `inventory-${Date.now()}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    const created = await caller.resources.upload(resourceData);

    // List resources
    const resources = await caller.resources.list();
    
    expect(Array.isArray(resources)).toBe(true);
    expect(resources.length).toBeGreaterThan(0);
    const found = resources.find(r => r.id === created.id);
    expect(found?.name).toBe(resourceData.name);
  });

  it("should delete a resource", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a resource first
    const resourceData = {
      name: `Conteúdo Produto ${Date.now()}`,
      type: "product_content" as const,
      description: "Conteúdo do produto",
      fileUrl: `/manus-storage/content-${Date.now()}.pdf`,
      fileKey: `content-${Date.now()}.pdf`,
      mimeType: "application/pdf",
    };

    const created = await caller.resources.upload(resourceData);
    
    // Delete it
    const deleted = await caller.resources.delete({ id: created.id });
    
    expect(deleted).toBe(true);
  });

  it("should support different resource types", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const resourceTypes = ["inventory", "pricing", "product_content", "market_data"] as const;

    for (const type of resourceTypes) {
      const resourceData = {
        name: `Resource ${type} ${Date.now()}`,
        type,
        description: `Test resource of type ${type}`,
        fileUrl: `/manus-storage/${type}-${Date.now()}.xlsx`,
        fileKey: `${type}-${Date.now()}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };

      const result = await caller.resources.upload(resourceData);
      
      expect(result.type).toBe(type);
    }
  });
});

describe("Planner Lídart - Integration", () => {
  it("should allow creating briefing and resources for same user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a briefing
    const briefingData = {
      clientName: `Integration Test Client ${Date.now()}`,
      segment: "automotive",
      cities: "Brasília",
      campaignPeriod: "Março 2026",
      budget: "R$ 75.000",
      objective: "Lançamento de modelo",
      contactName: "Carlos Oliveira",
      contactEmail: `carlos-${Date.now()}@auto.com`,
    };

    const briefing = await caller.briefings.create(briefingData);

    // Create resources
    const resourceData = {
      name: `Dados de Mercado Automotivo ${Date.now()}`,
      type: "market_data" as const,
      description: "Análise de mercado",
      fileUrl: `/manus-storage/market-auto-${Date.now()}.pdf`,
      fileKey: `market-auto-${Date.now()}.pdf`,
      mimeType: "application/pdf",
    };

    const resource = await caller.resources.upload(resourceData);

    // Verify both exist
    expect(briefing).toBeDefined();
    expect(resource).toBeDefined();
    expect(briefing.clientName).toBe(briefingData.clientName);
    expect(resource.name).toBe(resourceData.name);
  });
});
