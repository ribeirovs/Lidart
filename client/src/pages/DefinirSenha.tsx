import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export default function DefinirSenha() {
  const [senha, setSenha] = useState("");
  const [conf, setConf] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (senha.length < 8) { setMsg({ ok: false, txt: "A senha precisa ter ao menos 8 caracteres." }); return; }
    if (senha !== conf) { setMsg({ ok: false, txt: "As senhas não conferem." }); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: senha }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, txt: data?.error || "Não foi possível salvar." }); setLoading(false); return; }
      setMsg({ ok: true, txt: "Senha definida! Agora você já pode entrar com e-mail e senha." });
    } catch {
      setMsg({ ok: false, txt: "Falha de conexão." });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "var(--cream, #FBF8F6)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "var(--primary, #E20613)" }}>Definir senha</h1>
          <p className="text-sm text-muted-foreground mt-1">Crie a sua senha de acesso</p>
        </div>
        <form onSubmit={salvar} className="bg-white/70 backdrop-blur rounded-xl border border-border/50 p-6 space-y-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Nova senha</label>
            <Input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="ao menos 8 caracteres" required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Confirmar senha</label>
            <Input type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} placeholder="repita a senha" required />
          </div>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.txt}</p>}
          <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
            {loading ? <Spinner className="w-4 h-4" /> : "Salvar senha"}
          </Button>
          {msg?.ok && <a href="/login" className="block text-center text-sm text-primary mt-2">Ir para o login →</a>}
        </form>
      </div>
    </div>
  );
}
