import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ConfirmOptions = {
  title: string;
  message?: string;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "warn";
};

type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

type ConfirmDialogProps = ConfirmOptions & {
  onConfirm: () => void;
  onCancel: () => void;
};

function ConfirmDialog({
  title,
  message,
  details,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [onCancel]);

  return (
    <div className="cx-confirm" role="dialog" aria-modal="true" aria-labelledby="cx-confirm-title">
      <button type="button" className="cx-confirm__backdrop" aria-label="Закрыть" onClick={onCancel} />
      <div className={`cx-confirm__panel cx-confirm__panel--${tone}`}>
        <h2 id="cx-confirm-title" className="cx-confirm__title">
          {title}
        </h2>
        {message ? <p className="cx-confirm__message">{message}</p> : null}
        {details ? <p className="cx-confirm__details">{details}</p> : null}
        <div className="cx-confirm__actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn${tone === "danger" ? " danger" : tone === "warn" ? " warn" : ""}`}
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setState((cur) => {
      cur?.resolve(result);
      return null;
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {state ? (
        <ConfirmDialog
          title={state.title}
          message={state.message}
          details={state.details}
          confirmLabel={state.confirmLabel}
          cancelLabel={state.cancelLabel}
          tone={state.tone}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("ConfirmProvider missing");
  return ctx;
}
