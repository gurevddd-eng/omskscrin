import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "span",
];

const ALLOWED_ATTR = ["href", "target", "rel", "class", "style"];

/** Turn stored exhibit body (HTML or legacy plain text) into safe HTML for kiosk. */
export function sanitizeExhibitBody(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";

  let html = s;
  if (!/<[a-z][\s\S]*>/i.test(s)) {
    const escape = (t: string) =>
      t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = s
      .split(/\n{2,}/)
      .map((block) => `<p>${escape(block).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}
