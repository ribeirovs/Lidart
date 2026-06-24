import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { getDb } from "./db";
import { resources, briefings } from "../drizzle/schema";
import { and, desc, eq, or, like } from "drizzle-orm";
import { storageGetSignedUrl, storagePut } from "./storage";
import { loadFullCatalog, resolveFromOption } from "./valuation-builder";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Coluna mapping (1-indexed) no template Kallas ───────────────────────────
// Row 6 = header row; data starts at row 7
// C1=ID  C2=UF  C3=CIDADE  C4=VERTICAL  C5=LOCAL  C6=NOME COMERCIAL
// C7=COTA  C8=TIPO  C9=VEICULAÇÃO  C10=QTD FACES  C11=INS/DIA
// C12=INS/PERÍODO (fórmula K*7*O)  C13=IMPACTO EST  C14=IMPACTO PER (fórmula M*O)
// C15=PERÍODO  C16=CUSTO UNITÁRIO  C17=CUSTO TOTAL TABELA (fórmula P*O)
// C18=DESCONTO %  C19=CUSTO BRUTO NEGOCIADO (fórmula Q-Q*R)
// C20=vazio  C21=CNPJ  C22=RAZÃO SOCIAL  C23=ENDEREÇO

const KALLAS_TEMPLATE_PATH = path.join(
  __dirname,
  "../scratch/Modelo_ValoraAAo_Kallas.xlsx"
);
const TEMPLATE_DATA_START_ROW = 7;
const TARGET_SHEET_NAME = "Cenário1 - Banco BV";

interface KallasMediaItem {
  id?: number | string;
  uf?: string;
  cidade?: string;
  vertical?: string;
  local?: string;
  nomeComercial: string;
  cota?: string;
  tipo?: string;
  veiculacao?: string;
  qtdFaces?: number;
  insPorDia?: number;
  impactoEstimado?: number;
  periodo?: number;
  custoUnitario: number;
  desconto?: number; // 0–1, e.g. 0.3 = 30%
  cnpj?: string;
  razaoSocial?: string;
  endereco?: string;
}

