import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { Shell } from "./components/Shell";
import { api } from "./lib/api";
import { usePath } from "./lib/router";
import { ActivityPage } from "./pages/Activity";
import { ListingsPage } from "./pages/Listings";
import { Login } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { PayReturn } from "./pages/PayReturn";
import { QuestionsPage } from "./pages/Questions";
import { VisitsPage } from "./pages/Visits";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2000, refetchOnWindowFocus: true, retry: 1 } },
});

function Console() {
  const path = usePath();
  // "checking" until the Worker says whether a sign-in is needed. In demo mode it never is.
  const [state, setState] = useState<"checking" | "in" | "login">("checking");
  const [open, setOpen] = useState(false);

  const check = () =>
    api<{ open: boolean }>("/session")
      .then((r) => {
        setOpen(r.open);
        setState("in");
      })
      .catch(() => setState("login"));

  useEffect(() => {
    check();
    const out = () => {
      setState("login");
      queryClient.clear();
    };
    window.addEventListener("meridian:logout", out);
    return () => window.removeEventListener("meridian:logout", out);
  }, []);

  if (state === "checking") return null;
  if (state === "login") return <Login onSignedIn={check} />;

  let page;
  if (path.startsWith("/visits")) page = <VisitsPage />;
  else if (path.startsWith("/listings")) page = <ListingsPage />;
  else if (path.startsWith("/questions")) page = <QuestionsPage />;
  else if (path.startsWith("/activity")) page = <ActivityPage />;
  else page = <OverviewPage />;

  return <Shell canSignOut={!open}>{page}</Shell>;
}

function App() {
  const path = usePath();
  // The buyer-facing Paystack return page is public and lives outside the console.
  if (path.startsWith("/pay/")) return <PayReturn />;
  return <Console />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-center"
        toastOptions={{
          unstyled: true,
          className: "flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 font-sans text-[13.5px] text-white",
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
