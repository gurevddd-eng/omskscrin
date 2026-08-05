import { FormEvent, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { formatSpecsText, parseSpecsText, type SpecRow } from "@stella/shared";
import { useAuth } from "../auth";
import { api, uploadFile } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";
import { useConfirm } from "../components/ui/confirm";

type MediaRef = { id: string; url: string; filename?: string };

type Exhibit = {
  id: string;
  title: string;
  summary: string;
  body: string;
  specs: SpecRow[];
  heroImageId: string | null;
  galleryIds: string[];
  videoId: string | null;
  audioId: string | null;
  contentVersion: string;
  heroImage?: MediaRef | null;
  video?: MediaRef | null;
  audio?: MediaRef | null;
  gallery?: MediaRef[];
};

type FormState = {
  title: string;
  summary: string;
  body: string;
  specsText: string;
  heroImageId: string | null;
  galleryIds: string[];
  videoId: string | null;
  audioId: string | null;
  heroPreview: string | null;
  videoPreview: string | null;
  audioPreview: string | null;
  audioName: string | null;
  galleryPreviews: MediaRef[];
};

const emptyForm = (): FormState => ({
  title: "",
  summary: "",
  body: "",
  specsText: "",
  heroImageId: null,
  galleryIds: [],
  videoId: null,
  audioId: null,
  heroPreview: null,
  videoPreview: null,
  audioPreview: null,
  audioName: null,
  galleryPreviews: [],
});

export function ExhibitsPage() {
  const { canEdit } = useAuth();
  const confirmDialog = useConfirm();
  const [list, setList] = useState<Exhibit[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"hero" | "video" | "gallery" | "audio" | null>(
    null
  );
  const [dirty, setDirty] = useState(false);

  async function load() {
    setList(await api<Exhibit[]>("/api/exhibits"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q)
    );
  }, [list, query]);

  function patchForm(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  }

  function openCreate() {
    setEditId(null);
    setForm(emptyForm());
    setMode("edit");
    setDirty(false);
    setError("");
  }

  function openEdit(e: Exhibit) {
    setEditId(e.id);
    setForm({
      title: e.title,
      summary: e.summary,
      body: e.body,
      specsText: formatSpecsText(e.specs ?? []),
      heroImageId: e.heroImageId,
      galleryIds: e.galleryIds,
      videoId: e.videoId,
      audioId: e.audioId,
      heroPreview: e.heroImage?.url ?? null,
      videoPreview: e.video?.url ?? null,
      audioPreview: e.audio?.url ?? null,
      audioName: e.audio?.filename ?? null,
      galleryPreviews: e.gallery ?? [],
    });
    setMode("edit");
    setDirty(false);
    setError("");
  }

  async function backToList() {
    if (dirty && canEdit) {
      const ok = await confirmDialog({
        title: "Выйти без сохранения?",
        message: "Есть несохранённые изменения в экспонате.",
        details: "Если продолжить, правки будут потеряны.",
        confirmLabel: "Выйти",
        tone: "warn",
      });
      if (!ok) return;
    }
    setMode("list");
    setEditId(null);
    setForm(emptyForm());
    setDirty(false);
    setError("");
  }

  async function onUpload(
    file: File | undefined,
    kind: "hero" | "video" | "gallery" | "audio"
  ) {
    if (!file) return;
    setUploading(kind);
    setError("");
    try {
      const uploaded = await uploadFile(file);
      if (kind === "hero") {
        patchForm({ heroImageId: uploaded.id, heroPreview: uploaded.url });
      }
      if (kind === "video") {
        patchForm({ videoId: uploaded.id, videoPreview: uploaded.url });
      }
      if (kind === "audio") {
        patchForm({
          audioId: uploaded.id,
          audioPreview: uploaded.url,
          audioName: uploaded.filename,
        });
      }
      if (kind === "gallery") {
        setForm((f) => ({
          ...f,
          galleryIds: [...f.galleryIds, uploaded.id],
          galleryPreviews: [
            ...f.galleryPreviews,
            { id: uploaded.id, url: uploaded.url, filename: uploaded.filename },
          ],
        }));
        setDirty(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setUploading(null);
    }
  }

  function removeGalleryItem(id: string) {
    setForm((f) => ({
      ...f,
      galleryIds: f.galleryIds.filter((x) => x !== id),
      galleryPreviews: f.galleryPreviews.filter((x) => x.id !== id),
    }));
    setDirty(true);
  }

  const specsPreview = useMemo(() => parseSpecsText(form.specsText), [form.specsText]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setError("");
    setBusy(true);
    try {
      const payload = {
        title: form.title,
        summary: form.summary,
        body: form.body,
        specs: parseSpecsText(form.specsText),
        heroImageId: form.heroImageId,
        galleryIds: form.galleryIds,
        videoId: form.videoId,
        audioId: form.audioId,
      };
      const saved = editId
        ? await api<Exhibit>(`/api/exhibits/${editId}`, { method: "PATCH", json: payload })
        : await api<Exhibit>("/api/exhibits", { method: "POST", json: payload });

      setEditId(saved.id);
      setForm({
        title: saved.title,
        summary: saved.summary,
        body: saved.body,
        specsText: formatSpecsText(saved.specs ?? []),
        heroImageId: saved.heroImageId,
        galleryIds: saved.galleryIds,
        videoId: saved.videoId,
        audioId: saved.audioId,
        heroPreview: saved.heroImage?.url ?? null,
        videoPreview: saved.video?.url ?? null,
        audioPreview: saved.audio?.url ?? null,
        audioName: saved.audio?.filename ?? null,
        galleryPreviews: saved.gallery ?? [],
      });
      setDirty(false);
      setMode("edit");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter") return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    // Enter в input (ТТХ, название…) не должен случайно сохранять форму
    e.preventDefault();
  }

  async function remove(id: string) {
    const item = list.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: "Удалить экспонат?",
      message: item ? `«${item.title || "Без названия"}» будет удалён из админки.` : undefined,
      details: "Киоски не должны быть привязаны к этому экспонату.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/exhibits/${id}`, { method: "DELETE" });
      if (editId === id) {
        setMode("list");
        setEditId(null);
        setForm(emptyForm());
        setDirty(false);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  if (mode === "edit") {
    return (
      <PageShell
        section="Контент"
        title={form.title.trim() || (editId ? "Экспонат" : "Новый экспонат")}
        description={`${canEdit ? (editId ? "Редактирование" : "Создание") : "Просмотр"}${dirty && canEdit ? " · не сохранено" : ""}`}
        wide
        flush
        actions={
          <>
            <button type="button" className="btn secondary" onClick={backToList} disabled={busy}>
              ← К списку
            </button>
            {canEdit ? (
              <>
                <button type="button" className="btn secondary" onClick={backToList} disabled={busy}>
                  Отмена
                </button>
                <button
                  type="submit"
                  form="exhibit-edit-form"
                  className="btn"
                  disabled={busy || !!uploading || !form.title.trim() || !dirty}
                >
                  {busy ? "Сохранение…" : dirty ? "Сохранить" : "Сохранено"}
                </button>
              </>
            ) : null}
          </>
        }
        banner={error ? <Alert tone="error">{error}</Alert> : undefined}
      >
        <form
          id="exhibit-edit-form"
          className="exhibit-editor__grid"
          onSubmit={onSubmit}
          onKeyDown={onFormKeyDown}
        >
          <Card title="Тексты">
            <fieldset disabled={!canEdit || busy} className="exhibit-editor__fields">
              <label>
                Название
                <input
                  required
                  value={form.title}
                  onChange={(e) => patchForm({ title: e.target.value })}
                  placeholder="Например: Т-34-85"
                />
              </label>
              <label>
                Краткое описание
                <span className="field-hint">Главный экран киоска</span>
                <textarea
                  value={form.summary}
                  onChange={(e) => patchForm({ summary: e.target.value })}
                  rows={4}
                  placeholder="1–2 предложения для посетителя"
                />
              </label>
              <label className="exhibit-editor__body-label">
                Полный текст
                <span className="field-hint">Раздел «Описание» на киоске</span>
                <textarea
                  className="exhibit-editor__body"
                  value={form.body}
                  onChange={(e) => patchForm({ body: e.target.value })}
                  rows={12}
                  placeholder="История, особенности…"
                />
              </label>

              <div className="specs-editor">
                <label>
                  Характеристики
                  <span className="field-hint">
                    Одна строка — один параметр. Разделитель: «—», «:» или Tab. На киоске —
                    отдельный раздел «Характеристики».
                  </span>
                  <textarea
                    className="specs-editor__text"
                    value={form.specsText}
                    onChange={(e) => patchForm({ specsText: e.target.value })}
                    rows={10}
                    placeholder={
                      "Масса — 32 т\nЭкипаж: 5 чел.\nКалибр — 85 мм\nМакс. скорость — 55 км/ч"
                    }
                    readOnly={!canEdit}
                  />
                </label>
                {specsPreview.length > 0 && (
                  <div className="specs-editor__preview">
                    <div className="media-block__title">
                      Превью таблицы · {specsPreview.length}
                    </div>
                    <table>
                      <tbody>
                        {specsPreview.map((row, i) => (
                          <tr key={`${row.label}-${i}`}>
                            <th scope="row">{row.label}</th>
                            <td>{row.value || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </fieldset>
          </Card>

          <Card title="Медиа">
            <fieldset disabled={!canEdit || busy} className="exhibit-editor__fields">
              <div className="media-block media-block--spaced">
                <div className="media-block__title">Главное фото</div>
                <div className="media-hero media-hero--lg">
                  {form.heroPreview ? (
                    <img src={form.heroPreview} alt="" />
                  ) : (
                    <div className="media-hero__empty">Загрузите обложку экспоната</div>
                  )}
                </div>
                {canEdit && (
                  <label className="file-btn">
                    {uploading === "hero" ? "Загрузка…" : "Выбрать фото"}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      disabled={!!uploading}
                      onChange={(e) => {
                        void onUpload(e.target.files?.[0], "hero");
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="media-block media-block--spaced">
                <div className="media-block__title">
                  Галерея <span className="muted">{form.galleryPreviews.length}</span>
                </div>
                <div className="media-gallery media-gallery--editor">
                  {form.galleryPreviews.map((g) => (
                    <div key={g.id} className="media-gallery__item">
                      <img src={g.url} alt="" />
                      {canEdit && (
                        <button
                          type="button"
                          className="media-gallery__remove"
                          onClick={() => removeGalleryItem(g.id)}
                        >
                          Убрать
                        </button>
                      )}
                    </div>
                  ))}
                  {!form.galleryPreviews.length && (
                    <div className="media-gallery__empty">Добавьте фотографии для листания на киоске</div>
                  )}
                </div>
                {canEdit && (
                  <label className="file-btn">
                    {uploading === "gallery" ? "Загрузка…" : "Добавить фото"}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      disabled={!!uploading}
                      onChange={(e) => {
                        void onUpload(e.target.files?.[0], "gallery");
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="media-block media-block--spaced">
                <div className="media-block__title">Видео</div>
                {form.videoPreview ? (
                  <video className="media-video media-video--lg" src={form.videoPreview} controls playsInline />
                ) : (
                  <div className="media-video media-video--empty media-video--lg">Видео не загружено</div>
                )}
                {canEdit && (
                  <label className="file-btn">
                    {uploading === "video" ? "Загрузка…" : "Выбрать видео"}
                    <input
                      type="file"
                      accept="video/*"
                      hidden
                      disabled={!!uploading}
                      onChange={(e) => {
                        void onUpload(e.target.files?.[0], "video");
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="media-block media-block--spaced">
                <div className="media-block__title">Аудиорассказ</div>
                <span className="field-hint">Прослушивание на экране «Описание» (mp3 / wav / m4a)</span>
                {form.audioPreview ? (
                  <div className="media-audio">
                    <audio src={form.audioPreview} controls />
                    <div className="muted">{form.audioName || "Аудиофайл"}</div>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          patchForm({ audioId: null, audioPreview: null, audioName: null })
                        }
                      >
                        Убрать аудио
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="media-video media-video--empty">Аудио не загружено</div>
                )}
                {canEdit && (
                  <label className="file-btn">
                    {uploading === "audio" ? "Загрузка…" : "Выбрать аудио"}
                    <input
                      type="file"
                      accept="audio/*"
                      hidden
                      disabled={!!uploading}
                      onChange={(e) => {
                        void onUpload(e.target.files?.[0], "audio");
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </fieldset>
          </Card>
        </form>
      </PageShell>
    );
  }

  return (
    <PageShell
      section="Контент"
      title="Экспонаты"
      description={`${list.length} шт. · выберите строку для редактирования`}
      actions={
        <>
          <label className="exhibits-search">
            <span className="sr-only">Поиск</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск…"
            />
          </label>
          {canEdit && (
            <button type="button" className="btn" onClick={openCreate}>
              Новый экспонат
            </button>
          )}
        </>
      }
      banner={error ? <Alert tone="error">{error}</Alert> : undefined}
    >
      <Card padding="none">
        <div className="exhibits-table-wrap cx-table-wrap">
          <table className="exhibits-table">
          <thead>
            <tr>
              <th className="exhibits-table__photo">Фото</th>
              <th>Название</th>
              <th>Медиа</th>
              <th>Версия</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="exhibits-table__row" onDoubleClick={() => openEdit(e)}>
                <td>
                  {e.heroImage ? (
                    <img className="exhibits-table__thumb" src={e.heroImage.url} alt="" />
                  ) : (
                    <div className="exhibits-table__thumb exhibits-table__thumb--empty" />
                  )}
                </td>
                <td>
                  <button type="button" className="exhibits-table__link" onClick={() => openEdit(e)}>
                    {e.title || "Без названия"}
                  </button>
                  <div className="muted exhibits-table__summary">
                    {e.summary || "Нет краткого описания"}
                  </div>
                </td>
                <td className="muted">
                  {e.galleryIds.length} фото
                  {e.videoId ? " · видео" : ""}
                  {e.audioId ? " · аудио" : ""}
                  {e.specs?.length ? ` · ${e.specs.length} ТТХ` : ""}
                </td>
                <td>v{e.contentVersion}</td>
                <td className="exhibits-table__actions">
                  <button type="button" className="btn secondary" onClick={() => openEdit(e)}>
                    {canEdit ? "Открыть" : "Смотреть"}
                  </button>
                  {canEdit && (
                    <button type="button" className="btn danger" onClick={() => remove(e.id)}>
                      Удалить
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={5} className="exhibits-table__empty">
                  {query ? "Ничего не найдено" : "Пока нет экспонатов — создайте первый"}
                  {canEdit && !query && (
                    <>
                      {" · "}
                      <button type="button" className="btn" onClick={openCreate}>
                        Создать
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>
    </PageShell>
  );
}
