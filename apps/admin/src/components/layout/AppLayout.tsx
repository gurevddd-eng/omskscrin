import { useEffect, useState } from "react";
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth";
import { PRIMARY_NAV, getPageMeta, navIsActive } from "./nav";

export function AppLayout() {
  const { user, loading, logout, isAdmin } = useAuth();
  const location = useLocation();
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNav) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileNav(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNav]);

  if (loading) {
    return (
      <div className="cx-loading">
        <span className="cx-loading__spin" aria-hidden />
        Загрузка…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  const meta = getPageMeta(location.pathname);
  const links = PRIMARY_NAV.filter((item) => !item.adminOnly || isAdmin);

  return (
    <div className="cx-app">
      <header className="cx-header">
        <div className="cx-header__glow" aria-hidden />
        <div className="cx-header__bar">
          <NavLink to="/" className="cx-brand" end onClick={() => setMobileNav(false)}>
            <span className="cx-brand__glyph" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <span className="cx-brand__text">
              <span className="cx-brand__mark">Омскэкран</span>
              <span className="cx-brand__sub">Админка</span>
            </span>
          </NavLink>

          <nav className={`cx-nav${mobileNav ? " is-open" : ""}`} aria-label="Разделы админки">
            <div className="cx-nav__rail">
              {links.map((item) => {
                const active = navIsActive(location.pathname, item.to, item.end);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={`cx-nav__link${active ? " is-active" : ""}`}
                    onClick={() => setMobileNav(false)}
                  >
                    {item.label}
                  </NavLink>
                );
              })}
            </div>

            <div className="cx-nav__mobile-user">
              <div className="cx-user-chip">
                <span className="cx-user-chip__avatar">{user.login.slice(0, 1).toUpperCase()}</span>
                <span className="cx-user-chip__meta">
                  <strong>{user.login}</strong>
                  <small>{user.role}</small>
                </span>
              </div>
              <button type="button" className="btn ghost cx-user-chip__out" onClick={logout}>
                Выйти
              </button>
            </div>
          </nav>

          <div className="cx-header__trail">
            <div className="cx-header__user">
              <div className="cx-user-chip">
                <span className="cx-user-chip__avatar" aria-hidden>
                  {user.login.slice(0, 1).toUpperCase()}
                </span>
                <span className="cx-user-chip__meta">
                  <strong>{user.login}</strong>
                  <small>{user.role}</small>
                </span>
              </div>
              <button type="button" className="btn ghost cx-user-chip__out" onClick={logout}>
                Выйти
              </button>
            </div>

            <button
              type="button"
              className={`cx-header__toggle${mobileNav ? " is-open" : ""}`}
              aria-expanded={mobileNav}
              aria-label={mobileNav ? "Закрыть меню" : "Открыть меню"}
              onClick={() => setMobileNav((v) => !v)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>

        <div className="cx-header__context" aria-label="Текущий раздел">
          <span className="cx-header__crumb">{meta.section}</span>
          <span className="cx-header__sep" aria-hidden>
            /
          </span>
          <span className="cx-header__page">{meta.title}</span>
        </div>
      </header>

      {mobileNav ? (
        <button
          type="button"
          className="cx-nav-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMobileNav(false)}
        />
      ) : null}

      <main className="cx-main">
        <Outlet />
      </main>
    </div>
  );
}
