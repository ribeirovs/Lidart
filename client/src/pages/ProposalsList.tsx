import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { AppHeader } from "@/components/AppHeader";
import { ArrowLeft, Plus, Trash2, Eye, Download, Search, X } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const statusLabels: Record<string, { label: string; color: string; borderColor: string }> = {
  draft:    { label: "Rascunho",  color: "bg-gray-100 text-gray-800",   borderColor: "#8C7D70" },
  sent:     { label: "Enviada",   color: "bg-blue-100 text-blue-800",   borderColor: "#C49A1A" },
  accepted: { label: "Aceita",    color: "bg-green-100 text-green-800", borderColor: "#4A6640" },
  rejected: { label: "Rejeitada", color: "bg-red-100 text-red-800",     borderColor: "#B8562A" },
  archived: { label: "Arquivada", color: "bg-gray-200 text-gray-700",   borderColor: "#4A3F36" },
};

export default function ProposalsList() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: proposals, isLoading, refetch } = trpc.proposals.list.useQuery();

  // Filter proposals based on search and status
  const filteredProposals = proposals?.filter((proposal) => {
    const matchesSearch =
      proposal.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proposal.clientCompany.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proposal.projectScope.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = !statusFilter || proposal.status === statusFilter;

    return matchesSearch && matchesStatus;
  }) || [];

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredProposals.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredProposals.map((p) => p.id)));
    }
  };

  const deleteMutation = trpc.proposals.deleteProposal.useMutation();

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    const confirmMessage = selected.size === 1
      ? "Tem certeza que deseja deletar a proposta selecionada?"
      : `Tem certeza que deseja deletar as ${selected.size} propostas selecionadas?`;
    
    if (!confirm(confirmMessage)) return;

    try {
      await Promise.all(
        Array.from(selected).map((id) => deleteMutation.mutateAsync({ id }))
      );
      toast.success(
        selected.size === 1
          ? "Proposta deletada com sucesso!"
          : `${selected.size} propostas deletadas com sucesso!`
      );
      setSelected(new Set());
      refetch();
    } catch (error) {
      toast.error("Erro ao deletar propostas");
      console.error(error);
    }
  };

  const downloadPDFMutation = trpc.proposals.exportPDF.useMutation();

  const handleDownloadPDF = async (proposalId: number) => {
    try {
      const result = await downloadPDFMutation.mutateAsync({ id: proposalId });
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("PDF baixado com sucesso!");
    } catch (error) {
      toast.error("Erro ao baixar PDF");
      console.error(error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center">
        <div className="text-center">
          <Spinner className="w-12 h-12 mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando propostas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--cream)" }}>
      <AppHeader user={user} activeHref="/proposals" />

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 py-12">
        {/* Search and Filter */}
        {proposals && proposals.length > 0 && (
          <div className="mb-8 space-y-4">
            <div className="flex items-center gap-2 bg-white/50 backdrop-blur rounded-lg border border-border/50 px-4 py-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente, empresa ou escopo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="border-0 bg-transparent focus:outline-none focus:ring-0 text-sm"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {!proposals || proposals.length === 0 ? (
          <Card className="border-2 border-dashed border-border/50 bg-muted/20 backdrop-blur p-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
              <Eye className="w-8 h-8 text-primary/50" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">Nenhuma proposta criada</p>
              <p className="text-muted-foreground mt-2">
                Comece criando sua primeira proposta comercial com IA
              </p>
            </div>
            <Button
              onClick={() => navigate("/briefing")}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold mx-auto"
            >
              <Plus className="w-4 h-4 mr-2" />
              Criar Primeira Proposta
            </Button>
          </Card>
        ) : filteredProposals.length === 0 ? (
          <Card className="border-2 border-dashed border-border/50 bg-muted/20 backdrop-blur p-12 text-center space-y-4">
            <p className="text-muted-foreground">Nenhuma proposta encontrada com os filtros selecionados</p>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4 border-b border-border/30 pb-2">
              <h2 className="text-xl font-serif font-bold text-foreground">Suas Propostas</h2>
              {selected.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteSelected}
                  className="font-semibold animate-in fade-in zoom-in-95 duration-150"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Deletar selecionados ({selected.size})
                </Button>
              )}
            </div>
            
            <div className="flex items-center justify-between mb-2 px-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selected.size === filteredProposals.length && filteredProposals.length > 0}
                  onChange={toggleAll}
                  className="rounded border-border focus:ring-primary w-4 h-4"
                />
                Selecionar todas ({filteredProposals.length})
              </label>
            </div>
            {filteredProposals.map((proposal) => {
              const status = statusLabels[proposal.status as keyof typeof statusLabels];
              const borderColor = status?.borderColor ?? "#8C7D70";
              return (
              <Card
                key={proposal.id}
                className="bg-white cursor-pointer hover:shadow-md transition-all"
                style={{ borderLeft: `3px solid ${borderColor}`, borderRadius: "4px" }}
                onClick={() => navigate(`/proposal/${proposal.id}`)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "24px" }}>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(proposal.id);
                    }}
                    style={{ flexShrink: 0 }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(proposal.id)}
                      onChange={() => {}}
                      className="rounded border-border focus:ring-primary cursor-pointer"
                      style={{ width: "18px", height: "18px" }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                      <div style={{ flex: 1 }}>
                        <h3 className="text-lg font-semibold" style={{ color: "var(--ink)", marginBottom: "4px" }}>
                          {proposal.clientName} — {proposal.clientCompany}
                        </h3>
                        <p className="text-sm line-clamp-2" style={{ color: "var(--ink-light)", marginBottom: "8px" }}>
                          {proposal.projectScope}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                          <span
                            style={{
                              fontFamily: "var(--font-mono, 'DM Mono', monospace)",
                              fontSize: "10px",
                              fontWeight: 500,
                              letterSpacing: "0.12em",
                              textTransform: "uppercase",
                              color: borderColor,
                            }}
                          >
                            {status?.label ?? proposal.status}
                          </span>
                          <span className="text-xs" style={{ color: "var(--ink-light)" }}>
                            {format(new Date(proposal.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                          </span>
                          {proposal.deadline && (
                            <span className="text-xs" style={{ color: "var(--ink-light)" }}>
                              Prazo: {proposal.deadline}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadPDF(proposal.id);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        style={{ marginLeft: "16px", flexShrink: 0 }}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
