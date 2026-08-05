-- Invalidate admin JWT sessions after security-sensitive user or role changes.
-- Additive and backward-compatible with the pre-070 application. Apply before
-- deploying application code that reads users.token_version.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION '070 blocked: users, roles, and role_permissions must exist';
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_token_version_nonnegative'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_token_version_nonnegative
      CHECK (token_version >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE token_version < 0) THEN
    RAISE EXCEPTION '070 blocked: users.token_version contains a negative value';
  END IF;
END $$;

ALTER TABLE users VALIDATE CONSTRAINT users_token_version_nonnegative;

CREATE OR REPLACE FUNCTION bump_user_token_version_on_security_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.password IS DISTINCT FROM NEW.password
     OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    NEW.token_version := OLD.token_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_bump_token_version ON users;
CREATE TRIGGER trg_users_bump_token_version
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION bump_user_token_version_on_security_change();

CREATE OR REPLACE FUNCTION bump_role_members_token_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users usr
    SET token_version = token_version + 1
    FROM roles role_row
    WHERE role_row.id = NEW.role_id
      AND usr.role = role_row.name;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users usr
    SET token_version = token_version + 1
    FROM roles role_row
    WHERE role_row.id = OLD.role_id
      AND usr.role = role_row.name;
  ELSE
    IF OLD.role_id IS NOT DISTINCT FROM NEW.role_id
       AND OLD.permission_id IS NOT DISTINCT FROM NEW.permission_id THEN
      RETURN NULL;
    END IF;
    UPDATE users usr
    SET token_version = token_version + 1
    FROM roles role_row
    WHERE role_row.id IN (OLD.role_id, NEW.role_id)
      AND usr.role = role_row.name;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_permissions_bump_token_version ON role_permissions;
CREATE TRIGGER trg_role_permissions_bump_token_version
AFTER INSERT OR UPDATE OR DELETE ON role_permissions
FOR EACH ROW
EXECUTE FUNCTION bump_role_members_token_version();

COMMENT ON COLUMN users.token_version IS
  'JWT session version; security-sensitive account and role permission changes invalidate older tokens.';
COMMENT ON FUNCTION bump_user_token_version_on_security_change() IS
  'Invalidates active admin sessions when role, status, password, or tenant ownership changes.';
COMMENT ON FUNCTION bump_role_members_token_version() IS
  'Invalidates sessions for every user affected by a role permission matrix change.';

COMMIT;
