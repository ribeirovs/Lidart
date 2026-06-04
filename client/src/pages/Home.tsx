import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, Plus, History, LogOut } from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="mt-4 text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted">
        {/* Header */}
        <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="container max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
                <FileText className="w-6 h-6 text-primary-foreground" />
              </div>
              <h1 className="text-2xl font-serif font-bold text-foreground">Lídart Proposals</h1>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <main className="container max-w-7xl mx-auto px-4 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-5xl font-serif font-bold text-foreground leading-tight">
                  Propostas Comerciais Profissionais
                </h2>
                <p className="text-xl text-muted-foreground leading-relaxed">
                  Crie propostas comerciais elegantes e persuasivas em segundos com o poder da inteligência artificial. Gerencie, edite e exporte com facilidade.
                </p>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Funcionalidades Premium</h3>
                <ul className="space-y-3">
                  {[
                    "Geração automática com IA",
                    "Histórico completo de propostas",
                    "Edição e personalização",
                    "Exportação em PDF",
                    "Interface elegante e intuitiva",
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-foreground">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-4">
                <a href={getLoginUrl()}>
                  <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all">
                    Começar Agora
                  </Button>
                </a>
              </div>
            </div>

            {/* Right Visual */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl blur-3xl" />
              <Card className="relative border-2 border-border/50 bg-white/50 backdrop-blur p-8 space-y-6">
                <div className="space-y-4">
                  <div className="h-4 bg-muted rounded-full w-3/4" />
                  <div className="h-4 bg-muted rounded-full w-full" />
                  <div className="h-4 bg-muted rounded-full w-5/6" />
                </div>
                <div className="pt-4 border-t border-border space-y-3">
                  <div className="h-3 bg-muted/60 rounded-full w-2/3" />
                  <div className="h-3 bg-muted/60 rounded-full w-4/5" />
                </div>
                <div className="flex gap-2 pt-4">
                  <div className="h-10 bg-primary/20 rounded-lg flex-1" />
                  <div className="h-10 bg-primary/10 rounded-lg flex-1" />
                </div>
              </Card>
            </div>
          </div>

          {/* Features Grid */}
          <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Plus,
                title: "Criar Proposta",
                description: "Preencha um formulário simples e deixe a IA gerar uma proposta profissional",
              },
              {
                icon: History,
                title: "Histórico",
                description: "Acesse todas as suas propostas anteriores e reedite conforme necessário",
              },
              {
                icon: FileText,
                title: "Exportar",
                description: "Baixe suas propostas em PDF ou texto formatado para compartilhar",
              },
            ].map((feature, i) => (
              <Card key={i} className="border border-border/50 bg-white/50 backdrop-blur p-6 space-y-4 hover:border-primary/30 transition-colors">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </Card>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
              <FileText className="w-6 h-6 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Lídart Proposals</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.name || user?.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout()}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 py-12">
        <div className="space-y-8">
          {/* Welcome Section */}
          <div className="space-y-4">
            <h2 className="text-4xl font-serif font-bold text-foreground">
              Bem-vindo, {user?.name?.split(" ")[0] || "usuário"}!
            </h2>
            <p className="text-lg text-muted-foreground">
              Crie e gerencie suas propostas comerciais com elegância e profissionalismo.
            </p>
          </div>

          {/* Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Link href="/create">
              <Card className="border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-8 hover:border-primary/50 transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-lg bg-primary/20 group-hover:bg-primary/30 flex items-center justify-center transition-colors">
                    <Plus className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">Nova Proposta</h3>
                    <p className="text-sm text-muted-foreground">Crie uma proposta comercial com IA</p>
                  </div>
                </div>
              </Card>
            </Link>

            <Link href="/proposals">
              <Card className="border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-8 hover:border-primary/50 transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-lg bg-primary/20 group-hover:bg-primary/30 flex items-center justify-center transition-colors">
                    <History className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">Minhas Propostas</h3>
                    <p className="text-sm text-muted-foreground">Visualize e edite propostas anteriores</p>
                  </div>
                </div>
              </Card>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
