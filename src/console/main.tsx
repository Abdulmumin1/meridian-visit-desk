import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { Shell } from "./components/Shell";
import { auth } from "./lib/api";
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
  const [signedIn, setSignedIn] = useState(() => Boolean(auth.get()));

  useEffect(() => {
    const out = () => {
      setSignedIn(false);
      queryClient.clear();
    };
    window.addEventListener("meridian:logout", out);
    return () => window.removeEventListener("meridian:logout", out);
  }, []);

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  let page;
  if (path.startsWith("/visits")) page = <VisitsPage />;
  else if (path.startsWith("/listings")) page = <ListingsPage />;
  else if (path.startsWith("/questions")) page = <QuestionsPage />;
  else if (path.startsWith("/activity")) page = <ActivityPage />;
  else page = <OverviewPage />;

  return <Shell>{page}</Shell>;
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
