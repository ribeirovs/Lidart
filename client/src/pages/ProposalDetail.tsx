import { useState, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Download, Edit2, Save, X, FileText, Wand2, Calculator, FileCheck, Send, UploadCloud, Check, Globe, ExternalLink, MessageSquare, Sparkles, RefreshCw, AlertTriangle, Copy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { Textarea } from "@/components/ui/textarea";
import ProposalTimeline, { StageId, STAGES } from "@/components/ProposalTimeline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ProposalDetail() {
  const [, params] = useRoute("/proposal/:id");
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const [urlStage, setUrlStage] = useState<StageId | null>(null);

  useEffect(() => {
    const handleUrlChange = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const stage = searchParams.get("stage") as StageId | null;
      setUrlStage(stage);
    };

    handleUrlChange();

    window.addEventListener("popstate", handleUrlChange);
    const interval = setInterval(handleUrlChange, 150);

    return () => {
      window.removeEventListener("popstate", handleUrlChange);
      clearInterval(interval);
    };
  }, []);

  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");

  const [slideSelections, setSlideSelections] = useState({
    capa: true,
    defesa: true,
    conceito: true,
    detalhes: true,
    valoracao: true,
    cronograma: true,
  });

  const [selectedPaletteId, setSelectedPaletteId] = useState<string>("default");

  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPPTX, setIsExportingPPTX] = useState(false);
  const [isExportingDeck, setIsExportingDeck] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyProposal = async () => {
    if (!proposal?.proposalContent) return;
    try {
      await navigator.clipboard.writeText(proposal.proposalContent);
      setIsCopied(true);
      toast.success("Proposta copiada para a área de transferência!");
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error("Erro ao copiar proposta");
    }
  };

  const [refineInstruction, setRefineInstruction] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  const [viewingPdfUrl, setViewingPdfUrl] = useState<string | null>(null);

  // Customization Stage States
  const [customChatText, setCustomChatText] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [customBriefingText, setCustomBriefingText] = useState("");
  const [customBriefingFile, setCustomBriefingFile] = useState<File | null>(null);
  const [isCustomBriefingUpdating, setIsCustomBriefingUpdating] = useState(false);
  const [activeCustomTab, setActiveCustomTab] = useState("chat");

  const refineWithNewBriefingMutation = trpc.proposals.refineWithNewBriefing.useMutation();
  const chatRefineMutation = trpc.proposals.chatRefine.useMutation();

  const generateOfflineMutation = trpc.proposals.generateOffline.useMutation();

  const proposalId = params?.id ? parseInt(params.id) : null;
  const { data: proposal, isLoading, refetch } = trpc.proposals.getById.useQuery(
    { id: proposalId! },
    { enabled: !!proposalId }
  );

  const activeStage = urlStage || (proposal?.currentStage as StageId) || "briefing";
  const isInteractiveStage = ["research", "strategy_workshop", "idea_central", "idea_validation", "valuation", "valuation_validation", "proposal_final", "customization", "approval"].includes(activeStage);
  
  const { data: resources = [] } = trpc.resources.list.useQuery();
  const updateMutation = trpc.proposals.update.useMutation();

  // Verificador inline REMOVIDO desta etapa (a pedido): o bloqueio na EXPORTAÇÃO
  // (gateNarrativeExport, "Exportar mesmo assim?") cobre a segurança. A query
  // proposals.verifyNarrative segue no backend caso a gente queira reativar o painel.

  const advanceFromUploadsMutation = trpc.proposals.advanceFromUploads.useMutation();
  const generateStageContentMutation = trpc.proposals.generateStageContent.useMutation();
  const generateStrategyWorkshopMutation = trpc.proposals.generateStrategyWorkshop.useMutation();
  const validateIdeaMutation = trpc.proposals.validateIdea.useMutation();
  const validateValuationMutation = trpc.proposals.validateValuation.useMutation();
  const approveFinalMutation = trpc.proposals.approveFinal.useMutation();
  const deliverMutation = trpc.proposals.deliver.useMutation();

  const [isActionPending, setIsActionPending] = useState(false);
  // LLM error state — shown as inline banner with retry / offline options
  const [llmError, setLlmError] = useState<{
    message: string;
    detail: string;
    llmErrorType: string;
    pendingStage?: "idea_central" | "valuation" | "proposal_final";
    retryFn?: () => void;
  } | null>(null);

  const hasInventory = resources.some((r) => r.type === "inventory");
  const hasPricing = resources.some((r) => r.type === "pricing");

  // ─── Parse structured LLM error from TRPCError message ────────────────────
  function parseLLMError(error: unknown): {
    isLLMError: boolean;
    message: string;
    detail: string;
    llmErrorType: string;
  } {
    try {
      const msg = (error as any)?.message ?? "";
      const parsed = JSON.parse(msg);
      if (parsed?.errorType === "llm_unavailable") {
        return {
          isLLMError: true,
          message: parsed.message ?? "IA indispon\u00edvel.",
          detail: parsed.detail ?? "",
          llmErrorType: parsed.llmErrorType ?? "unknown",
        };
      }
    } catch (_) {}
    return { isLLMError: false, message: "", detail: "", llmErrorType: "" };
  }

  const handleStageAction = async (
    action: () => Promise<any>,
    successMsg: string,
    errorMsg: string,
    stage?: "idea_central" | "valuation" | "proposal_final"
  ) => {
    setIsActionPending(true);
    setLlmError(null);
    try {
      const result = await action();
      toast.success(successMsg);
      if (result && typeof result === "object" && "nextStage" in result) {
        navigate(`/proposal/${proposalId}?stage=${result.nextStage}`);
      } else {
        navigate(`/proposal/${proposalId}`);
      }
      await refetch();
    } catch (error) {
      const parsed = parseLLMError(error);
      if (parsed.isLLMError) {
        setLlmError({
          message: parsed.message,
          detail: parsed.detail,
          llmErrorType: parsed.llmErrorType,
          pendingStage: stage,
          retryFn: () => handleStageAction(action, successMsg, errorMsg, stage),
        });
      } else {
        toast.error(errorMsg);
        console.error(error);
      }
    } finally {
      setIsActionPending(false);
    }
  };

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

  const downloadPDFMutation = trpc.proposals.exportPDF.useMutation();
  const downloadTextMutation = trpc.proposals.exportText.useMutation();
  const downloadHTMLMutation = trpc.proposals.exportHTML.useMutation();
  const exportExcelMutation = trpc.proposals.exportExcel.useMutation();
  const exportPPTXMutation = trpc.proposals.exportPPTX.useMutation();
  const exportPremiumDeckMutation = trpc.proposals.exportPremiumDeck.useMutation();
  const refineContentMutation = trpc.proposals.refineContent.useMutation();

  // Bloqueio do verificador: se o backend recusar por pontos CRÍTICOS fora do plano,
  // mostra os pontos e pergunta se exporta mesmo assim (re-chama com force=true).
  const withVerificador = async <T,>(run: (force: boolean) => Promise<T>): Promise<T | null> => {
    try {
      return await run(false);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("[VERIFICADOR]")) {
        const ok = window.confirm("⚠️ " + msg.replace("[VERIFICADOR] ", "") + "\n\nExportar mesmo assim?");
        if (ok) return await run(true);
        return null;
      }
      throw e;
    }
  };

  const handleDownloadPDF = async () => {
    if (!proposal) return;
    try {
      const result = await withVerificador((force) => downloadPDFMutation.mutateAsync({ id: proposal.id, force }));
      if (!result) return;
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

  const handleViewPDF = async () => {
    if (!proposal) return;
    try {
      const result = await withVerificador((force) => downloadPDFMutation.mutateAsync({ id: proposal.id, force }));
      if (!result) return;
      setViewingPdfUrl(result.url);
    } catch (error) {
      toast.error("Erro ao gerar visualização do PDF");
      console.error(error);
    }
  };

  const handleDownloadText = async () => {
    if (!proposal) return;
    try {
      const result = await withVerificador((force) => downloadTextMutation.mutateAsync({ id: proposal.id, force }));
      if (!result) return;
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Arquivo de texto baixado com sucesso!");
    } catch (error) {
      toast.error("Erro ao baixar arquivo");
      console.error(error);
    }
  };

  const handleViewHTML = async () => {
    if (!proposal) return;
    // Abre a aba JÁ no clique (gesto do usuário) p/ não ser bloqueada como popup —
    // o window.open vinha DEPOIS do await e o navegador bloqueava (HTML "não abria").
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(
        "<!doctype html><meta charset='utf-8'><title>Gerando apresentação…</title>" +
        "<body style='margin:0;font-family:system-ui,sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;color:#555'>Gerando apresentação…</body>"
      );
    }
    try {
      const result = await withVerificador((force) => downloadHTMLMutation.mutateAsync({ id: proposal.id, force }));
      if (!result) { if (win && !win.closed) win.close(); return; }
      const abs = new URL(result.url, window.location.origin).href; // URL absoluta (about:blank não resolve relativa)
      if (win && !win.closed) {
        win.location.href = abs;
      } else {
        // popup foi bloqueado mesmo assim: tenta de novo e, em último caso, navega na aba atual
        const w2 = window.open(abs, "_blank");
        if (!w2) window.location.href = abs;
      }
      toast.success("Visualização web (HTML) gerada com sucesso!");
    } catch (error) {
      if (win && !win.closed) win.close();
      toast.error("Erro ao gerar visualização web (HTML)");
      console.error(error);
    }
  };

  const handleExportExcel = async () => {
    if (!proposal) return;
    setIsExportingExcel(true);
    try {
      const result = await exportExcelMutation.mutateAsync({ id: proposal.id });
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Planilha Excel gerada com sucesso!");
    } catch (error) {
      toast.error("Erro ao exportar planilha Excel");
      console.error(error);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportPPTX = async () => {
    if (!proposal) return;
    setIsExportingPPTX(true);
    try {
      const result = await withVerificador((force) => exportPPTXMutation.mutateAsync({
        id: proposal.id,
        selections: slideSelections,
        paletteId: selectedPaletteId,
        force,
      }));
      if (!result) return;
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Apresentação PPTX gerada com sucesso!");
    } catch (error) {
      toast.error("Erro ao exportar apresentação PPTX");
      console.error(error);
    } finally {
      setIsExportingPPTX(false);
    }
  };

  const handleExportPremiumDeck = async () => {
    if (!proposal) return;
    setIsExportingDeck(true);
    try {
      const result = await withVerificador((force) => exportPremiumDeckMutation.mutateAsync({
        id: proposal.id,
        force,
      }));
      if (!result) return;
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Deck Premium gerado com sucesso!");
    } catch (error) {
      toast.error("Erro ao gerar o Deck Premium");
      console.error(error);
    } finally {
      setIsExportingDeck(false);
    }
  };

  const handleRefineContent = async (stageKey: "idea_central" | "valuation" | "proposal_final") => {
    if (!proposal || !refineInstruction.trim()) return;
    setIsRefining(true);
    try {
      const result = await refineContentMutation.mutateAsync({
        id: proposal.id,
        stage: stageKey,
        instruction: refineInstruction,
      });
      toast.success("Conteúdo refinado com sucesso!");
      setRefineInstruction("");
      await refetch();
    } catch (error) {
      toast.error("Erro ao refinar conteúdo");
      console.error(error);
    } finally {
      setIsRefining(false);
    }
  };

  const handleChatRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposal || !customChatText.trim() || isChatSending) return;

    setIsChatSending(true);
    try {
      await chatRefineMutation.mutateAsync({
        id: proposal.id,
        message: customChatText,
      });
      toast.success("Proposta ajustada com sucesso!");
      setCustomChatText("");
      await refetch();
    } catch (error) {
      toast.error("Erro ao ajustar proposta via chat");
      console.error(error);
    } finally {
      setIsChatSending(false);
    }
  };

  const handleBriefingUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposal) return;
    if (!customBriefingText.trim() && !customBriefingFile) {
      toast.error("Insira o texto do briefing ou selecione um arquivo PDF");
      return;
    }

    setIsCustomBriefingUpdating(true);
    try {
      let textToSubmit = customBriefingText;

      if (customBriefingFile) {
        const body = new FormData();
        body.append("file", customBriefingFile);

        const response = await fetch("/api/parse-briefing", {
          method: "POST",
          body,
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Erro ao processar arquivo");
        }

        const result = await response.json();
        textToSubmit = result.rawText || "";
      }

      await refineWithNewBriefingMutation.mutateAsync({
        id: proposal.id,
        briefingText: textToSubmit,
      });

      toast.success("Proposta atualizada com base no novo briefing!");
      setCustomBriefingText("");
      setCustomBriefingFile(null);
      await refetch();
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar proposta");
      console.error(error);
    } finally {
      setIsCustomBriefingUpdating(false);
    }
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
                  onClick={handleCopyProposal}
                  className="text-muted-foreground hover:text-foreground"
                  title="Copiar proposta"
                >
                  {isCopied ? (
                    <Check className="w-4 h-4 mr-2 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4 mr-2" />
                  )}
                  {isCopied ? "Copiada!" : "Copiar"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPDF}
                  disabled={downloadPDFMutation.isPending}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="w-4 h-4 mr-2" />
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadText}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Texto
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportExcel}
                  disabled={isExportingExcel}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Calculator className="w-4 h-4 mr-2 text-emerald-600" />
                  Excel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportPPTX}
                  disabled={isExportingPPTX}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Wand2 className="w-4 h-4 mr-2 text-blue-600" />
                  PPTX
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportPremiumDeck}
                  disabled={isExportingDeck}
                  className="text-primary border-primary/40 hover:bg-primary/5 font-medium"
                >
                  <Wand2 className="w-4 h-4 mr-2 text-primary" />
                  {isExportingDeck ? "Gerando deck…" : "Deck Premium (IA)"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleViewHTML}
                  disabled={downloadHTMLMutation.isPending}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Globe className="w-4 h-4 mr-2 text-primary" />
                  Visualizar Web (HTML)
                  <ExternalLink className="w-3 h-3 ml-1 opacity-70" />
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
      <main className={`container ${isInteractiveStage ? "max-w-7xl" : "max-w-4xl"} mx-auto px-4 py-12`}>
        <div className="space-y-6">
          {/* Proposal Timeline */}
          <ProposalTimeline 
            currentStage={proposal.currentStage as StageId} 
            activeStage={activeStage}
            proposalId={proposal.id}
            onStageClick={(stageId) => navigate(`/proposal/${proposal.id}?stage=${stageId}`)}
          />

          {/* LLM Error Banner */}
          {llmError && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-3 shadow-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">IA temporariamente indisponível</p>
                  <p className="text-xs text-amber-700 mt-0.5">{llmError.message}</p>
                  {llmError.llmErrorType === "quota_exhausted" && (
                    <p className="text-xs text-amber-600 mt-1">
                      Acesse o painel Manus para recarregar créditos e tente novamente.
                    </p>
                  )}
                </div>
                <button onClick={() => setLlmError(null)} className="text-amber-500 hover:text-amber-700 shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {llmError.retryFn && (
                  <Button
                    size="sm"
                    onClick={() => { llmError.retryFn?.(); }}
                    disabled={isActionPending}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                    Tentar novamente
                  </Button>
                )}
                {llmError.pendingStage && proposal && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await generateOfflineMutation.mutateAsync({
                          id: proposal.id,
                          stageToGenerate: llmError.pendingStage!,
                        });
                        toast.success("Template gerado offline. Revise antes de enviar ao cliente.");
                        setLlmError(null);
                        await refetch();
                      } catch (err) {
                        toast.error("Erro ao gerar template offline");
                      }
                    }}
                    disabled={generateOfflineMutation.isPending}
                    className="text-xs border-amber-400 text-amber-800 hover:bg-amber-100"
                  >
                    Gerar versão offline (template básico)
                  </Button>
                )}
              </div>
            </div>
          )}

          {isInteractiveStage ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch mt-6 animate-in fade-in duration-200">
              {/* Left Pane - Markdown Preview */}
              <div className="lg:col-span-7 flex flex-col">
                <Card className="border border-border/50 bg-white/50 backdrop-blur p-6 flex-1 flex flex-col shadow-lg rounded-2xl min-h-[500px] lg:h-[700px]">
                  <div className="flex items-center justify-between pb-4 border-b border-border/50 mb-4 shrink-0">
                    <h3 className="text-lg font-serif font-bold text-foreground">Prévia da Proposta</h3>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsEditing(true);
                          setEditedContent(proposal.proposalContent);
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Edit2 className="w-3.5 h-3.5 mr-1" />
                        Editar Manual
                      </Button>
                    </div>
                  </div>
                  
                  {isEditing ? (
                    <div className="flex-1 flex flex-col">
                      <Textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="flex-1 min-h-[400px] bg-background border-border font-mono text-xs p-3 focus:ring-1 resize-none"
                      />
                      <div className="flex justify-end gap-2 mt-4 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsEditing(false)}
                          className="text-xs"
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={updateMutation.isPending}
                          className="bg-primary text-primary-foreground text-xs"
                        >
                          Salvar Alterações
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar max-h-[550px] lg:max-h-[600px]">
                      <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
                        <Streamdown>{proposal.proposalContent}</Streamdown>
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              {/* Right Pane - Action Panel + Chat Customization */}
              <div className="lg:col-span-5 flex flex-col gap-6 lg:h-[700px]">
                {/* Action Control Panel */}
                <Card className="border border-primary/20 bg-gradient-to-r from-primary/5 to-muted/20 p-5 shadow-md rounded-2xl shrink-0">
                  {activeStage !== proposal.currentStage && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50/80 p-2.5 flex flex-col gap-2 text-xs mb-3">
                      <span className="text-amber-800">
                        Você está visualizando a etapa de <strong>{STAGES.find(s => s.id === activeStage)?.label}</strong>. A etapa ativa do projeto é <strong>{STAGES.find(s => s.id === proposal.currentStage)?.label}</strong>.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await updateMutation.mutateAsync({
                              id: proposal.id,
                              currentStage: activeStage,
                            });
                            toast.success("Etapa ativa do projeto alterada!");
                            await refetch();
                          } catch (err) {
                            toast.error("Erro ao alterar etapa");
                          }
                        }}
                        disabled={updateMutation.isPending}
                        className="border-amber-400 text-amber-900 hover:bg-amber-100 text-xs w-full"
                      >
                        Definir como Etapa Ativa
                      </Button>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        {activeStage === "research" && "Etapa 3: Coleta de Dados de Pesquisa"}
                        {activeStage === "strategy_workshop" && "Etapa 6: Workshop Estratégico"}
                        {activeStage === "idea_central" && "Etapa 7: Gerar Ideia Central da Campanha"}
                        {activeStage === "idea_validation" && "Etapa 8: Aprovar Ideia Central"}
                        {activeStage === "valuation" && "Etapa 9: Calcular Valoração Mídia OOH"}
                        {activeStage === "valuation_validation" && "Etapa 10: Aprovar Plano de Custos/Valoração"}
                        {activeStage === "proposal_final" && "Etapa 11: Gerar Proposta Comercial Consolidada"}
                        {activeStage === "customization" && "Etapa 12: Customizar Proposta Comercial"}
                        {activeStage === "approval" && "Etapa 13: Aprovação Final"}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {activeStage === "research" && "Processando inteligência de mercado automatizada para a praça selecionada."}
                        {activeStage === "strategy_workshop" && "O agente estrategista sênior analisa o briefing e o inventário para definir tensão de mercado, insight, jornada do target e o trade-off da estratégia — a base de uma proposta defensável."}
                        {activeStage === "idea_central" && "Pronto para gerar a Ideia Central e mote criativo do projeto com Inteligência Artificial."}
                        {activeStage === "idea_validation" && "Revise a Ideia Central no documento gerado à esquerda e valide para destravar o cálculo financeiro."}
                        {activeStage === "valuation" && "A IA calculará a distribuição orçamentária e o ROI estimado do projeto."}
                        {activeStage === "valuation_validation" && "Revise a planilha e valoração de custos e valide para destravar a proposta consolidada."}
                        {activeStage === "proposal_final" && "Gere o documento final que reúne todos os itens anteriores de forma unificada e profissional."}
                        {activeStage === "customization" && "Ajuste e refine a proposta gerada pela IA usando o chat copiloto ou editando o texto diretamente."}
                        {activeStage === "approval" && "Revise a proposta na íntegra à esquerda e conceda a aprovação comercial final."}
                      </p>
                    </div>

                    <div className="pt-2">
                      {/* Action buttons based on activeStage */}
                      {activeStage === "research" && (
                        <Button
                          onClick={() => handleStageAction(
                            () => updateMutation.mutateAsync({ id: proposal.id, currentStage: "inventory" }),
                            "Pesquisa concluída!",
                            "Erro ao atualizar etapa"
                          )}
                          disabled={isActionPending}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-lg"
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Avançar para Inventário
                        </Button>
                      )}

                      {activeStage === "strategy_workshop" && (
                        <Button
                          onClick={() => handleStageAction(
                            () => generateStrategyWorkshopMutation.mutateAsync({ id: proposal.id }),
                            "Workshop Estratégico concluído! Tensão, insight, jornada e trade-off gerados.",
                            "Erro ao executar o Workshop Estratégico"
                          )}
                          disabled={isActionPending}
                          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold py-2 rounded-lg"
                        >
                          {isActionPending ? (
                            <><Spinner className="w-3.5 h-3.5 mr-1" /> Executando estrategista...</>
                          ) : (
                            <><Sparkles className="w-3.5 h-3.5 mr-1" /> Executar Workshop Estratégico</>
                          )}
                        </Button>
                      )}

                      {activeStage === "idea_central" && (
                        <Button
                          onClick={() => handleStageAction(
                            () => generateStageContentMutation.mutateAsync({ id: proposal.id, stageToGenerate: "idea_central" }),
                            "Ideia Central gerada com sucesso pela IA!",
                            "Erro ao gerar Ideia Central",
                            "idea_central"
                          )}
                          disabled={isActionPending}
                          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold py-2 rounded-lg"
                        >
                          <Wand2 className="w-3.5 h-3.5 mr-1" />
                          Gerar Ideia Central com IA
                        </Button>
                      )}

                      {activeStage === "idea_validation" && (
                        <Button
                          onClick={() => handleStageAction(
                            () => validateIdeaMutation.mutateAsync({ id: proposal.id }),
                            "Ideia Central aprovada e validada!",
                            "Erro ao aprovar Ideia Central"
                          )}
                          disabled={isActionPending}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-lg"
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Aprovar e Validar Ideia Central
                        </Button>
                      )}

                      {activeStage === "valuation" && (
                        <div className="space-y-2">
                          <Link href={`/proposal/${proposal.id}/plano-midia`}>
                            <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold py-2 rounded-lg">
                              <Calculator className="w-3.5 h-3.5 mr-1" />
                              Selecionar Cotas (Plano de Mídia)
                            </Button>
                          </Link>
                          <p className="text-[11px] text-muted-foreground text-center">
                            Escolha as linhas exatas do catálogo Kallas. Preços vêm da tabela oficial, sem estimativa.
                          </p>
                        </div>
                      )}

                      {activeStage === "valuation_validation" && (
                        <Button
                          onClick={() => handleStageAction(
                            () => validateValuationMutation.mutateAsync({ id: proposal.id }),
                            "Valoração e custos aprovados!",
                            "Erro ao aprovar valoração"
                          )}
                          disabled={isActionPending}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-lg"
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Aprovar e Validar Valoração
                        </Button>
                      )}

                      {activeStage === "proposal_final" && (
                        <div className="flex flex-col gap-2">
                          <Button
                            onClick={() => handleStageAction(
                              () => generateStageContentMutation.mutateAsync({ id: proposal.id, stageToGenerate: "proposal_final" }),
                              "Proposta Comercial consolidada gerada pela IA!",
                              "Erro ao gerar proposta comercial",
                              "proposal_final"
                            )}
                            disabled={isActionPending}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold py-2 rounded-lg"
                          >
                            <Wand2 className="w-3.5 h-3.5 mr-1" />
                            {proposal.proposalContent ? "Regerar Proposta Final com IA" : "Gerar Proposta Final com IA"}
                          </Button>
                          {proposal.proposalContent && (
                            <Link href={`/proposal/${proposal.id}?stage=customization`}>
                              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-lg">
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Avançar para Customizar (Refinamento)
                              </Button>
                            </Link>
                          )}
                        </div>
                      )}

                      {activeStage === "customization" && (
                        <Button
                          onClick={() => handleStageAction(
                            () => updateMutation.mutateAsync({ id: proposal.id, currentStage: "approval" }),
                            "Avançado para a Aprovação Final!",
                            "Erro ao avançar etapa"
                          )}
                          disabled={isActionPending}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-lg shadow-md"
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Finalizar e Avançar para Aprovação
                        </Button>
                      )}

                      {activeStage === "approval" && (
                        <Button
                          onClick={() => handleStageAction(
                            () => approveFinalMutation.mutateAsync({ id: proposal.id }),
                            "Proposta Comercial aprovada com sucesso!",
                            "Erro ao aprovar proposta"
                          )}
                          disabled={isActionPending}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-lg"
                        >
                          <FileCheck className="w-3.5 h-3.5 mr-1" />
                          Aprovar Proposta Comercial
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Chat Card */}
                <Card className="border border-border/50 bg-white/50 backdrop-blur p-5 flex-1 flex flex-col shadow-lg rounded-2xl min-h-[300px]">
                  <Tabs value={activeCustomTab} onValueChange={setActiveCustomTab} className="flex-1 flex flex-col">
                    <TabsList className="grid grid-cols-2 mb-3 shrink-0 bg-muted/50 p-1 rounded-lg">
                      <TabsTrigger value="chat" className="text-xs py-1.5 rounded-md font-medium">Chat de Refinamento</TabsTrigger>
                      <TabsTrigger value="briefing" className="text-xs py-1.5 rounded-md font-medium">Importar Briefing Atualizado</TabsTrigger>
                    </TabsList>

                    {/* Chat Tab Content */}
                    <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 focus-visible:outline-none focus-visible:ring-0">
                      {/* Chat messages */}
                      <div className="flex-1 overflow-y-auto pr-1 space-y-3 mb-3 max-h-[300px] lg:max-h-[350px] min-h-[150px]">
                        {(() => {
                          let chatHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
                          if (proposal.chatHistory) {
                            try {
                              chatHistory = JSON.parse(proposal.chatHistory);
                            } catch (e) {
                              console.error(e);
                            }
                          }
                          
                          if (chatHistory.length === 0) {
                            return (
                              <div className="flex flex-col items-center justify-center text-center p-6 h-full space-y-2">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                  <Sparkles className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-foreground">Como deseja ajustar a proposta?</p>
                                  <p className="text-[10px] text-muted-foreground mt-1 max-w-[250px]">
                                    Converse em linguagem natural com a IA. Ex: "mude o tom para mais consultivo", "tire a cidade de São Paulo", "troque o termo Kallax por Kallas".
                                  </p>
                                </div>
                              </div>
                            );
                          }

                          return chatHistory.map((msg, i) => (
                            <div
                              key={i}
                              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs shadow-sm ${
                                  msg.role === "user"
                                    ? "bg-slate-800 text-white rounded-tr-none"
                                    : "bg-white border border-border/60 text-foreground rounded-tl-none"
                                }`}
                              >
                                {msg.content}
                              </div>
                            </div>
                          ));
                        })()}
                        {isChatSending && (
                          <div className="flex justify-start">
                            <div className="bg-white border border-border/60 rounded-2xl rounded-tl-none px-3 py-2 flex gap-1 items-center">
                              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Chat Input */}
                      <form onSubmit={handleChatRefine} className="flex gap-2 border-t border-border/40 pt-2 shrink-0">
                        <input
                          type="text"
                          value={customChatText}
                          onChange={(e) => setCustomChatText(e.target.value)}
                          placeholder="Ex: Altere o termo Kallax para Kallas..."
                          disabled={isChatSending}
                          className="flex-1 px-3 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isChatSending || !customChatText.trim()}
                          className="bg-primary text-primary-foreground font-semibold px-3 shrink-0 rounded-lg text-xs"
                        >
                          Enviar
                        </Button>
                      </form>
                    </TabsContent>

                    {/* Briefing Tab Content */}
                    <TabsContent value="briefing" className="flex-1 flex flex-col justify-between focus-visible:outline-none focus-visible:ring-0">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-semibold text-foreground mb-1">
                            Opção A: Subir Briefing Atualizado (PDF)
                          </label>
                          <input
                            type="file"
                            accept=".pdf"
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              setCustomBriefingFile(file);
                              if (file) setCustomBriefingText("");
                            }}
                            className="w-full text-xs text-muted-foreground file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-[10px] file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
                          />
                        </div>

                        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                          <span className="h-px bg-border flex-1" />
                          <span>ou</span>
                          <span className="h-px bg-border flex-1" />
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-foreground mb-1">
                            Opção B: Colar Ajustes do Cliente (Texto)
                          </label>
                          <textarea
                            value={customBriefingText}
                            onChange={(e) => {
                              setCustomBriefingText(e.target.value);
                              if (e.target.value) setCustomBriefingFile(null);
                            }}
                            placeholder="Ex: Orçamento mudou para R$ 60.000..."
                            rows={3}
                            className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>

                      <Button
                        type="button"
                        onClick={handleBriefingUpdate}
                        disabled={isCustomBriefingUpdating || (!customBriefingText.trim() && !customBriefingFile)}
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2 mt-3 shrink-0 rounded-lg text-xs"
                      >
                        {isCustomBriefingUpdating ? (
                          <>
                            <Spinner className="w-3 h-3 mr-1.5 animate-spin" />
                            Atualizando...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3 h-3 mr-1.5" />
                            Aplicar Ajustes
                          </>
                        )}
                      </Button>
                    </TabsContent>
                  </Tabs>
                </Card>
              </div>
            </div>
          ) : (
            <>
              {/* Action Control Panel based on activeStage */}
              {activeStage !== "delivery" && (
                <Card className="border border-primary/20 bg-gradient-to-r from-primary/5 to-muted/20 p-6 space-y-4 shadow-md rounded-xl">
                  {activeStage !== proposal.currentStage && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50/80 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs mb-2">
                      <span className="text-amber-800">
                        Você está visualizando a etapa de <strong>{STAGES.find(s => s.id === activeStage)?.label}</strong>. A etapa ativa do projeto é <strong>{STAGES.find(s => s.id === proposal.currentStage)?.label}</strong>.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await updateMutation.mutateAsync({
                              id: proposal.id,
                              currentStage: activeStage,
                            });
                            toast.success("Etapa ativa do projeto alterada!");
                            await refetch();
                          } catch (err) {
                            toast.error("Erro ao alterar etapa");
                          }
                        }}
                        disabled={updateMutation.isPending}
                        className="border-amber-400 text-amber-905 hover:bg-amber-100 text-xs shrink-0 self-end sm:self-center h-8"
                      >
                        Definir como Etapa Ativa
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        {activeStage === "briefing" && "Etapa 1: Briefing Recebido"}
                        {activeStage === "validation" && "Etapa 2: Validação Automatizada"}
                        {activeStage === "inventory" && "Etapa 4: Carregar Inventário (Obrigatório)"}
                        {activeStage === "pricing" && "Etapa 5: Carregar Tabela de Preços (Obrigatório)"}
                        {activeStage === "product_content" && "Etapa 6: Carregar Informações do Produto (Opcional)"}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {activeStage === "briefing" && "Os dados do briefing foram preenchidos com sucesso."}
                        {activeStage === "validation" && "Aguarde a validação das regras de negócios pelo sistema."}
                        {activeStage === "inventory" && (hasInventory ? "Inventário detectado no sistema! Clique abaixo para avançar." : "Você precisa fazer o upload de um arquivo de inventário OOH na tela de Recursos.")}
                        {activeStage === "pricing" && (hasPricing ? "Tabela de preços detectada no sistema! Clique abaixo para avançar." : "Você precisa fazer o upload de uma tabela de preços na tela de Recursos.")}
                        {activeStage === "product_content" && "Esta etapa de upload é opcional. Você pode anexar arquivos de produto ou prosseguir."}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* Inventory Action */}
                      {activeStage === "inventory" && (
                        hasInventory ? (
                          <Button
                            onClick={() => handleStageAction(
                              () => advanceFromUploadsMutation.mutateAsync({ id: proposal.id }),
                              "Etapa de inventário concluída!",
                              "Erro ao atualizar etapa"
                            )}
                            disabled={isActionPending}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Avançar para Preços
                          </Button>
                        ) : (
                          <Link href="/resources">
                            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium">
                              <UploadCloud className="w-4 h-4 mr-2" />
                              Gerenciar Recursos
                            </Button>
                          </Link>
                        )
                      )}

                      {/* Pricing Action */}
                      {activeStage === "pricing" && (
                        hasPricing ? (
                          <Button
                            onClick={() => handleStageAction(
                              () => updateMutation.mutateAsync({ id: proposal.id, currentStage: "product_content" }),
                              "Tabela de preços confirmada!",
                              "Erro ao atualizar etapa"
                            )}
                            disabled={isActionPending}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Avançar para Produto
                          </Button>
                        ) : (
                          <Link href="/resources">
                            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium">
                              <UploadCloud className="w-4 h-4 mr-2" />
                              Gerenciar Recursos
                            </Button>
                          </Link>
                        )
                      )}

                      {/* Product Action (Optional) */}
                      {activeStage === "product_content" && (
                        <Button
                          onClick={() => handleStageAction(
                            () => updateMutation.mutateAsync({ id: proposal.id, currentStage: "strategy_workshop" }),
                            "Avançado para o Workshop Estratégico!",
                            "Erro ao atualizar etapa"
                          )}
                          disabled={isActionPending}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                        >
                          <Check className="w-4 h-4 mr-2" />
                          Avançar para o Workshop
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              )}

              {/* Delivery State Action */}
              {activeStage === "delivery" && proposal.status === "accepted" && (
                <Card className="border border-emerald-500/30 bg-emerald-500/5 p-6 space-y-4 shadow-md rounded-xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        Proposta Aprovada - Aguardando Finalização
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        A proposta foi totalmente validada e aprovada pelo cliente. Clique abaixo para concluir o processo e baixar a versão final em PDF.
                      </p>
                    </div>
                    <Button
                      onClick={() => handleStageAction(
                        async () => {
                          await deliverMutation.mutateAsync({ id: proposal.id });
                          await handleDownloadPDF();
                        },
                        "Proposta Comercial concluída e PDF baixado com sucesso!",
                        "Erro ao finalizar proposta"
                      )}
                      disabled={isActionPending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shrink-0"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Concluir e Baixar PDF
                    </Button>
                  </div>
                </Card>
              )}

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
            </>
          )}
        </div>
      </main>

      {/* PDF Viewer Modal */}
      {viewingPdfUrl && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-background border border-border w-full max-w-5xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
              <h3 className="font-serif font-bold text-lg text-foreground">Visualização da Proposta (PDF)</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewingPdfUrl(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5 mr-1" />
                Fechar
              </Button>
            </div>
            <div className="flex-1 bg-muted">
              <iframe
                src={viewingPdfUrl}
                className="w-full h-full border-none"
                title="Visualização da Proposta"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
