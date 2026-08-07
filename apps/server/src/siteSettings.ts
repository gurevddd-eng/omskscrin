import { prisma } from "./prisma.js";

export async function ensureSiteSettings() {
  return prisma.siteSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      adsVersion: "1",
      timelineVersion: "1",
      settingsVersion: "1",
      blockKeyboard: true,
      softwareEnabled: true,
      themeMode: "manual",
      themeDarkFrom: "20:00",
      themeDarkTo: "08:00",
      defaultHealthPort: 47821,
      defaultUiPort: 47820,
      corsOrigins: "",
      probeIntervalMs: 30000,
      probeTimeoutMs: 2500,
      domainSuffix: "udhb.local",
      deployTransport: "winrm",
    },
    update: {},
  });
}
