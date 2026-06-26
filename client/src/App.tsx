import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import CreateProposal from "./pages/CreateProposal";
import ProposalsList from "./pages/ProposalsList";
import ProposalDetail from "./pages/ProposalDetail";
import Resources from "./pages/ResourcesPage";
import ResourcesNew from "./pages/ResourcesPageNew";
import Briefing from "./pages/Briefing";
import PlanoMidia from "./pages/PlanoMidia";
import Login from "./pages/Login";
import DefinirSenha from "./pages/DefinirSenha";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/login"} component={Login} />
      <Route path={"/definir-senha"} component={DefinirSenha} />
      <Route path={"/"} component={Home} />
      <Route path={"/create"} component={CreateProposal} />
      <Route path={"/proposals"} component={ProposalsList} />
      <Route path={"/proposal/:id/plano-midia"} component={PlanoMidia} />
      <Route path={"/proposal/:id"} component={ProposalDetail} />
      <Route path={"/resources"} component={Resources} />
      <Route path={"/resources-new"} component={ResourcesNew} />
      <Route path={"/briefing"} component={Briefing} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
