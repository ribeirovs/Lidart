export type Proposal = {
  id: number;
  userId: number;
  clientName: string;
  clientCompany: string;
  clientContact?: string | null;
  projectScope: string;
  values: string;
  deadline?: string | null;
  commercialTerms?: string | null;
  proposalContent: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "archived";
  createdAt: Date;
  updatedAt: Date;
};
