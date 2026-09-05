export const ADMIN_PRODUCT_BRAND = Object.freeze({
  name: "Khodimul Ma'had",
  shortName: "KhodimulMa'had",
  tagline: "Admin Pesantren",
  logo: "/branding-khodimul-mahad-icon-512.png",
  poweredBy: "Powered by KlikPesantren",
});

export function isUniversalAdminHost(hostname = window.location.hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "app.klikpesantren.com" || normalized === "localhost" || normalized === "127.0.0.1";
}