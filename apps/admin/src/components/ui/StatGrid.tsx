import type { ReactNode } from "react";

type StatGridProps = {
  children: ReactNode;
  columns?: 3 | 4 | 5;
};

export function StatGrid({ children, columns = 4 }: StatGridProps) {
  return <div className={`cx-stats cx-stats--${columns}`}>{children}</div>;
}

type StatProps = {
  label: string;
  value: ReactNode;
  tone?: "default" | "ok" | "warn" | "bad";
};

export function Stat({ label, value, tone = "default" }: StatProps) {
  return (
    <div className={`cx-stat cx-stat--${tone}`}>
      <div className="cx-stat__value">{value}</div>
      <div className="cx-stat__label">{label}</div>
    </div>
  );
}
