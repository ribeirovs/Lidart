import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(data?.error || "Não foi possível entrar.");
        setLoading(false);
        return;
      }
      window.location.href = "/"; // recarrega p/ a sessão valer
    } catch {
      setErro("Falha de conexão. Tente de novo.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "var(--cream, #FBF8F6)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "var(--primary, #E20613)" }}>Lídart Proposals</h1>
          <p className="text-sm text-muted-foreground mt-1">Entre com seu e-mail e senha</p>
        </div>
        <form onSubmit={entrar} className="bg-white/70 backdrop-blur rounded-xl border border-border/50 p-6 space-y-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">E-mail</label>
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Senha</label>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
            {loading ? <Spinner className="w-4 h-4" /> : "Entrar"}
          </Button>
        </form>
        <p className="text-center text-[11px] text-muted-foreground mt-4">Acesso restrito · Lídart / Kallas</p>
      </div>
    </div>
  );
}
