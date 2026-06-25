/**
 * ============================================================
 * MOTOR DE VALORAÇÃO — ancoragem atômica à Tabela de Preços Kallas
 * ============================================================
 * Implementa as travas da instrução de sistema do agente OOH:
 *  - Trava 1: linha atômica (UF, CNPJ, razão, faces, custo vêm da MESMA linha)
 *  - Trava 3: conversão de período pela regra das Notas (não ×N linear)
 *  - Trava 4: circuito é preço fechado (não multiplica por face)
 *  - Trava 5: sem linha na fonte → recusa (nunca inventa)
 *  - Passo final: reverificação linha a linha
 * A cota/veiculação vêm de FORA (do planner). O motor só localiza a
 * linha exata e calcula — nunca escolhe cota.
 * ============================================================
 */

import ExcelJS from "exceljs";
import { getDb } from "./db";
import { resources } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { storageReadBuffer } from "./storage";

const SHEET = "Tabela de Preços Kallas_2026";

export interface CatalogRow {
  uf: string;
  cidade: string;
  vertical: string;
  local: string;
  nome: string;
  /** Nome do arquivo da foto do ponto (coluna "IMAGEM DO PRODUTO"), p/ casar com o inventário de mockup. */
  imagem: string;
  /** Inserções por dia (coluna "INS POR DIA" da tabela). */
  insPorDia: number;
  /** Impacto estimado por inserção/dia (coluna "IMPACTO ESTIMADO" da tabela). */
  impactoEstimado: number;
  cota: string;
  tipo: string;
  veiculacao: string;
  faces: number;
  custoUnitario: number;
  cnpj: string;
  razao: string;
  endereco: string;
}

