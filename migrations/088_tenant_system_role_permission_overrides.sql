BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION '088 blocked: required RBAC/tenant tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'token_version'
  ) THEN
    RAISE EXCEPTION '088 blocked: users.token_version from migration 070 is required';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS tenant_role_overrides (
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  label_override VARCHAR(100),
  has_permission_override BOOLEAN NOT NULL DEFAULT false,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, role_id),
  CONSTRAINT tenant_role_overrides_label_check CHECK (
    label_override IS NULL OR LENGTH(BTRIM(label_override)) > 0
  )
);

CREATE TABLE IF NOT EXISTS tenant_role_permissions (
  tenant_id BIGINT NOT NULL,
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, role_id, permission_id),
  CONSTRAINT tenant_role_permissions_override_fk
    FOREIGN KEY (tenant_id, role_id)
    REFERENCES tenant_role_overrides(tenant_id, role_id)
    ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION enforce_tenant_system_role_override()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_role_is_system BOOLEAN;
BEGIN
  SELECT is_system
  INTO target_role_is_system
  FROM roles
  WHERE id = NEW.role_id;

  IF target_role_is_system IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Tenant role override hanya valid untuk role sistem'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_role_overrides_system_only ON tenant_role_overrides;
CREATE TRIGGER trg_tenant_role_overrides_system_only
BEFORE INSERT OR UPDATE OF role_id ON tenant_role_overrides
FOR EACH ROW EXECUTE FUNCTION enforce_tenant_system_role_override();
CREATE INDEX IF NOT EXISTS tenant_role_permissions_lookup_idx
  ON tenant_role_permissions (tenant_id, role_id);

CREATE OR REPLACE FUNCTION touch_tenant_role_override()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_role_overrides_touch ON tenant_role_overrides;
CREATE TRIGGER trg_tenant_role_overrides_touch
BEFORE UPDATE ON tenant_role_overrides
FOR EACH ROW EXECUTE FUNCTION touch_tenant_role_override();

CREATE OR REPLACE FUNCTION bump_tenant_role_members_token_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_tenant_id BIGINT;
  affected_role_id INTEGER;
BEGIN
  affected_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  affected_role_id := COALESCE(NEW.role_id, OLD.role_id);

  UPDATE users usr
  SET token_version = token_version + 1
  FROM roles role_row
  WHERE role_row.id = affected_role_id
    AND usr.tenant_id = affected_tenant_id
    AND usr.role = role_row.name;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_role_overrides_bump_session ON tenant_role_overrides;
CREATE TRIGGER trg_tenant_role_overrides_bump_session
AFTER INSERT OR UPDATE OR DELETE ON tenant_role_overrides
FOR EACH ROW EXECUTE FUNCTION bump_tenant_role_members_token_version();

DROP TRIGGER IF EXISTS trg_tenant_role_permissions_bump_session ON tenant_role_permissions;
CREATE TRIGGER trg_tenant_role_permissions_bump_session
AFTER INSERT OR UPDATE OR DELETE ON tenant_role_permissions
FOR EACH ROW EXECUTE FUNCTION bump_tenant_role_members_token_version();

COMMENT ON TABLE tenant_role_overrides IS
  'Tenant-local presentation and permission override marker for canonical system roles.';
COMMENT ON TABLE tenant_role_permissions IS
  'Full tenant-local permission set used only when has_permission_override is true.';

COMMENT ON FUNCTION enforce_tenant_system_role_override() IS
  'Database guard: tenant-local overrides may only target canonical roles with is_system=true.';

COMMIT;
