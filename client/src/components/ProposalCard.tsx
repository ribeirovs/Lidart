import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Proposal } from "@shared/types";

interface ProposalCardProps {
  proposal: Proposal;
  onView?: (id: number) => void;
  onDelete?: (id: number) => void;
  onDownload?: (id: number) => void;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-gray-100 text-gray-800" },
  sent: { label: "Enviada", color: "bg-blue-100 text-blue-800" },
  accepted: { label: "Aceita", color: "bg-green-100 text-green-800" },
  rejected: { label: "Rejeitada", color: "bg-red-100 text-red-800" },
  archived: { label: "Arquivada", color: "bg-gray-200 text-gray-700" },
};

export function ProposalCard({
  proposal,
  onView,
  onDelete,
  onDownload,
}: ProposalCardProps) {
  const statusInfo = statusLabels[proposal.status] || { label: proposal.status, color: "bg-gray-100" };

  return (
    <Card
      className="border border-border/50 bg-white/50 backdrop-blur p-6 hover:border-primary/30 transition-all cursor-pointer group"
      onClick={() => onView?.(proposal.id)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
              {proposal.clientName}
            </h3>
            <Badge className={statusInfo.color}>
              {statusInfo.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {proposal.clientCompany}
          </p>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {proposal.projectScope}
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
            <span>
              {format(new Date(proposal.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </span>
            {proposal.deadline && <span>Prazo: {proposal.deadline}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          {onDownload && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDownload(proposal.id);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="w-4 h-4" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(proposal.id);
              }}
              className="text-destructive hover:text-destructive/90"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
