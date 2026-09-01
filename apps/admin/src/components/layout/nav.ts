export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
};

/** Top-level admin navigation — 4 sections. */
export const PRIMARY_NAV: NavItem[] = [
  { to: "/", label: "Обзор", end: true },
  { to: "/content/exhibits", label: "Контент" },
  { to: "/kiosks", label: "Киоски" },
  { to: "/system/settings", label: "Система" },
];

const PAGE_MAP: { match: (p: string) => boolean; section: string; title: string }[] = [
  { match: (p) => p === "/" || p === "", section: "Обзор", title: "Парк и контент" },
  { match: (p) => p.startsWith("/content/exhibits"), section: "Контент", title: "Экспонаты" },
  { match: (p) => p.startsWith("/content/timeline"), section: "Контент", title: "Хроника" },
  { match: (p) => p.startsWith("/content/ads"), section: "Контент", title: "Реклама" },
  { match: (p) => p.startsWith("/exhibits"), section: "Контент", title: "Экспонаты" },
  { match: (p) => p.startsWith("/timeline"), section: "Контент", title: "Хроника" },
  { match: (p) => p.startsWith("/ads"), section: "Контент", title: "Реклама" },
  { match: (p) => p.startsWith("/kiosks"), section: "Киоски", title: "Управление" },
  { match: (p) => p.startsWith("/system/settings"), section: "Система", title: "Настройки" },
  { match: (p) => p.startsWith("/system/users"), section: "Система", title: "Пользователи" },
  { match: (p) => p.startsWith("/settings"), section: "Система", title: "Настройки" },
  { match: (p) => p.startsWith("/users"), section: "Система", title: "Пользователи" },
  { match: (p) => p === "/monitor", section: "Обзор", title: "Парк и контент" },
];

export function getPageMeta(pathname: string): { section: string; title: string } {
  const hit = PAGE_MAP.find((m) => m.match(pathname));
  return hit ? { section: hit.section, title: hit.title } : { section: "Омскэкран", title: "Админка" };
}

export function navIsActive(pathname: string, to: string, end?: boolean) {
  if (to === "/content/exhibits") {
    return (
      pathname.startsWith("/content/") ||
      pathname.startsWith("/exhibits") ||
      pathname.startsWith("/timeline") ||
      pathname.startsWith("/ads")
    );
  }
  if (to === "/system/settings") {
    return pathname.startsWith("/system/") || pathname.startsWith("/settings") || pathname.startsWith("/users");
  }
  if (end) return pathname === to || (to === "/" && pathname === "");
  return pathname === to || pathname.startsWith(`${to}/`);
}
