import { useEffect, useState, type ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
};

/**
 * Renders only after the image is fully decoded, so progressive JPEGs
 * do not paint scan-by-scan on screen.
 */
export function ReadyImage({ src, className = "", alt = "", ...rest }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    const img = new Image();
    img.src = src;

    const mark = () => {
      if (!cancelled) setReady(true);
    };

    const fail = () => {
      // Still paint so a broken asset is not a permanent blank
      if (!cancelled) setReady(true);
    };

    if (typeof img.decode === "function") {
      img
        .decode()
        .then(mark)
        .catch(() => {
          if (img.complete && img.naturalWidth > 0) mark();
          else fail();
        });
    } else if (img.complete && img.naturalWidth > 0) {
      mark();
    } else {
      img.onload = mark;
      img.onerror = fail;
    }

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      className={`ready-img${ready ? " is-ready" : ""}${className ? ` ${className}` : ""}`}
      decoding="async"
      loading="eager"
      draggable={false}
    />
  );
}

/** Warm browser decode cache for blob / http image URLs. */
export function prefetchImages(urls: Array<string | null | undefined>) {
  for (const src of urls) {
    if (!src) continue;
    const img = new Image();
    img.src = src;
    void img.decode?.().catch(() => undefined);
  }
}
