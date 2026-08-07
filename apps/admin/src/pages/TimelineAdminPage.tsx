import { FormEvent, useEffect, useState } from "react";
import type { TimelineDto, TimelinePageDto } from "@stella/shared";
import { TIMELINE_MAX_IMAGES } from "@stella/shared";
import { useAuth } from "../auth";
import { api, uploadFile } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";

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
  const [pages, setPages] = useState<DraftPage[]>([]);
  const [timelineVersion, setTimelineVersion] = useState("—");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadingPageId, setUploadingPageId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  async function load() {
    const data = await api<TimelineDto>("/api/timeline");
    setPages(toDraft(data.pages));
    setTimelineVersion(data.timelineVersion);
    setDirty(false);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function addPage() {
    if (!canEdit) return;
    const id = `timeline-${Date.now().toString(36)}`;
    setPages((list) => [...list, { id, label: "Новый год", imageIds: [], images: [] }]);
    setDirty(true);
  }

  function updateLabel(id: string, label: string) {
    setPages((list) => list.map((p) => (p.id === id ? { ...p, label } : p)));
    setDirty(true);
  }

  function removePage(id: string) {
    setPages((list) => list.filter((p) => p.id !== id));
    setDirty(true);
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
  }

  async function onUpload(pageId: string, file: File | undefined) {
    if (!file || !canEdit) return;
    const page = pages.find((p) => p.id === pageId);
    if (!page || page.imageIds.length >= TIMELINE_MAX_IMAGES) {
      setError(`На странице максимум ${TIMELINE_MAX_IMAGES} изображений`);
      return;
    }
    setUploadingPageId(pageId);
    setError("");
    try {
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
      setDirty(true);
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
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError("");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      section="Контент"
      title="Хроника"
      description="Общие страницы годов для всех киосков. В меню слева — под основными разделами. До 8 картинок на страницу, без отступов."
      banner={error ? <Alert tone="error">{error}</Alert> : null}
      actions={
        canEdit ? (
          <>
            <button type="button" className="btn secondary" onClick={addPage}>
              Добавить страницу
            </button>
          </>
        ) : null
      }
    >
      <form onSubmit={onSave} className="timeline-admin">
        <p className="muted" style={{ marginTop: 0 }}>
          Версия контента: <strong>{timelineVersion}</strong>
          {canEdit ? (
            <>
              {" · "}
              <button className="btn" disabled={busy || !dirty} type="submit">
                {busy ? "Сохранение…" : dirty ? "Сохранить" : "Сохранено"}
              </button>
            </>
          ) : null}
        </p>

        {pages.length === 0 ? (
          <Card>
            <p className="muted">Нет страниц. Добавьте годы (например 1941–1945) и загрузите изображения.</p>
          </Card>
        ) : null}

        {pages.map((page, pageIdx) => (
          <Card key={page.id} className="timeline-admin__page" title={page.label || "Страница"}>
            <div className="timeline-admin__head">
              <label className="field">
                <span>Название в меню</span>
                <input
                  value={page.label}
                  disabled={!canEdit}
                  onChange={(e) => updateLabel(page.id, e.target.value)}
                  maxLength={32}
                />
              </label>
              <div className="cx-card__actions">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!canEdit || pageIdx === 0}
                  onClick={() => movePage(page.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!canEdit || pageIdx === pages.length - 1}
                  onClick={() => movePage(page.id, 1)}
                >
                  ↓
                </button>
                {canEdit ? (
                  <button type="button" className="btn danger" onClick={() => removePage(page.id)}>
                    Удалить
                  </button>
                ) : null}
              </div>
            </div>

            <p className="muted">
              Картинки {page.imageIds.length}/{TIMELINE_MAX_IMAGES} — порядок сверху вниз на киоске
            </p>

            <div className="timeline-admin__grid">
              {page.images.map((img, imgIdx) => (
                <div key={img.id} className="timeline-admin__item">
                  <img src={img.url} alt="" />
                  {canEdit ? (
                    <div className="timeline-admin__item-actions">
                      <button type="button" onClick={() => moveImage(page.id, img.id, -1)} disabled={imgIdx === 0}>
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(page.id, img.id, 1)}
                        disabled={imgIdx === page.images.length - 1}
                      >
                        →
                      </button>
                      <button type="button" onClick={() => removeImage(page.id, img.id)}>
                        ×
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {canEdit && page.imageIds.length < TIMELINE_MAX_IMAGES ? (
              <label className="file-btn" style={{ marginTop: 12 }}>
                {uploadingPageId === page.id ? "Загрузка…" : "Добавить изображение"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={uploadingPageId === page.id}
                  onChange={(e) => {
                    void onUpload(page.id, e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : null}
          </Card>
        ))}
      </form>
    </PageShell>
  );
}
