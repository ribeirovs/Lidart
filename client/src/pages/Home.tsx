import { useEffect, useState } from "react";
import * as amplitude from '@amplitude/unified';
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { AppHeader } from "@/components/AppHeader";
import {
  History, ClipboardList, UploadCloud,
  Sparkles, Coins, FileCheck, FileText,
} from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

/* ─── Funnel card ─────────────────────────────────────────── */
function FunnelCard({
  label,
  accentColor,
  icon: Icon,
  count,
  rows,
}: {
  label: string;
  accentColor: string;
  icon: React.ElementType;
  count: number;
  rows: { label: string; value: number; note?: string }[];
}) {
  return (
    <Card
      className="bg-white p-5 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow"
      style={{ borderLeft: `3px solid ${accentColor}`, borderRadius: "4px" }}
    >
      <div>
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[10px] font-medium uppercase tracking-widest"
            style={{ fontFamily: "var(--font-mono, 'DM Mono', monospace)", color: accentColor }}
          >
            {label}
          </span>
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
        </div>
        <div className="text-3xl font-bold" style={{ color: "var(--ink)", fontFamily: "var(--font-serif)" }}>{count}</div>
        <div className="mt-2 h-0.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--cream-dark)" }}>
          <div
            className="h-full transition-all duration-500"
            style={{ backgroundColor: accentColor, width: `${Math.min(100, count * 20)}%` }}
          />
        </div>
      </div>
      <div className="mt-4 pt-3 border-t text-xs space-y-1" style={{ borderColor: "var(--cream-dark)", color: "var(--ink-light)" }}>
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between">
            <span>{r.label}:</span>
            <span className="font-semibold" style={{ color: "var(--ink)" }}>
              {r.value}
              {r.note && <span className="text-[9px] ml-1 font-normal" style={{ color: "var(--ink-light)" }}>{r.note}</span>}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ─── Action card (todos consistentes) ────────────────────── */
