import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Wand2 } from "lucide-react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

export default function CreateProposal() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    clientName: "",
    clientCompany: "",
    clientContact: "",
    projectScope: "",
    values: "",
    deadline: "",
    commercialTerms: "",
  });

  const [generatedProposal, setGeneratedProposal] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateMutation = trpc.proposals.generate.useMutation();
  const createMutation = trpc.proposals.create.useMutation();

  const handleGenerateProposal = async () => {
    if (!formData.clientName || !formData.clientCompany || !formData.projectScope || !formData.values) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateMutation.mutateAsync(formData);
      const content = typeof result.proposalContent === 'string' ? result.proposalContent : '';
      setGeneratedProposal(content);
      toast.success("Proposta gerada com sucesso!");
    } catch (error) {
      toast.error("Erro ao gerar proposta");
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveProposal = async () => {
    if (!generatedProposal) {
      toast.error("Nenhuma proposta para salvar");
      return;
    }

    try {
      await createMutation.mutateAsync({
        ...formData,
        proposalContent: generatedProposal,
      });
      toast.success("Proposta salva com sucesso!");
      navigate("/proposals");
    } catch (error) {
      toast.error("Erro ao salvar proposta");
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 py-6 flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-2xl font-serif font-bold text-foreground">Nova Proposta</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Form Section */}
          <div className="space-y-6">
            <Card className="border border-border/50 bg-white/50 backdrop-blur p-8 space-y-6">
              <h2 className="text-xl font-semibold text-foreground">Dados da Proposta</h2>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="clientName" className="text-sm font-medium text-foreground">
                    Nome do Cliente *
                  </Label>
                  <Input
                    id="clientName"
                    placeholder="Ex: João Silva"
                    value={formData.clientName}
                    onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                    className="mt-2 bg-background border-border"
                  />
                </div>

                <div>
                  <Label htmlFor="clientCompany" className="text-sm font-medium text-foreground">
                    Empresa do Cliente *
                  </Label>
                  <Input
                    id="clientCompany"
                    placeholder="Ex: Tech Solutions Ltda"
                    value={formData.clientCompany}
                    onChange={(e) => setFormData({ ...formData, clientCompany: e.target.value })}
                    className="mt-2 bg-background border-border"
                  />
                </div>

                <div>
                  <Label htmlFor="clientContact" className="text-sm font-medium text-foreground">
                    Contato (Email/Telefone)
                  </Label>
                  <Input
                    id="clientContact"
                    placeholder="Ex: joao@techsolutions.com"
                    value={formData.clientContact}
                    onChange={(e) => setFormData({ ...formData, clientContact: e.target.value })}
                    className="mt-2 bg-background border-border"
                  />
                </div>

                <div>
                  <Label htmlFor="projectScope" className="text-sm font-medium text-foreground">
                    Escopo do Projeto *
                  </Label>
                  <Textarea
                    id="projectScope"
                    placeholder="Descreva detalhadamente o escopo do projeto..."
                    value={formData.projectScope}
                    onChange={(e) => setFormData({ ...formData, projectScope: e.target.value })}
                    className="mt-2 bg-background border-border min-h-24"
                  />
                </div>

                <div>
                  <Label htmlFor="values" className="text-sm font-medium text-foreground">
                    Valores e Investimento *
                  </Label>
                  <Textarea
                    id="values"
                    placeholder="Ex: Pacote básico: R$ 5.000 | Pacote completo: R$ 15.000"
                    value={formData.values}
                    onChange={(e) => setFormData({ ...formData, values: e.target.value })}
                    className="mt-2 bg-background border-border min-h-20"
                  />
                </div>

                <div>
                  <Label htmlFor="deadline" className="text-sm font-medium text-foreground">
                    Prazo de Entrega
                  </Label>
                  <Input
                    id="deadline"
                    placeholder="Ex: 30 dias | 3 meses"
                    value={formData.deadline}
                    onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                    className="mt-2 bg-background border-border"
                  />
                </div>

                <div>
                  <Label htmlFor="commercialTerms" className="text-sm font-medium text-foreground">
                    Condições Comerciais
                  </Label>
                  <Textarea
                    id="commercialTerms"
                    placeholder="Ex: 50% de adiantamento, 50% na entrega. Validade: 30 dias"
                    value={formData.commercialTerms}
                    onChange={(e) => setFormData({ ...formData, commercialTerms: e.target.value })}
                    className="mt-2 bg-background border-border min-h-20"
                  />
                </div>
              </div>

              <Button
                onClick={handleGenerateProposal}
                disabled={isGenerating || !formData.clientName || !formData.clientCompany || !formData.projectScope || !formData.values}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-6 rounded-lg"
              >
                {isGenerating ? (
                  <>
                    <Spinner className="w-4 h-4 mr-2" />
                    Gerando proposta...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4 mr-2" />
                    Gerar Proposta com IA
                  </>
                )}
              </Button>
            </Card>
          </div>

          {/* Preview Section */}
          <div className="space-y-6">
            {generatedProposal ? (
              <>
                <Card className="border border-border/50 bg-white/50 backdrop-blur p-8 space-y-4 max-h-[600px] overflow-y-auto">
                  <h2 className="text-xl font-semibold text-foreground sticky top-0 bg-white/50">
                    Prévia da Proposta
                  </h2>
                  <div className="prose prose-sm max-w-none text-foreground">
                    <Streamdown>{generatedProposal}</Streamdown>
                  </div>
                </Card>

                <Button
                  onClick={handleSaveProposal}
                  disabled={createMutation.isPending}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-6 rounded-lg"
                >
                  {createMutation.isPending ? (
                    <>
                      <Spinner className="w-4 h-4 mr-2" />
                      Salvando...
                    </>
                  ) : (
                    "Salvar Proposta"
                  )}
                </Button>
              </>
            ) : (
              <Card className="border-2 border-dashed border-border/50 bg-muted/20 backdrop-blur p-8 flex items-center justify-center min-h-[400px]">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
                    <Wand2 className="w-8 h-8 text-primary/50" />
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      Preencha o formulário e clique em "Gerar Proposta com IA"
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      A proposta será exibida aqui para revisão
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
