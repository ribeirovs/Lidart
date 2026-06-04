import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createProposal, deleteProposal, getProposalById, getProposalsByUserId, updateProposal } from "./db";
import { invokeLLM } from "./_core/llm";
import { exportProposalToPDF, exportProposalToText } from "./proposal-export";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  proposals: router({
    create: protectedProcedure
      .input(
        z.object({
          clientName: z.string().min(1),
          clientCompany: z.string().min(1),
          clientContact: z.string().optional(),
          projectScope: z.string().min(1),
          values: z.string().min(1),
          deadline: z.string().optional(),
          commercialTerms: z.string().optional(),
          proposalContent: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await createProposal({
          userId: ctx.user.id,
          ...input,
        });
        return result;
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const proposals = await getProposalsByUserId(ctx.user.id);
      return proposals;
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        return proposal;
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          clientName: z.string().optional(),
          clientCompany: z.string().optional(),
          clientContact: z.string().optional(),
          projectScope: z.string().optional(),
          values: z.string().optional(),
          deadline: z.string().optional(),
          commercialTerms: z.string().optional(),
          proposalContent: z.string().optional(),
          status: z.enum(["draft", "sent", "accepted", "rejected", "archived"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateProposal(id, ctx.user.id, data);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteProposal(input.id, ctx.user.id);
        return { success: true };
      }),

    generate: protectedProcedure
      .input(
        z.object({
          clientName: z.string().min(1),
          clientCompany: z.string().min(1),
          projectScope: z.string().min(1),
          values: z.string().min(1),
          deadline: z.string().optional(),
          commercialTerms: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const systemPrompt = `Você é um especialista em propostas comerciais profissionais. Sua tarefa é gerar uma proposta comercial elegante, bem estruturada e persuasiva em português.

A proposta deve incluir:
1. Cabeçalho com dados do cliente
2. Sumário executivo
3. Escopo do projeto
4. Metodologia
5. Timeline e prazos
6. Investimento e condições comerciais
7. Termos e condições
8. Próximos passos

Formate a resposta em Markdown com estrutura clara e profissional.`;

        const userPrompt = `Gere uma proposta comercial para:

Cliente: ${input.clientName}
Empresa: ${input.clientCompany}
Escopo do Projeto: ${input.projectScope}
Valores: ${input.values}
${input.deadline ? `Prazo: ${input.deadline}` : ""}
${input.commercialTerms ? `Condições Comerciais: ${input.commercialTerms}` : ""}

Gere uma proposta profissional, elegante e persuasiva em Markdown.`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });

        const content = response.choices[0]?.message.content;
        if (!content) {
          throw new Error("Failed to generate proposal");
        }

        return { proposalContent: content };
      }),

    exportPDF: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }

        const { url, key } = await exportProposalToPDF(proposal);
        return {
          success: true,
          url,
          key,
          filename: `proposta_${proposal.clientName.replace(/\s+/g, "_")}.pdf`,
        };
      }),

    exportText: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const proposal = await getProposalById(input.id, ctx.user.id);
        if (!proposal) {
          throw new Error("Proposal not found");
        }

        const { url, key } = await exportProposalToText(proposal);
        return {
          success: true,
          url,
          key,
          filename: `proposta_${proposal.clientName.replace(/\s+/g, "_")}.txt`,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
