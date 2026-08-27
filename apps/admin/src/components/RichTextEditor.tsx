import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Remount/resync when switching exhibits */
  docKey?: string | null;
};

/** Plain text → simple paragraphs for TipTap; HTML left as-is. */
export function toEditorHtml(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/<[a-z][\s\S]*>/i.test(s)) return s;
  const escape = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return s
    .split(/\n{2,}/)
    .map((block) => `<p>${escape(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Compare TipTap HTML ignoring cosmetic whitespace / empty paragraphs. */
export function normalizeEditorHtml(html: string): string {
  return String(html || "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/<p><\/p>/gi, "")
    .trim();
}

function ToolbarBtn({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rte__btn${active ? " is-active" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // Keep editor selection when clicking toolbar (mousedown would otherwise clear it)
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function RichTextEditor({ value, onChange, disabled, placeholder, docKey }: Props) {
  const skipNextExternal = useRef(false);
  const lastDocKey = useRef(docKey);
  const valueRef = useRef(value);
  valueRef.current = value;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({
        placeholder: placeholder || "Текст описания…",
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: "rte-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: toEditorHtml(value),
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? "" : ed.getHTML();
      // TipTap may emit cosmetic HTML on mount/parse — don't treat as a user edit.
      if (normalizeEditorHtml(html) === normalizeEditorHtml(toEditorHtml(valueRef.current))) {
        return;
      }
      skipNextExternal.current = true;
      onChange(html);
    },
    editorProps: {
      attributes: {
        class: "rte__prose",
      },
      handleDOMEvents: {
        // Stop Enter from bubbling to <form onKeyDown> that blocks non-textarea Enter
        keydown: (_view, event) => {
          if (event.key === "Enter") {
            event.stopPropagation();
          }
          return false;
        },
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Sync when opening another exhibit (or after save replaces body from server)
  useEffect(() => {
    if (!editor) return;
    const docChanged = lastDocKey.current !== docKey;
    lastDocKey.current = docKey;

    if (skipNextExternal.current && !docChanged) {
      skipNextExternal.current = false;
      return;
    }

    const next = toEditorHtml(value);
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (normalizeEditorHtml(next) === normalizeEditorHtml(current)) return;
    if (!docChanged && editor.isFocused) return;

    editor.commands.setContent(next || "", { emitUpdate: false });
    skipNextExternal.current = false;
  }, [editor, value, docKey]);

  if (!editor) return <div className="rte rte--loading">Загрузка редактора…</div>;

  const inTable = editor.isActive("table");

  const setLink = () => {
    if (disabled) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Ссылка (URL)", prev || "https://");
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  };

  const insertTable = () => {
    if (disabled) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className={`rte${disabled ? " is-disabled" : ""}`}>
      <div className="rte__toolbar" role="toolbar" aria-label="Форматирование">
        <ToolbarBtn
          label="Ж"
          title="Жирный"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarBtn
          label="К"
          title="Курсив"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarBtn
          label="Ч"
          title="Подчёркнутый"
          active={editor.isActive("underline")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <span className="rte__sep" aria-hidden />
        <ToolbarBtn
          label="H2"
          title="Подзаголовок"
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarBtn
          label="H3"
          title="Мелкий заголовок"
          active={editor.isActive("heading", { level: 3 })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <span className="rte__sep" aria-hidden />
        <ToolbarBtn
          label="• Список"
          title="Маркированный список"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarBtn
          label="1. Список"
          title="Нумерованный список"
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarBtn
          label="Цитата"
          title="Цитата"
          active={editor.isActive("blockquote")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <span className="rte__sep" aria-hidden />
        <ToolbarBtn
          label="Таблица"
          title="Вставить таблицу 3×3"
          active={inTable}
          disabled={disabled}
          onClick={insertTable}
        />
        <ToolbarBtn
          label="+ряд"
          title="Добавить строку снизу"
          disabled={disabled || !inTable}
          onClick={() => editor.chain().focus().addRowAfter().run()}
        />
        <ToolbarBtn
          label="+кол"
          title="Добавить столбец справа"
          disabled={disabled || !inTable}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        />
        <ToolbarBtn
          label="−ряд"
          title="Удалить строку"
          disabled={disabled || !inTable}
          onClick={() => editor.chain().focus().deleteRow().run()}
        />
        <ToolbarBtn
          label="−кол"
          title="Удалить столбец"
          disabled={disabled || !inTable}
          onClick={() => editor.chain().focus().deleteColumn().run()}
        />
        <ToolbarBtn
          label="✕табл"
          title="Удалить таблицу"
          disabled={disabled || !inTable}
          onClick={() => editor.chain().focus().deleteTable().run()}
        />
        <span className="rte__sep" aria-hidden />
        <ToolbarBtn
          label="⟸"
          title="По левому краю"
          active={editor.isActive({ textAlign: "left" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        />
        <ToolbarBtn
          label="⇔"
          title="По центру"
          active={editor.isActive({ textAlign: "center" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        />
        <ToolbarBtn
          label="⟹"
          title="По правому краю"
          active={editor.isActive({ textAlign: "right" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        />
        <span className="rte__sep" aria-hidden />
        <ToolbarBtn
          label="Ссылка"
          title="Вставить ссылку"
          active={editor.isActive("link")}
          disabled={disabled}
          onClick={setLink}
        />
        <ToolbarBtn
          label="↩"
          title="Отменить"
          disabled={disabled || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarBtn
          label="↪"
          title="Повторить"
          disabled={disabled || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
