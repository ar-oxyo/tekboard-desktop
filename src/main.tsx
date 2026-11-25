import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 15_000 } },
});

// The floating capture window loads the editor only, not the whole app.
const capture = new URLSearchParams(window.location.search).get("window") === "capture";
const Root = capture ? lazy(() => import("./features/brain/CaptureApp").then((m) => ({ default: m.CaptureApp }))) : lazy(() => import("./app/App").then((m) => ({ default: m.App })));

// Development in a plain browser (no Tauri): demonstration data instead of the backend.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installMock } = await import("./dev/mockIpc");
  installMock();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>,
);
