import { describe, expect, it, beforeEach, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./_core/llm", () => {
  return {
    invokeLLM: vi.fn().mockImplementation(async (params) => {
      const prompt = params.messages.find((m: any) => m.role === "user")?.content || "";
      let content = "Mock LLM Response";
      if (prompt.includes("Ideia Central")) {
        content = "### Ideia Central da Campanha OOH\n- **Mote**: Conectando caminhos\n- **Conceito**: Mock Concept\n- **Ações**: Mock Action";
      } else if (prompt.includes("valoração")) {
        content = "### Plano de Custos e Valoração\n| Item | Descrição | Valor (Est.) |\n| --- | --- | --- |\n| Mídia OOH | Painéis | R$ 35.000 |";
      } else if (prompt.includes("Proposta Comercial")) {
        content = "# Proposta Comercial OOH - Mock Client\n\n## 1. Sumário Executivo\nMock Executive Summary.";
      }
      return {
        id: "mock-id",
        created: Date.now(),
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content,
            },
            finish_reason: "stop",
          }
        ],
      };
    }),
  };
});

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
      targetAudience: "Consumidores finais de varejo",
      contactName: "João Silva",
      contactEmail: `joao-${Date.now()}@empresa.com`,
    };

    const result = await caller.briefings.create(briefingData);
    
    expect(result).toBeDefined();
    expect(result.briefing.userId).toBe(ctx.user.id);
    expect(result.briefing.clientName).toBe(briefingData.clientName);
    expect(result.briefing.segment).toBe(briefingData.segment);
  }, 25000);

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
      targetAudience: "Usuários de tecnologia e desenvolvedores",
      contactName: "Maria Santos",
      contactEmail: `maria-${Date.now()}@test.com`,
    };

    const created = await caller.briefings.create(briefingData);

    // List briefings
    const briefings = await caller.briefings.list();
    
    expect(Array.isArray(briefings)).toBe(true);
    expect(briefings.length).toBeGreaterThan(0);
    const found = briefings.find(b => b.id === created.briefing.id);
    expect(found?.clientName).toBe(briefingData.clientName);
  }, 25000);

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
      targetAudience: "Test",
      contactName: "Test",
      contactEmail: "invalid-email", // Invalid email
    };

    try {
      await caller.briefings.create(invalidBriefing as any);
      expect.fail("Should have thrown validation error");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
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
      targetAudience: "Compradores de carros novos",
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
    expect(briefing.briefing.clientName).toBe(briefingData.clientName);
    expect(resource.name).toBe(resourceData.name);
  }, 25000);

  it("should transition proposal through the 14 stages", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // 1. Submit briefing (transitions automated stage: briefing -> validation -> research -> inventory)
    const briefingData = {
      clientName: `Test Client Stage ${Date.now()}`,
      segment: "finance",
      cities: "Belo Horizonte",
      campaignPeriod: "Março 2026",
      budget: "R$ 150.000",
      objective: "Rebranding corporativo",
      targetAudience: "Investidores e clientes premium",
      contactName: "Ana Souza",
      contactEmail: `ana-${Date.now()}@finance.com`,
    };

    const result = await caller.briefings.create(briefingData);
    expect(result.stage).toBe("inventory");
    
    const proposalId = result.proposalId;
    let proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("inventory");

    // 2. Advance from inventory stage (requires manual trigger in detail page, which calls advanceFromUploads)
    const res1 = await caller.proposals.advanceFromUploads({ id: proposalId });
    expect(res1.nextStage).toBe("idea_central");
    
    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("idea_central");

    // 3. Generate Idea Central (calls generateStageContent)
    const res2 = await caller.proposals.generateStageContent({ id: proposalId, stageToGenerate: "idea_central" });
    expect(res2.nextStage).toBe("idea_validation");

    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("idea_validation");

    // 4. Human validation of Idea Central (calls validateIdea)
    const res3 = await caller.proposals.validateIdea({ id: proposalId });
    expect(res3.nextStage).toBe("valuation");

    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("valuation");

    // 5. Generate Valuation (calls generateStageContent)
    const res4 = await caller.proposals.generateStageContent({ id: proposalId, stageToGenerate: "valuation" });
    expect(res4.nextStage).toBe("valuation_validation");

    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("valuation_validation");

    // 6. Human validation of Valuation (calls validateValuation)
    const res5 = await caller.proposals.validateValuation({ id: proposalId });
    expect(res5.nextStage).toBe("proposal_final");

    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("proposal_final");

    // 7. Generate Final Proposal (calls generateStageContent)
    const res6 = await caller.proposals.generateStageContent({ id: proposalId, stageToGenerate: "proposal_final" });
    expect(res6.nextStage).toBe("customization");

    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("customization");

    // 7.5. Move stage to approval (simulates user completing customization stage)
    const resUpdate = await caller.proposals.update({ id: proposalId, currentStage: "approval" });
    expect(resUpdate.success).toBe(true);

    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("approval");

    // 8. Human final approval (calls approveFinal)
    const res7 = await caller.proposals.approveFinal({ id: proposalId });
    expect(res7.nextStage).toBe("delivery");

    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.currentStage).toBe("delivery");
    expect(proposal?.status).toBe("accepted");

    // 9. Deliver (calls deliver)
    const res8 = await caller.proposals.deliver({ id: proposalId });
    expect(res8.success).toBe(true);

    proposal = await caller.proposals.getById({ id: proposalId });
    expect(proposal?.status).toBe("sent");
  }, 40000);
});

describe("Planner Lídart - New Features", () => {
  it("should refine proposal content via AI chat", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const proposal = await caller.proposals.create({
      clientName: "Refine Test Client",
      clientCompany: "Tech Corp",
      projectScope: "OOH Ads",
      values: "R$ 40.000",
      proposalContent: "# Mídia OOH\n\nInitial Text.",
    });

    if (!proposal) throw new Error("Failed to create proposal");

    const result = await caller.proposals.refineContent({
      id: proposal.id,
      stage: "idea_central",
      instruction: "Adicione outdoors digitais como opção principal",
    });

    expect(result.success).toBe(true);
    expect(result.proposalContent).toBeDefined();
    expect(result.proposalContent).toContain("Mock LLM Response");
  });

  it("should export proposal to Excel", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const proposal = await caller.proposals.create({
      clientName: "Excel Test Client",
      clientCompany: "Excel Corp",
      projectScope: "OOH Ads",
      values: "R$ 40.000",
      proposalContent: "# Mídia OOH\n\nInitial Text.",
    });

    if (!proposal) throw new Error("Failed to create proposal");

    const result = await caller.proposals.exportExcel({
      id: proposal.id,
    });

    expect(result.success).toBe(true);
    expect(result.url).toBeDefined();
    expect(result.key).toBeDefined();
    expect(result.filename).toContain(".xlsx");
  }, 25000);

  it("should export proposal to PPTX with selections", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const proposal = await caller.proposals.create({
      clientName: "PPTX Test Client",
      clientCompany: "PPTX Corp",
      projectScope: "OOH Ads",
      values: "R$ 40.000",
      proposalContent: "# Mídia OOH\n\nInitial Text.",
    });

    if (!proposal) throw new Error("Failed to create proposal");

    const result = await caller.proposals.exportPPTX({
      id: proposal.id,
      selections: {
        capa: true,
        defesa: true,
        conceito: true,
      },
    });

    expect(result.success).toBe(true);
    expect(result.url).toBeDefined();
    expect(result.key).toBeDefined();
    expect(result.filename).toContain(".pptx");
  }, 25000);
});

