import { config } from "./config.js";
import { ensureSiteSettings } from "./siteSettings.js";

export type EffectiveDeploy = {
  user: string;
  password: string;
  sshKeyPath: string;
  sshPort: number;
  transport: "auto" | "ssh" | "winrm";
  domainSuffix: string;
  source: "db" | "env" | "mixed";
};

function normalizeUser(raw: string) {
  let u = raw.trim().replace(/^["']|["']$/g, "");
  while (u.includes("\\\\")) u = u.replaceAll("\\\\", "\\");
  if (/^[^\\/@]+\/[^\\/@]+$/.test(u)) {
    const [domain, user] = u.split("/");
    u = `${domain}\\${user}`;
  }
  return u;
}

function normalizeTransport(raw: string | null | undefined): "auto" | "ssh" | "winrm" {
  const v = (raw || "").trim().toLowerCase();
  if (v === "winrm" || v === "ssh") return v;
  return "auto";
}

let cached: EffectiveDeploy = {
  user: config.deployUser,
  password: config.deployPassword,
  sshKeyPath: config.deploySshKeyPath,
  sshPort: config.deploySshPort,
  transport: config.deployTransport,
  domainSuffix: "udhb.local",
  source: "env",
};

export function getEffectiveDeploy(): EffectiveDeploy {
  return cached;
}

export async function refreshDeployCredentialsFromDb() {
  const s = await ensureSiteSettings();
  const dbUser = (s.deployUser || "").trim();
  const dbPass = s.deployPassword ?? "";
  const domainSuffix = (s.domainSuffix || "udhb.local").trim().replace(/^\./, "") || "udhb.local";
  const dbTransport = normalizeTransport(s.deployTransport);

  const user = normalizeUser(dbUser || config.deployUser);
  const password = dbUser ? dbPass : config.deployPassword || dbPass;
  const transport =
    s.deployTransport && s.deployTransport.trim()
      ? dbTransport
      : config.deployTransport;

  cached = {
    user,
    password: password || config.deployPassword,
    sshKeyPath: config.deploySshKeyPath,
    sshPort: config.deploySshPort,
    transport,
    domainSuffix,
    source: dbUser ? (config.deployUser && !dbUser ? "mixed" : "db") : "env",
  };

  // If DB user set but password empty, keep env password as fallback
  if (dbUser && !dbPass && config.deployPassword) {
    cached.password = config.deployPassword;
    cached.source = "mixed";
  }

  return cached;
}

export function deployCredentialsConfigured(d: EffectiveDeploy = cached): boolean {
  return Boolean(
    d.user &&
      !/^domain\\/i.test(d.user) &&
      d.user.toLowerCase() !== "domain\\admin" &&
      (d.password || d.sshKeyPath)
  );
}

/** Short name → FQDN using domainSuffix (pc01 → pc01.udhb.local). */
export function expandHostname(raw: string, domainSuffix = cached.domainSuffix): string {
  let h = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!h) return h;
  if (h.includes(".") || h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
  const suffix = domainSuffix.replace(/^\./, "");
  return suffix ? `${h}.${suffix}` : h;
}

export function toDeployDto(d: EffectiveDeploy = cached) {
  return {
    deployUser: d.user,
    deployPasswordSet: Boolean(d.password),
    domainSuffix: d.domainSuffix,
    deployTransport: d.transport,
    sshKeyConfigured: Boolean(d.sshKeyPath),
    credentialsOk: deployCredentialsConfigured(d),
    source: d.source,
  };
}
