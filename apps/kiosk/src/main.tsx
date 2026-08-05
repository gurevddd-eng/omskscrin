import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installKioskLockdown } from "./lockdown";
import "./styles.css";

installKioskLockdown();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
