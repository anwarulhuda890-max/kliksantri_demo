// Helper RBAC frontend — cek apakah user login punya permission tertentu.
// Sumber: localStorage.user.permissions (diisi saat login / refresh /auth/me)

import { getUser } from "./storage";

export { getUser };

export function getPermissions() {
  const user = getUser();
  return Array.isArray(user?.permissions) ? user.permissions : [];
}

export function hasPermission(key) {
  if (!key) return true;
  // Tenant superadmin is the all-access administrator. Backend permission
  // middleware remains authoritative; this prevents a stale cached permission
  // list from hiding newly introduced workspace controls after deployment.
  if (getUser()?.role === "superadmin") return true;
  return getPermissions().includes(key);
}

export function hasAnyPermission(keys) {
  if (!Array.isArray(keys)) return hasPermission(keys);
  return keys.some((key) => hasPermission(key));
}