function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Base da cidade: remove sufixo de região metropolitana ("e RM", "e Região",
// "e RMR", "/RM") para que "Belo Horizonte e RM" == "Belo Horizonte" (MESMA praça),
// SEM colar municípios distintos ("Vitória da Conquista" ≠ "Vitória").
function cidadeBase(s: string): string {
  return norm(s)
    .replace(/[\/\-]\s*(rm|rmr)\b/g, "")
    .replace(/\s+e\s+(rm|rmr|regiao metropolitana|regiao|grande\s+\w+)\b.*$/g, "")
    .replace(/\s+(rm|rmr)\s*$/g, "")
    .trim();
}
function mesmaCidade(a: string, b: string): boolean {
  const ba = cidadeBase(a), bb = cidadeBase(b);
  return ba === bb;
}

function parseMoney(s: string): number {
  const raw = String(s ?? "").replace(/[^\d.,]/g, "");
  if (!raw) return 0;
  if (raw.includes(",")) return parseFloat(raw.replace(/\./g, "").replace(",", ".")) || 0;
  const dots = (raw.match(/\./g) || []).length;
  if (dots === 0) return parseFloat(raw) || 0;
  if (dots === 1 && !/^\d{1,3}\.\d{3}$/.test(raw)) return parseFloat(raw) || 0;
  return parseFloat(raw.replace(/\./g, "")) || 0;
}

/** Carrega TODAS as linhas da Tabela de Preços, sem dedup, com todos os campos. */
export async function loadFullCatalog(userId: number): Promise<CatalogRow[]> {
  const db = await getDb();
  if (!db) return [];
  const userResources = await db.select().from(resources).where(eq(resources.userId, userId)).orderBy(desc(resources.id));
  const priceRes = userResources.find((r) => {
    const n = norm(r.name || "");
    return (n.includes("preco") || n.includes("tabela")) && ((r.mimeType || "").includes("spreadsheetml") || n.endsWith(".xlsx"));
  });
  if (!priceRes) return [];

  const buf = await storageReadBuffer(priceRes.fileKey);
  if (!buf) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const sheet = wb.getWorksheet(SHEET) || wb.worksheets[0];
  if (!sheet) return [];

  const get = (row: ExcelJS.Row): string[] => {
    const raw = Array.isArray(row.values) ? row.values : [];
    const arr: string[] = [];
    for (let i = 1; i < raw.length; i++) {
      const v: any = raw[i];
      const val = v && typeof v === "object" ? (v.result ?? v.text ?? "") : v;
      arr.push(val !== null && val !== undefined ? String(val) : "");
    }
    return arr;
  };

  // Localiza a linha de cabeçalho (procura UF + CIDADE + COTA nos primeiros 20 registros).
  let headerRow = -1;
  sheet.eachRow({ includeEmpty: false }, (row, rn) => {
    if (headerRow !== -1 || rn > 20) return;
    const v = get(row).map((x) => x.toUpperCase());
    if (v.includes("UF") && v.some((x) => x.includes("CIDADE")) && v.some((x) => x.includes("COTA"))) headerRow = rn;
  });
  if (headerRow === -1) return [];

  // Mapa coluna→índice por NOME do cabeçalho (robusto à inserção de colunas, ex.: "IMAGEM
  // DO PRODUTO"/"CODIGO DO PRODUTO"). Fallback p/ o índice fixo antigo se o nome não existir.
  const header = get(sheet.getRow(headerRow));
  const colKey = (s: string) => norm(s).replace(/\s+/g, " ").trim();
  const findCol = (aliases: string[], fallback: number): number => {
    const al = aliases.map(colKey);
    for (let k = 0; k < header.length; k++) {
      const h = colKey(header[k]);
      if (h && al.some((a) => h === a || h.startsWith(a))) return k;
    }
    return fallback;
  };
  const ix = {
    uf: findCol(["uf"], 1),
    cidade: findCol(["cidade"], 2),
    vertical: findCol(["vertical"], 3),
    local: findCol(["local"], 4),
    nome: findCol(["nome comercial", "nome"], 6),
    imagem: findCol(["imagem do produto", "imagem"], -1),
    insPorDia: findCol(["ins por dia", "insercoes por dia"], -1),
    impactoEstimado: findCol(["impacto estimado"], -1),
    cota: findCol(["cota"], 10),
    tipo: findCol(["tipo"], 11),
    veiculacao: findCol(["veiculacao"], 12),
    faces: findCol(["qtd de faces", "faces"], 13),
    custo: findCol(["custo unitario"], 19),
    cnpj: findCol(["cnpj"], 24),
    razao: findCol(["razao social", "razao"], 25),
    endereco: findCol(["endereco"], 26),
  };
  const cell = (v: string[], i: number) => (i >= 0 ? (v[i] || "").trim() : "");

  const out: CatalogRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= headerRow) return;
    const v = get(row);
    const cidade = cell(v, ix.cidade);
    const preco = parseMoney(v[ix.custo] || "");
    if (!cidade || preco <= 0) return;
    out.push({
      uf: cell(v, ix.uf),
      cidade,
      vertical: cell(v, ix.vertical),
      local: cell(v, ix.local),
      nome: cell(v, ix.nome),
      imagem: cell(v, ix.imagem),
      insPorDia: parseMoney(cell(v, ix.insPorDia)),
      impactoEstimado: parseMoney(cell(v, ix.impactoEstimado)),
      cota: cell(v, ix.cota),
      tipo: cell(v, ix.tipo),
      veiculacao: cell(v, ix.veiculacao),
      faces: parseInt(cell(v, ix.faces).replace(/[^\d]/g, ""), 10) || 1,
      custoUnitario: preco,
      cnpj: cell(v, ix.cnpj),
      razao: cell(v, ix.razao),
      endereco: cell(v, ix.endereco),
    });
  });
  return out;
}

// ─── Trava 4: detecção de circuito (preço fechado, não multiplica por face) ───
export function isCircuito(nome: string, local: string): boolean {
  const t = norm(`${nome} ${local}`);
  return /circuito|\bmega led\b|station mub|\d+\s*pain(e|é)is|\d+\s*faces/.test(t);
}

// ─── Trava 3: conversão de período pela regra das Notas ───
// A tabela já tem preço por veiculação (Mensal/Semanal/Diário/Quinzenal).
// Para a duração da campanha, multiplica-se pelo nº de períodos daquela veiculação.
// Frações de mês seguem a Nota da vertical.
export function periodMultiplier(veiculacao: string, campanhaSemanas: number): number {
  const v = norm(veiculacao);
  if (v.includes("diario")) return campanhaSemanas * 7;        // preço diário × dias
  if (v.includes("semanal")) return campanhaSemanas;            // preço semanal × semanas
  if (v.includes("quinzenal")) return Math.ceil(campanhaSemanas / 2);
  if (v.includes("mensal")) return Math.max(1, Math.round((campanhaSemanas / 4.345) * 100) / 100); // semanas → meses
  return 1;
}

