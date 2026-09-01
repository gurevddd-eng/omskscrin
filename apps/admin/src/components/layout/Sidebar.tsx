import { NavLink, Link } from "react-router-dom";
import { NAV_GROUPS, navIsActive } from "./nav";

type SidebarProps = {
  pathname: string;
  login: string;
  fleetOnline: { online: number; total: number } | null;
  onLogout: () => void;
  onNavigate?: () => void;
};

export function Sidebar({ pathname, login, fleetOnline, onLogout, onNavigate }: SidebarProps) {
  return (
    <aside className="st-sidebar" aria-label="Навигация">
      <div className="st-sidebar__brand">
        <Link to="/" className="st-brand" onClick={onNavigate}>
          <span className="st-brand__mark" aria-hidden>
            С
          </span>
          <span className="st-brand__text">
            <strong>Омскэкран</strong>
            <small>Админка киосков</small>
          </span>
        </Link>
      </div>

      {fleetOnline && fleetOnline.total > 0 ? (
        <Link to="/kiosks" className="st-fleet" onClick={onNavigate}>
          <span
            className={`st-fleet__dot${fleetOnline.online < fleetOnline.total ? " is-warn" : ""}`}
            aria-hidden
          />
          <span className="st-fleet__text">
            <strong>
              {fleetOnline.online}/{fleetOnline.total}
            </strong>
            <small>киосков онлайн</small>
          </span>
        </Link>
      ) : null}

      <nav className="st-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="st-nav__group">
            {group.label ? <p className="st-nav__label">{group.label}</p> : null}
            <ul className="st-nav__list">
              {group.items.map((item) => {
                const active = navIsActive(pathname, item.to, item.end);
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={`st-nav__link${active ? " is-active" : ""}`}
                      onClick={onNavigate}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="st-sidebar__foot">
        <div className="st-user">
          <span className="st-user__avatar" aria-hidden>
            {login.slice(0, 1).toUpperCase()}
          </span>
          <div className="st-user__meta">
            <strong>{login}</strong>
            <span>Администратор</span>
          </div>
        </div>
        <button type="button" className="btn ghost st-user__out" onClick={onLogout}>
          Выйти
        </button>
      </div>
    </aside>
  );
}
