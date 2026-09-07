import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { randomUUID } from "node:crypto";
import { runWithAiSession } from "./amplitude-ai";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

/**
 * Abre o escopo de sessão do Amplitude Agent Analytics em volta de cada chamada.
 * Qualquer invokeLLM disparado dentro do procedure herda userId e sessionId daqui,
 * então os turnos de uma mesma requisição aparecem agrupados no dashboard em vez
 * de virarem sessões soltas.
 */
const withAiSession = t.middleware(async ({ ctx, next }) =>
  runWithAiSession(
    {
      userId: ctx.user ? String(ctx.user.id) : undefined,
      sessionId: `req-${randomUUID()}`,
    },
    () => next(),
  ),
);

export const publicProcedure = t.procedure.use(withAiSession);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(withAiSession).use(requireUser);

export const adminProcedure = t.procedure.use(withAiSession).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
