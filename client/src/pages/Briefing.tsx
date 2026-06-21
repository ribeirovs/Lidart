import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AppHeader } from "@/components/AppHeader";
import { ArrowLeft, Send, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Briefing() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // States for briefing import
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // States for advanced OOH specification sections
  const [showTechSpecs, setShowTechSpecs] = useState(false);
  const [showLocationSpecs, setShowLocationSpecs] = useState(false);
  const [showCommercialTerms, setShowCommercialTerms] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  const [formData, setFormData] = useState({
    clientName: "",
    segment: "",
    cities: "",
    campaignPeriod: "",
    budget: "",
    objective: "",
    targetAudience: "",
    contactName: "",
    contactEmail: "",
    campaignName: "",
    mediaSpecs: "",
    locationSpecs: "",
    commercialTerms: "",
    moreDetails: "",
    creativityLevel: "medio" as "baixo" | "medio" | "alto",
    generatedBy: "ai",
  });

  const [briefingLlmError, setBriefingLlmError] = useState<{
    message: string;
    detail: string;
    rawText?: string;
  } | null>(null);

  const createBriefingMutation = trpc.briefings.create.useMutation();

  const handleImportBriefing = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!importText.trim() && !importFile && !briefingLlmError?.rawText) {
      toast.error("Por favor, cole um texto ou selecione um arquivo PDF");
      return;
    }

    setIsImporting(true);
    const body = new FormData();
    if (importFile) {
      body.append("file", importFile);
    } else {
      body.append("text", importText || briefingLlmError?.rawText || "");
    }

    try {
      const response = await fetch("/api/parse-briefing", {
        method: "POST",
        body,
        credentials: "include",
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Erro ao processar briefing");
      }

      const result = await response.json();
      if (result.success && result.data) {
        setFormData({
          clientName: result.data.clientName || "",
          segment: result.data.segment || "",
          cities: result.data.cities || "",
          campaignPeriod: result.data.campaignPeriod || "",
          budget: result.data.budget || "",
          objective: result.data.objective || "",
          targetAudience: result.data.targetAudience || "",
          contactName: result.data.contactName || "",
          contactEmail: result.data.contactEmail || "",
          campaignName: result.data.campaignName || "",
          mediaSpecs: result.data.mediaSpecs || "",
          locationSpecs: result.data.locationSpecs || "",
          commercialTerms: result.data.commercialTerms || "",
          moreDetails: result.data.moreDetails || "",
          creativityLevel: "medio",
          generatedBy: result.generatedBy || "ai",
        });
        setBriefingLlmError(null);
        if (result.data.mediaSpecs) setShowTechSpecs(true);
        if (result.data.locationSpecs) setShowLocationSpecs(true);
        if (result.data.commercialTerms) setShowCommercialTerms(true);
        if (result.data.moreDetails) setShowMoreDetails(true);
        toast.success("Dados do briefing extraídos e preenchidos com sucesso!");
        setShowImport(false);
        setImportText("");
        setImportFile(null);
      } else if (result.errorType === "llm_unavailable") {
        setBriefingLlmError({
          message: result.message,
          detail: result.detail,
          rawText: result.rawText || importText,
        });
        toast.error("IA temporariamente indisponível.");
      } else {
        throw new Error(result.error || "Resposta inválida do servidor");
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao processar briefing");
      console.error(error);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportOffline = async () => {
    setIsImporting(true);
    const body = new FormData();
    if (importFile) {
      body.append("file", importFile);
    } else {
      body.append("text", briefingLlmError?.rawText || importText);
    }
    try {
      const response = await fetch("/api/parse-briefing-offline", {
        method: "POST",
        body,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Erro ao processar briefing offline");
      }
      const result = await response.json();
      if (result.success && result.data) {
        setFormData({
          clientName: result.data.clientName || "",
          segment: result.data.segment || "",
          cities: result.data.cities || "",
          campaignPeriod: result.data.campaignPeriod || "",
          budget: result.data.budget || "",
          objective: result.data.objective || "",
          targetAudience: result.data.targetAudience || "",
          contactName: result.data.contactName || "",
          contactEmail: result.data.contactEmail || "",
          campaignName: result.data.campaignName || "",
          mediaSpecs: result.data.mediaSpecs || "",
          locationSpecs: result.data.locationSpecs || "",
          commercialTerms: result.data.commercialTerms || "",
          moreDetails: result.data.moreDetails || "",
          creativityLevel: "medio",
          generatedBy: "fallback",
        });
        setBriefingLlmError(null);
        if (result.data.mediaSpecs) setShowTechSpecs(true);
        if (result.data.locationSpecs) setShowLocationSpecs(true);
        if (result.data.commercialTerms) setShowCommercialTerms(true);
        if (result.data.moreDetails) setShowMoreDetails(true);
        toast.success("Dados do briefing extraídos offline!");
        setShowImport(false);
        setImportText("");
        setImportFile(null);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao processar briefing offline");
    } finally {
      setIsImporting(false);
    }
  };

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
    if (!formData.clientName || !formData.segment || !formData.cities || !formData.campaignPeriod || !formData.budget || !formData.objective || !formData.targetAudience || !formData.contactName || !formData.contactEmail) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setIsSubmitting(true);
    try {
      await createBriefingMutation.mutateAsync(formData);
      toast.success("Nova proposta iniciada com sucesso!");
      
      setFormData({
        clientName: "",
        segment: "",
        cities: "",
        campaignPeriod: "",
        budget: "",
        objective: "",
        targetAudience: "",
        contactName: "",
        contactEmail: "",
        campaignName: "",
        mediaSpecs: "",
        locationSpecs: "",
        commercialTerms: "",
        moreDetails: "",
        creativityLevel: "medio",
        generatedBy: "ai",
      });

      // Redirecionar para propostas após 2 segundos
      setTimeout(() => navigate("/proposals"), 2000);
    } catch (error) {
      toast.error("Erro ao criar proposta");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--cream)" }}>
      <AppHeader user={user} activeHref="/briefing" />

      {/* Main Content */}
      <main className="container max-w-4xl mx-auto px-4 py-12">
        <Card className="border border-border/50 bg-white/50 backdrop-blur p-8">
          <div className="mb-8">
            <h2 className="text-2xl font-serif font-bold text-foreground mb-2">Nova Proposta Comercial OOH</h2>
            <p className="text-muted-foreground">
              Preencha os dados da campanha para iniciar a geração da proposta personalizada.
            </p>
          </div>

          {/* Import Briefing section */}
          <div className="mb-8 pb-8 border-b border-border/50">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Já tem um briefing do cliente?</h4>
                <p className="text-xs text-muted-foreground">
                  Suba o PDF ou cole o texto do briefing e a IA preencherá o formulário automaticamente.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowImport(!showImport)}
                className="shrink-0 ml-4 border-primary/20 text-primary hover:bg-primary/5"
              >
                {showImport ? "Preencher Manualmente" : "Tenho um briefing do cliente"}
              </Button>
            </div>

            {showImport && (
              <Card className="mt-4 p-4 border border-primary/10 bg-primary/5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                {briefingLlmError && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-col gap-2 shadow-sm text-xs">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-amber-900">IA temporariamente indisponível</p>
                        <p className="text-amber-700 mt-0.5">{briefingLlmError.message} (Detalhe: {briefingLlmError.detail})</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleImportBriefing()}
                        disabled={isImporting}
                        className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7 px-3"
                      >
                        Tentar novamente
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleImportOffline}
                        disabled={isImporting}
                        className="border-amber-400 text-amber-800 hover:bg-amber-100 text-xs h-7 px-3"
                      >
                        Gerar versão offline (template básico)
                      </Button>
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Opção A: Subir PDF do Briefing
                    </label>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setImportFile(file);
                        if (file) setImportText(""); // Clear text if file selected
                      }}
                      className="w-full text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-px bg-border flex-1" />
                    <span>ou</span>
                    <span className="h-px bg-border flex-1" />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Opção B: Colar Texto do Briefing
                    </label>
                    <textarea
                      value={importText}
                      onChange={(e) => {
                        setImportText(e.target.value);
                        if (e.target.value) setImportFile(null); // Clear file if text entered
                      }}
                      placeholder="Cole aqui o texto do email, briefing ou anotações enviadas pelo cliente..."
                      rows={4}
                      className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowImport(false);
                      setImportText("");
                      setImportFile(null);
                    }}
                    className="text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isImporting || (!importText.trim() && !importFile)}
                    onClick={handleImportBriefing}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs"
                  >
                    {isImporting ? (
                      <>
                        <Spinner className="w-3 h-3 mr-1.5 animate-spin" />
                        Importando...
                      </>
                    ) : (
                      "Importar e Preencher"
                    )}
                  </Button>
                </div>
              </Card>
            )}
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
                  Nome da Campanha (Opcional)
                </label>
                <input
                  type="text"
                  name="campaignName"
                  value={formData.campaignName}
                  onChange={handleChange}
                  placeholder="Ex: SSV Jundiaí"
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

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
                  Grau de Criatividade da IA
                </label>
                <div className="grid grid-cols-3 gap-2 bg-muted p-1 rounded-xl border border-border">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, creativityLevel: "baixo" }))}
                    className={`py-2 px-3 text-xs md:text-sm font-medium rounded-lg transition-all duration-200 ${
                      formData.creativityLevel === "baixo"
                        ? "bg-background text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Baixo (Foco Comercial)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, creativityLevel: "medio" }))}
                    className={`py-2 px-3 text-xs md:text-sm font-medium rounded-lg transition-all duration-200 ${
                      formData.creativityLevel === "medio"
                        ? "bg-background text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Médio (Equilibrado)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, creativityLevel: "alto" }))}
                    className={`py-2 px-3 text-xs md:text-sm font-medium rounded-lg transition-all duration-200 ${
                      formData.creativityLevel === "alto"
                        ? "bg-primary text-primary-foreground shadow-sm border border-primary/20"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Alto (Disruptivo ✨)
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {formData.creativityLevel === "baixo" && "💡 IA prioriza formatos tradicionais e foco pragmático de custos."}
                  {formData.creativityLevel === "medio" && "💡 IA equilibra formatos convencionais com inovações padrão."}
                  {formData.creativityLevel === "alto" && "💡 IA prioriza ativações sensoriais, guerrilha urbana e tecnologia fora da caixa."}
                </p>
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

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Público-Alvo *
                </label>
                <textarea
                  name="targetAudience"
                  value={formData.targetAudience}
                  onChange={handleChange}
                  placeholder="Ex: Jovens de 18 a 30 anos interessados em tecnologia, executivos, etc."
                  className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={3}
                  required
                />
              </div>
            </div>

            {/* Seções Opcionais Avançadas (Especificações OOH) */}
            <div className="space-y-4 pt-4 border-t border-border/50">
              <h3 className="text-lg font-semibold text-foreground">Especificações e Termos OOH (Opcional)</h3>

              {/* Especificações Técnicas */}
              <div className="border border-border/60 rounded-xl overflow-hidden bg-background/50">
                <button
                  type="button"
                  onClick={() => setShowTechSpecs(!showTechSpecs)}
                  className="w-full px-5 py-4 flex items-center justify-between text-sm font-medium text-foreground hover:bg-muted/30 transition-all"
                >
                  <span>1. Especificações Técnicas de Mídia</span>
                  <span className="text-xs text-muted-foreground">{showTechSpecs ? "Recolher ▲" : "Expandir ▼"}</span>
                </button>
                {showTechSpecs && (
                  <div className="p-5 border-t border-border/60 bg-white/20 animate-in fade-in duration-200">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Especificações técnicas de exibição (formatos, secundagem, inserções, etc.)</label>
                    <textarea
                      name="mediaSpecs"
                      value={formData.mediaSpecs}
                      onChange={handleChange}
                      placeholder="Ex: Formato digital de 1920x1080 pixels, looping com inserções diárias de 120 VTs de 15 segundos cada em formato MP4."
                      className="w-full px-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      rows={4}
                    />
                  </div>
                )}
              </div>

              {/* Requisitos do Ponto */}
              <div className="border border-border/60 rounded-xl overflow-hidden bg-background/50">
                <button
                  type="button"
                  onClick={() => setShowLocationSpecs(!showLocationSpecs)}
                  className="w-full px-5 py-4 flex items-center justify-between text-sm font-medium text-foreground hover:bg-muted/30 transition-all"
                >
                  <span>2. Dados e Exigências do Ponto</span>
                  <span className="text-xs text-muted-foreground">{showLocationSpecs ? "Recolher ▲" : "Expandir ▼"}</span>
                </button>
                {showLocationSpecs && (
                  <div className="p-5 border-t border-border/60 bg-white/20 animate-in fade-in duration-200">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Requisitos geográficos e dados físicos do ponto (foto, endereço completo, latitude/longitude, etc.)</label>
                    <textarea
                      name="locationSpecs"
                      value={formData.locationSpecs}
                      onChange={handleChange}
                      placeholder="Ex: Exige foto diurna e noturna do ponto, endereço exato e coordenadas de Latitude/Longitude obrigatoriamente."
                      className="w-full px-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      rows={4}
                    />
                  </div>
                )}
              </div>

              {/* Termos Comerciais */}
              <div className="border border-border/60 rounded-xl overflow-hidden bg-background/50">
                <button
                  type="button"
                  onClick={() => setShowCommercialTerms(!showCommercialTerms)}
                  className="w-full px-5 py-4 flex items-center justify-between text-sm font-medium text-foreground hover:bg-muted/30 transition-all"
                >
                  <span>3. Termos e Premissas Comerciais da Proposta</span>
                  <span className="text-xs text-muted-foreground">{showCommercialTerms ? "Recolher ▲" : "Expandir ▼"}</span>
                </button>
                {showCommercialTerms && (
                  <div className="p-5 border-t border-border/60 bg-white/20 animate-in fade-in duration-200">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Premissas financeiras, comissionamento e condições comerciais (pagamento, tipo de mídia, etc.)</label>
                    <textarea
                      name="commercialTerms"
                      value={formData.commercialTerms}
                      onChange={handleChange}
                      placeholder="Ex: Considerar valores líquidos mensais. Condição de pagamento de 30 DFM (dias fora o mês)."
                      className="w-full px-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      rows={4}
                    />
                  </div>
                )}
              </div>

              {/* Outras Informações / Mais Detalhes */}
              <div className="border border-border/60 rounded-xl overflow-hidden bg-background/50">
                <button
                  type="button"
                  onClick={() => setShowMoreDetails(!showMoreDetails)}
                  className="w-full px-5 py-4 flex items-center justify-between text-sm font-medium text-foreground hover:bg-muted/30 transition-all"
                >
                  <span>4. Mais Detalhes / Outras Informações da Campanha</span>
                  <span className="text-xs text-muted-foreground">{showMoreDetails ? "Recolher ▲" : "Expandir ▼"}</span>
                </button>
                {showMoreDetails && (
                  <div className="p-5 border-t border-border/60 bg-white/20 animate-in fade-in duration-200">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Outras informações da campanha (apoio local, colônias de pescadores, carros de som, etc.)</label>
                    <textarea
                      name="moreDetails"
                      value={formData.moreDetails}
                      onChange={handleChange}
                      placeholder="Ex: Foco demográfico em pescadores, marisqueiras e trabalhadores do litoral. Apoio local de colônias de pescadores, divulgação em comunidades e marinas, e carros de som territoriais."
                      className="w-full px-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      rows={4}
                    />
                  </div>
                )}
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
                    Iniciando...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Iniciar Proposta
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
            <li>Seu briefing e dados iniciais serão validados</li>
            <li>A IA analisará a praça e gerará dados de mercado</li>
            <li>Você fará o upload das tabelas de inventário e preços</li>
            <li>A IA formulará a ideia criativa e o plano de mídia</li>
            <li>A proposta será gerada e você poderá customizá-la e refiná-la</li>
          </ol>
        </Card>
      </main>
    </div>
  );
}
