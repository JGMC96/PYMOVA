import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { bootstrapSessionPersistence } from "./lib/sessionPersistence";
import { isFramedOnProduction } from "./lib/framing";

const root = document.getElementById("root")!;

if (isFramedOnProduction()) {
  // Dentro de otra web: no se pinta la app, solo un enlace para abrirla aparte.
  const link = document.createElement("a");
  link.href = window.location.href;
  link.target = "_top";
  link.rel = "noopener";
  link.textContent = "Abrir PYMOVA";
  link.style.cssText = "display:block;margin:2rem;font:16px system-ui,sans-serif";
  root.replaceChildren(link);
} else {
  bootstrapSessionPersistence();
  createRoot(root).render(<App />);
}
