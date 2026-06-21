import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";

interface AppHeaderProps {
  user?: { name?: string | null; email?: string | null } | null;
  onLogout?: () => void;
  /** qual rota está ativa para destacar o link */
  activeHref?: string;
}

const NAV_LINKS = [
  { href: "/",             label: "Dashboard"  },
  { href: "/proposals",    label: "Propostas"  },
  { href: "/resources-new", label: "Recursos"  },
  { href: "/briefing",     label: "Nova Proposta" },
] as const;

export function AppHeader({ user, onLogout, activeHref }: AppHeaderProps) {
  const [location] = useLocation();
  const active = activeHref ?? location;

  return (
    <header
      className="sticky top-0 z-50 backdrop-blur-sm border-b"
      style={{
        backgroundColor: "rgba(247,242,234,0.92)", /* --cream com 92% opacidade */
        borderColor: "var(--cream-dark)",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-6">

        {/* ── Logotipo tipográfico ──────────────────────── */}
        <Link href="/" className="shrink-0 leading-none no-underline flex items-baseline">
          <span
            style={{
              fontFamily: "var(--font-sans, 'DM Sans', sans-serif)",
              fontWeight: 600,
              fontSize: "1.25rem",
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            Líd
          </span>
          <span
            style={{
              fontFamily: "var(--font-serif, 'Playfair Display', serif)",
    
              fontWeight: 700,
              fontSize: "1.25rem",
              color: "var(--terra)",
            }}
          >
            art
          </span>
        </Link>

        {/* ── Nav central ──────────────────────────────── */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = href === "/" ? active === "/" : active.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="no-underline px-3 py-1 rounded text-sm transition-colors"
                style={{
                  color: isActive ? "var(--terra)" : "var(--ink-mid)",
                  fontWeight: isActive ? 600 : 400,
                  borderBottom: isActive ? "2px solid var(--terra)" : "2px solid transparent",
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* ── Usuário + logout ─────────────────────────── */}
        <div className="shrink-0 flex items-center gap-2">
          {user && (
            <>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                style={{
                  backgroundColor: "var(--terra-pale)",
                  color: "var(--terra)",
                }}
              >
                {user.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase() || "U"}
              </div>
              <span
                className="hidden sm:block text-sm max-w-[120px] truncate"
                style={{ color: "var(--ink-mid)" }}
              >
                {user.name?.split(" ")[0] || user.email}
              </span>
            </>
          )}
          {onLogout && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="text-xs px-2 gap-1"
              style={{ color: "var(--ink-light)" }}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