// ─── ETAPA 2: seletor de cota populado da FONTE (nunca texto livre) ───
// Cada opção é uma linha DISTINTA do catálogo (separada por local/cota/veiculação)
// que o planner aponta para desfazer a ambiguidade que o motor detecta.
export interface CotaOption {
  chave: string;        // identidade única: cidade|nome|local|cota|veiculacao
  cidade: string;
  uf: string;
  vertical: string;
  nome: string;
  local: string;
  cota: string;
  veiculacao: string;
  faces: number;
  custoUnitario: number;
  ehCircuito: boolean;
  rotulo: string;       // legível p/ o seletor
}

function optKey(r: CatalogRow): string {
  return [norm(r.cidade), norm(r.nome), norm(r.local), norm(r.cota), norm(r.veiculacao)].join("|");
}

/**
 * Lista as combinações REAIS (produto distinto × cota × veiculação) de uma praça,
 * para o seletor do planner. Cada irmão (circuito vs estação, 6 vs 12 painéis,
 * banca pura vs misto) aparece SEPARADO. Filtro opcional por termo de produto.
 */
export function listCotaOptions(catalog: CatalogRow[], cidade: string, termo?: string): CotaOption[] {
  const naCidade = catalog.filter((r) => mesmaCidade(r.cidade, cidade));

  const termoTokens = norm(termo || "").split(/\W+/).filter((t) => t.length > 2);
  const filtradas = termoTokens.length
    ? naCidade.filter((r) => { const hay = norm(`${r.nome} ${r.local} ${r.vertical}`); return termoTokens.every((t) => hay.includes(t)); })
    : naCidade;

  const porChave = new Map<string, CotaOption>();
  for (const r of filtradas) {
    const k = optKey(r);
    if (porChave.has(k)) continue;
    const ehCircuito = isCircuito(r.nome, r.local);
    porChave.set(k, {
      chave: k, cidade: r.cidade, uf: r.uf, vertical: r.vertical, nome: r.nome, local: r.local,
      cota: r.cota, veiculacao: r.veiculacao, faces: r.faces, custoUnitario: r.custoUnitario, ehCircuito,
      rotulo: `${r.nome}${r.local && norm(r.local) !== norm(r.nome) ? ` · ${r.local}` : ""} — ${r.cota}/${r.veiculacao} — R$ ${r.custoUnitario.toLocaleString("pt-BR")}`,
    });
  }
  return Array.from(porChave.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome) || a.local.localeCompare(b.local) || a.custoUnitario - b.custoUnitario);
}

/**
 * Resolve a partir de uma opção JÁ escolhida pelo planner (linha exata da fonte).
 * Casamento por identidade (chave), garantindo ZERO ambiguidade.
 */
export function resolveFromOption(catalog: CatalogRow[], chave: string, campanhaSemanas: number): ResolveResult {
  const row = catalog.find((r) => optKey(r) === chave);
  if (!row) return { status: "sem_lastro", pedido: { cidade: "", produto: chave, cota: "", veiculacao: "", campanhaSemanas }, motivo: `Opção "${chave}" não existe mais na tabela` };
  const periodos = periodMultiplier(row.veiculacao, campanhaSemanas);
  const subtotal = Math.round(row.custoUnitario * periodos * 100) / 100;
  return { status: "ok", row, periodos, subtotal, ufAlerta: ufAlerta(row.cidade, row.uf) };
}

// ── FONTE ÚNICA: plano resolvido para apresentação (Excel + texto + PPT) ──
// Resolve o mediaPlan salvo em itens prontos (preço/UF/período do motor),
// agrupados por praça, com total. Quem consome: Excel, proposta (texto), PPT.
export interface PlanItemResolvido {
  cidade: string; uf: string; vertical: string; nome: string; local: string;
  cota: string; veiculacao: string; qtd: number; periodos: number; custoUnitario: number; subtotal: number;
  cnpj: string; razao: string;
  /** Nome do arquivo da foto do ponto (coluna "IMAGEM DO PRODUTO") — usado p/ casar o mockup. */
  imagem: string;
  /** Inserções por dia e impacto estimado (colunas da tabela), p/ sair na planilha. */
  insPorDia: number;
  impactoEstimado: number;
}
export interface PlanoResolvido {
  itens: PlanItemResolvido[];
  porPraca: Array<{ praca: string; uf: string; itens: PlanItemResolvido[]; subtotal: number }>;
  totalVeiculacao: number;
  vazio: boolean;
}

