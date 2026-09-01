export const ROOT_DOMAIN = "klikpesantren.com";

export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "platform",
  "api",
  "docs",
  "status",
  "admin",
  "default",
  "root",
  "system",
]);

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const TENANT_SLUG_PATTERN = /^[a-z0-9-]+$/;
const EXTERNAL_HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

export function resolveHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  const result = { type: "unknown", hostname: normalized, tenantSlug: null };

  if (!normalized) return result;

  if (
    LOCAL_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost")
  ) {
    return { ...result, type: "local" };
  }

  if (normalized === ROOT_DOMAIN || normalized === `www.${ROOT_DOMAIN}`) {
    return { ...result, type: "official" };
  }

  if (normalized === `platform.${ROOT_DOMAIN}`) {
    return { ...result, type: "platform" };
  }

  if (normalized === `app.${ROOT_DOMAIN}`) {
    return { ...result, type: "app" };
  }

  if (normalized === "vercel.app" || normalized.endsWith(".vercel.app")) {
    return { ...result, type: "preview" };
  }

  const domainSuffix = `.${ROOT_DOMAIN}`;
  if (!normalized.endsWith(domainSuffix)) {
    if (EXTERNAL_HOSTNAME_PATTERN.test(normalized)) return { ...result, type: "custom-domain" };
    return result;
  }

  const subdomain = normalized.slice(0, -domainSuffix.length);
  if (!subdomain || subdomain.indexOf(".") !== -1) return result;

  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return { ...result, type: "reserved" };
  }

  if (!TENANT_SLUG_PATTERN.test(subdomain)) return result;

  return { ...result, type: "tenant", tenantSlug: subdomain };
}

export function getCurrentHostnameRoute() {
  if (typeof window === "undefined") return resolveHostname("");
  return resolveHostname(window.location.hostname);
}
