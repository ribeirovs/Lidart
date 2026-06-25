import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Plus, Trash2, Save, Search, AlertTriangle, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Linha = { chave: string; rotulo: string; cidade: string; custoUnitario: number; campanhaSemanas: number; qtd: number };

const brl = (n: number) => "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

export default function PlanoMidia() {
  const [, params] = useRoute("/proposal/:id/plano-midia");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const id = Number(params?.id);

  const [cidade, setCidade] = useState<string>("");
  const [termo, setTermo] = useState<string>("");
  const [buscaAtiva, setBuscaAtiva] = useState<string>("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregouPlano, setCarregouPlano] = useState(false);

  const optionsQuery = trpc.proposals.listMediaOptions.useQuery(
    { id, cidade: cidade || undefined, termo: buscaAtiva || undefined },
    { enabled: !!id }
  );
  const planoSalvo = trpc.proposals.getMediaPlan.useQuery({ id }, { enabled: !!id });
  const saveMutation = trpc.proposals.saveMediaPlan.useMutation();
  const updateStage = trpc.proposals.update.useMutation();

  // Recomendação ESTRATÉGICA da IA p/ a praça atual (destaque, não pré-seleção).
  // É uma chamada de LLM; carrega à parte (a lista aparece na hora, o destaque chega depois).
  const cidadeEfetiva = cidade || optionsQuery.data?.cidadeAlvo || "";
  const recQuery = trpc.proposals.recommendCotas.useQuery(
    { id, cidade: cidadeEfetiva },
    { enabled: !!id && !!cidadeEfetiva, staleTime: 5 * 60 * 1000, retry: false }
  );
  const recMap = new Map<string, string>((recQuery.data?.recomendadas || []).map((r: any) => [r.chave, r.motivo]));

  // Praça inicial = primeira do briefing
  useEffect(() => {
    if (!cidade && optionsQuery.data?.cidadeAlvo) setCidade(optionsQuery.data.cidadeAlvo);
  }, [optionsQuery.data?.cidadeAlvo, cidade]);

  // Carrega o plano já salvo para edição (uma vez)
  useEffect(() => {
    if (carregouPlano || !planoSalvo.data) return;
    const itens = planoSalvo.data.itens || [];
    if (itens.length > 0) {
      setLinhas(itens.filter((i: any) => i.status === "ok").map((i: any) => ({
        chave: i.chave, rotulo: `${i.row.nome} · ${i.row.local}`, cidade: i.row.cidade,
        custoUnitario: i.row.custoUnitario, campanhaSemanas: i.campanhaSemanas || 1, qtd: i.qtd || 1,
      })));
    }
    setCarregouPlano(true);
  }, [planoSalvo.data, carregouPlano]);

  const pracas: string[] = optionsQuery.data?.pracas || [];
  const options = optionsQuery.data?.options || [];
  const jaNoPlano = (chave: string) => linhas.some((l) => l.chave === chave);

  const adicionar = (o: any) => {
    if (jaNoPlano(o.chave)) return;
    setLinhas((p) => [...p, { chave: o.chave, rotulo: `${o.nome} · ${o.local}`, cidade: o.cidade, custoUnitario: o.custoUnitario, campanhaSemanas: 1, qtd: 1 }]);
  };
  const remover = (chave: string) => setLinhas((p) => p.filter((l) => l.chave !== chave));
  const setCampo = (chave: string, campo: "campanhaSemanas" | "qtd", v: number) =>
    setLinhas((p) => p.map((l) => (l.chave === chave ? { ...l, [campo]: Math.max(1, v || 1) } : l)));

  const salvar = async () => {
    try {
      await saveMutation.mutateAsync({ id, linhas: linhas.map((l) => ({ chave: l.chave, campanhaSemanas: l.campanhaSemanas, qtd: l.qtd })) });
      toast.success("Plano de mídia salvo!");
      planoSalvo.refetch();
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar o plano");
    }
  };

  const concluirValoracao = async () => {
    if (linhas.length === 0) { toast.error("Adicione ao menos um ponto antes de concluir."); return; }
    try {
      await saveMutation.mutateAsync({ id, linhas: linhas.map((l) => ({ chave: l.chave, campanhaSemanas: l.campanhaSemanas, qtd: l.qtd })) });
      await updateStage.mutateAsync({ id, currentStage: "valuation_validation" } as any);
      toast.success("Valoração concluída! Seguindo para a aprovação.");
      navigate(`/proposal/${id}`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao concluir a valoração");
    }
  };

  const totalSalvo = planoSalvo.data?.total || 0;
  const semLastro = (planoSalvo.data?.itens || []).filter((i: any) => i.status === "sem_lastro");
  // Aviso de "verticais fora do plano" REMOVIDO (pedido da Viviane): a IA agora sugere os formatos
  // por critério (briefing → pesquisa → ideia → diversidade) e o planner escolhe — o aviso
  // formato-a-formato virou redundante. Mantido só o aviso de PRAÇA inteira sem nada (mais grave).
  // Praças do briefing SEM nenhuma linha no plano (caíram inteiras) — confirmar se é intencional
  const pracasCaidas = ((planoSalvo.data as any)?.completude || [])
    .filter((c: any) => c.verticaisNoPlano.length === 0)
    .map((c: any) => c.praca);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--cream)" }}>
      <AppHeader user={user} activeHref="" />
      <main className="container max-w-6xl mx-auto px-4 py-8">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/proposal/${id}`)} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar para a proposta
        </Button>
        <h1 className="text-2xl font-serif font-bold text-foreground mb-1">Plano de Mídia — Seleção de Cotas</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Escolha a linha exata do catálogo Kallas por ponto. Os preços vêm direto da tabela oficial — nada é estimado.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ESQUERDA: catálogo */}
          <Card className="p-5 border border-border/50 bg-white/60">
            <h3 className="font-semibold text-foreground mb-3">Catálogo da praça</h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {pracas.map((p) => (
                <button key={p} onClick={() => { setCidade(p); }}
                  className={`px-2.5 py-1 text-xs rounded-full border transition ${cidade === p ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              <Input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Filtrar produto (ex.: banca, painel, aeroporto)"
                onKeyDown={(e) => { if (e.key === "Enter") setBuscaAtiva(termo); }} className="text-sm" />
              <Button size="sm" variant="outline" onClick={() => setBuscaAtiva(termo)}><Search className="w-4 h-4" /></Button>
            </div>
            {recQuery.isFetching ? (
              <div className="flex items-center gap-1.5 text-[11px] text-primary mb-2"><Spinner className="w-3 h-3" /> IA analisando o catálogo desta praça…</div>
            ) : recMap.size > 0 ? (
              <div className="text-[11px] text-muted-foreground mb-2"><span className="text-primary font-semibold">★</span> = sugestão da IA (briefing → pesquisa → ideia → diversidade). Passe o mouse pro motivo; você decide o que adicionar.</div>
            ) : null}
            {optionsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><Spinner className="w-4 h-4" /> Carregando catálogo...</div>
            ) : optionsQuery.data?.semCatalogo ? (
              <p className="text-sm text-amber-700 py-6">Tabela de preços não encontrada nos recursos. Suba a tabela Kallas para liberar o seletor.</p>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {options.length === 0 && <p className="text-sm text-muted-foreground py-4">Nenhuma opção para esta praça/filtro.</p>}
                {options.map((o: any) => {
                  const motivo = recMap.get(o.chave);
                  const rec = !!motivo;
                  return (
                  <div key={o.chave} title={motivo || undefined}
                    className={`flex items-center justify-between gap-2 p-2 rounded-lg border text-xs transition ${rec ? "border-primary bg-primary/10 ring-1 ring-primary/20" : "border-border/50 bg-background/60"}`}>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {rec && <span className="mr-1 text-primary">★</span>}
                        {o.nome}{o.ehCircuito && <span className="ml-1 text-[10px] text-primary">circuito</span>}
                      </div>
                      <div className="text-muted-foreground truncate">{o.local} · {o.cota}/{o.veiculacao} · <span className="font-semibold">{brl(o.custoUnitario)}</span></div>
                      {rec && <div className="text-[10px] text-primary/80 truncate mt-0.5">{motivo}</div>}
                    </div>
                    <Button size="sm" variant="outline" disabled={jaNoPlano(o.chave)} onClick={() => adicionar(o)} className="shrink-0 h-7 px-2">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* DIREITA: plano montado */}
          <Card className="p-5 border border-border/50 bg-white/60">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">Plano selecionado ({linhas.length})</h3>
              <Button size="sm" onClick={salvar} disabled={saveMutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                {saveMutation.isPending ? <Spinner className="w-4 h-4 mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />} Salvar
              </Button>
            </div>
            {linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Adicione pontos do catálogo ao lado.</p>
            ) : (
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {linhas.map((l) => (
                  <div key={l.chave} className="p-2.5 rounded-lg border border-border/50 bg-background/60 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">{l.cidade} · {l.rotulo}</div>
                        <div className="text-muted-foreground">{brl(l.custoUnitario)} / unid.</div>
                      </div>
                      <button onClick={() => remover(l.chave)} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-3 mt-2">
                      <label className="flex items-center gap-1 text-muted-foreground">semanas
                        <Input type="number" min={1} value={l.campanhaSemanas} onChange={(e) => setCampo(l.chave, "campanhaSemanas", Number(e.target.value))} className="h-7 w-16 text-xs" /></label>
                      <label className="flex items-center gap-1 text-muted-foreground">qtd
                        <Input type="number" min={1} value={l.qtd} onChange={(e) => setCampo(l.chave, "qtd", Number(e.target.value))} className="h-7 w-16 text-xs" /></label>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Totais resolvidos pelo motor (após salvar) */}
            <div className="mt-4 pt-4 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Total veiculação (resolvido)</span>
                <span className="text-lg font-bold text-primary">{brl(totalSalvo)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Calculado pelo motor a partir da tabela oficial (período não-linear, circuito fechado). Salve para atualizar.</p>
              <Button onClick={concluirValoracao} disabled={saveMutation.isPending || updateStage.isPending || linhas.length === 0}
                className="w-full mt-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
                <Check className="w-4 h-4 mr-1.5" /> Concluir valoração e enviar para aprovação
              </Button>
              {semLastro.length > 0 && (
                <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{semLastro.length} linha(s) sem lastro no catálogo — revise (catálogo pode ter mudado).</span>
                </div>
              )}
              {/* Praças do briefing que ficaram inteiras de fora do plano */}
              {pracasCaidas.length > 0 && (
                <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2.5 text-[11px]">
                  <div className="flex items-center gap-1.5 font-semibold text-red-800 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Praças do briefing sem nenhuma linha
                  </div>
                  <p className="text-red-700">{pracasCaidas.join(", ")} — não há nada precificado para elas. Confirme se a ausência é intencional (o texto da proposta também não poderá vendê-las).</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
