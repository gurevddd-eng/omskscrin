import { useState } from "react";
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth";
import { PRIMARY_NAV, getPageMeta, menuIsActive, navIsActive } from "./nav";

export function AppLayout() {
  const { user, loading, logout, isAdmin } = useAuth();
  const location = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

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

  return (
    <div className="cx-app">
      <header className="cx-header">
        <div className="cx-header__bar">
          <NavLink to="/" className="cx-brand" end onClick={() => setMobileNav(false)}>
            <span className="cx-brand__mark">Омскэкран</span>
          </NavLink>

          <button
            type="button"
            className="cx-header__toggle"
            aria-expanded={mobileNav}
            aria-label="Меню"
            onClick={() => setMobileNav((v) => !v)}
          >
            ☰
          </button>

          <nav className={`cx-nav${mobileNav ? " is-open" : ""}`} aria-label="Разделы админки">
            {PRIMARY_NAV.map((entry) => {
              if (entry.kind === "link") {
                const active = navIsActive(location.pathname, entry.to, entry.end);
                return (
                  <NavLink
                    key={entry.to}
                    to={entry.to}
                    end={entry.end}
                    className={`cx-nav__link${active ? " is-active" : ""}`}
                    onClick={() => setMobileNav(false)}
                  >
                    {entry.label}
                  </NavLink>
                );
              }

              const items = entry.items.filter((i) => !i.adminOnly || isAdmin);
              if (!items.length) return null;
              const active = menuIsActive(location.pathname, items);
              const open = openMenu === entry.id || (mobileNav && active);

              return (
                <div
                  key={entry.id}
                  className={`cx-nav__menu${active ? " is-active" : ""}${open ? " is-open" : ""}`}
                >
                  <button
                    type="button"
                    className="cx-nav__menu-btn"
                    aria-expanded={open}
                    onClick={() => setOpenMenu((cur) => (cur === entry.id ? null : entry.id))}
                  >
                    {entry.label}
                    <span className="cx-nav__chev" aria-hidden />
                  </button>
                  <div className="cx-nav__drop">
                    {items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) => `cx-nav__drop-link${isActive ? " is-active" : ""}`}
                        onClick={() => {
                          setMobileNav(false);
                          setOpenMenu(null);
                        }}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="cx-header__user">
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
        </div>

        <div className="cx-header__context">
          <span className="cx-header__crumb">{meta.section}</span>
          <span className="cx-header__page">{meta.title}</span>
        </div>
      </header>

      <main className="cx-main">
        <Outlet />
      </main>
    </div>
  );
}
