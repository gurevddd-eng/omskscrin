import { FormEvent, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { formatSpecsText, parseSpecsText, type GameShareDto, type SpecRow } from "@stella/shared";
import { useAuth } from "../auth";
import { api, uploadFile } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";
import { useConfirm } from "../components/ui/confirm";
import { RichTextEditor } from "../components/RichTextEditor";

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
  gameTitle?: string;
  gameShareFolder?: string;
  gameExe?: string;
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
  gameTitle: string;
  gameShareFolder: string;
  gameExe: string;
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
  gameTitle: "Играть",
  gameShareFolder: "",
  gameExe: "",
});

export function ExhibitsPage() {
  const { canEdit } = useAuth();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
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
  const [savedNote, setSavedNote] = useState("");
  const [gameShare, setGameShare] = useState<GameShareDto | null>(null);

  async function load() {
    setList(await api<Exhibit[]>("/api/exhibits"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<GameShareDto>("/api/game-share")
      .then(setGameShare)
      .catch(() => setGameShare(null));
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

  const listStats = useMemo(() => {
    const source = filtered;
    return {
      total: source.length,
      withHero: source.filter((e) => Boolean(e.heroImageId)).length,
      withGallery: source.filter((e) => e.galleryIds.length > 0).length,
      withVideo: source.filter((e) => Boolean(e.videoId)).length,
      withAudio: source.filter((e) => Boolean(e.audioId)).length,
      withGame: source.filter((e) => Boolean(e.gameShareFolder && e.gameExe)).length,
    };
  }, [filtered]);

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
    setSavedNote("");
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
      gameTitle: e.gameTitle || "Играть",
      gameShareFolder: e.gameShareFolder || "",
      gameExe: e.gameExe || "",
    });
    setMode("edit");
    setDirty(false);
    setError("");
    setSavedNote("");
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
  const selectedGameFolder = useMemo(
    () => gameShare?.folders?.find((f) => f.name === form.gameShareFolder) ?? null,
    [gameShare, form.gameShareFolder]
  );

  async function saveExhibit() {
    if (!canEdit) {
      setSavedNote("");
      setError("Недостаточно прав для сохранения.");
      return;
    }
    if (busy || uploading) return;
    const title = form.title.trim();
    if (!title) {
      setSavedNote("");
      setError("Укажите название экспоната.");
      return;
    }
    setError("");
    setSavedNote("");
    setBusy(true);
    try {
      const payload = {
        title,
        summary: form.summary,
        body: form.body,
        specs: parseSpecsText(form.specsText),
        heroImageId: form.heroImageId,
        galleryIds: form.galleryIds,
        videoId: form.videoId,
        audioId: form.audioId,
        gameTitle: form.gameTitle,
        gameShareFolder: form.gameShareFolder || null,
        gameExe: form.gameExe || null,
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
        gameTitle: saved.gameTitle || "Играть",
        gameShareFolder: saved.gameShareFolder || "",
        gameExe: saved.gameExe || "",
      });
      setDirty(false);
      setMode("edit");
      setSavedNote("Сохранено.");
      await load();
    } catch (err) {
      setSavedNote("");
      setError(err instanceof Error ? err.message : "Не удалось сохранить экспонат");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await saveExhibit();
  }

  function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter") return;
    const el = e.target as HTMLElement;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    // TipTap / contenteditable — Enter создаёт абзац, не submit
    if (el.isContentEditable || el.closest?.(".ProseMirror, .rte, [contenteditable='true']")) {
      return;
    }
    // Enter в обычном input — сохранить
    e.preventDefault();
    if (!canEdit || busy || uploading || !form.title.trim()) return;
    void saveExhibit();
  }

  async function openPreview(id: string | null) {
    if (!id) return;
    if (dirty) {
      const ok = await confirmDialog({
        title: "Превью сохранённой версии?",
        message: "На киоске будет показан последний сохранённый экспонат. Несохранённые правки в превью не попадут.",
        confirmLabel: "Открыть превью",
        tone: "warn",
      });
      if (!ok) return;
    }
    navigate(`/exhibits/${id}/preview`);
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
            {editId ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => void openPreview(editId)}
                disabled={busy}
              >
                Как на киоске
              </button>
            ) : null}
            {canEdit ? (
              <>
                <button type="button" className="btn secondary" onClick={backToList} disabled={busy}>
                  Отмена
                </button>
                <button
                  type="submit"
                  form="exhibit-edit-form"
                  className="btn"
                  disabled={busy || !!uploading || !form.title.trim()}
                >
                  {busy ? "Сохранение…" : "Сохранить"}
                </button>
              </>
            ) : null}
          </>
        }
        banner={
          error ? (
            <Alert tone="error">{error}</Alert>
          ) : savedNote ? (
            <Alert tone="success">{savedNote}</Alert>
          ) : undefined
        }
      >
        <form
          id="exhibit-edit-form"
          className="exhibit-editor__grid"
          onSubmit={onSubmit}
          onKeyDown={onFormKeyDown}
          noValidate
        >
          <div className="exhibit-editor__main">
            <Card
              title="Тексты и структура"
              subtitle="Главный экран, описание и характеристики киоска"
            >
              <fieldset disabled={!canEdit} className="exhibit-editor__fields">
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
                <div className="exhibit-editor__body-label">
                  <span className="exhibit-editor__field-title">Полный текст</span>
                  <span className="field-hint">
                    Раздел «Описание» на киоске — форматирование сохраняется
                  </span>
                  <RichTextEditor
                    key={editId ?? "new"}
                    docKey={editId ?? "new"}
                    value={form.body}
                    onChange={(body) => patchForm({ body })}
                    disabled={!canEdit || busy}
                    placeholder="История, особенности…"
                  />
                </div>

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
                      <div className="media-block__title">Превью таблицы · {specsPreview.length}</div>
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
          </div>

          <div className="exhibit-editor__side">
            <Card title="Сводка" subtitle="Что увидит посетитель на киоске">
              <div className="exhibit-summary">
                <div className="exhibit-summary__hero">
                  {form.heroPreview ? (
                    <img src={form.heroPreview} alt="" />
                  ) : (
                    <div className="media-hero__empty">Нет обложки</div>
                  )}
                </div>
                <div className="exhibit-summary__title">{form.title.trim() || "Новый экспонат"}</div>
                <div className="exhibit-summary__text">
                  {form.summary.trim() || "Краткое описание пока не заполнено."}
                </div>
                <div className="exhibit-summary__chips">
                  <span className={`badge ${form.heroImageId ? "ok" : "offline"}`}>
                    {form.heroImageId ? "Есть обложка" : "Без обложки"}
                  </span>
                  <span className={`badge ${form.galleryIds.length ? "ok" : "offline"}`}>
                    Галерея · {form.galleryIds.length}
                  </span>
                  <span className={`badge ${form.videoId ? "ok" : "offline"}`}>
                    {form.videoId ? "Видео" : "Без видео"}
                  </span>
                  <span className={`badge ${form.audioId ? "ok" : "offline"}`}>
                    {form.audioId ? "Аудио" : "Без аудио"}
                  </span>
                  <span className={`badge ${specsPreview.length ? "ok" : "offline"}`}>
                    ТТХ · {specsPreview.length}
                  </span>
                  <span className={`badge ${form.gameShareFolder && form.gameExe ? "ok" : "offline"}`}>
                    {form.gameShareFolder && form.gameExe ? "Игра настроена" : "Без игры"}
                  </span>
                </div>
              </div>
            </Card>

            <Card title="Медиа" subtitle="Изображения, видео и аудио для киоска">
              <fieldset disabled={!canEdit} className="exhibit-editor__fields">
                <div className="media-block">
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
                          onClick={() => patchForm({ audioId: null, audioPreview: null, audioName: null })}
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

            <Card title="Игра на киоске" subtitle="Локальный запуск через агент и UNC-шару">
              <fieldset disabled={!canEdit} className="exhibit-editor__fields exhibit-editor__game">
                <p className="field-hint">
                  Файл игры не загружается на сервер. Киоск копирует выбранную папку с шары
                  {gameShare?.unc ? ` (${gameShare.unc})` : ""} в C:\ProgramData\omskekran\games.
                </p>
                <label>
                  Подпись кнопки
                  <input
                    value={form.gameTitle}
                    onChange={(e) => patchForm({ gameTitle: e.target.value })}
                    placeholder="Играть"
                  />
                </label>
                <label>
                  Папка на шаре
                  {gameShare?.folders?.length ? (
                    <select
                      value={form.gameShareFolder}
                      onChange={(e) => patchForm({ gameShareFolder: e.target.value, gameExe: "" })}
                    >
                      <option value="">Нет игры</option>
                      {gameShare.folders.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={form.gameShareFolder}
                      onChange={(e) => patchForm({ gameShareFolder: e.target.value })}
                      placeholder="Имя папки на шаре"
                    />
                  )}
                </label>
                <label>
                  Файл .exe
                  {selectedGameFolder?.exes?.length ? (
                    <select
                      value={form.gameExe}
                      onChange={(e) => patchForm({ gameExe: e.target.value })}
                      disabled={!form.gameShareFolder}
                    >
                      <option value="">Выберите .exe</option>
                      {selectedGameFolder.exes.map((exe) => (
                        <option key={exe} value={exe}>
                          {exe}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={form.gameExe}
                      onChange={(e) => patchForm({ gameExe: e.target.value })}
                      placeholder="Game.exe"
                      disabled={!form.gameShareFolder}
                    />
                  )}
                </label>
                {selectedGameFolder?.exes?.length ? (
                  <div className="exhibit-game__list">
                    <div className="media-block__title">Найденные .exe</div>
                    <div className="exhibit-game__chips">
                      {selectedGameFolder.exes.map((exe) => (
                        <button
                          key={exe}
                          type="button"
                          className={`btn ghost${form.gameExe === exe ? " is-active" : ""}`}
                          onClick={() => patchForm({ gameExe: exe })}
                        >
                          {exe}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <span className="field-hint">
                  {gameShare?.scannedAt
                    ? `Список папок с киоска ${gameShare.sourceHostname || "—"} · ${new Date(gameShare.scannedAt).toLocaleString("ru-RU")}`
                    : "Список папок появится, когда киоск в домене увидит шару."}
                </span>
              </fieldset>
            </Card>
          </div>
          {canEdit ? (
            <div className="exhibit-editor__savebar">
              <button
                type="submit"
                className="btn"
                disabled={busy || !!uploading || !form.title.trim()}
              >
                {busy ? "Сохранение…" : "Сохранить"}
              </button>
              {dirty ? <span className="field-hint">Есть несохранённые изменения</span> : null}
              {error ? <span className="field-hint exhibit-editor__save-error">{error}</span> : null}
              {savedNote ? <span className="field-hint exhibit-editor__save-ok">{savedNote}</span> : null}
            </div>
          ) : null}
        </form>
      </PageShell>
    );
  }

  return (
    <PageShell
      section="Контент"
      title="Экспонаты"
      description={`${list.length} шт. · карточки, превью киоска и быстрый доступ к медиа`}
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
      <section className="exhibits-stats" aria-label="Сводка по экспонатам">
        <Card className="exhibits-stat">
          <div className="exhibits-stat__label">Найдено</div>
          <div className="exhibits-stat__value">{listStats.total}</div>
        </Card>
        <Card className="exhibits-stat">
          <div className="exhibits-stat__label">С обложкой</div>
          <div className="exhibits-stat__value">{listStats.withHero}</div>
        </Card>
        <Card className="exhibits-stat">
          <div className="exhibits-stat__label">С галереей</div>
          <div className="exhibits-stat__value">{listStats.withGallery}</div>
        </Card>
        <Card className="exhibits-stat">
          <div className="exhibits-stat__label">С видео / аудио</div>
          <div className="exhibits-stat__value">
            {listStats.withVideo} / {listStats.withAudio}
          </div>
        </Card>
        <Card className="exhibits-stat">
          <div className="exhibits-stat__label">С игрой</div>
          <div className="exhibits-stat__value">{listStats.withGame}</div>
        </Card>
      </section>

      <section className="exhibits-grid" aria-label="Список экспонатов">
        {filtered.map((e) => (
          <Card
            key={e.id}
            className="exhibit-card"
            actions={
              <div className="exhibit-card__actions">
                <button type="button" className="btn secondary" onClick={() => openEdit(e)}>
                  {canEdit ? "Открыть" : "Смотреть"}
                </button>
                <button type="button" className="btn secondary" onClick={() => void openPreview(e.id)}>
                  Как на киоске
                </button>
                {canEdit ? (
                  <button type="button" className="btn danger" onClick={() => remove(e.id)}>
                    Удалить
                  </button>
                ) : null}
              </div>
            }
          >
            <div className="exhibit-card__body" onDoubleClick={() => openEdit(e)}>
              <div className="exhibit-card__thumb">
                {e.heroImage ? (
                  <img src={e.heroImage.url} alt="" />
                ) : (
                  <div className="exhibits-table__thumb exhibits-table__thumb--empty" />
                )}
              </div>
              <div className="exhibit-card__content">
                <button type="button" className="exhibits-table__link exhibit-card__title" onClick={() => openEdit(e)}>
                  {e.title || "Без названия"}
                </button>
                <div className="muted exhibits-table__summary">
                  {e.summary || "Нет краткого описания"}
                </div>
                <div className="exhibit-card__chips">
                  <span className={`badge ${e.heroImageId ? "ok" : "offline"}`}>
                    {e.heroImageId ? "Обложка" : "Без обложки"}
                  </span>
                  <span className={`badge ${e.galleryIds.length ? "ok" : "offline"}`}>
                    Галерея · {e.galleryIds.length}
                  </span>
                  <span className={`badge ${e.videoId ? "ok" : "offline"}`}>
                    {e.videoId ? "Видео" : "Без видео"}
                  </span>
                  <span className={`badge ${e.audioId ? "ok" : "offline"}`}>
                    {e.audioId ? "Аудио" : "Без аудио"}
                  </span>
                  <span className={`badge ${e.specs?.length ? "ok" : "offline"}`}>
                    ТТХ · {e.specs?.length ?? 0}
                  </span>
                  <span className={`badge ${e.gameShareFolder && e.gameExe ? "warn" : "offline"}`}>
                    {e.gameShareFolder && e.gameExe ? "Игра" : "Без игры"}
                  </span>
                </div>
                <div className="exhibit-card__meta muted">
                  <span>v{e.contentVersion}</span>
                  <span>{e.body ? "Есть описание" : "Без полного текста"}</span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </section>

      {!filtered.length ? (
        <Card>
          <div className="exhibits-empty">
            {query ? "Ничего не найдено" : "Пока нет экспонатов — создайте первый"}
            {canEdit && !query ? (
              <div>
                <button type="button" className="btn" onClick={openCreate}>
                  Создать
                </button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </PageShell>
  );
}
