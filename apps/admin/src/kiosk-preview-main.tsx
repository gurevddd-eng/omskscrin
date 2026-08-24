import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { KioskManifest } from "@stella/shared";
import { App as KioskApp } from "../../kiosk/src/App";
import "../../kiosk/src/styles.css";

const TOKEN_KEY = "stella_admin_token";

function showError(text: string) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;font-family:Manrope,sans-serif;padding:2rem;text-align:center">${text}</div>`;
}

async function main() {
  const id = new URLSearchParams(location.search).get("id");
  const token = localStorage.getItem(TOKEN_KEY);
  if (!id) {
    showError("Не указан экспонат.");
    return;
  }
  if (!token) {
    showError("Нужно войти в админку, чтобы смотреть превью.");
    return;
  }
  const res = await fetch(`/api/exhibits/${encodeURIComponent(id)}/preview-manifest`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    showError("Не удалось загрузить превью сохранённого экспоната.");
    return;
  }
  const manifest = (await res.json()) as KioskManifest;
  const el = document.getElementById("root");
  if (!el) return;
  createRoot(el).render(
    <StrictMode>
      <KioskApp preview={{ manifest, serverUrl: "" }} />
    </StrictMode>
  );
}

void main();
