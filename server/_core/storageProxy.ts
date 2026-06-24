import type { Express } from "express";
import fs from "fs";
import { storageLocalPath } from "../storage";

// Serve os arquivos do storage LOCAL (migração: não redireciona mais p/ o Forge/Manus).
export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    let full: string;
    try {
      full = storageLocalPath(key);
    } catch {
      res.status(400).send("Invalid storage key");
      return;
    }
    if (!fs.existsSync(full)) {
      res.status(404).send("Not found");
      return;
    }
    res.set("Cache-Control", "no-store");
    res.sendFile(full, (err) => {
      if (err && !res.headersSent) res.status(500).send("Storage read error");
    });
  });
}