export async function resolvePlanForPresentation(userId: number, mediaPlanJson?: string | null): Promise<PlanoResolvido> {
  const empty: PlanoResolvido = { itens: [], porPraca: [], totalVeiculacao: 0, vazio: true };
  if (!mediaPlanJson) return empty;
  let linhas: Array<{ chave: string; campanhaSemanas?: number; qtd?: number }> = [];
  try { linhas = JSON.parse(mediaPlanJson); } catch { return empty; }
  if (!Array.isArray(linhas) || linhas.length === 0) return empty;

  const catalog = await loadFullCatalog(userId);
  if (catalog.length === 0) return empty;

  const itens: PlanItemResolvido[] = [];
  let total = 0;
  for (const l of linhas) {
    const res = resolveFromOption(catalog, l.chave, l.campanhaSemanas || 1);
    if (res.status !== "ok") continue;
    const r = res.row;
    const qtd = l.qtd && l.qtd > 0 ? l.qtd : 1;
    const subtotal = Math.round(res.subtotal * qtd * 100) / 100;
    total += subtotal;
    itens.push({
      cidade: r.cidade, uf: r.uf, vertical: r.vertical, nome: r.nome, local: r.local,
      cota: r.cota, veiculacao: r.veiculacao, qtd, periodos: res.periodos, custoUnitario: r.custoUnitario,
      subtotal, cnpj: r.cnpj, razao: r.razao, imagem: r.imagem,
      insPorDia: r.insPorDia, impactoEstimado: r.impactoEstimado,
    });
  }
  if (itens.length === 0) return empty;

  // agrupa por praça (base, p/ unir "X" e "X e RM")
  const grupos = new Map<string, { praca: string; uf: string; itens: PlanItemResolvido[]; subtotal: number }>();
  for (const it of itens) {
    const k = cidadeBase(it.cidade);
    if (!grupos.has(k)) grupos.set(k, { praca: it.cidade.replace(/\s+e\s+rm.*/i, "").trim(), uf: it.uf, itens: [], subtotal: 0 });
    const g = grupos.get(k)!;
    g.itens.push(it);
    g.subtotal = Math.round((g.subtotal + it.subtotal) * 100) / 100;
  }
  return { itens, porPraca: Array.from(grupos.values()), totalVeiculacao: Math.round(total * 100) / 100, vazio: false };
}

// ── ETAPA 3: reverificação de completude (rede do Erro 7) ──
// Por praça do briefing, aponta as VERTICAIS que existem na fonte mas não
// têm nenhuma linha no plano. Nível de vertical (não de linha) p/ não virar ruído.
export interface CompletudePraca { praca: string; verticaisFaltando: string[]; verticaisNoPlano: string[]; }

export function planCompleteness(catalog: CatalogRow[], pracas: string[], chavesNoPlano: string[]): CompletudePraca[] {
  const noPlano = new Set(chavesNoPlano);
  const rowsNoPlano = catalog.filter((r) => noPlano.has(optKey(r)));
  return pracas.map((praca) => {
    const naFonte = catalog.filter((r) => mesmaCidade(r.cidade, praca));
    const vertFonte = new Set(naFonte.map((r) => r.vertical).filter(Boolean));
    const vertPlano = new Set(rowsNoPlano.filter((r) => mesmaCidade(r.cidade, praca)).map((r) => r.vertical).filter(Boolean));
    // Cada vertical faltando vem com o(s) PRODUTO(S) reais sob ela — o seletor de cotas
    // rotula por nome·local (ex.: "VIDRO TRASEIRO + MÍDIA INTERNA · CARROS DE APP"), não
    // por vertical ("CARTAXI"); sem isso o aviso fica impossível de achar no seletor.
    const faltando = Array.from(vertFonte).filter((v) => !vertPlano.has(v)).sort().map((v) => {
      const prods = Array.from(new Set(
        naFonte.filter((r) => r.vertical === v)
          .map((r) => `${r.nome}${r.local && norm(r.local) !== norm(r.nome) ? ` · ${r.local}` : ""}`.trim())
          .filter(Boolean)
      ));
      const amostra = prods.slice(0, 3).join(" / ") + (prods.length > 3 ? " / …" : "");
      return amostra ? `${v} (${amostra})` : v;
    });
    return { praca, verticaisFaltando: faltando, verticaisNoPlano: Array.from(vertPlano).sort() };
  });
}

