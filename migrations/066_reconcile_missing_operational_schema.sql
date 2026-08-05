-- Sprint 0B: final operational schema used by active routes/services.
-- Replaces historical migrations 050-051 and 053-056 without replaying their seed/history.
-- Additive only: no DROP, no DELETE, no external provider call.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_id_id ON users (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kelas_tenant_id_id ON kelas (tenant_id, id);

CREATE TABLE IF NOT EXISTS user_kelas_scope (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  kelas_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_kelas_scope_user_tenant_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT user_kelas_scope_kelas_tenant_fkey
    FOREIGN KEY (tenant_id, kelas_id) REFERENCES kelas(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT user_kelas_scope_tenant_user_kelas_key UNIQUE (tenant_id, user_id, kelas_id)
);
CREATE INDEX IF NOT EXISTS idx_user_kelas_scope_tenant_user ON user_kelas_scope (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_kelas_scope_tenant_kelas ON user_kelas_scope (tenant_id, kelas_id);

CREATE TABLE IF NOT EXISTS wali_home_links (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'other',
  thumbnail_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wali_home_links_active_order
  ON wali_home_links (tenant_id, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS platform_website_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_content JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CONSTRAINT platform_website_settings_singleton_check CHECK (id = 1),
  CONSTRAINT platform_website_settings_status_check CHECK (status IN ('draft','published'))
);

CREATE TABLE IF NOT EXISTS tenant_domains (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hostname VARCHAR(255) NOT NULL,
  domain_type VARCHAR(30) NOT NULL DEFAULT 'platform_subdomain',
  provider VARCHAR(30) NOT NULL DEFAULT 'klikpesantren',
  dns_managed BOOLEAN NOT NULL DEFAULT true,
  dns_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  vercel_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ssl_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  overall_status VARCHAR(30) NOT NULL DEFAULT 'draft',
  is_primary BOOLEAN NOT NULL DEFAULT true,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  CONSTRAINT tenant_domains_hostname_key UNIQUE (hostname),
  CONSTRAINT tenant_domains_domain_type_check CHECK (domain_type IN ('platform_subdomain','custom_domain')),
  CONSTRAINT tenant_domains_dns_status_check CHECK (dns_status IN ('pending','creating','active','failed')),
  CONSTRAINT tenant_domains_vercel_status_check CHECK (vercel_status IN ('pending','adding','verified','failed')),
  CONSTRAINT tenant_domains_ssl_status_check CHECK (ssl_status IN ('pending','issuing','active','failed')),
  CONSTRAINT tenant_domains_overall_status_check CHECK (overall_status IN ('draft','provisioning','active','failed','disabled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_primary_tenant_key
  ON tenant_domains (tenant_id) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS tenant_domains_overall_status_idx ON tenant_domains (overall_status);

ALTER TABLE wali_akun ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='wali_akun'::regclass AND conname='wali_akun_token_version_nonnegative') THEN
    ALTER TABLE wali_akun ADD CONSTRAINT wali_akun_token_version_nonnegative
      CHECK (token_version >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_kelas_scope s
    LEFT JOIN users u ON u.id=s.user_id
    LEFT JOIN kelas k ON k.id=s.kelas_id
    WHERE u.id IS NULL OR k.id IS NULL
       OR s.tenant_id IS DISTINCT FROM u.tenant_id
       OR s.tenant_id IS DISTINCT FROM k.tenant_id
  ) THEN RAISE EXCEPTION '066 blocked: user_kelas_scope orphan/cross-tenant rows'; END IF;
  IF EXISTS (SELECT 1 FROM user_kelas_scope GROUP BY tenant_id,user_id,kelas_id HAVING COUNT(*)>1) THEN
    RAISE EXCEPTION '066 blocked: duplicate user_kelas_scope rows';
  END IF;
  IF EXISTS (SELECT 1 FROM wali_home_links l LEFT JOIN tenants t ON t.id=l.tenant_id WHERE t.id IS NULL) THEN
    RAISE EXCEPTION '066 blocked: wali_home_links orphan tenant';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_website_settings WHERE id<>1 OR status NOT IN ('draft','published')) THEN
    RAISE EXCEPTION '066 blocked: platform website singleton/status invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM tenant_domains d LEFT JOIN tenants t ON t.id=d.tenant_id WHERE t.id IS NULL) THEN
    RAISE EXCEPTION '066 blocked: tenant_domains orphan tenant';
  END IF;
  IF EXISTS (SELECT 1 FROM tenant_domains GROUP BY LOWER(hostname) HAVING COUNT(*)>1) THEN
    RAISE EXCEPTION '066 blocked: duplicate tenant domain hostname';
  END IF;
  IF EXISTS (SELECT 1 FROM tenant_domains WHERE
      domain_type NOT IN ('platform_subdomain','custom_domain')
      OR dns_status NOT IN ('pending','creating','active','failed')
      OR vercel_status NOT IN ('pending','adding','verified','failed')
      OR ssl_status NOT IN ('pending','issuing','active','failed')
      OR overall_status NOT IN ('draft','provisioning','active','failed','disabled')) THEN
    RAISE EXCEPTION '066 blocked: tenant domain lifecycle value invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM wali_akun WHERE token_version < 0) THEN
    RAISE EXCEPTION '066 blocked: negative wali token_version';
  END IF;
END $$;

ALTER TABLE wali_akun VALIDATE CONSTRAINT wali_akun_token_version_nonnegative;

-- Draft only. This does not call Cloudflare/Vercel and does not activate a domain.
INSERT INTO tenant_domains (tenant_id, hostname, domain_type, provider, dns_managed, overall_status)
SELECT t.id, LOWER(t.slug) || '.klikpesantren.com', 'platform_subdomain', 'klikpesantren', true, 'draft'
FROM tenants t
WHERE t.status='active'
  AND t.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  AND t.slug NOT IN ('www','app','platform','api','docs','status','admin','default','root','system')
ON CONFLICT (hostname) DO NOTHING;

COMMIT;