function ActionCard({
  href,
  icon: Icon,
  iconColor,
  paleBg,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ElementType;
  iconColor: string;
  paleBg: string;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} className="no-underline block">
      <Card
        className="bg-white p-7 cursor-pointer group hover:shadow-md transition-all"
        style={{ borderLeft: `3px solid ${iconColor}`, borderRadius: "4px" }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded flex items-center justify-center shrink-0 transition-opacity group-hover:opacity-80"
            style={{ backgroundColor: paleBg }}
          >
            <Icon className="w-6 h-6" style={{ color: iconColor }} />
          </div>
          <div>
            <h3
              className="text-lg font-semibold leading-snug"
              style={{ fontFamily: "var(--font-serif)", color: "var(--ink)" }}
            >
              {title}
            </h3>
            <p className="text-sm mt-0.5" style={{ color: "var(--ink-light)" }}>{subtitle}</p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

/* ─── Page ────────────────────────────────────────────────── */
export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();

  useEffect(() => {
    amplitude.track('Viewed Home Page', { prompt_version: 'BA400.4' }); // helps improve this setup flow — safe to remove once you've verified the event lands
  }, []);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginErro, setLoginErro] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErro(null);
    setLoginLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoginErro(data?.error || "Não foi possível entrar.");
        setLoginLoading(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setLoginErro("Falha de conexão. Tente de novo.");
      setLoginLoading(false);
    }
  };

  const { data: proposals = [] } = trpc.proposals.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const stageCounts = {
    briefing: 0, validation: 0, research: 0,
    inventory: 0, pricing: 0, product_content: 0,
    idea_central: 0, idea_validation: 0,
    valuation: 0, valuation_validation: 0,
    proposal_final: 0, customization: 0, approval: 0, delivery: 0,
  };

  proposals.forEach((p) => {
    const stage = p.currentStage as keyof typeof stageCounts;
    if (stageCounts[stage] !== undefined) stageCounts[stage]++;
  });

  /* ── loading ── */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--cream)" }}>
        <div className="text-center">
          <div
            className="inline-block animate-spin rounded-full h-10 w-10 border-b-2"
            style={{ borderColor: "var(--terra)" }}
          />
          <p className="mt-4 text-sm" style={{ color: "var(--ink-light)" }}>Carregando...</p>
        </div>
      </div>
    );
  }

  /* ── unauthenticated landing ── */
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "var(--cream)" }}>
        <AppHeader />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="space-y-4">
                <p
                  className="text-[10px] font-medium uppercase tracking-[0.2em]"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--terra)" }}
                >
                  Sistema de Propostas
                </p>
                <h2
                  className="text-5xl font-bold leading-tight"
                  style={{ fontFamily: "var(--font-serif)", color: "var(--ink)" }}
                >
                  Propostas Comerciais Profissionais
                </h2>
                <p className="text-lg leading-relaxed" style={{ color: "var(--ink-mid)" }}>
                  Crie propostas elegantes e persuasivas com o poder da inteligência artificial.
                </p>
              </div>

              <ul className="space-y-3">
                {[
                  "Geração automática com IA",
                  "Histórico completo de propostas",
                  "Edição e personalização",
                  "Exportação em PDF",
                ].map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm" style={{ color: "var(--ink-mid)" }}>
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--terra)" }} />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="flex gap-3 pt-2">
                {import.meta.env.DEV && (
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => (window.location.href = "/api/auth/dev-login")}
                    className="px-8 font-medium"
                  >
                    Acesso Dev
                  </Button>
                )}
              </div>
            </div>

            <div className="relative">
              <div
                className="absolute inset-0 blur-3xl opacity-30 rounded-2xl"
                style={{ background: "linear-gradient(135deg, var(--terra-pale), var(--cream-dark))" }}
              />
              <Card
                className="relative border bg-white/70 backdrop-blur p-8"
                style={{ borderColor: "var(--cream-dark)", borderRadius: "4px" }}
              >
                <h3
                  className="text-lg font-semibold mb-6"
                  style={{ fontFamily: "var(--font-serif)", color: "var(--ink)" }}
                >
                  Acesse sua conta
                </h3>
                <form onSubmit={entrar} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium" style={{ color: "var(--ink)" }}>E-mail</label>
                    <Input
                      type="email"
                      autoComplete="username"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="voce@empresa.com.br"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium" style={{ color: "var(--ink)" }}>Senha</label>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  {loginErro && <p className="text-sm text-destructive">{loginErro}</p>}
                  <Button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full text-white font-medium"
                    style={{ backgroundColor: "var(--terra)" }}
                  >
                    {loginLoading ? <Spinner className="w-4 h-4" /> : "Entrar"}
                  </Button>
                </form>
              </Card>
            </div>
          </div>
        </main>
      </div>
    );
  }

  /* ── authenticated dashboard ── */
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--cream)" }}>
      <AppHeader user={user} onLogout={logout} activeHref="/" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="space-y-10">

          {/* Welcome */}
          <div>
            <h2
              className="text-4xl font-bold"
              style={{ fontFamily: "var(--font-serif)", color: "var(--ink)" }}
            >
              Bem-vinda, {user?.name?.split(" ")[0] || "usuária"}!
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-light)" }}>
              Gerencie propostas comerciais com elegância e eficiência.
            </p>
          </div>

          {/* Funil */}
          <div>
            <p
              className="mb-3 text-[10px] uppercase tracking-widest font-medium"
              style={{ fontFamily: "var(--font-mono)", color: "var(--ink-light)" }}
            >
              Funil de Produção · 13 etapas
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <FunnelCard
                label="Briefing"
                accentColor="var(--terra)"
                icon={ClipboardList}
                count={stageCounts.briefing + stageCounts.validation + stageCounts.research}
                rows={[
                  { label: "Briefing",  value: stageCounts.briefing },
                  { label: "Validação", value: stageCounts.validation },
                  { label: "Pesquisa",  value: stageCounts.research },
                ]}
              />
              <FunnelCard
                label="Uploads"
                accentColor="var(--terra-light)"
                icon={UploadCloud}
                count={stageCounts.inventory + stageCounts.pricing + stageCounts.product_content}
                rows={[
                  { label: "Inventário",     value: stageCounts.inventory },
                  { label: "Tabela Preços",  value: stageCounts.pricing },
                  { label: "Mídias Produto", value: stageCounts.product_content, note: "(opc)" },
                ]}
              />
              <FunnelCard
                label="Ideia Criativa"
                accentColor="var(--ocre)"
                icon={Sparkles}
                count={stageCounts.idea_central + stageCounts.idea_validation}
                rows={[
                  { label: "Geração IA",       value: stageCounts.idea_central },
                  { label: "Validação Humana", value: stageCounts.idea_validation },
                ]}
              />
              <FunnelCard
                label="Custos & Valor"
                accentColor="var(--musgo)"
                icon={Coins}
                count={stageCounts.valuation + stageCounts.valuation_validation}
                rows={[
                  { label: "Cálculo IA",       value: stageCounts.valuation },
                  { label: "Validação Humana", value: stageCounts.valuation_validation },
                ]}
              />
              <FunnelCard
                label="Entrega"
                accentColor="var(--ink-mid)"
                icon={FileCheck}
                count={stageCounts.proposal_final + stageCounts.customization + stageCounts.approval + stageCounts.delivery}
                rows={[
                  { label: "Proposta Final",  value: stageCounts.proposal_final },
                  { label: "Customização",    value: stageCounts.customization },
                  { label: "Aprovação Final", value: stageCounts.approval },
                  { label: "Entrega",         value: stageCounts.delivery },
                ]}
              />
            </div>
          </div>

          {/* Action cards — todos com o mesmo estilo */}
          <div>
            <p
              className="mb-3 text-[10px] uppercase tracking-widest font-medium"
              style={{ fontFamily: "var(--font-mono)", color: "var(--ink-light)" }}
            >
              Ações Rápidas
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ActionCard
                href="/proposals"
                icon={Sparkles}
                iconColor="#B8562A"
                paleBg="#F2E4DA"
                title="Customizar Proposta"
                subtitle="Ajustar propostas geradas no funil com chat ou briefing"
              />
              <ActionCard
                href="/briefing"
                icon={ClipboardList}
                iconColor="#C49A1A"
                paleBg="#FBF5DC"
                title="Nova Proposta"
                subtitle="Iniciar processo Planner Lídart"
              />
              <ActionCard
                href="/proposals"
                icon={History}
                iconColor="#4A6640"
                paleBg="#E3EBE1"
                title="Minhas Propostas"
                subtitle="Histórico e status de todas as propostas"
              />
              <ActionCard
                href="/resources-new"
                icon={FileText}
                iconColor="#D4724A"
                paleBg="#F9EDE6"
                title="Recursos"
                subtitle="Gerencie inventário, preços e conteúdo"
              />
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