export interface PlanRequest {
  cidade: string;
  /** termo do produto desejado (ex.: "Relógio", "Mega Led Metrô") */
  produto: string;
  cota: string;        // definida pelo planner
  veiculacao: string;  // definida pelo planner
  campanhaSemanas: number;
}

export interface PlanOption { nome: string; local: string; cota: string; veiculacao: string; custoUnitario: number; }
export type ResolveResult =
  | { status: "ok"; row: CatalogRow; periodos: number; subtotal: number; ufAlerta?: string }
  | { status: "sem_lastro"; pedido: PlanRequest; motivo: string }
  | { status: "ambiguo"; pedido: PlanRequest; motivo: string; opcoes: PlanOption[] };

// UF esperada por capital — usada SÓ para SINALIZAR divergência (Regra de Ouro:
// nunca corrige sozinho; fonte clara prevalece, fonte ambígua vira aviso).
const UF_CAPITAL: Record<string, string> = {
  "sao paulo": "SP", "rio de janeiro": "RJ", "belo horizonte": "MG", "curitiba": "PR",
  "florianopolis": "SC", "porto alegre": "RS", "vitoria": "ES", "goiania": "GO",
  "recife": "PE", "fortaleza": "CE", "salvador": "BA", "natal": "RN",
  "joao pessoa": "PB", "maceio": "AL", "aracaju": "SE", "manaus": "AM",
};
function ufAlerta(cidade: string, ufFonte: string): string | undefined {
  const c = norm(cidade);
  for (const [nome, uf] of Object.entries(UF_CAPITAL)) {
    if (c === nome && ufFonte && ufFonte.toUpperCase() !== uf) {
      return `UF da fonte é ${ufFonte}, mas "${cidade}" normalmente é ${uf} — confirmar (pode ser homônima, ex.: Vitória da Conquista/BA)`;
    }
  }
  return undefined;
}

/**
 * Trava 1 + 4 + 5: localiza a linha EXATA (cidade + produto/local + cota + veiculação).
 * - Exige que TODOS os tokens do pedido estejam na linha (nome + local).
 * - Se casar com >1 linha distinta → AMBÍGUO: recusa e lista as opções (não chuta entre irmãos).
 * - Se não casar → SEM LASTRO (não inventa).
 * - Copia a linha inteira (atômica). Circuito = preço fechado (nunca ×face).
 */
