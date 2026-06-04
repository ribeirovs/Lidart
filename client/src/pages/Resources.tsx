import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Plus, Trash2, Upload, File } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const resourceTypeLabels: Record<string, { label: string; color: string }> = {
  inventory: { label: "Inventário", color: "bg-blue-100 text-blue-800" },
  pricing: { label: "Tabela de Preços", color: "bg-green-100 text-green-800" },
  product_content: { label: "Conteúdo de Produto", color: "bg-purple-100 text-purple-800" },
  market_data: { label: "Dados de Mercado", color: "bg-orange-100 text-orange-800" },
};

export default function Resources() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resourceType, setResourceType] = useState<string>("inventory");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const { data: resources = [], isLoading, refetch } = trpc.resources.list.useQuery();
  const uploadMutation = trpc.resources.upload.useMutation();
  const deleteMutation = trpc.resources.delete.useMutation();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setSelectedFile(e.target.files[0]);
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
      formData.append("file", selectedFile);
      formData.append("type", resourceType);
      formData.append("description", description);

      await uploadMutation.mutateAsync(formData as any);
      toast.success("Arquivo enviado com sucesso!");
      setSelectedFile(null);
      setDescription("");
      refetch();
    } catch (error) {
      toast.error("Erro ao enviar arquivo");
      console.error(error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja deletar este recurso?")) return;

    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Recurso deletado com sucesso!");
      refetch();
    } catch (error) {
      toast.error("Erro ao deletar recurso");
      console.error(error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center">
        <div className="text-center">
          <Spinner className="w-12 h-12 mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando recursos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-2xl font-serif font-bold text-foreground">Recursos</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 py-12">
        {/* Upload Section */}
        <Card className="border border-border/50 bg-white/50 backdrop-blur p-8 mb-12">
          <h2 className="text-xl font-semibold text-foreground mb-6">Fazer Upload de Recurso</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Tipo de Recurso
              </label>
              <select
                value={resourceType}
                onChange={(e) => setResourceType(e.target.value)}
                className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="inventory">Inventário</option>
                <option value="pricing">Tabela de Preços</option>
                <option value="product_content">Conteúdo de Produto</option>
                <option value="market_data">Dados de Mercado</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Descrição (opcional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o conteúdo deste recurso..."
                className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Arquivo
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="file"
                  onChange={handleFileChange}
                  className="flex-1 px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.txt,.json"
                />
                <Button
                  onClick={handleUpload}
                  disabled={!selectedFile || isUploading}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isUploading ? "Enviando..." : "Enviar"}
                </Button>
              </div>
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-2">
                  Arquivo selecionado: {selectedFile.name}
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Resources List */}
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-6">Seus Recursos</h2>
          
          {!resources || resources.length === 0 ? (
            <Card className="border-2 border-dashed border-border/50 bg-muted/20 backdrop-blur p-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
                <File className="w-8 h-8 text-primary/50" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground">Nenhum recurso enviado</p>
                <p className="text-muted-foreground mt-2">
                  Comece enviando seus arquivos de inventário, tabela de preços ou conteúdo
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {resources.map((resource: any) => (
                <Card
                  key={resource.id}
                  className="border border-border/50 bg-white/50 backdrop-blur p-6 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <File className="w-5 h-5 text-muted-foreground" />
                        <h3 className="text-lg font-semibold text-foreground">
                          {resource.name}
                        </h3>
                        <Badge className={resourceTypeLabels[resource.type as keyof typeof resourceTypeLabels]?.color || "bg-gray-100"}>
                          {resourceTypeLabels[resource.type as keyof typeof resourceTypeLabels]?.label || resource.type}
                        </Badge>
                      </div>
                      {resource.description && (
                        <p className="text-sm text-muted-foreground">
                          {resource.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
                        <span>
                          Enviado em {format(new Date(resource.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(resource.id)}
                        className="text-destructive hover:text-destructive/80"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
