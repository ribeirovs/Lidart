import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  UploadCloud,
  Trash2,
  Package,
  CircleDollarSign,
  ImageIcon,
  BarChart2,
} from "lucide-react";

/* ── type metadata ───────────────────────────────────────── */
const typeConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  inventory:       { label: "Inventário",          icon: Package,          color: "var(--terra)"       },
  pricing:         { label: "Tabela de Preços",     icon: CircleDollarSign, color: "var(--ocre)"        },
  product_content: { label: "Conteúdo de Produto", icon: ImageIcon,        color: "var(--terra-light)" },
  market_data:     { label: "Dados de Mercado",     icon: BarChart2,        color: "var(--musgo)"       },
};

/* ── page ────────────────────────────────────────────────── */
export default function ResourcesNew() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resourceType, setResourceType] = useState("inventory");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: resources = [], refetch } = trpc.resources.list.useQuery();
  const deleteMutation = trpc.resources.delete.useMutation();

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(
      selected.size === resources.length
        ? new Set()
        : new Set(resources.map((r: any) => r.id))
    );
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Deletar ${selected.size} arquivo(s)?`)) return;
    try {
      await Promise.all(Array.from(selected).map(id => deleteMutation.mutateAsync({ id })));
      toast.success(`${selected.size} arquivo(s) deletado(s)`);
      setSelected(new Set());
      await refetch();
    } catch {
      toast.error("Erro ao deletar arquivos");
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) { toast.error("Selecione um arquivo"); return; }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("type", resourceType);
      formData.append("description", description);
      formData.append("name", selectedFile.name);
      formData.append("file", selectedFile);

      const response = await fetch("/api/upload-resource", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }

      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Upload failed");

      toast.success("Arquivo enviado com sucesso!");
      setSelectedFile(null);
      setDescription("");
      await refetch();
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar arquivo");
    } finally {
      setIsUploading(false);
    }
  };

  const allSelected = resources.length > 0 && selected.size === resources.length;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--cream)" }}>
      <AppHeader user={user} onLogout={logout} activeHref="/resources-new" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Page title */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm mb-4 transition-colors hover:opacity-80"
            style={{ color: "var(--ink-light)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao dashboard
          </button>
          <h1
            className="text-4xl font-bold"
            style={{ fontFamily: "var(--font-serif)", color: "var(--ink)" }}
          >
            Recursos
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-light)" }}>
            Inventário, tabelas de preço e arquivos de referência para as propostas.
          </p>
        </div>

        {/* Upload form */}
        <Card
          className="bg-white p-8 mb-8 shadow-sm"
          style={{ borderLeft: "3px solid var(--terra)", borderRadius: "4px" }}
        >
          <h2
            className="text-xl font-semibold mb-6"
            style={{ fontFamily: "var(--font-serif)", color: "var(--ink)" }}
          >
            Enviar novo recurso
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Type select */}
            <div className="space-y-2">
              <Label
                className="text-xs uppercase tracking-widest font-medium"
                style={{ fontFamily: "var(--font-mono)", color: "var(--ink-light)" }}
              >
                Tipo de recurso
              </Label>
              <Select value={resourceType} onValueChange={setResourceType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(typeConfig).map(([value, { label, icon: Icon, color }]) => (
                    <SelectItem key={value} value={value}>
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4" style={{ color }} />
                        {label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* File input */}
            <div className="space-y-2">
              <Label
                className="text-xs uppercase tracking-widest font-medium"
                style={{ fontFamily: "var(--font-mono)", color: "var(--ink-light)" }}
              >
                Arquivo
              </Label>
              <label
                className="flex items-center gap-3 w-full px-4 py-2.5 border text-sm cursor-pointer transition-colors hover:border-[var(--terra)]"
                style={{
                  minHeight: "42px",
                  borderColor: "var(--cream-dark)",
                  borderRadius: "4px",
                  backgroundColor: "var(--cream)",
                }}
              >
                <UploadCloud className="w-4 h-4 shrink-0" style={{ color: "var(--terra)" }} />
                <span style={{ color: selectedFile ? "var(--ink)" : "var(--ink-light)" }}>
                  {selectedFile ? selectedFile.name : "Clique para selecionar..."}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.txt,.json"
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                />
              </label>
              <p
                className="text-xs"
                style={{ fontFamily: "var(--font-mono)", color: "var(--ink-light)" }}
              >
                PDF, Excel, CSV, Word ou JSON
              </p>
            </div>

            {/* Description full-width */}
            <div className="md:col-span-2 space-y-2">
              <Label
                className="text-xs uppercase tracking-widest font-medium"
                style={{ fontFamily: "var(--font-mono)", color: "var(--ink-light)" }}
              >
                Descrição{" "}
                <span className="normal-case tracking-normal font-normal" style={{ color: "var(--ink-light)" }}>
                  (opcional)
                </span>
              </Label>
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Breve descrição do conteúdo do arquivo..."
                className="resize-none"
                rows={3}
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className="text-white gap-2"
              style={{ backgroundColor: "var(--terra)" }}
            >
              <UploadCloud className="w-4 h-4" />
              {isUploading ? "Enviando..." : "Enviar arquivo"}
            </Button>
          </div>
        </Card>

        {/* Resources list */}
        <Card
          className="bg-white shadow-sm overflow-hidden"
          style={{ borderLeft: "3px solid var(--terra-light)", borderRadius: "4px" }}
        >
          <div
            className="flex items-center justify-between px-6 py-4 border-b"
            style={{ borderColor: "var(--cream-dark)" }}
          >
            <h2
              className="text-lg font-semibold"
              style={{ fontFamily: "var(--font-serif)", color: "var(--ink)" }}
            >
              Seus recursos
              {resources.length > 0 && (
                <span
                  className="ml-2 text-sm font-normal"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--ink-light)" }}
                >
                  ({resources.length})
                </span>
              )}
            </h2>
            {selected.size > 0 && (
              <Button variant="destructive" size="sm" onClick={handleDelete} className="gap-1.5">
                <Trash2 className="w-3.5 h-3.5" />
                Deletar {selected.size} selecionado{selected.size !== 1 ? "s" : ""}
              </Button>
            )}
          </div>

          {resources.length === 0 ? (
            <div className="py-16 text-center">
              <div
                className="w-12 h-12 rounded flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: "var(--terra-pale)" }}
              >
                <UploadCloud className="w-6 h-6" style={{ color: "var(--terra)" }} />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>Nenhum recurso ainda</p>
              <p className="text-sm mt-1" style={{ color: "var(--ink-light)" }}>
                Envie um arquivo acima para começar.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: "var(--cream)", borderBottom: `1px solid var(--cream-dark)` }}>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.1em", color: "var(--ink-light)", textTransform: "uppercase" }}
                  >
                    Nome
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.1em", color: "var(--ink-light)", textTransform: "uppercase" }}
                  >
                    Tipo
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium hidden md:table-cell"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.1em", color: "var(--ink-light)", textTransform: "uppercase" }}
                  >
                    Descrição
                  </th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r: any) => {
                  const cfg = typeConfig[r.type] || typeConfig.inventory;
                  const TypeIcon = cfg.icon;
                  const isChecked = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className="transition-colors cursor-pointer"
                      style={{
                        borderBottom: `1px solid var(--cream-dark)`,
                        backgroundColor: isChecked ? "var(--terra-pale)" : undefined,
                      }}
                      onClick={() => toggleSelect(r.id)}
                      onMouseEnter={e => !isChecked && ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--cream)")}
                      onMouseLeave={e => !isChecked && ((e.currentTarget as HTMLElement).style.backgroundColor = "")}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(r.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: "var(--ink)" }}>{r.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <TypeIcon className="w-3.5 h-3.5 shrink-0" style={{ color: cfg.color }} />
                          <span
                            className="text-xs font-medium"
                            style={{ fontFamily: "var(--font-mono)", color: cfg.color }}
                          >
                            {cfg.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell" style={{ color: "var(--ink-light)" }}>
                        {r.description || <span style={{ opacity: 0.35 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </main>
    </div>
  );
}