export function resolvePlanLine(catalog: CatalogRow[], req: PlanRequest): ResolveResult {
  const cidadeN = norm(req.cidade);
  const prodTokens = norm(req.produto).split(/\W+/).filter((t) => t.length > 2);
  const cotaN = norm(req.cota);
  const veicN = norm(req.veiculacao);

  // Cidade casa por BASE (inclui "X e RM" como mesma praça; exclui "X da Conquista").
  const naCidade = catalog.filter((r) => mesmaCidade(r.cidade, req.cidade));
  if (naCidade.length === 0) return { status: "sem_lastro", pedido: req, motivo: `Cidade "${req.cidade}" não existe na tabela` };

  const candidatos = naCidade.filter((r) => norm(r.cota) === cotaN && norm(r.veiculacao) === veicN);
  if (candidatos.length === 0) {
    return { status: "sem_lastro", pedido: req, motivo: `Não há linha em ${req.cidade} com cota "${req.cota}" + veiculação "${req.veiculacao}"` };
  }

  // Exige TODOS os tokens do produto presentes em nome+local (casamento estrito)
  const matches = candidatos.filter((r) => {
    const hay = norm(`${r.nome} ${r.local} ${r.vertical}`);
    return prodTokens.length > 0 && prodTokens.every((t) => hay.includes(t));
  });

  if (matches.length === 0) {
    return { status: "sem_lastro", pedido: req, motivo: `Produto "${req.produto}" não casa com nenhuma linha em ${req.cidade} (cota ${req.cota}/${req.veiculacao})` };
  }

  // Linhas distintas (nome+local diferentes) → ambíguo: não escolhe entre irmãos
  const distintos = new Map<string, CatalogRow>();
  for (const r of matches) distintos.set(`${norm(r.nome)}||${norm(r.local)}`, r);
  if (distintos.size > 1) {
    return {
      status: "ambiguo",
      pedido: req,
      motivo: `"${req.produto}" casa com ${distintos.size} produtos distintos em ${req.cidade} (${req.cota}/${req.veiculacao}). Especifique o local/circuito.`,
      opcoes: Array.from(distintos.values()).map((r) => ({ nome: r.nome, local: r.local, cota: r.cota, veiculacao: r.veiculacao, custoUnitario: r.custoUnitario })),
    };
  }

  const best = matches[0];
  // Trava 4: circuito = preço fechado; produto unitário pode multiplicar por faces
  const periodos = periodMultiplier(best.veiculacao, req.campanhaSemanas);
  const subtotal = Math.round(best.custoUnitario * periodos * 100) / 100;
  return { status: "ok", row: best, periodos, subtotal, ufAlerta: ufAlerta(best.cidade, best.uf) };
}

// ── PASSO 3: VERIFICADOR DETERMINÍSTICO da NARRATIVA contra o PLANO ──
// Cruza o texto gerado com o plano ESTRUTURADO (não fuzzy) e MARCA para o humano
// (planner/Vivi). REGRA DE OURO: a IA NUNCA conserta sozinha — só sinaliza; quem
// decide é a consultora. Marca: praça/formato/preço fora do plano, "Modelo
// Valoração", LINGUAGEM DE EXCLUSÃO (sacrifício/abrimos mão/trade-off/ausência —
// a narrativa só pode falar do que ESTÁ no plano) e ESTATÍSTICA SEM FONTE no Insight.
export type NarrativeFlagTipo =
  | "modelo_valoracao" | "preco_na_prosa" | "praca_fora_plano" | "formato_fora_plano"
  | "linguagem_exclusao" | "estatistica_sem_fonte" | "ambiente_fora_plano" | "calculo_rascunhado";
export interface NarrativeFlag { tipo: NarrativeFlagTipo; linha: number; trecho: string; detalhe?: string; }
export interface NarrativeCheck { flags: NarrativeFlag[]; ok: boolean; resumo: Record<NarrativeFlagTipo, number>; }

// Tipos CRÍTICOS que BLOQUEIAM a exportação (infidelidade ao plano).
// formato_fora_plano BLOQUEIA por decisão da Viviane (bloquear formato fora do plano).
// ⚠️ Tem falso positivo com descrição CRIATIVA ("Painel Fotográfico", "Totens" da
// ativação) → nesses casos o planner confirma "exportar mesmo assim".
// REGRA Nº 1 (Vivi): número sem fonte NEM lógica explícita BLOQUEIA — na proposta,
// toda estimativa tem que mostrar a premissa/cálculo (RE_FONTE aceita a derivação).
// preco_na_prosa segue como AVISO (contexto/produção, não estatística inventada).
export const NARRATIVE_BLOCKERS: NarrativeFlagTipo[] = [
  "praca_fora_plano", "formato_fora_plano", "ambiente_fora_plano",
  "linguagem_exclusao", "modelo_valoracao", "calculo_rascunhado",
  "estatistica_sem_fonte",
];

