import type { ReactNode } from "react";

type PageShellProps = {
  section: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  flush?: boolean;
};

export function PageShell({
  section,
  title,
  description,
  actions,
  banner,
  children,
  wide,
  flush,
}: PageShellProps) {
  return (
    <div className={`cx-page${wide ? " cx-page--wide" : ""}${flush ? " cx-page--flush" : ""}`}>
      <header className="cx-page__head">
        <div className="cx-page__intro">
          <p className="cx-page__section">{section}</p>
          <h1 className="cx-page__title">{title}</h1>
          {description ? <p className="cx-page__desc">{description}</p> : null}
        </div>
        {actions ? <div className="cx-page__actions">{actions}</div> : null}
      </header>
      {banner ? <div className="cx-page__banner">{banner}</div> : null}
      <div className="cx-page__body">{children}</div>
    </div>
  );
}
