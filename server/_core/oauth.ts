import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import express, { type Express, type Request, type Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { hashPassword, verifyPassword, isPasswordAcceptable } from "./password";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // (Removido) /api/oauth/callback — era a entrada do login OAuth do Manus.
  // O login agora é interno (e-mail+senha), abaixo.

  // Backdoor de bootstrap. GATEADO: só funciona em desenvolvimento OU se
  // ENABLE_DEV_LOGIN=true. Em produção (demo público) fica DESLIGADO — senão
  // qualquer um vira admin. Pra criar a senha do dono na 1ª vez no servidor de
  // produção, ligue ENABLE_DEV_LOGIN=true, faça o bootstrap, e desligue.
  const devLoginOn = process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_LOGIN === "true";
  app.get("/api/auth/dev-login", async (req: Request, res: Response) => {
    if (!devLoginOn) { res.status(404).send("Not found"); return; }
    try {
      const devOpenId = ENV.ownerOpenId || "dev-user";

      // NÃO sobrescrever e-mail/nome de um usuário que já existe (era o bug: o dev-login
      // trocava o e-mail real por dev@planner.local). Só cria os campos se for usuário novo.
      const existing = await db.getUserByOpenId(devOpenId);
      await db.upsertUser(existing
        ? { openId: devOpenId, role: "admin", lastSignedIn: new Date() }
        : { openId: devOpenId, name: "Desenvolvedor Local", email: "dev@planner.local", loginMethod: "dev", role: "admin", lastSignedIn: new Date() });

      const sessionToken = await sdk.createSessionToken(devOpenId, {
        name: "Desenvolvedor Local",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[DevAuth] Failed", error);
      res.status(500).send("Dev login failed");
    }
  });

  // ── Login INTERNO (e-mail + senha) — substitui o login do Manus ──────────────
  const jsonBody = express.json();

  app.post("/api/auth/login", jsonBody, async (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "");
      if (!email || !password) { res.status(400).json({ error: "Informe e-mail e senha." }); return; }
      const user = await db.getUserByEmail(email);
      // verifica sempre (mesmo sem user) p/ tempo ~constante; nunca revela qual campo falhou
      const ok = verifyPassword(password, user?.passwordHash ?? "scrypt$00$00");
      if (!user || !user.passwordHash || !ok) { res.status(401).json({ error: "E-mail ou senha inválidos." }); return; }
      const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name || email, expiresInMs: ONE_YEAR_MS });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      res.json({ success: true, name: user.name, role: user.role });
    } catch (error) {
      console.error("[Auth] login falhou", error);
      res.status(500).json({ error: "Falha no login." });
    }
  });

  // ── Link de recuperação de emergência ─────────────────────────────────────────
  // Acesse: /api/auth/recovery?secret=<JWT_SECRET>
  // O JWT_SECRET está visível nas variáveis de ambiente do Railway.
  // Gera uma sessão de admin sem precisar de senha. Mude sua senha depois.
  app.get("/api/auth/recovery", async (req: Request, res: Response) => {
    try {
      const secret = getQueryParam(req, "secret");
      if (!secret || secret !== ENV.cookieSecret) {
        res.status(403).send("Segredo inválido.");
        return;
      }
      const user = await db.getUserByOpenId(ENV.ownerOpenId || "");
      if (!user) { res.status(404).send("Usuário não encontrado."); return; }
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || user.email || "Admin",
        expiresInMs: ONE_YEAR_MS,
      });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[Auth] recovery falhou", error);
      res.status(500).send("Falha na recuperação.");
    }
  });

  // Define a própria senha (precisa estar logado — ex.: entrou pelo dev-login).
  app.post("/api/auth/set-password", jsonBody, async (req: Request, res: Response) => {
    try {
      const session = await sdk.verifySession(parseCookieHeader(req.headers.cookie || "")[COOKIE_NAME]);
      if (!session) { res.status(401).json({ error: "Faça login primeiro." }); return; }
      const newPassword = String(req.body?.newPassword ?? "");
      if (!isPasswordAcceptable(newPassword)) { res.status(400).json({ error: "A senha precisa ter ao menos 8 caracteres." }); return; }
      const user = await db.getUserByOpenId(session.openId);
      if (!user) { res.status(404).json({ error: "Usuário não encontrado." }); return; }
      await db.setUserPassword(user.id, hashPassword(newPassword));
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] set-password falhou", error);
      res.status(500).json({ error: "Falha ao definir a senha." });
    }
  });
}