// Nomes de FORMATO OOH (raízes normalizadas) — usados só p/ marcar formato fora do plano.
const FORMATOS_OOH = [
  // "adesiv" (adesivação) NÃO entra: é técnica de EXECUÇÃO do vidro traseiro/mobiliário/ônibus
  // (que estão no plano), não um formato vendido — entrava como falso positivo de "formato fora do plano".
  "led", "outdoor", "empena", "busdoor", "banca", "abrigo", "relogio",
  "painel", "mupi", "totem", "backlight", "frontlight", "triedro", "megapainel", "placa", "doohbike",
];
// Linguagem de EXCLUSÃO/sacrifício/fraqueza (NÃO inclui "exclusiv*", que é positivo).
// "abrir mão" (infinitivo) FORA — aparece demais em claim de produto ("ninguém quer abrir mão
// do sabor", "sem abrir mão de qualidade"), que é conceito, não exclusão de mídia. A exclusão
// de mídia perigosa é "abrimos mão DE [praça]" (1ª pessoa) — essa fica, junto de trade-off etc.
const RE_EXCLUSAO = /sacrific|abrim[oa]s m[ãa]o|trade.?off|deixa(?:mos|ram|r) de fora|fic(?:ou|aram) de fora|n[ãa]o cobert|descart|menor alcance|menor roi|menor retorno/i;
// "ausência" só conta como exclusão quando perto de mercado/praça (evita falso positivo
// criativo do tipo "ausência de call-to-action / de texto").
const RE_AUSENCIA = /aus[êe]ncia[^.\n]{0,45}(mercado|pra[çc]a|capital|cobertura|regi[ãa]o|cidade)/i;
// Lastro de estatística: fonte real, rótulo de estimativa OU derivação explícita
// (premissa + cálculo). REGRA Nº 1: número pode aparecer na proposta se mostrar de onde saiu.
const RE_FONTE = /fonte|estimativa|hip[óo]tese|benchmark|segundo |de acordo com|assumindo|premissa|com base|partindo de|considerando|c[áa]lculo|calcul|deriv|projetad|proje[çc][aã]o|a confirmar|ibge|kantar|ibope|nielsen|euromonitor|anac|ccsp|geofusion/i;
// Estatística numérica (%, CAGR, "X vezes/superior/maior").
const RE_ESTATISTICA = /\d+([.,]\d+)?\s*%|\bcagr\b|\d+([.,]\d+)?\s*(vez(?:es)?|x)\s+(mais|maior|superior)/i;
// Ambientes/pontos de contato OOH fora do plano (raízes; metrô tratado por regex à parte).
const AMBIENTES_OOH = ["aeroporto", "embarque", "check-in", "vlt", "rodoviaria"];
// Cálculo rascunhado / autocorreção vazando no texto final (só a versão final vai ao cliente).
const RE_CALCULO = /corre[çc][ãa]o\s*:|ajustar (a |sua )?meta|\bou\s+r\$|\brecalcul|valores? intermedi/i;

