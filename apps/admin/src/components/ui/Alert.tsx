import type { ReactNode } from "react";

type AlertProps = {
  tone: "error" | "success" | "info";
  onDismiss?: () => void;
  children: ReactNode;
};

export function Alert({ tone, onDismiss, children }: AlertProps) {
  return (
    <div className={`cx-alert cx-alert--${tone}`} role="status">
      <div className="cx-alert__body">{children}</div>
      {onDismiss ? (
        <button type="button" className="cx-alert__close" onClick={onDismiss}>
          Закрыть
        </button>
      ) : null}
    </div>
  );
}
