import { NavLink, Outlet, useLocation } from "react-router-dom";
import { navIsActive } from "./nav";

const CONTENT_TABS = [
  { to: "/content/exhibits", label: "Экспонаты" },
  { to: "/content/timeline", label: "Хроника" },
  { to: "/content/ads", label: "Реклама" },
];

export function ContentLayout() {
  const location = useLocation();

  return (
    <div className="cx-section">
      <nav className="cx-subnav" aria-label="Контент">
        {CONTENT_TABS.map((tab) => (
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
