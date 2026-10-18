import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

const render = () =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );

// Browser preview of the UI during development (no Tauri): sample data only.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) void import("./dev/mockTauri").then(render);
else render();
