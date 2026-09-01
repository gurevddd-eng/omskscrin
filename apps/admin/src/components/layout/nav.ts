export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
};

export type NavGroup = {
  id: string;
  label?: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    items: [{ to: "/", label: "Обзор", end: true }],
  },
  {
    id: "content",
    label: "Контент",
    items: [
      { to: "/content/exhibits", label: "Экспонаты" },
      { to: "/content/timeline", label: "Хроника" },
      { to: "/content/ads", label: "Реклама" },
    ],
  },
  {
    id: "fleet",
    items: [{ to: "/kiosks", label: "Киоски" }],
  },
  {
    id: "system",
    label: "Система",
    items: [
      { to: "/system/settings", label: "Настройки" },
      { to: "/system/users", label: "Пользователи" },
    ],
  },
];

const PAGE_MAP: { match: (p: string) => boolean; section: string; title: string }[] = [
  { match: (p) => p === "/" || p === "", section: "Обзор", title: "Парк и контент" },
  { match: (p) => p.startsWith("/content/exhibits") || p.startsWith("/exhibits"), section: "Контент", title: "Экспонаты" },
  { match: (p) => p.startsWith("/content/timeline") || p.startsWith("/timeline"), section: "Контент", title: "Хроника" },
  { match: (p) => p.startsWith("/content/ads") || p.startsWith("/ads"), section: "Контент", title: "Реклама" },
  { match: (p) => p.startsWith("/kiosks"), section: "Киоски", title: "Управление" },
  { match: (p) => p.startsWith("/system/settings") || p.startsWith("/settings"), section: "Система", title: "Настройки" },
  { match: (p) => p.startsWith("/system/users") || p.startsWith("/users"), section: "Система", title: "Пользователи" },
];

export function getPageMeta(pathname: string): { section: string; title: string } {
  const hit = PAGE_MAP.find((m) => m.match(pathname));
  return hit ? { section: hit.section, title: hit.title } : { section: "Омскэкран", title: "Админка" };
}

export function navIsActive(pathname: string, to: string, end?: boolean) {
  if (end) return pathname === to || (to === "/" && pathname === "");
  return pathname === to || pathname.startsWith(`${to}/`);
}