export function verifyNarrativeAgainstPlan(narrative: string, plano: PlanoResolvido): NarrativeCheck {
  const flags: NarrativeFlag[] = [];
  const linhasTxt = (narrative || "").split(/\r?\n/);

  // Limite do bloco determinístico do plano: dali p/ frente é o motor (preço/praça legítimos).
  let planoStart = linhasTxt.length;
  for (let i = 0; i < linhasTxt.length; i++) {
    if (/^#{1,3}\s*Plano de Veicula[çc][ãa]o/i.test(linhasTxt[i])) { planoStart = i; break; }
  }
  // Limites da seção "Insight de Mercado" (p/ checar estatística sem fonte só lá).
  let insightStart = -1, insightEnd = linhasTxt.length;
  for (let i = 0; i < linhasTxt.length; i++) {
    if (insightStart === -1 && /^#{1,4}\s.*\binsight\b/i.test(linhasTxt[i])) { insightStart = i; continue; }
    if (insightStart !== -1 && i > insightStart && /^#{1,4}\s/.test(linhasTxt[i])) { insightEnd = i; break; }
  }

  // Conjuntos permitidos (do plano)
  const pracasOk = new Set<string>();
  for (const g of plano.porPraca) { pracasOk.add(norm(g.praca)); pracasOk.add(norm(cidadeBase(g.praca))); }
  // Reconhecimento do que está no plano: nome + local + VERTICAL. A vertical é essencial
  // p/ ambientes — ex.: aeroporto entra como vertical "AEROPORTO" com nome "PAINEL DE LED" e
  // local "DESEMBARQUE"; sem a vertical, a palavra "aeroporto" não era reconhecida e a narrativa
  // (que fala de aeroporto, corretamente, pois ele ESTÁ no plano) era marcada como fora do plano.
  const formatosOkTxt = norm(plano.porPraca.flatMap((g) => g.itens.map((it) => `${it.nome} ${it.local} ${it.vertical || ""}`)).join(" | "));

  const add = (tipo: NarrativeFlagTipo, i: number, detalhe?: string) =>
    flags.push({ tipo, linha: i + 1, trecho: linhasTxt[i].trim().slice(0, 180), detalhe });

  for (let i = 0; i < linhasTxt.length; i++) {
    const linha = linhasTxt[i];
    if (!linha.trim()) continue;
    const ln = norm(linha);

    // (a) "Modelo Valoração" — em qualquer lugar
    if (/modelo\s+(de\s+)?valora[çc][ãa]o/i.test(linha))
      add("modelo_valoracao", i, 'trocar por "Tabela de Preços Kallas (plano validado)"');

    // (b) linguagem de exclusão/sacrifício/fraqueza — inclui TÍTULOS (ex.: "## ... O Que Abrimos Mão")
    // "sem abrir mão de X" é claim POSITIVO do produto (ex.: "sem abrir mão do sabor"),
    // não exposição de exclusão de mídia — não bloquear por isso.
    if (i < planoStart && (RE_EXCLUSAO.test(linha) || RE_AUSENCIA.test(linha)) && !/sem\s+abrir\s+m[ãa]o/i.test(linha))
      add("linguagem_exclusao", i, "remover: a narrativa fala SÓ do que está no plano, nunca do que ficou fora/é fraco");

    // (b2) cálculo rascunhado / autocorreção vazando — só a versão final pode ir ao cliente
    if (i < planoStart && RE_CALCULO.test(linha))
      add("calculo_rascunhado", i, "remover: mostrar só o número FINAL do KPI, sem rascunho/correção/valores intermediários");

    // (c) estatística sem fonte — só na seção Insight de Mercado
    if (insightStart !== -1 && i > insightStart && i < insightEnd && !/^#{1,6}\s/.test(linha)
        && RE_ESTATISTICA.test(linha) && !RE_FONTE.test(linha))
      add("estatistica_sem_fonte", i, "número sem fonte NEM lógica — citar fonte real, OU mostrar a derivação (premissa + cálculo) e rotular como estimativa");

    // Demais checagens só na PROSA (antes do bloco do plano) e fora de títulos
    if (i >= planoStart) continue;
    if (/^#{1,6}\s/.test(linha)) continue;

    // (d) preço na prosa (o plano é a ÚNICA fonte de preço de mídia)
    if (/R\$\s?\d/.test(linha))
      add("preco_na_prosa", i, "confirmar: contexto / métrica / produção? preço de mídia vem só do plano");

    // (e) praça fora do plano
    for (const cap of Object.keys(UF_CAPITAL)) {
      if (ln.includes(cap) && !pracasOk.has(cap)) {
        add("praca_fora_plano", i, `"${cap}" fora do plano — remover (não citar o que está fora)`);
        break;
      }
    }

    // (f) formato fora do plano
    for (const f of FORMATOS_OOH) {
      if (ln.includes(f) && !formatosOkTxt.includes(f)) {
        add("formato_fora_plano", i, `"${f}" não está no plano — remover`);
        break;
      }
    }

    // (g) ambiente / ponto de contato fora do plano (ex.: aeroporto sem mídia de aeroporto no plano)
    let ambienteOk = false;
    for (const a of AMBIENTES_OOH) {
      if (ln.includes(a) && !formatosOkTxt.includes(a)) {
        add("ambiente_fora_plano", i, `"${a}" não está no plano — remover cena/dado fora do plano`);
        ambienteOk = true;
        break;
      }
    }
    if (!ambienteOk && /\bmetr[ôo]\b/i.test(linha) && !formatosOkTxt.includes("metro"))
      add("ambiente_fora_plano", i, `"metrô" não está no plano — remover cena/dado fora do plano`);
  }

  const resumo: Record<NarrativeFlagTipo, number> = {
    modelo_valoracao: 0, preco_na_prosa: 0, praca_fora_plano: 0, formato_fora_plano: 0,
    linguagem_exclusao: 0, estatistica_sem_fonte: 0, ambiente_fora_plano: 0, calculo_rascunhado: 0,
  };
  for (const f of flags) resumo[f.tipo]++;
  return { flags, ok: flags.length === 0, resumo };
}
