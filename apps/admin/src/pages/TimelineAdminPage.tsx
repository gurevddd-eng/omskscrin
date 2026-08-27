import { FormEvent, useEffect, useMemo, useState } from "react";
import type { TimelineDto, TimelinePageDto } from "@stella/shared";
import { TIMELINE_MAX_IMAGES } from "@stella/shared";
import { useAuth } from "../auth";
import { api, uploadFile } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { useConfirm } from "../components/ui/confirm";

type DraftPage = {
  id: string;
  label: string;
  imageIds: string[];
  images: { id: string; url: string; filename?: string }[];
};

function toDraft(pages: TimelinePageDto[]): DraftPage[] {
  return pages.map((p) => ({
    id: p.id,
    label: p.label,
    imageIds: [...p.imageIds],
    images: p.images.map((f) => ({ id: f.id, url: f.url, filename: f.filename })),
  }));
}

export function TimelineAdminPage() {
  const { canEdit } = useAuth();
  const confirmDialog = useConfirm();
  const [pages, setPages] = useState<DraftPage[]>([]);
  const [timelineVersion, setTimelineVersion] = useState("—");
  const [error, setError] = useState("");
  const [savedHint, setSavedHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadingPageId, setUploadingPageId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const imageTotal = useMemo(
    () => pages.reduce((sum, p) => sum + p.imageIds.length, 0),
    [pages]
  );

  async function load() {
    const data = await api<TimelineDto>("/api/timeline");
    const draft = toDraft(data.pages);
    setPages(draft);
    setTimelineVersion(data.timelineVersion);
    setDirty(false);
    setActiveId((id) => (id && draft.some((p) => p.id === id) ? id : draft[0]?.id ?? null));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function addPage() {
    if (!canEdit) return;
    const id = `timeline-${Date.now().toString(36)}`;
    setPages((list) => [...list, { id, label: "Новый год", imageIds: [], images: [] }]);
    setActiveId(id);
    setDirty(true);
    setSavedHint("");
  }

  function updateLabel(id: string, label: string) {
    setPages((list) => list.map((p) => (p.id === id ? { ...p, label } : p)));
    setDirty(true);
    setSavedHint("");
  }

  async function removePage(id: string) {
    const page = pages.find((p) => p.id === id);
    const ok = await confirmDialog({
      title: "Удалить страницу хроники?",
      message: page
        ? `«${page.label || "Без названия"}» и её изображения исчезнут из меню киосков после сохранения.`
        : undefined,
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    setPages((list) => {
      const next = list.filter((p) => p.id !== id);
      setActiveId((cur) => (cur === id ? next[0]?.id ?? null : cur));
      return next;
    });
    setDirty(true);
    setSavedHint("");
  }

  function movePage(id: string, dir: -1 | 1) {
    setPages((list) => {
      const i = list.findIndex((p) => p.id === id);
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

  async function onUpload(pageId: string, files: FileList | null) {
    if (!files?.length || !canEdit) return;
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    const room = TIMELINE_MAX_IMAGES - page.imageIds.length;
    if (room <= 0) {
      setError(`На странице максимум ${TIMELINE_MAX_IMAGES} изображений`);
      return;
    }
    setUploadingPageId(pageId);
    setError("");
    try {
      const batch = Array.from(files).slice(0, room);
      for (const file of batch) {
        const uploaded = await uploadFile(file);
        setPages((list) =>
          list.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  imageIds: [...p.imageIds, uploaded.id],
                  images: [
                    ...p.images,
                    { id: uploaded.id, url: uploaded.url, filename: uploaded.filename },
                  ],
                }
              : p
          )
        );
      }
      setDirty(true);
      setSavedHint("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setUploadingPageId(null);
    }
  }

  function removeImage(pageId: string, fileId: string) {
    setPages((list) =>
      list.map((p) =>
        p.id === pageId
          ? {
              ...p,
              imageIds: p.imageIds.filter((x) => x !== fileId),
              images: p.images.filter((x) => x.id !== fileId),
            }
          : p
      )
    );
    setDirty(true);
    setSavedHint("");
  }

  function moveImage(pageId: string, fileId: string, dir: -1 | 1) {
    setPages((list) =>
      list.map((p) => {
        if (p.id !== pageId) return p;
        const i = p.imageIds.indexOf(fileId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= p.imageIds.length) return p;
        const imageIds = [...p.imageIds];
        const images = [...p.images];
        const t1 = imageIds[i]!;
        imageIds[i] = imageIds[j]!;
        imageIds[j] = t1;
        const t2 = images[i]!;
        images[i] = images[j]!;
        images[j] = t2;
        return { ...p, imageIds, images };
      })
    );
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
      const saved = await api<TimelineDto>("/api/timeline", {
        method: "PUT",
        json: {
          pages: pages.map((p) => ({
            id: p.id,
            label: p.label.trim() || "Без названия",
            imageIds: p.imageIds.slice(0, TIMELINE_MAX_IMAGES),
          })),
        },
      });
      setPages(toDraft(saved.pages));
      setTimelineVersion(saved.timelineVersion);
      setDirty(false);
      setSavedHint("Хроника сохранена — киоски подхватят при синхронизации");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  const active = pages.find((p) => p.id === activeId) ?? pages[0] ?? null;
  const activeIdx = active ? pages.findIndex((p) => p.id === active.id) : -1;

  return (
    <PageShell
      section="Контент"
      title="Хроника"
      description="Общие страницы эпох для меню слева на всех киосках. Картинки идут сверху вниз без отступов."
      banner={
        <>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {savedHint ? <Alert tone="success">{savedHint}</Alert> : null}
        </>
      }
      actions={
        canEdit ? (
          <>
            <button type="button" className="btn secondary" onClick={addPage}>
              Добавить страницу
            </button>
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
            <strong>{String(pages.length).padStart(2, "0")}</strong>
            <span>страниц</span>
          </li>
          <li>
            <strong>{String(imageTotal).padStart(2, "0")}</strong>
            <span>изображений</span>
          </li>
          <li>
            <strong className="admin-toolbar__ver">{timelineVersion}</strong>
            <span>версия</span>
          </li>
          <li>
            <strong className={dirty ? "is-warn" : "is-ok"}>{dirty ? "черновик" : "чисто"}</strong>
            <span>статус</span>
          </li>
        </ul>
      </div>

      {pages.length === 0 ? (
        <div className="admin-empty">
          <p className="admin-empty__title">Хроника пока пуста</p>
          <p className="admin-empty__text">
            Добавьте страницы эпох (например 1941–1945) и загрузите изображения — они появятся в меню
            киосков.
          </p>
          {canEdit ? (
            <button type="button" className="btn" onClick={addPage}>
              Добавить первую страницу
            </button>
          ) : null}
        </div>
      ) : (
        <div className="timeline-work">
          <aside className="timeline-nav" aria-label="Страницы хроники">
            <p className="timeline-nav__label">Страницы</p>
            <ol className="timeline-nav__list">
              {pages.map((page, i) => {
                const selected = active?.id === page.id;
                return (
                  <li key={page.id}>
                    <button
                      type="button"
                      className={`timeline-nav__item${selected ? " is-active" : ""}`}
                      onClick={() => setActiveId(page.id)}
                    >
                      <span className="timeline-nav__idx">{String(i + 1).padStart(2, "0")}</span>
                      <span className="timeline-nav__copy">
                        <span className="timeline-nav__title">{page.label || "Без названия"}</span>
                        <span className="timeline-nav__meta">
                          {page.imageIds.length} фото
                          {page.imageIds.length >= TIMELINE_MAX_IMAGES ? " · лимит" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          {active ? (
            <section className="timeline-editor" key={active.id}>
              <header className="timeline-editor__head">
                <div className="timeline-editor__intro">
                  <p className="timeline-editor__kicker">
                    Страница {String(activeIdx + 1).padStart(2, "0")} /{" "}
                    {String(pages.length).padStart(2, "0")}
                  </p>
                  <label className="timeline-editor__label-field">
                    <span>Название в меню киоска</span>
                    <input
                      value={active.label}
                      disabled={!canEdit}
                      onChange={(e) => updateLabel(active.id, e.target.value)}
                      maxLength={32}
                      placeholder="1941"
                    />
                  </label>
                </div>
                {canEdit ? (
                  <div className="timeline-editor__actions">
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={activeIdx <= 0}
                      onClick={() => movePage(active.id, -1)}
                      title="Выше в меню"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={activeIdx >= pages.length - 1}
                      onClick={() => movePage(active.id, 1)}
                      title="Ниже в меню"
                    >
                      ↓
                    </button>
                    <button type="button" className="btn danger" onClick={() => void removePage(active.id)}>
                      Удалить
                    </button>
                  </div>
                ) : null}
              </header>

              <div className="timeline-editor__media-head">
                <div>
                  <h2 className="timeline-editor__media-title">Изображения</h2>
                  <p className="muted">
                    Порядок сверху вниз на киоске · {active.imageIds.length}
                    {active.imageIds.length >= TIMELINE_MAX_IMAGES
                      ? ` / лимит ${TIMELINE_MAX_IMAGES}`
                      : ` из ${TIMELINE_MAX_IMAGES}`}
                  </p>
                </div>
                {canEdit && active.imageIds.length < TIMELINE_MAX_IMAGES ? (
                  <label className="file-btn">
                    {uploadingPageId === active.id ? "Загрузка…" : "Добавить фото"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      disabled={uploadingPageId === active.id}
                      onChange={(e) => {
                        void onUpload(active.id, e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
              </div>

              {active.images.length === 0 ? (
                <div className="admin-empty admin-empty--inset">
                  <p className="admin-empty__title">Нет изображений</p>
                  <p className="admin-empty__text">Загрузите jpg, png или webp — кадры пойдут столбиком.</p>
                </div>
              ) : (
                <div className="timeline-editor__grid">
                  {active.images.map((img, imgIdx) => (
                    <figure key={img.id} className="timeline-thumb">
                      <img src={img.url} alt="" />
                      <span className="timeline-thumb__idx">{String(imgIdx + 1).padStart(2, "0")}</span>
                      {canEdit ? (
                        <div className="timeline-thumb__actions">
                          <button
                            type="button"
                            disabled={imgIdx === 0}
                            onClick={() => moveImage(active.id, img.id, -1)}
                            aria-label="Раньше"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            disabled={imgIdx === active.images.length - 1}
                            onClick={() => moveImage(active.id, img.id, 1)}
                            aria-label="Позже"
                          >
                            →
                          </button>
                          <button type="button" onClick={() => removeImage(active.id, img.id)} aria-label="Убрать">
                            ×
                          </button>
                        </div>
                      ) : null}
                    </figure>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      )}
    </PageShell>
  );
}
