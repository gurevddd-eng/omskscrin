import { FormEvent, useEffect, useState } from "react";
import type { AdsDto } from "@stella/shared";
import { useAuth } from "../auth";
import { api, uploadFile } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";

type MediaRef = { id: string; url: string; filename?: string };

export function AdsPage() {
  const { canEdit } = useAuth();
  const [adIds, setAdIds] = useState<string[]>([]);
  const [previews, setPreviews] = useState<MediaRef[]>([]);
  const [adsVersion, setAdsVersion] = useState("—");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    const data = await api<AdsDto>("/api/ads");
    setAdIds(data.adIds);
    setPreviews(data.ads);
    setAdsVersion(data.adsVersion);
    setDirty(false);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onUpload(file: File | undefined) {
    if (!file || !canEdit) return;
    setUploading(true);
    setError("");
    try {
      const uploaded = await uploadFile(file);
      setAdIds((ids) => [...ids, uploaded.id]);
      setPreviews((list) => [
        ...list,
        { id: uploaded.id, url: uploaded.url, filename: uploaded.filename },
      ]);
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  function removeItem(id: string) {
    setAdIds((ids) => ids.filter((x) => x !== id));
    setPreviews((list) => list.filter((x) => x.id !== id));
    setDirty(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api<AdsDto>("/api/ads", { method: "PUT", json: { adIds } });
      setAdIds(saved.adIds);
      setPreviews(saved.ads);
      setAdsVersion(saved.adsVersion);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      section="Контент"
      title="Реклама"
      description="Вертикальные баннеры в правой колонке на всех киосках. Несколько файлов сменяются по кругу."
      banner={error ? <Alert tone="error">{error}</Alert> : null}
    >
      <form onSubmit={onSave}>
        <Card
          title={`Баннеры · ${previews.length}`}
          subtitle={`Версия контента: ${adsVersion}`}
          actions={
            canEdit ? (
              <>
                <label className="file-btn">
                  {uploading ? "Загрузка…" : "Добавить файл"}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={busy || uploading}
                    onChange={(ev) => {
                      void onUpload(ev.target.files?.[0]);
                      ev.target.value = "";
                    }}
                  />
                </label>
                <button className="btn" disabled={busy || !dirty}>
                  {busy ? "Сохранение…" : "Сохранить"}
                </button>
              </>
            ) : null
          }
        >
          <div className="media-gallery media-gallery--editor ads-gallery">
            {previews.map((g, i) => (
              <div key={g.id} className="media-gallery__item">
                <img src={g.url} alt="" />
                <span className="ads-gallery__idx">{String(i + 1).padStart(2, "0")}</span>
                {canEdit ? (
                  <button type="button" className="media-gallery__remove" onClick={() => removeItem(g.id)}>
                    Убрать
                  </button>
                ) : null}
              </div>
            ))}
            {!previews.length ? (
              <div className="media-gallery__empty cx-empty">
                <p className="cx-empty__title">Баннеров пока нет</p>
                <p className="muted">Загрузите jpg, png или webp</p>
              </div>
            ) : null}
          </div>
        </Card>
      </form>
    </PageShell>
  );
}
