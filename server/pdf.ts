import { jsPDF } from "jspdf";

export async function generateProposalPDF(proposal: {
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  createdAt: Date;
}): Promise<Buffer> {
  const doc = new jsPDF();
  
  let yPosition = 20;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const maxWidth = pageWidth - 2 * margin;

  // Helper function to add text with line breaks
  const addText = (text: string, fontSize: number = 12, isBold: boolean = false) => {
    doc.setFontSize(fontSize);
    if (isBold) {
      doc.setFont("helvetica", "bold");
    } else {
      doc.setFont("helvetica", "normal");
    }
    
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line: string) => {
      if (yPosition > pageHeight - 20) {
        doc.addPage();
        yPosition = 20;
      }
      doc.text(line, margin, yPosition);
      yPosition += 7;
    });
  };

  // Header
  addText("PROPOSTA COMERCIAL", 20, true);
  yPosition += 5;
  addText(`Data: ${proposal.createdAt.toLocaleDateString("pt-BR")}`, 10, false);
  yPosition += 10;

  // Client Info
  addText("CLIENTE", 14, true);
  yPosition += 3;
  addText(`Nome: ${proposal.clientName}`, 11, false);
  addText(`Empresa: ${proposal.clientCompany}`, 11, false);
  if (proposal.clientContact) {
    addText(`Contato: ${proposal.clientContact}`, 11, false);
  }
  yPosition += 5;

  // Project Info
  addText("INFORMAÇÕES DO PROJETO", 14, true);
  yPosition += 3;
  addText(`Escopo: ${proposal.projectScope}`, 11, false);
  addText(`Valores: ${proposal.values}`, 11, false);
  if (proposal.deadline) {
    addText(`Prazo: ${proposal.deadline}`, 11, false);
  }
  if (proposal.commercialTerms) {
    addText(`Condições Comerciais: ${proposal.commercialTerms}`, 11, false);
  }
  yPosition += 5;

  // Proposal Content
  addText("PROPOSTA", 14, true);
  yPosition += 3;
  
  // Convert markdown to simple text (basic conversion)
  const content = proposal.proposalContent
    .replace(/^### (.*?)$/gm, "$1")
    .replace(/^## (.*?)$/gm, "$1")
    .replace(/^# (.*?)$/gm, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1");

  addText(content, 11, false);

  return Buffer.from(doc.output("arraybuffer"));
}
