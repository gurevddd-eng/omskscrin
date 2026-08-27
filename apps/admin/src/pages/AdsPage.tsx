import { FormEvent, useEffect, useState } from "react";
import type { AdsDto } from "@stella/shared";
import { useAuth } from "../auth";
import { api, uploadFile } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";

type MediaRef = { id: string; url: string; filename?: string };

export function AdsPage() {
  const { canEdit } = useAuth();
  const [adIds, setAdIds] = useState<string[]>([]);
  const [previews, setPreviews] = useState<MediaRef[]>([]);
  const [adsVersion, setAdsVersion] = useState("—");
  const [error, setError] = useState("");
  const [savedHint, setSavedHint] = useState("");
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

  async function onUpload(files: FileList | null) {
    if (!files?.length || !canEdit) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadFile(file);
        setAdIds((ids) => [...ids, uploaded.id]);
        setPreviews((list) => [
          ...list,
          { id: uploaded.id, url: uploaded.url, filename: uploaded.filename },
        ]);
      }
      setDirty(true);
      setSavedHint("");
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
    setSavedHint("");
  }

  function moveItem(id: string, dir: -1 | 1) {
    setAdIds((ids) => {
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return ids;
      const next = [...ids];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
    setPreviews((list) => {
      const i = list.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
    setDirty(true);
    setSavedHint("");
  }

  async function onSave(e?: FormEvent) {
    e?.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError("");
    setSavedHint("");
    try {
      const saved = await api<AdsDto>("/api/ads", { method: "PUT", json: { adIds } });
      setAdIds(saved.adIds);
      setPreviews(saved.ads);
      setAdsVersion(saved.adsVersion);
      setDirty(false);
      setSavedHint("Реклама сохранена — киоски подхватят при синхронизации");
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
      banner={
        <>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {savedHint ? <Alert tone="success">{savedHint}</Alert> : null}
        </>
      }
      actions={
        canEdit ? (
          <>
            <label className="file-btn">
              {uploading ? "Загрузка…" : "Добавить баннеры"}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={busy || uploading}
                onChange={(ev) => {
                  void onUpload(ev.target.files);
                  ev.target.value = "";
                }}
              />
            </label>
            <button type="button" className="btn" disabled={busy || !dirty} onClick={() => void onSave()}>
              {busy ? "Сохранение…" : dirty ? "Сохранить" : "Сохранено"}
            </button>
          </>
        ) : null
      }
    >
      <div className="admin-toolbar">
        <ul className="admin-toolbar__stats">
          <li>
            <strong>{String(previews.length).padStart(2, "0")}</strong>
            <span>баннеров</span>
          </li>
          <li>
            <strong className="admin-toolbar__ver">{adsVersion}</strong>
            <span>версия</span>
          </li>
          <li>
            <strong className={dirty ? "is-warn" : "is-ok"}>{dirty ? "черновик" : "чисто"}</strong>
            <span>статус</span>
          </li>
        </ul>
        <p className="admin-toolbar__hint">Рекомендуемый формат — вертикальный jpg/png/webp.</p>
      </div>

      {!previews.length ? (
        <div className="admin-empty">
          <p className="admin-empty__title">Баннеров пока нет</p>
          <p className="admin-empty__text">
            Загрузите один или несколько файлов — на киосках они будут крутиться в правой колонке.
          </p>
          {canEdit ? (
            <label className="file-btn">
              {uploading ? "Загрузка…" : "Загрузить первый баннер"}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(ev) => {
                  void onUpload(ev.target.files);
                  ev.target.value = "";
                }}
              />
            </label>
          ) : null}
        </div>
      ) : (
        <div className="ads-board">
          {previews.map((g, i) => (
            <article key={g.id} className="ads-card">
              <div className="ads-card__media">
                <img src={g.url} alt="" />
                <span className="ads-card__idx">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="ads-card__body">
                <p className="ads-card__name" title={g.filename || g.id}>
                  {g.filename || g.id.slice(0, 10)}
                </p>
                <p className="ads-card__meta">Слот {i + 1} в ротации</p>
                {canEdit ? (
                  <div className="ads-card__actions">
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={i === 0}
                      onClick={() => moveItem(g.id, -1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={i === previews.length - 1}
                      onClick={() => moveItem(g.id, 1)}
                    >
                      →
                    </button>
                    <button type="button" className="btn danger" onClick={() => removeItem(g.id)}>
                      Убрать
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </PageShell>
  );
}
