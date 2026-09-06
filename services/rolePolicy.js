const {
  isPlatformRole,
  isTenantCustomRole,
  isTenantAssignableRole,
} = require("../utils/platformRbac");

const MUTABLE_FIELDS = new Set(["permissions", "label"]);

function canTenantEditRole(role, tenantId) {
  if (!role || isPlatformRole(role.name)) return false;
  if (role.is_system) return isTenantAssignableRole(role.name);
  return isTenantCustomRole(role.name, tenantId);
}

function canTenantDeleteRole(role, tenantId) {
  return Boolean(role && !role.is_system && canTenantEditRole(role, tenantId));
}

function validateRoleMutationBody(body) {
  const unexpected = Object.keys(body || {}).filter((key) => !MUTABLE_FIELDS.has(key));
  if (unexpected.length) {
    return {
      status: 400,
      code: "PROTECTED_ROLE_FIELD",
      error: `Field role canonical tidak dapat diubah: ${unexpected.join(", ")}`,
    };
  }
  if (!Array.isArray(body?.permissions)) {
    return { status: 400, code: "INVALID_PERMISSIONS", error: "permissions wajib berupa array" };
  }
  if (body.label !== undefined) {
    const label = String(body.label).trim();
    if (!label || label.length > 100) {
      return { status: 400, code: "INVALID_ROLE_LABEL", error: "Label role wajib 1-100 karakter" };
    }
  }
  return null;
}

module.exports = {
  MUTABLE_FIELDS,
  canTenantEditRole,
  canTenantDeleteRole,
  validateRoleMutationBody,
};