// ─── Main export function ─────────────────────────────────────────────────────
export async function exportProposalToExcel(proposal: {
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
  createdAt: Date;
  mediaPlan?: string | null;
}): Promise<{ url: string; key: string }> {
  const workbook = new ExcelJS.Workbook();
  let templateLoaded = false;

  // ── 1. Try local Kallas template first ─────────────────────────────────────
  if (fs.existsSync(KALLAS_TEMPLATE_PATH)) {
    try {
      await workbook.xlsx.readFile(KALLAS_TEMPLATE_PATH);
      templateLoaded = true;
      console.log("[Excel Export] Loaded local Kallas template.");
    } catch (err) {
      console.error("[Excel Export] Failed to load local Kallas template:", err);
    }
  }

  // ── 2. Fallback: try resource from cloud storage ────────────────────────────
  if (!templateLoaded) {
    const db = await getDb();
    if (db) {
      try {
        const userResources = await db
          .select()
          .from(resources)
          .where(
            and(
              eq(resources.userId, proposal.userId),
              or(like(resources.name, "%modelo%"), eq(resources.type, "pricing"))
            )
          )
          .orderBy(desc(resources.id))
          .limit(1);

        if (userResources.length > 0) {
          const resource = userResources[0];
          const signedUrl = await storageGetSignedUrl(resource.fileKey);
          const resp = await fetch(signedUrl);
          if (resp.ok) {
            const buffer = await resp.arrayBuffer();
            await workbook.xlsx.load(Buffer.from(buffer) as any);
            templateLoaded = true;
            console.log(`[Excel Export] Loaded cloud template: ${resource.name}`);
          }
        }
      } catch (err) {
        console.error("[Excel Export] Error loading cloud template:", err);
      }
    }
  }

  // Fetch associated briefing for this proposal to enrich the sheet info
  const dbInstance = await getDb();
  let briefing: any = undefined;
  if (dbInstance) {
    try {
      const results = await dbInstance.select().from(briefings).where(eq(briefings.proposalId, proposal.id)).limit(1);
      if (results.length > 0) {
        briefing = results[0];
      }
    } catch (err) {
      console.error("[Excel Export] Failed to fetch briefing for proposal:", err);
    }
  }

  // ── 3. Itens de mídia ───────────────────────────────────────────────────────
  // PRIORIDADE: se o planner montou o plano na tela (mediaPlan), usa as linhas
  // EXATAS resolvidas pelo motor (preço/UF/CNPJ atômicos da fonte). Só cai no
  // parser antigo (casamento difuso) se NÃO houver plano selecionado.
  let mediaItems = await buildItemsFromMediaPlan(proposal.userId, proposal.mediaPlan);
  const usouPlano = mediaItems.length > 0;
  if (!usouPlano) {
    mediaItems = parseMediaItemsFromProposal(proposal.proposalContent, proposal.values);
  } else {
    console.log(`[Excel Export] Plano do planner: ${mediaItems.length} linhas ancoradas na fonte (motor). Casamento difuso IGNORADO.`);
  }

  // ── 3b. Enriquecer com preços REAIS do catálogo (SÓ no caminho antigo).
  //        Quando o planner montou o plano (usouPlano), os itens já vêm
  //        resolvidos atomicamente pelo motor — NÃO aplicar casamento difuso.
  try {
    const catalog = usouPlano ? [] : await loadPriceCatalogFromResources(proposal.userId);
    if (catalog.length > 0) {
      if (mediaItems.length > 0) {
        const matched = enrichItemsWithCatalog(mediaItems, catalog);
        console.log(`[Excel Export] Catálogo real: ${catalog.length} linhas; ${matched} itens da proposta receberam preço de tabela.`);
      } else {
        const briefCities = (briefing?.cities || "")
          .split(/[,;]/)
          .map((c: string) => normalizeTxt(c))
          .filter(Boolean);
        const filtered = briefCities.length > 0
          ? catalog.filter((r) => briefCities.some((c: string) => normalizeTxt(r.cidade).includes(c) || c.includes(normalizeTxt(r.cidade))))
          : catalog;
        const rows = (filtered.length > 0 ? filtered : catalog).slice(0, 60);
        rows.forEach((r, i) => {
          mediaItems.push({
            id: i + 1,
            uf: r.uf,
            cidade: r.cidade,
            local: r.local,
            nomeComercial: r.formato,
            razaoSocial: r.parceiro,
            custoUnitario: r.preco,
            vertical: r.vertical,
            cota: r.cota,
            tipo: r.tipo,
            veiculacao: r.veiculacao,
            qtdFaces: r.qtdFaces,
            insPorDia: r.insPorDia,
            impactoEstimado: r.impactoEstimado,
            cnpj: r.cnpj,
            endereco: r.endereco,
          });
        });
        console.log(`[Excel Export] Proposta sem tabela própria; ${rows.length} itens montados direto do catálogo real.`);
      }
    }
  } catch (err) {
    console.error("[Excel Export] Falha ao carregar catálogo de preços dos recursos (usando dados da proposta):", err);
  }

  if (templateLoaded) {
    await populateKallasTemplate(workbook, proposal, mediaItems, briefing);
  } else {
    // ── 4. Last resort: generate from scratch ──────────────────────────────
    console.warn("[Excel Export] No template available, generating from scratch.");
    generateFallbackWorksheet(workbook, proposal, mediaItems, briefing);
  }

  // ── 5. Upload ──────────────────────────────────────────────────────────────
  const outBuffer = await workbook.xlsx.writeBuffer();
  const safeClientName = sanitizeName(proposal.clientName);
  const filename = `valoracao_${safeClientName}_${proposal.id}.xlsx`;
  const key = `proposals/${proposal.id}/${filename}`;

  return storagePut(
    key,
    Buffer.from(outBuffer),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

// ─── Populate Kallas template worksheet ──────────────────────────────────────
async function populateKallasTemplate(
  workbook: ExcelJS.Workbook,
  proposal: {
    id: number;
    clientName: string;
    clientCompany: string;
    clientContact?: string | null;
    projectScope: string;
    values: string;
    deadline?: string | null;
    createdAt: Date;
  },
  mediaItems: KallasMediaItem[],
  briefing?: {
    clientName: string;
    contactName: string;
    contactEmail: string;
    cities: string;
    campaignPeriod: string;
    budget: string;
    objective: string;
  }
): Promise<void> {
  // Find the target sheet
  let ws = workbook.getWorksheet(TARGET_SHEET_NAME);
  if (!ws) {
    // Try first worksheet as fallback
    ws = workbook.worksheets[0];
  }
  if (!ws) {
    console.error("[Excel Export] No worksheet found in template.");
    return;
  }

  // Rename the Scenario sheet
  const safeClientCompany = proposal.clientCompany.replace(/[\\/?*\[\]:]/g, "").substring(0, 18);
  const newSheetName = `Cenário 1 - ${safeClientCompany}`;
  ws.name = newSheetName;

  // Remove o AutoFiltro herdado do template (as "setinhas" nos cabeçalhos/linhas)
  (ws as any).autoFilter = null;

  // Remove other worksheets (except the Scenario sheet and pricing table)
  const sheetsToRemove = workbook.worksheets.filter(
    (sheet) => sheet.id !== ws!.id && sheet.name !== "Tabela de Preços Kallas_2026"
  );
  sheetsToRemove.forEach((sheet) => {
    workbook.removeWorksheet(sheet.id);
  });

  // ── Clear existing data rows and styles completely (row 7 to 300) ──────────
  const lastDataRow = Math.max(ws.rowCount, 300);
  for (let r = TEMPLATE_DATA_START_ROW; r <= lastDataRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 40; c++) {
      const cell = row.getCell(c);
      cell.value = null;
      cell.style = {};
    }
  }

  // ── Write client info in rows 2–4 ──────────────────────────────────────────
  const writeInfoCell = (row: number, col: number, label: string, val: string) => {
    const cell = ws!.getCell(row, col);
    cell.value = `${label}: ${val}`;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF333333" } };
  };

  const clientName = briefing?.clientName || proposal.clientName;
  const contactInfo = briefing ? `${briefing.contactName} (${briefing.contactEmail})` : (proposal.clientContact || "-");
  const createdAtStr = proposal.createdAt.toLocaleDateString("pt-BR");
  const clientCompany = proposal.clientCompany;
  const cities = briefing?.cities || "-";
  const campaignPeriod = briefing?.campaignPeriod || proposal.deadline || "-";
  const budget = briefing?.budget || proposal.values;
  const objective = briefing?.objective || proposal.projectScope;

  ws.getCell(1, 2).value = "PROPOSTA COMERCIAL DE MÍDIA OOH";
  ws.getCell(1, 2).font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFE20613" } };

  writeInfoCell(2, 2, "Cliente", clientName);
  writeInfoCell(2, 5, "Contato", contactInfo);
  writeInfoCell(2, 8, "Data", createdAtStr);

  writeInfoCell(3, 2, "Empresa", clientCompany);
  writeInfoCell(3, 5, "Praças", cities);
  writeInfoCell(3, 8, "Cronograma", campaignPeriod);

  writeInfoCell(4, 2, "Verba de Mídia", budget);
  writeInfoCell(4, 5, "Objetivo", objective);


  // ── Write media items starting at row 7 ────────────────────────────────────
  mediaItems.forEach((item, idx) => {
    const rn = TEMPLATE_DATA_START_ROW + idx;
    const row = ws!.getRow(rn);

    const periodo = item.periodo ?? 1;
    const desconto = item.desconto ?? 0;

    // Static columns
    row.getCell(1).value = item.id ?? idx + 1;                       // ID
    row.getCell(2).value = ufFromCidade(item.cidade ?? "", item.uf ?? "");  // UF (autoritativa por cidade)
    row.getCell(3).value = item.cidade ?? "";                         // CIDADE
    row.getCell(4).value = item.vertical ?? "OOH";                   // VERTICAL
    row.getCell(5).value = item.local ?? "";                          // LOCAL
    row.getCell(6).value = item.nomeComercial;                        // NOME COMERCIAL
    row.getCell(7).value = item.cota ?? "Única";                      // COTA
    row.getCell(8).value = item.tipo ?? "Estático";                   // TIPO
    row.getCell(9).value = item.veiculacao ?? "Mensal";               // VEICULAÇÃO
    row.getCell(10).value = item.qtdFaces ?? 1;                       // QTD FACES
    row.getCell(11).value = item.insPorDia ?? 0;                      // INS/DIA

    // C12 = INS/PERÍODO = K*7*O (K=col11, O=col15)
    row.getCell(12).value = { formula: `K${rn}*7*O${rn}` };

    // C13 = IMPACTO ESTIMADO
    row.getCell(13).value = item.impactoEstimado ?? 0;

    // C14 = IMPACTO POR PERÍODO = M*O
    row.getCell(14).value = { formula: `M${rn}*O${rn}` };

    // C15 = PERÍODO (semanas)
    row.getCell(15).value = periodo;

    // C16 = CUSTO UNITÁRIO
    row.getCell(16).value = item.custoUnitario;
    applyMoneyFormat(row.getCell(16));

    // C17 = CUSTO TOTAL TABELA = P*O (com resultado em cache p/ aparecer sem abrir o Excel)
    const custoTotal = Math.round((item.custoUnitario || 0) * periodo * 100) / 100;
    row.getCell(17).value = { formula: `P${rn}*O${rn}`, result: custoTotal };
    applyMoneyFormat(row.getCell(17));

    // C18 = DESCONTO %
    row.getCell(18).value = desconto;
    row.getCell(18).numFmt = "0%";

    // C19 = CUSTO BRUTO NEGOCIADO = Q-Q*R (resultado em cache)
    const custoBruto = Math.round(custoTotal * (1 - desconto) * 100) / 100;
    row.getCell(19).value = { formula: `Q${rn}-Q${rn}*R${rn}`, result: custoBruto };
    applyMoneyFormat(row.getCell(19));

    // C20 = empty
    // C21 = CNPJ
    row.getCell(21).value = item.cnpj ?? "";
    // C22 = RAZÃO SOCIAL
    row.getCell(22).value = item.razaoSocial ?? "";
    // C23 = ENDEREÇO
    row.getCell(23).value = item.endereco ?? "";

    // Apply alternating row fill similar to template
    const fillColor = idx % 2 === 0 ? "FFF5F5F5" : "FFFFFFFF";
    for (let c = 1; c <= 23; c++) {
      const cell = row.getCell(c);
      if (!cell.fill || (cell.fill as any).type === "none") {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fillColor },
        };
      }
      cell.font = { name: "Calibri", size: 10 };
    }

    row.commit();
  });

  // ── Totals row ─────────────────────────────────────────────────────────────
  if (mediaItems.length > 0) {
    const totalsRn = TEMPLATE_DATA_START_ROW + mediaItems.length;
    const totalsRow = ws.getRow(totalsRn);

    totalsRow.getCell(6).value = "TOTAL VEICULAÇÃO";
    totalsRow.getCell(6).font = { bold: true, name: "Calibri", size: 10 };

    const firstData = TEMPLATE_DATA_START_ROW;
    const lastData = totalsRn - 1;

    // Resultado em cache: soma do custo de cada linha (aparece sem abrir o Excel)
    const totalTabela = mediaItems.reduce((s, it) => s + Math.round((it.custoUnitario || 0) * (it.periodo ?? 1) * 100) / 100, 0);
    const totalNeg = mediaItems.reduce((s, it) => s + Math.round((it.custoUnitario || 0) * (it.periodo ?? 1) * (1 - (it.desconto ?? 0)) * 100) / 100, 0);

    totalsRow.getCell(17).value = { formula: `SUBTOTAL(9,Q${firstData}:Q${lastData})`, result: Math.round(totalTabela * 100) / 100 };
    applyMoneyFormat(totalsRow.getCell(17));
    totalsRow.getCell(17).font = { bold: true, name: "Calibri", size: 10 };

    totalsRow.getCell(19).value = { formula: `SUBTOTAL(9,S${firstData}:S${lastData})`, result: Math.round(totalNeg * 100) / 100 };
    applyMoneyFormat(totalsRow.getCell(19));
    totalsRow.getCell(19).font = { bold: true, name: "Calibri", size: 10 };

    // Red background on totals row (Kallas brand)
    for (let c = 1; c <= 23; c++) {
      const cell = totalsRow.getCell(c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE20613" } };
      cell.font = { bold: true, name: "Calibri", size: 10, color: { argb: "FFFFFFFF" } };
    }
    totalsRow.commit();

    // ── 3 LINHAS DO PLANNER (T-spec): criadas, marcadas "A PREENCHER — PLANNER" ──
    // O agente NÃO calcula nem estima — só garante que existam e estejam pendentes.
    // Desconto NÃO entra (alçada do diretor comercial).
    const plannerLabels = ["Produção de Peças", "Instalação e Manutenção", "Taxa de Agência"];
    plannerLabels.forEach((label, k) => {
      const prow = ws!.getRow(totalsRn + 1 + k);
      prow.getCell(6).value = label;
      prow.getCell(6).font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF555555" } };
      prow.getCell(17).value = "A PREENCHER — PLANNER";
      prow.getCell(17).font = { name: "Calibri", size: 9, italic: true, color: { argb: "FFB45309" } };
      for (let c = 1; c <= 23; c++) {
        const cell = prow.getCell(c);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF6E3" } };
        if (!cell.font) cell.font = { name: "Calibri", size: 10 };
      }
      prow.commit();
    });
  }
}

