import { NavLink, Outlet, useLocation } from "react-router-dom";
import { navIsActive } from "./nav";

const SYSTEM_TABS = [
  { to: "/system/settings", label: "Настройки" },
  { to: "/system/users", label: "Пользователи" },
];

export function SystemLayout() {
  const location = useLocation();

  return (
    <div className="cx-section">
      <nav className="cx-subnav" aria-label="Система">
        {SYSTEM_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={`cx-subnav__link${navIsActive(location.pathname, tab.to) ? " is-active" : ""}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
