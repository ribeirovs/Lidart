import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Resources() {
  const [, navigate] = useLocation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resourceType, setResourceType] = useState("inventory");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: resources = [], refetch } = trpc.resources.list.useQuery();
  const deleteMutation = trpc.resources.deleteResource.useMutation();

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === resources.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(resources.map((r: any) => r.id)));
    }
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Deletar ${selected.size} arquivo(s)?`)) return;
    try {
      await Promise.all(
        Array.from(selected).map(id => deleteMutation.mutateAsync({ id }))
      );
      toast.success(`${selected.size} arquivo(s) deletado(s)`);
      setSelected(new Set());
      await refetch();
    } catch {
      toast.error("Erro ao deletar arquivos");
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Selecione um arquivo");
      return;
    }
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

  const typeLabels: Record<string, string> = {
    inventory: "Inventário",
    pricing: "Tabela de Preços",
    product_content: "Conteúdo de Produto",
    market_data: "Dados de Mercado",
  };

  return (
    <div style={{ padding: "40px", maxWidth: "1000px", margin: "0 auto" }}>
      <button onClick={() => navigate("/")} style={{ marginBottom: "20px", padding: "8px 16px" }}>
        ← Voltar
      </button>

      <h1>Recursos</h1>

      <div style={{ marginBottom: "40px", padding: "20px", border: "1px solid #ccc", borderRadius: "8px" }}>
        <h2>Fazer Upload de Recurso</h2>

        <div style={{ marginBottom: "15px" }}>
          <label>Tipo de Recurso:</label>
          <select
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            style={{ display: "block", width: "100%", padding: "8px", marginTop: "5px" }}
          >
            <option value="inventory">Inventário</option>
            <option value="pricing">Tabela de Preços</option>
            <option value="product_content">Conteúdo de Produto</option>
            <option value="market_data">Dados de Mercado</option>
          </select>
        </div>

        <div style={{ marginBottom: "15px" }}>
          <label>Descrição (opcional):</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ display: "block", width: "100%", padding: "8px", marginTop: "5px", minHeight: "80px" }}
          />
        </div>

        <div style={{ marginBottom: "15px" }}>
          <label>Arquivo:</label>
          <input
            type="file"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            style={{ display: "block", marginTop: "5px" }}
            accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.txt,.json"
          />
          {selectedFile && <p style={{ marginTop: "5px", fontSize: "14px" }}>Selecionado: {selectedFile.name}</p>}
        </div>

        <button
          onClick={handleUpload}
          disabled={!selectedFile || isUploading}
          style={{
            padding: "10px 20px",
            backgroundColor: selectedFile && !isUploading ? "#2d5016" : "#ccc",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: selectedFile && !isUploading ? "pointer" : "not-allowed",
          }}
        >
          {isUploading ? "Enviando..." : "Enviar"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <h2 style={{ margin: 0 }}>Seus Recursos</h2>
        {selected.size > 0 && (
          <button
            onClick={handleDelete}
            style={{
              padding: "8px 16px",
              backgroundColor: "#c0392b",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Deletar selecionados ({selected.size})
          </button>
        )}
      </div>

      {resources.length === 0 ? (
        <p>Nenhum recurso enviado ainda.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ccc" }}>
              <th style={{ padding: "10px", textAlign: "left", width: "40px" }}>
                <input
                  type="checkbox"
                  checked={selected.size === resources.length && resources.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th style={{ padding: "10px", textAlign: "left" }}>Nome</th>
              <th style={{ padding: "10px", textAlign: "left" }}>Tipo</th>
              <th style={{ padding: "10px", textAlign: "left" }}>Descrição</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r: any) => (
              <tr
                key={r.id}
                style={{
                  borderBottom: "1px solid #eee",
                  backgroundColor: selected.has(r.id) ? "#fff3f3" : "transparent",
                }}
              >
                <td style={{ padding: "10px" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                  />
                </td>
                <td style={{ padding: "10px" }}><strong>{r.name}</strong></td>
                <td style={{ padding: "10px" }}>{typeLabels[r.type] || r.type}</td>
                <td style={{ padding: "10px" }}>{r.description || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
