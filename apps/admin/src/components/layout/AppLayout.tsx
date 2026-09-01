import { useCallback, useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import type { KioskDto } from "@stella/shared";
import { useAuth } from "../../auth";
import { api } from "../../api";
import { getPageMeta } from "./nav";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fleetOnline, setFleetOnline] = useState<{ online: number; total: number } | null>(null);

  const refreshFleet = useCallback(() => {
    api<KioskDto[]>("/api/kiosks")
      .then((ks) => {
        setFleetOnline({
          online: ks.filter((k) => k.online).length,
          total: ks.length,
        });
      })
      .catch(() => setFleetOnline(null));
  }, []);

  useEffect(() => {
    refreshFleet();
    const id = window.setInterval(refreshFleet, 30_000);
    return () => window.clearInterval(id);
  }, [refreshFleet]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  if (loading) {
    return (
      <div className="st-loading">
        <span className="st-loading__spin" aria-hidden />
        Загрузка…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  const meta = getPageMeta(location.pathname);

  return (
    <div className={`st-shell${mobileOpen ? " is-nav-open" : ""}`}>
      <Sidebar
        pathname={location.pathname}
        login={user.login}
        fleetOnline={fleetOnline}
        onLogout={logout}
        onNavigate={() => setMobileOpen(false)}
      />

      {mobileOpen ? (
        <button
          type="button"
          className="st-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="st-main">
        <header className="st-topbar">
          <button
            type="button"
            className={`st-topbar__menu${mobileOpen ? " is-open" : ""}`}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="st-topbar__trail">
            <span className="st-topbar__section">{meta.section}</span>
            <span className="st-topbar__sep" aria-hidden>
              /
            </span>
            <span className="st-topbar__page">{meta.title}</span>
          </div>
        </header>

        <main className="st-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
