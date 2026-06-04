import { storagePut } from "./storage";
import { generateProposalPDF } from "./pdf";

export async function exportProposalToPDF(proposal: {
  id: number;
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  createdAt: Date;
}): Promise<{ url: string; key: string }> {
  const pdfBuffer = await generateProposalPDF(proposal);
  const filename = `proposta_${proposal.clientName.replace(/\s+/g, "_")}_${proposal.id}.pdf`;
  const key = `proposals/${proposal.id}/${filename}`;

  const result = await storagePut(key, pdfBuffer, "application/pdf");
  return result;
}

export async function exportProposalToText(proposal: {
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  createdAt: Date;
}): Promise<{ url: string; key: string }> {
  const textContent = `PROPOSTA COMERCIAL
Data: ${proposal.createdAt.toLocaleDateString("pt-BR")}

CLIENTE
Nome: ${proposal.clientName}
Empresa: ${proposal.clientCompany}
${proposal.clientContact ? `Contato: ${proposal.clientContact}` : ""}

INFORMAÇÕES DO PROJETO
Escopo: ${proposal.projectScope}
Valores: ${proposal.values}
${proposal.deadline ? `Prazo: ${proposal.deadline}` : ""}
${proposal.commercialTerms ? `Condições Comerciais: ${proposal.commercialTerms}` : ""}

PROPOSTA
${proposal.proposalContent}`;

  const textBuffer = Buffer.from(textContent, "utf-8");
  const filename = `proposta_${proposal.clientName.replace(/\s+/g, "_")}_${Date.now()}.txt`;
  const key = `proposals/text/${filename}`;

  const result = await storagePut(key, textBuffer, "text/plain");
  return result;
}
