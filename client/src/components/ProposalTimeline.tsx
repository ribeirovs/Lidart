import { CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";

export type StageId =
  | "briefing"
  | "validation"
  | "research"
  | "inventory"
  | "pricing"
  | "product_content"
  | "strategy_workshop"
  | "idea_central"
  | "idea_validation"
  | "valuation"
  | "valuation_validation"
  | "proposal_final"
  | "customization"
  | "approval"
  | "delivery";

export interface StageInfo {
  id: StageId;
  label: string;
  desc: string;
  type: "system" | "human" | "upload";
  optional?: boolean;
}

export const STAGES: StageInfo[] = [
  { id: "briefing", label: "Briefing", desc: "Coleta dos dados iniciais da campanha", type: "human" },
  { id: "validation", label: "Validação", desc: "Verificação dos dados obrigatórios e formatos", type: "system" },
  { id: "research", label: "Pesquisa", desc: "Pesquisa automatizada de inteligência de mercado", type: "system" },
  { id: "inventory", label: "Inventário", desc: "Upload do arquivo de inventário OOH", type: "upload" },
  { id: "pricing", label: "Tabela de Preços", desc: "Upload do arquivo com a tabela de preços", type: "upload" },
  { id: "product_content", label: "Produto", desc: "Upload opcional de materiais do produto", type: "upload", optional: true },
  { id: "strategy_workshop", label: "Workshop Estratégico", desc: "Agente estrategista define tensão, insight, jornada e trade-off da campanha", type: "system" },
  { id: "idea_central", label: "Ideia Central", desc: "IA elabora o conceito criativo da campanha", type: "system" },
  { id: "idea_validation", label: "Aprovar Ideia", desc: "Validação humana da ideia central proposta", type: "human" },
  { id: "valuation", label: "Valoração", desc: "IA calcula os custos e retornos de mídia", type: "system" },
  { id: "valuation_validation", label: "Aprovar Valoração", desc: "Validação humana dos custos e orçamento", type: "human" },
  { id: "proposal_final", label: "Proposta Final", desc: "IA consolida toda a proposta em Markdown", type: "system" },
  { id: "customization", label: "Customizar", desc: "Refinamento e ajustes na proposta com IA", type: "human" },
  { id: "approval", label: "Aprovação Final", desc: "Aprovação definitiva da proposta comercial", type: "human" },
  { id: "delivery", label: "Entrega", desc: "Disponibilização da proposta", type: "system" },
];

interface ProposalTimelineProps {
  currentStage: StageId;
  activeStage?: StageId;
  proposalId?: number;
  onStageClick?: (stageId: StageId) => void;
}

export default function ProposalTimeline({ currentStage, activeStage, proposalId, onStageClick }: ProposalTimelineProps) {
  const currentIndex = STAGES.findIndex((s) => s.id === currentStage);
  const activeStageId = activeStage || currentStage;

  return (
    <TooltipProvider>
      <Card className="p-6 bg-gradient-to-br from-white/60 to-white/40 dark:from-black/60 dark:to-black/40 backdrop-blur-xl border border-white/30 dark:border-white/10 shadow-2xl rounded-2xl">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-serif font-semibold text-foreground">Acompanhamento do Processo</h3>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary uppercase tracking-wide">
              Etapa {currentIndex + 1} de {STAGES.length}
            </span>
          </div>

          {/* Stepper Container */}
          <div className="relative flex items-center justify-between gap-1 overflow-x-auto py-4 scrollbar-none">
            {/* Background Line */}
            <div className="absolute left-4 right-4 top-1/2 h-1 -translate-y-1/2 bg-muted/40 dark:bg-muted/10 -z-10 rounded-full" />

            {/* Filled Progress Line */}
            <div
              className="absolute left-4 top-1/2 h-1 -translate-y-1/2 bg-gradient-to-r from-emerald-500 to-primary -z-10 rounded-full transition-all duration-500"
              style={{
                width: `${currentIndex === 0 ? 0 : (currentIndex / (STAGES.length - 1)) * 96}%`,
              }}
            />

            {STAGES.map((stage, idx) => {
              const isCompleted = idx < currentIndex;
              const isActive = idx === currentIndex;
              const isPending = idx > currentIndex;
              const isSelected = stage.id === activeStageId;

              let stateColor = "bg-muted text-muted-foreground border-muted";
              let stateIcon = <Clock className="w-4 h-4" />;

              if (isCompleted) {
                stateColor = "bg-emerald-500 text-white border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]";
                stateIcon = <CheckCircle2 className="w-4 h-4" />;
              } else if (isActive) {
                stateColor = "bg-primary text-primary-foreground border-primary animate-pulse shadow-[0_0_20px_rgba(var(--primary-rgb),0.4)]";
                stateIcon = <Clock className="w-4 h-4" />;
              }

              let selectRing = isSelected ? "ring-2 ring-primary ring-offset-2 scale-105 border-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.3)]" : "";

              const circleContent = (
                <div
                  className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${stateColor} ${selectRing}`}
                >
                  {stateIcon}
                </div>
              );
 
              return (
                <div key={stage.id} className="flex flex-col items-center min-w-[75px] text-center relative group">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {isPending ? (
                        // Etapa futura: bloqueada (não pode pular adiante na sequência)
                        <div
                          className="block opacity-60 cursor-not-allowed"
                          title="Conclua as etapas anteriores primeiro"
                          aria-disabled="true"
                        >
                          {circleContent}
                        </div>
                      ) : proposalId ? (
                        <Link
                          href={`/proposal/${proposalId}?stage=${stage.id}`}
                          className="focus:outline-none cursor-pointer hover:scale-110 transition-all duration-250 block"
                        >
                          {circleContent}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onStageClick?.(stage.id)}
                          className="focus:outline-none cursor-pointer hover:scale-110 transition-all duration-250"
                        >
                          {circleContent}
                        </button>
                      )}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[220px] p-2.5 text-xs bg-popover/95 backdrop-blur shadow-lg border border-border">
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        {stage.label}
                        {stage.optional && (
                          <span className="text-[9px] font-medium bg-muted text-muted-foreground px-1 py-0.5 rounded">
                            Opcional
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1 leading-relaxed">{stage.desc}</p>
                      <div className="mt-1.5 text-[10px] text-primary font-medium capitalize">
                        Responsável: {stage.type === "system" ? "Robô (IA)" : stage.type === "upload" ? "Upload" : "Revisor"}
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  <span
                    className={`text-[10px] mt-2.5 font-medium truncate max-w-[70px] ${
                      isSelected ? "text-primary font-bold scale-105" : isCompleted ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/70"
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </TooltipProvider>
  );
}