// ─── Fallback worksheet (no template) ────────────────────────────────────────
function generateFallbackWorksheet(
  workbook: ExcelJS.Workbook,
  proposal: {
    id: number;
    clientName: string;
    clientCompany: string;
    projectScope: string;
    values: string;
    deadline?: string | null;
    createdAt: Date;
  },
  mediaItems: KallasMediaItem[],
  briefing?: {
    clientName: string;
    contactName: string;
    contactEmail: string;
    cities: string;
    campaignPeriod: string;
    budget: string;
    objective: string;
  }
): void {
  const ws = workbook.addWorksheet("Plano de Valoração");

  const KALLAS_RED: ExcelJS.Fill = {
    type: "pattern", pattern: "solid", fgColor: { argb: "FFE20613" },
  };
  const headerFont: Partial<ExcelJS.Font> = {
    name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" },
  };

  // Title row
  ws.mergeCells("A1:S1");
  ws.getCell("A1").value = "KALLAS MÍDIA OOH — PLANO DE VALORAÇÃO";
  ws.getCell("A1").fill = KALLAS_RED;
  ws.getCell("A1").font = { ...headerFont, size: 14 };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 32;

  // Client info rows 2–4 using briefing data if available
  const clientName = briefing?.clientName || proposal.clientName;
  const contactName = briefing ? `${briefing.contactName} (${briefing.contactEmail})` : "-";
  const cities = briefing?.cities || "-";
  const campaignPeriod = briefing?.campaignPeriod || proposal.deadline || "-";
  const budget = briefing?.budget || proposal.values;
  const objective = briefing?.objective || proposal.projectScope;

  ws.getCell("A2").value = `Cliente: ${clientName}`;
  ws.getCell("H2").value = `Contato: ${contactName}`;
  ws.getCell("N2").value = `Data: ${proposal.createdAt.toLocaleDateString("pt-BR")}`;

  ws.getCell("A3").value = `Empresa: ${proposal.clientCompany}`;
  ws.getCell("H3").value = `Praças: ${cities}`;
  ws.getCell("N3").value = `Cronograma: ${campaignPeriod}`;

  ws.getCell("A4").value = `Verba: ${budget}`;
  ws.getCell("H4").value = `Objetivo: ${objective}`;

  // Blank row 5
  // Header row 6
  const HEADERS = [
    "ID", "UF", "CIDADE", "VERTICAL", "LOCAL", "NOME COMERCIAL",
    "COTA", "TIPO", "VEICULAÇÃO", "QTD FACES", "INS/DIA",
    "INS/PERÍODO", "IMPACTO EST.", "IMPACTO PER.", "PERÍODO",
    "CUSTO UNITÁRIO", "CUSTO TOTAL", "DESCONTO %", "CUSTO NEGOCIADO",
  ];
  const headerRow = ws.getRow(6);
  headerRow.height = 28;
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.fill = KALLAS_RED;
    cell.font = headerFont;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.commit();

  // Data rows
  mediaItems.forEach((item, idx) => {
    const rn = 7 + idx;
    const row = ws.getRow(rn);
    const periodo = item.periodo ?? 1;
    const desconto = item.desconto ?? 0;

    row.getCell(1).value = item.id ?? idx + 1;
    row.getCell(2).value = ufFromCidade(item.cidade ?? "", item.uf ?? "");
    row.getCell(3).value = item.cidade ?? "";
    row.getCell(4).value = item.vertical ?? "OOH";
    row.getCell(5).value = item.local ?? "";
    row.getCell(6).value = item.nomeComercial;
    row.getCell(7).value = item.cota ?? "Única";
    row.getCell(8).value = item.tipo ?? "Estático";
    row.getCell(9).value = item.veiculacao ?? "Mensal";
    row.getCell(10).value = item.qtdFaces ?? 1;
    row.getCell(11).value = item.insPorDia ?? 0;
    row.getCell(12).value = { formula: `K${rn}*7*O${rn}` };
    row.getCell(13).value = item.impactoEstimado ?? 0;
    row.getCell(14).value = { formula: `M${rn}*O${rn}` };
    row.getCell(15).value = periodo;
    row.getCell(16).value = item.custoUnitario; applyMoneyFormat(row.getCell(16));
    row.getCell(17).value = { formula: `P${rn}*O${rn}` }; applyMoneyFormat(row.getCell(17));
    row.getCell(18).value = desconto; row.getCell(18).numFmt = "0%";
    row.getCell(19).value = { formula: `Q${rn}-Q${rn}*R${rn}` }; applyMoneyFormat(row.getCell(19));

    const fillColor = idx % 2 === 0 ? "FFFFF0F0" : "FFFFFFFF";
    for (let c = 1; c <= 19; c++) {
      const cell = row.getCell(c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      cell.font = { name: "Calibri", size: 10 };
    }
    row.commit();
  });

  // Totals row
  if (mediaItems.length > 0) {
    const totalsRn = 7 + mediaItems.length;
    const lastData = totalsRn - 1;
    const totalsRow = ws.getRow(totalsRn);
    totalsRow.getCell(6).value = "TOTAL";
    totalsRow.getCell(17).value = { formula: `SUBTOTAL(9,Q7:Q${lastData})` };
    applyMoneyFormat(totalsRow.getCell(17));
    totalsRow.getCell(19).value = { formula: `SUBTOTAL(9,S7:S${lastData})` };
    applyMoneyFormat(totalsRow.getCell(19));
    for (let c = 1; c <= 19; c++) {
      totalsRow.getCell(c).fill = KALLAS_RED;
      totalsRow.getCell(c).font = { ...headerFont, size: 11 };
    }
    totalsRow.commit();
  }

  // Column widths
  const colWidths = [5, 5, 14, 14, 22, 28, 10, 10, 10, 7, 8, 10, 12, 12, 7, 14, 14, 9, 16];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

// ─── Parse media items from proposal content ──────────────────────────────────
// ── ETAPA 3: itens a partir do plano do planner (linhas exatas, motor) ──
// Cada linha é resolvida atomicamente; órfãs (catálogo mudou) são ignoradas
// (nunca inventa). UF/CNPJ/razão vêm da MESMA linha — sem band-aid aqui.
async function buildItemsFromMediaPlan(userId: number, mediaPlanJson?: string | null): Promise<KallasMediaItem[]> {
  if (!mediaPlanJson) return [];
  let linhas: Array<{ chave: string; campanhaSemanas?: number; qtd?: number }> = [];
  try { linhas = JSON.parse(mediaPlanJson); } catch { return []; }
  if (!Array.isArray(linhas) || linhas.length === 0) return [];

  const catalog = await loadFullCatalog(userId);
  if (catalog.length === 0) return [];

  const items: KallasMediaItem[] = [];
  linhas.forEach((l) => {
    const res = resolveFromOption(catalog, l.chave, l.campanhaSemanas || 1);
    if (res.status !== "ok") return; // sem lastro → ignora (não inventa)
    const r = res.row;
    const qtd = l.qtd && l.qtd > 0 ? l.qtd : 1;
    items.push({
      id: items.length + 1,
      uf: r.uf,
      cidade: r.cidade,
      vertical: r.vertical,
      local: r.local,
      nomeComercial: r.nome,
      cota: r.cota,
      tipo: r.tipo,
      veiculacao: r.veiculacao,
      qtdFaces: r.faces,
      insPorDia: r.insPorDia,
      impactoEstimado: r.impactoEstimado,
      // PERÍODO inclui o multiplicador não-linear × quantidade, p/ o total do
      // template (P×O) bater EXATO com o subtotal do motor.
      periodo: Math.round(res.periodos * qtd * 100) / 100,
      custoUnitario: r.custoUnitario,
      cnpj: r.cnpj,
      razaoSocial: r.razao,
      endereco: r.endereco,
    });
  });
  return items;
}

export function parseMediaItemsFromProposal(
  proposalContent: string,
  budgetStr: string
): KallasMediaItem[] {
  const items: KallasMediaItem[] = [];

  // ── Strategy 0: Tabelas de plano de mídia detalhado ───────────────────────
  // A proposta da IA costuma trazer VÁRIAS tabelas no formato
  // | Praça/Aeroporto | Formato | Período | Qtd | Valor Unit. | Subtotal |
  // Coleta TODAS elas (aeroportos, DOOH urbano, grandes formatos, etc.),
  // ignorando tabelas-resumo com colunas de percentual.
  const allTables = parseMarkdownTables(proposalContent);
  for (const t of allTables) {
    const hdrs = t.headers.map((h) => normalizeTxt(h.replace(/\*\*/g, "")));
    const hasPercentCol = hdrs.some((h) => h.includes("%"));
    if (hasPercentCol) continue; // tabelas-resumo com % não são plano detalhado

    // A IA varia o nome da coluna de valor — aceitar as variações conhecidas,
    // em ordem de preferência: unitário > por período (semanal/mensal) > total
    const colUnit = hdrs.findIndex((h) => h.includes("valor unit") || h.includes("custo unit") || (h.includes("unit") && (h.includes("valor") || h.includes("custo") || h.includes("r$"))));
    const colPeriodic = hdrs.findIndex((h) => /valor (semanal|mensal|quinzenal|bisemanal)|investimento (semanal|mensal)/.test(h));
    const colTotal = hdrs.findIndex((h) => /valor total|investimento total|investimento estimado|investimento \(?\d+|investimento \d+ meses|subtotal/.test(h) || h === "investimento" || h === "valor");
    const valueMode: "unit" | "periodic" | "total" | null =
      colUnit >= 0 ? "unit" : colPeriodic >= 0 ? "periodic" : colTotal >= 0 ? "total" : null;
    if (!valueMode) continue; // não é tabela de plano detalhado
    const colValue = valueMode === "unit" ? colUnit : valueMode === "periodic" ? colPeriodic : colTotal;

    const colCity = hdrs.findIndex((h) => h.includes("praca") || h.includes("aeroporto") || h.includes("cidade"));
    let colName = hdrs.findIndex((h) => h.includes("formato") || h.includes("local/formato") || h.includes("atividade") || h.includes("ativacao") || h.includes("midia"));
    if (colName === -1) colName = hdrs.findIndex((h) => h === "item" || h.includes("nome") || h.includes("produto"));
    if (colName === -1) colName = hdrs.findIndex((h) => h.includes("descricao"));
    const colPer = hdrs.findIndex((h) => h.includes("periodo"));
    const colQtd = hdrs.findIndex((h) => h.includes("qtd") || h.includes("faces") || h.includes("unid") || h.includes("quantidade") || h.includes("circuito"));
    const colLocal = hdrs.findIndex((h) => h === "local" || h.includes("local ") || h.includes("ambiente"));
    const colPartner = hdrs.findIndex((h) => h.includes("parceiro") || h.includes("fornecedor") || h.includes("fonte"));

    // Exige identificação mínima do item (formato ou praça)
    if (colName === -1 && colCity === -1) continue;

    for (const row of t.rows) {
      if (row.length === 0) continue;
      const clean = (v: string | undefined) => (v ?? "").replace(/\*\*/g, "").trim();
      const cityRaw = colCity >= 0 ? clean(row[colCity]) : "";
      const name = colName >= 0 ? clean(row[colName]) : "";
      const nomeComercial = name || cityRaw;
      if (!nomeComercial || /subtotal|total/i.test(nomeComercial) || /subtotal|total/i.test(cityRaw)) continue;

      const valueRaw = parseMoneyStr(clean(row[colValue]));
      if (valueRaw <= 0) continue;

      // "10 semanas" / "24 sem" / "6 meses" → número de períodos
      const perStr = colPer >= 0 ? clean(row[colPer]) : "";
      let perNum = parseInt(perStr.replace(/[^\d]/g, ""), 10);
      // Coluna de valor total costuma trazer o período no cabeçalho ("Investimento 6 meses", "Valor Total (24 sem)")
      if ((isNaN(perNum) || perNum <= 0) && valueMode === "total") {
        const hdrPer = hdrs[colValue].match(/(\d+)\s*(sem|mes)/);
        if (hdrPer) perNum = parseInt(hdrPer[1], 10);
      }
      const qtdStr = colQtd >= 0 ? clean(row[colQtd]) : "";
      const qtdNum = parseInt(qtdStr.replace(/[^\d]/g, ""), 10);
      const periodo = !isNaN(perNum) && perNum > 0 ? perNum : 1;

      // Converte o valor lido para custo unitário por período
      const custoUnitario = valueMode === "total" ? Math.round(valueRaw / periodo) : valueRaw;

      // "São Paulo (Congonhas)" → cidade "São Paulo", local "Congonhas"
      const cityMatch = cityRaw.match(/^([^(]+?)\s*(?:\(([^)]+)\))?$/);
      items.push({
        id: items.length + 1,
        nomeComercial,
        cidade: cityMatch ? cityMatch[1].trim() : cityRaw,
        local: colLocal >= 0 ? clean(row[colLocal]) : (cityMatch && cityMatch[2] ? cityMatch[2].trim() : undefined),
        razaoSocial: colPartner >= 0 ? clean(row[colPartner]) || undefined : undefined,
        periodo,
        qtdFaces: !isNaN(qtdNum) && qtdNum > 0 ? qtdNum : 1,
        custoUnitario,
      });
    }
  }
  if (items.length > 0) {
    // A proposta costuma repetir os mesmos itens em tabelas diferentes
    // (visão por praça + visão consolidada) — manter a 1ª ocorrência
    const seen = new Set<string>();
    const deduped = items.filter((it) => {
      const key = normalizeTxt(`${it.cidade ?? ""}|${it.nomeComercial}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.forEach((it, i) => { it.id = i + 1; });
    console.log(`[Excel Export] ${deduped.length} itens extraídos das tabelas de plano de mídia da proposta (${items.length - deduped.length} duplicados removidos).`);
    return deduped;
  }

  // ── Strategy 1: Parse markdown tables ─────────────────────────────────────
  const tables = parseMarkdownTables(proposalContent);
  if (tables.length > 0) {
    // Find the table most likely to be the media/valuation table
    // (has columns related to value/custo or nome comercial)
    const mediaTable = tables.find((t) => {
      const hdrs = t.headers.map((h) => h.toLowerCase());
      return (
        hdrs.some((h) => h.includes("item") || h.includes("nome") || h.includes("ativação") || h.includes("produto")) &&
        hdrs.some((h) => h.includes("valor") || h.includes("custo") || h.includes("r$") || h.includes("invest"))
      );
    }) ?? tables[0];

    if (mediaTable) {
      const hdrs = mediaTable.headers.map((h) => h.toLowerCase());

      // Find column indices dynamically
      const findCol = (...keys: string[]) =>
        hdrs.findIndex((h) => keys.some((k) => h.includes(k)));

      const colUnitVal = hdrs.findIndex((h) => h.includes("unit") || h.includes("unitário") || h.includes("p/ face"));
      // Nunca tratar colunas de percentual ("% total", "% budget") como valor
      const colTotalVal = hdrs.findIndex((h) => !h.includes("%") && (h.includes("total") || h.includes("investimento") || h.includes("geral") || h.includes("acumulado")));

      const colItem   = findCol("item", "nome", "ativação", "produto", "ponto", "mídia");
      const colLocal  = findCol("local", "localização", "ambiente", "praça");
      const colCidade = findCol("cidade", "city");
      const colUf     = findCol("uf", "estado");
      const colTipo   = findCol("tipo", "format");
      const colQtd    = findCol("qtd", "quantidade", "faces", "qnt");
      const colPer    = findCol("período", "period", "semanas", "meses");
      // "%" sozinho pegava colunas como "% Total"; exige menção a desconto
      const colDesc   = hdrs.findIndex((h) => h.includes("desconto") || h.includes("discount") || h.includes("desc. %") || h.includes("desc %"));
      const colValor  = findCol("valor", "custo", "r$", "investimento", "preço");

      mediaTable.rows.forEach((row, idx) => {
        if (row.length === 0) return;
        const clean = (v: string | undefined) => (v ?? "").replace(/\*\*/g, "").trim();
        const nomeComercial = colItem >= 0 ? clean(row[colItem]) : clean(row[0]);
        if (!nomeComercial || nomeComercial.toLowerCase().includes("total")) return;

        const qtd = colQtd >= 0 ? parseInt(clean(row[colQtd]), 10) || 1 : 1;
        const per = colPer >= 0 ? parseInt(clean(row[colPer]), 10) || 1 : 1;
        const descVal = colDesc >= 0 ? parsePercentStr(clean(row[colDesc])) : 0;

        let custoUnitario = 0;
        if (colUnitVal >= 0) {
          custoUnitario = parseMoneyStr(clean(row[colUnitVal]));
        } else if (colTotalVal >= 0) {
          const totalVal = parseMoneyStr(clean(row[colTotalVal]));
          custoUnitario = per > 0 ? Math.round(totalVal / per) : totalVal;
        } else if (colValor >= 0) {
          const valorVal = parseMoneyStr(clean(row[colValor]));
          custoUnitario = per > 0 ? Math.round(valorVal / per) : valorVal;
        } else {
          const lastVal = parseMoneyStr(clean(row[row.length - 1]));
          custoUnitario = per > 0 ? Math.round(lastVal / per) : lastVal;
        }

        const item: KallasMediaItem = {
          id: idx + 1,
          nomeComercial,
          local: colLocal >= 0 ? clean(row[colLocal]) : undefined,
          cidade: colCidade >= 0 ? clean(row[colCidade]) : undefined,
          uf: colUf >= 0 ? clean(row[colUf]) : undefined,
          tipo: colTipo >= 0 ? clean(row[colTipo]) : undefined,
          qtdFaces: qtd,
          periodo: per,
          desconto: descVal,
          custoUnitario: custoUnitario,
        };
        items.push(item);
      });
    }
  }

  // ── Strategy 2: Parse bullet list items (e.g. "• Painéis LED ... R$ 50.000") ─
  if (items.length === 0) {
    const bulletRe = /^[\-\*•]\s*(.+?)[:\s]+R\$\s*([\d.,]+)/gm;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = bulletRe.exec(proposalContent)) !== null) {
      const label = match[1].replace(/\*\*/g, "").trim();
      const custo = parseMoneyStr(match[2]);
      if (custo > 0) {
        items.push({ id: idx + 1, nomeComercial: label, custoUnitario: custo });
        idx++;
      }
    }
  }

  // ── Fallback: distribute budget proportionally ──────────────────────────────
  if (items.length === 0) {
    const total = parseMoneyStr(budgetStr);
    items.push(
      { id: 1, nomeComercial: "Veiculação OOH — Locação de pontos e painéis", custoUnitario: Math.round(total * 0.7), tipo: "Digital", vertical: "OOH" },
      { id: 2, nomeComercial: "Produção e Instalação — Impressão e logística", custoUnitario: Math.round(total * 0.2), tipo: "Estático", vertical: "Produção" },
      { id: 3, nomeComercial: "Gestão e Agência — Planejamento e relatórios", custoUnitario: Math.round(total * 0.1), vertical: "Agência" }
    );
  }

  return items;
}

// ─── Catálogo de preços reais (recursos do usuário) ───────────────────────────

interface CatalogRow {
  uf: string;
  cidade: string;
  formato: string;
  local: string;
  parceiro: string;
  preco: number;
  vertical?: string;
  cota?: string;
  tipo?: string;
  veiculacao?: string;
  qtdFaces?: number;
  insPorDia?: number;
  impactoEstimado?: number;
  cnpj?: string;
  endereco?: string;
}

// ⚠️ BAND-AID TEMPORÁRIO — DATA DE MORTE: Etapa 3 (motor de valoração) ⚠️
// Corrige o Erro 6 (UF arraste) NO CAMINHO ANTIGO do Excel enquanto o motor
// (valuation-builder.ts) não está plugado. Quando o motor assumir a resolução
// (Etapa 3), a UF passa a vir ATÔMICA da linha de origem e ESTE bloco DEVE SER
// REMOVIDO. Não pode haver dois lugares decidindo UF — band-aid que sobrevive
// à cirurgia vira o próximo bug.
const CIDADE_UF: Record<string, string> = {
  "sao paulo": "SP", "rio de janeiro": "RJ", "belo horizonte": "MG", "curitiba": "PR",
  "florianopolis": "SC", "porto alegre": "RS", "vitoria": "ES", "goiania": "GO",
  "recife": "PE", "fortaleza": "CE", "salvador": "BA", "natal": "RN",
  "joao pessoa": "PB", "maceio": "AL", "aracaju": "SE", "manaus": "AM", "belem": "PA",
  "cuiaba": "MT", "campo grande": "MS", "brasilia": "DF", "teresina": "PI",
  "sao luis": "MA", "macapa": "AP", "boa vista": "RR", "porto velho": "RO",
  "rio branco": "AC", "palmas": "TO", "vitoria da conquista": "BA",
};
function ufFromCidade(cidade: string, ufAtual: string): string {
  const c = (cidade || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!c) return ufAtual || "";
  if (c.includes("vitoria da conquista")) return "BA";
  for (const [nome, uf] of Object.entries(CIDADE_UF)) {
    if (c === nome || c.includes(nome) || nome.includes(c)) return uf;
  }
  return ufAtual || "";
}

function normalizeTxt(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Converte valor de célula em número. Aceita tanto célula numérica do Excel
 * ("15000.5", ponto decimal US) quanto texto BR ("R$ 15.000,00").
 */
function parseCellMoney(s: string): number {
  const raw = String(s).replace(/[^\d.,]/g, "");
  if (!raw) return 0;
  let val: number;
  if (raw.includes(",")) {
    // formato BR: pontos = milhar, vírgula = decimal ("15.000,50")
    val = parseFloat(raw.replace(/\./g, "").replace(",", "."));
  } else {
    const dots = (raw.match(/\./g) || []).length;
    if (dots === 0) {
      val = parseFloat(raw);
    } else if (dots === 1 && !/^\d{1,3}\.\d{3}$/.test(raw)) {
      // decimal US vindo de célula numérica ("15000.5", "249.00000000000003")
      val = parseFloat(raw);
    } else {
      // milhar BR sem decimais ("15.000", "1.234.567")
      val = parseFloat(raw.replace(/\./g, ""));
    }
  }
  return isNaN(val) ? 0 : val;
}

/**
 * Lê a tabela de preços/inventário enviada pelo usuário (recursos .xlsx) e
 * devolve as linhas com preço real. Ignora arquivos de modelo/template.
 */
export async function loadPriceCatalogFromResources(userId: number): Promise<CatalogRow[]> {
  const db = await getDb();
  if (!db) return [];

  const userResources = await db
    .select()
    .from(resources)
    .where(eq(resources.userId, userId))
    .orderBy(desc(resources.id));

  const candidates = userResources
    .filter((r) => {
      const n = normalizeTxt(r.name || "");
      const isXlsx = (r.mimeType || "").includes("spreadsheetml") || n.endsWith(".xlsx");
      const isTemplate = n.includes("modelo") || n.includes("valoracao") || n.includes("valoração");
      return isXlsx && !isTemplate;
    })
    // Prioriza planilhas com cara de tabela de preços
    .sort((a, b) => {
      const score = (r: typeof a) => {
        const n = normalizeTxt(r.name || "");
        return (n.includes("preco") || n.includes("tabela") ? 2 : 0) + (r.type === "pricing" ? 1 : 0);
      };
      return score(b) - score(a);
    });

  for (const resource of candidates) {
    try {
      const signedUrl = await storageGetSignedUrl(resource.fileKey);
      const resp = await fetch(signedUrl);
      if (!resp.ok) continue;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await resp.arrayBuffer()) as any);

      const rows: CatalogRow[] = [];
      workbook.eachSheet((sheet) => {
        if (sheet.rowCount === 0) return;

        const getRowArray = (row: ExcelJS.Row): string[] => {
          const raw = Array.isArray(row.values) ? row.values : [];
          const arr: string[] = [];
          for (let i = 1; i < raw.length; i++) {
            const v: any = raw[i];
            // Células com fórmula/rich text vêm como objeto
            const val = v && typeof v === "object" ? (v.result ?? v.text ?? "") : v;
            arr.push(val !== null && val !== undefined ? String(val) : "");
          }
          return arr;
        };

        // Detectar a linha de cabeçalho (precisa de cidade + preço)
        let headerRowNum = -1;
        let cidadeIdx = -1, ufIdx = -1, formatoIdx = -1, localIdx = -1, parceiroIdx = -1, precoIdx = -1;
        let verticalIdx = -1, cotaIdx = -1, tipoIdx = -1, veicIdx = -1, facesIdx = -1, insDiaIdx = -1, impactoIdx = -1, cnpjIdx = -1, endIdx = -1;
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (headerRowNum !== -1 || rowNumber > 20) return;
          const vals = getRowArray(row).map((v) => normalizeTxt(v).toUpperCase());
          const ci = vals.findIndex((v) => v.includes("MUNIC") || v.includes("CIDADE") || v.includes("PRACA") || v.includes("LOCALIDADE"));
          // "CUSTO UNITARIO" tem prioridade sobre "CUSTO TOTAL"
          let pi = vals.findIndex((v) => v.includes("CUSTO") && v.includes("UNIT"));
          if (pi === -1) pi = vals.findIndex((v) => v.includes("VALOR") || v.includes("CUSTO") || v.includes("PRECO") || v.includes("UNITARIO") || v.includes("R$") || v.includes("INVESTIMENTO"));
          if (ci !== -1 && pi !== -1) {
            headerRowNum = rowNumber;
            cidadeIdx = ci;
            precoIdx = pi;
            ufIdx = vals.findIndex((v) => v === "UF" || v === "ESTADO");
            // Nome do produto: prioriza "NOME COMERCIAL", depois alternativas genéricas
            formatoIdx = vals.findIndex((v) => v.includes("NOME COMERCIAL"));
            if (formatoIdx === -1) formatoIdx = vals.findIndex((v) => v.includes("FORMATO") || v.includes("COMERCIAL") || v.includes("TIPOLOGIA") || v.includes("PRODUTO") || v.includes("MIDIA"));
            localIdx = vals.findIndex((v) => v.includes("AMBIENTE") || v === "LOCAL" || v.includes("LOCAL "));
            if (localIdx === -1) localIdx = vals.findIndex((v) => v.includes("LOCAL") && !v.includes("LOCALIDADE"));
            parceiroIdx = vals.findIndex((v) => v.includes("PARCEIRO") || v.includes("RAZAO") || v.includes("FORNECEDOR"));
            // Colunas extras do padrão Kallas (quando presentes)
            verticalIdx = vals.findIndex((v) => v.includes("VERTICAL"));
            cotaIdx = vals.findIndex((v) => v === "COTA" || v.includes("COTA"));
            tipoIdx = vals.findIndex((v) => v === "TIPO");
            veicIdx = vals.findIndex((v) => v.includes("VEICULA"));
            facesIdx = vals.findIndex((v) => v.includes("FACES"));
            insDiaIdx = vals.findIndex((v) => v.includes("INS POR") && v.includes("DIA"));
            impactoIdx = vals.findIndex((v) => v.includes("IMPACTO ESTIMADO"));
            cnpjIdx = vals.findIndex((v) => v.includes("CNPJ"));
            endIdx = vals.findIndex((v) => v.includes("ENDERECO"));
          }
        });
        if (headerRowNum === -1) return;

        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (rowNumber <= headerRowNum) return;
          const vals = getRowArray(row);
          const cidade = (vals[cidadeIdx] || "").trim();
          const preco = parseCellMoney(vals[precoIdx] || "");
          if (!cidade || preco <= 0) return;
          const num = (idx: number) => {
            if (idx === -1) return undefined;
            const n = parseCellMoney(vals[idx] || "");
            return n > 0 ? n : undefined;
          };
          const txt = (idx: number) => (idx !== -1 ? (vals[idx] || "").trim() || undefined : undefined);
          rows.push({
            uf: ufIdx !== -1 ? (vals[ufIdx] || "").trim() : "",
            cidade,
            formato: formatoIdx !== -1 ? (vals[formatoIdx] || "").trim() : "Mídia OOH",
            local: localIdx !== -1 ? (vals[localIdx] || "").trim() : "",
            parceiro: parceiroIdx !== -1 ? (vals[parceiroIdx] || "").trim() : "",
            preco,
            vertical: txt(verticalIdx),
            cota: txt(cotaIdx),
            tipo: txt(tipoIdx),
            veiculacao: txt(veicIdx),
            qtdFaces: num(facesIdx),
            insPorDia: num(insDiaIdx),
            impactoEstimado: num(impactoIdx),
            cnpj: txt(cnpjIdx),
            endereco: txt(endIdx),
          });
        });
      });

      if (rows.length > 0) {
        console.log(`[Excel Export] Catálogo de preços carregado de "${resource.name}" (${rows.length} linhas).`);
        return rows;
      }
    } catch (err) {
      console.error(`[Excel Export] Erro lendo recurso "${resource.name}":`, err);
    }
  }
  return [];
}

/**
 * Casa os itens extraídos do texto da proposta com o catálogo real
 * (por cidade + similaridade de nome/formato) e aplica o preço de tabela.
 * Retorna quantos itens foram casados.
 */
function enrichItemsWithCatalog(items: KallasMediaItem[], catalog: CatalogRow[]): number {
  let matched = 0;
  for (const item of items) {
    // Linhas de produção/taxas não são mídia — não casar com o catálogo
    // (evita "Produção Estática" herdar cidade de "Produção placa de rua" de outra praça)
    if (/produc|impress|instalac|manutenc|taxa|agencia|reserva|contingencia/i.test(normalizeTxt(item.nomeComercial))) {
      continue;
    }
    const itemTokens = normalizeTxt(`${item.nomeComercial} ${item.local ?? ""} ${item.tipo ?? ""}`)
      .split(/\W+/)
      .filter((t) => t.length > 3);
    let best: CatalogRow | null = null;
    let bestScore = 0;
    for (const row of catalog) {
      const rowText = normalizeTxt(`${row.formato} ${row.local} ${row.parceiro}`);
      let score = 0;
      for (const t of itemTokens) if (rowText.includes(t)) score++;
      if (item.cidade && row.cidade) {
        const a = normalizeTxt(item.cidade);
        const b = normalizeTxt(row.cidade);
        if (a && b && (a.includes(b) || b.includes(a))) score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
    if (best && bestScore >= 2) {
      item.custoUnitario = best.preco;
      item.uf = item.uf || best.uf;
      item.cidade = item.cidade || best.cidade;
      item.local = item.local || best.local;
      item.razaoSocial = item.razaoSocial || best.parceiro;
      item.vertical = item.vertical || best.vertical;
      item.cota = item.cota || best.cota;
      item.tipo = item.tipo || best.tipo;
      item.veiculacao = item.veiculacao || best.veiculacao;
      item.qtdFaces = item.qtdFaces ?? best.qtdFaces;
      item.insPorDia = item.insPorDia ?? best.insPorDia;
      item.impactoEstimado = item.impactoEstimado ?? best.impactoEstimado;
      item.cnpj = item.cnpj || best.cnpj;
      item.endereco = item.endereco || best.endereco;
      matched++;
    }
  }
  return matched;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function applyMoneyFormat(cell: ExcelJS.Cell): void {
  cell.numFmt = '"R$"#,##0.00';
}

function parseMoneyStr(s: string): number {
  if (!s) return 0;
  // Remove "R$", spaces, dots (thousands), keep comma as decimal separator
  const cleaned = s.replace(/R\$\s*/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function parsePercentStr(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/%/g, "").replace(",", ".").trim();
  const val = parseFloat(cleaned);
  if (isNaN(val)) return 0;
  return val > 1 ? val / 100 : val; // normalize 30 → 0.3
}

function sanitizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "");
}

function parseMarkdownTables(markdown: string): Array<{ headers: string[]; rows: string[][] }> {
  const lines = markdown.split("\n").map((l) => l.trim());
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  let currentTable: { headers: string[]; rows: string[][] } | null = null;

  for (const line of lines) {
    if (line.startsWith("|") && line.endsWith("|")) {
      const parts = line.split("|").map((p) => p.trim()).slice(1, -1);
      // Skip separator rows (e.g. |---|---|)
      if (parts.every((p) => /^:?-+:?$/.test(p))) continue;
      if (!currentTable) {
        currentTable = { headers: parts, rows: [] };
      } else {
        currentTable.rows.push(parts);
      }
    } else {
      if (currentTable) {
        tables.push(currentTable);
        currentTable = null;
      }
    }
  }
  if (currentTable) tables.push(currentTable);
  return tables;
}
