export type NavLink = {
  to: string;
  label: string;
  end?: boolean;
  adminOnly?: boolean;
};

export type NavEntry =
  | { kind: "link"; to: string; label: string; end?: boolean }
  | { kind: "menu"; id: string; label: string; items: NavLink[] };

export const PRIMARY_NAV: NavEntry[] = [
  { kind: "link", to: "/", label: "Доступ", end: true },
  { kind: "link", to: "/monitor", label: "Мониторинг", end: true },
  {
    kind: "menu",
    id: "content",
    label: "Контент",
    items: [
      { to: "/exhibits", label: "Экспонаты" },
      { to: "/ads", label: "Реклама" },
    ],
  },
  { kind: "link", to: "/kiosks", label: "Киоски" },
  {
    kind: "menu",
    id: "system",
    label: "Система",
    items: [
      { to: "/settings", label: "Настройки" },
      { to: "/users", label: "Пользователи", adminOnly: true },
    ],
  },
];

const PAGE_MAP: { match: (p: string) => boolean; section: string; title: string }[] = [
  { match: (p) => p === "/" || p === "", section: "Быстрый доступ", title: "Главная" },
  { match: (p) => p === "/monitor", section: "Мониторинг", title: "Live-поток" },
  { match: (p) => p.startsWith("/exhibits"), section: "Контент", title: "Экспонаты" },
  { match: (p) => p.startsWith("/ads"), section: "Контент", title: "Реклама" },
  { match: (p) => p.startsWith("/kiosks"), section: "Парк ПК", title: "Киоски" },
  { match: (p) => p.startsWith("/settings"), section: "Система", title: "Настройки" },
  { match: (p) => p.startsWith("/users"), section: "Система", title: "Пользователи" },
];

export function getPageMeta(pathname: string): { section: string; title: string } {
  const hit = PAGE_MAP.find((m) => m.match(pathname));
  return hit ? { section: hit.section, title: hit.title } : { section: "Омскэкран", title: "Админка" };
}

export function navIsActive(pathname: string, to: string, end?: boolean) {
  if (end) return pathname === to || (to === "/" && pathname === "");
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function menuIsActive(pathname: string, items: NavLink[]) {
  return items.some((item) => navIsActive(pathname, item.to, item.end));
}
