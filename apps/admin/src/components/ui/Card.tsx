import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padding?: "default" | "none";
};

export function Card({ title, subtitle, actions, children, className = "", padding = "default" }: CardProps) {
  return (
    <section className={`cx-card ${className}`.trim()}>
      {title || actions ? (
        <header className="cx-card__head">
          <div>
            {title ? <h2 className="cx-card__title">{title}</h2> : null}
            {subtitle ? <p className="cx-card__sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="cx-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`cx-card__body${padding === "none" ? " cx-card__body--flush" : ""}`}>{children}</div>
    </section>
  );
}
