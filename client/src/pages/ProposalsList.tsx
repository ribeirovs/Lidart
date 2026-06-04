import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Plus, Trash2, Eye, Download } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const statusLabels: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-gray-100 text-gray-800" },
  sent: { label: "Enviada", color: "bg-blue-100 text-blue-800" },
  accepted: { label: "Aceita", color: "bg-green-100 text-green-800" },
  rejected: { label: "Rejeitada", color: "bg-red-100 text-red-800" },
  archived: { label: "Arquivada", color: "bg-gray-200 text-gray-700" },
};

export default function ProposalsList() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const { data: proposals, isLoading, refetch } = trpc.proposals.list.useQuery();
  const deleteMutation = trpc.proposals.delete.useMutation();

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja deletar esta proposta?")) return;

    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Proposta deletada com sucesso!");
      refetch();
    } catch (error) {
      toast.error("Erro ao deletar proposta");
      console.error(error);
    }
  };

  const handleDownloadPDF = (proposalId: number) => {
    toast.info("Funcionalidade de download em desenvolvimento");
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
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-2xl font-serif font-bold text-foreground">Minhas Propostas</h1>
          </div>
          <Button
            onClick={() => navigate("/create")}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            <Plus className="w-4 h-4 mr-2" />
            Nova Proposta
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 py-12">
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
              onClick={() => navigate("/create")}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold mx-auto"
            >
              <Plus className="w-4 h-4 mr-2" />
              Criar Primeira Proposta
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal) => (
              <Card
                key={proposal.id}
                className="border border-border/50 bg-white/50 backdrop-blur p-6 hover:border-primary/30 transition-colors cursor-pointer"
                onClick={() => navigate(`/proposal/${proposal.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-foreground">
                        {proposal.clientName} - {proposal.clientCompany}
                      </h3>
                      <Badge className={statusLabels[proposal.status as keyof typeof statusLabels]?.color || "bg-gray-100"}>
                        {statusLabels[proposal.status as keyof typeof statusLabels]?.label || proposal.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {proposal.projectScope}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
                      <span>
                        Criada em {format(new Date(proposal.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                      </span>
                      {proposal.deadline && <span>Prazo: {proposal.deadline}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadPDF(proposal.id);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(proposal.id);
                      }}
                      className="text-destructive hover:text-destructive/90"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
