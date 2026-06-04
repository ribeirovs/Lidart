import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Send } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Briefing() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    clientName: "",
    segment: "",
    cities: "",
    campaignPeriod: "",
    budget: "",
    objective: "",
    contactName: "",
    contactEmail: "",
  });

  const createBriefingMutation = trpc.briefings.create.useMutation();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validar campos obrigatórios
    if (!formData.clientName || !formData.segment || !formData.cities || !formData.campaignPeriod || !formData.budget || !formData.objective || !formData.contactName || !formData.contactEmail) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setIsSubmitting(true);
    try {
      await createBriefingMutation.mutateAsync(formData);
      toast.success("Briefing enviado com sucesso!");
      
      // Limpar formulário
      setFormData({
        clientName: "",
        segment: "",
        cities: "",
        campaignPeriod: "",
        budget: "",
        objective: "",
        contactName: "",
        contactEmail: "",
      });

      // Redirecionar para propostas após 2 segundos
      setTimeout(() => navigate("/proposals"), 2000);
    } catch (error) {
      toast.error("Erro ao enviar briefing");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <h1 className="text-2xl font-serif font-bold text-foreground">Novo Briefing</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl mx-auto px-4 py-12">
        <Card className="border border-border/50 bg-white/50 backdrop-blur p-8">
          <div className="mb-8">
            <h2 className="text-2xl font-serif font-bold text-foreground mb-2">Briefing de Campanha OOH</h2>
            <p className="text-muted-foreground">
              Preencha os dados da campanha para que a IA gere uma proposta comercial personalizada.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Dados do Cliente */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">Dados do Cliente</h3>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Nome do Cliente *
                </label>
                <input
                  type="text"
                  name="clientName"
                  value={formData.clientName}
                  onChange={handleChange}
                  placeholder="Ex: Empresa XYZ"
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Segmento de Mercado *
                </label>
                <select
                  name="segment"
                  value={formData.segment}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                >
                  <option value="">Selecione um segmento</option>
                  <option value="retail">Varejo</option>
                  <option value="technology">Tecnologia</option>
                  <option value="finance">Financeiro</option>
                  <option value="automotive">Automotivo</option>
                  <option value="food_beverage">Alimentos e Bebidas</option>
                  <option value="healthcare">Saúde</option>
                  <option value="real_estate">Imóveis</option>
                  <option value="education">Educação</option>
                  <option value="other">Outro</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Contato Responsável *
                </label>
                <input
                  type="text"
                  name="contactName"
                  value={formData.contactName}
                  onChange={handleChange}
                  placeholder="Nome completo"
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Email de Contato *
                </label>
                <input
                  type="email"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  placeholder="email@example.com"
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
            </div>

            {/* Dados da Campanha */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">Dados da Campanha</h3>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Cidade(s) / Praça(s) *
                </label>
                <input
                  type="text"
                  name="cities"
                  value={formData.cities}
                  onChange={handleChange}
                  placeholder="Ex: São Paulo, Rio de Janeiro"
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Período da Campanha *
                </label>
                <input
                  type="text"
                  name="campaignPeriod"
                  value={formData.campaignPeriod}
                  onChange={handleChange}
                  placeholder="Ex: Janeiro a Março de 2026"
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Orçamento Disponível *
                </label>
                <input
                  type="text"
                  name="budget"
                  value={formData.budget}
                  onChange={handleChange}
                  placeholder="Ex: R$ 50.000"
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Objetivo da Campanha *
                </label>
                <textarea
                  name="objective"
                  value={formData.objective}
                  onChange={handleChange}
                  placeholder="Ex: Aumentar awareness da marca, lançar novo produto, performance..."
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={4}
                  required
                />
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="flex gap-4 pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/")}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isSubmitting ? (
                  <>
                    <Spinner className="w-4 h-4 mr-2" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Enviar Briefing
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>

        {/* Info Box */}
        <Card className="border border-border/50 bg-primary/5 backdrop-blur p-6 mt-8">
          <h4 className="font-semibold text-foreground mb-2">O que acontece depois?</h4>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>Seu briefing será processado e validado</li>
            <li>A IA analisará os dados e consultará o inventário</li>
            <li>Uma proposta será gerada automaticamente</li>
            <li>Você poderá revisar, editar e aprovar</li>
            <li>A proposta final será salva e pronta para enviar</li>
          </ol>
        </Card>
      </main>
    </div>
  );
}
