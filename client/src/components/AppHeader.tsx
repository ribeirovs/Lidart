import { Button } from "@/components/ui/button";
import { FileText, LogOut } from "lucide-react";
import { useLocation } from "wouter";

interface AppHeaderProps {
  title: string;
  showBack?: boolean;
  onBackClick?: () => void;
  rightAction?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "ghost";
    icon?: React.ReactNode;
  };
  user?: {
    name?: string | null;
    email?: string | null;
  };
  onLogout?: () => void;
}

export function AppHeader({
  title,
  showBack = false,
  onBackClick,
  rightAction,
  user,
  onLogout,
}: AppHeaderProps) {
  const [, navigate] = useLocation();

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {showBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBackClick || (() => navigate("/"))}
              className="text-muted-foreground hover:text-foreground"
            >
              ←
            </Button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
              <FileText className="w-6 h-6 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-serif font-bold text-foreground">{title}</h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.name || user.email}
            </span>
          )}
          {rightAction && (
            <Button
              onClick={rightAction.onClick}
              variant={rightAction.variant || "default"}
              size="sm"
              className={rightAction.variant === "default" ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""}
            >
              {rightAction.icon && <span className="mr-2">{rightAction.icon}</span>}
              {rightAction.label}
            </Button>
          )}
          {onLogout && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
