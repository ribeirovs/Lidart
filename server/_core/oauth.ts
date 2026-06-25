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
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  // Local developer login backdoor
  app.get("/api/auth/dev-login", async (req: Request, res: Response) => {
    try {
      const devOpenId = ENV.ownerOpenId || "dev-user";
      
      // Ensure user exists in database
      await db.upsertUser({
        openId: devOpenId,
        name: "Desenvolvedor Local",
        email: "dev@planner.local",
        loginMethod: "dev",
        role: "admin",
        lastSignedIn: new Date(),
      });

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
