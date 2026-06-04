import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Download, Edit2, Save, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { Textarea } from "@/components/ui/textarea";

export default function ProposalDetail() {
  const [, params] = useRoute("/proposal/:id");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");

  const proposalId = params?.id ? parseInt(params.id) : null;
  const { data: proposal, isLoading } = trpc.proposals.getById.useQuery(
    { id: proposalId! },
    { enabled: !!proposalId }
  );
  const updateMutation = trpc.proposals.update.useMutation();

  const handleSaveEdit = async () => {
    if (!proposal || !editedContent) return;

    try {
      await updateMutation.mutateAsync({
        id: proposal.id,
        proposalContent: editedContent,
      });
      toast.success("Proposta atualizada com sucesso!");
      setIsEditing(false);
    } catch (error) {
      toast.error("Erro ao atualizar proposta");
      console.error(error);
    }
  };

  const handleDownloadPDF = () => {
    toast.info("Funcionalidade de download em desenvolvimento");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center">
        <div className="text-center">
          <Spinner className="w-12 h-12 mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando proposta...</p>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted">
        <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="container max-w-7xl mx-auto px-4 py-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/proposals")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </div>
        </header>
        <main className="container max-w-7xl mx-auto px-4 py-12">
          <Card className="border border-border/50 bg-white/50 backdrop-blur p-8 text-center">
            <p className="text-foreground">Proposta não encontrada</p>
          </Card>
        </main>
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
              onClick={() => navigate("/proposals")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-2xl font-serif font-bold text-foreground">
              {proposal.clientName} - {proposal.clientCompany}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPDF}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Baixar PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(true);
                    setEditedContent(proposal.proposalContent);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Edit2 className="w-4 h-4 mr-2" />
                  Editar
                </Button>
              </>
            )}
            {isEditing && (
              <>
                <Button
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Salvar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl mx-auto px-4 py-12">
        <div className="space-y-6">
          {/* Metadata */}
          <Card className="border border-border/50 bg-white/50 backdrop-blur p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Cliente</p>
                <p className="text-sm font-semibold text-foreground">{proposal.clientName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Empresa</p>
                <p className="text-sm font-semibold text-foreground">{proposal.clientCompany}</p>
              </div>
              {proposal.clientContact && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Contato</p>
                  <p className="text-sm font-semibold text-foreground">{proposal.clientContact}</p>
                </div>
              )}
              {proposal.deadline && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Prazo</p>
                  <p className="text-sm font-semibold text-foreground">{proposal.deadline}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Content */}
          {isEditing ? (
            <Card className="border border-border/50 bg-white/50 backdrop-blur p-6">
              <Textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="min-h-[600px] bg-background border-border font-mono text-sm"
              />
            </Card>
          ) : (
            <Card className="border border-border/50 bg-white/50 backdrop-blur p-8">
              <div className="prose prose-sm max-w-none text-foreground">
                <Streamdown>{proposal.proposalContent}</Streamdown>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
