-- Normalize user-facing platform branding only.
-- Stable technical identifiers, storage paths, package IDs, and migration history stay unchanged.

DO $$
BEGIN
  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    UPDATE platform_settings
    SET
      settings = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              settings,
              '{platform_name}',
              to_jsonb(
                CASE
                  WHEN lower(COALESCE(settings->>'platform_name', '')) IN ('kliksantri', 'klikpesantren')
                    THEN 'KlikPesantren'
                  ELSE settings->>'platform_name'
                END
              ),
              true
            ),
            '{tagline}',
            to_jsonb(
              CASE
                WHEN COALESCE(settings->>'tagline', '') IN ('', 'Satu klik-semua terhubung')
                  THEN 'Amanah Kita Bersama'
                ELSE settings->>'tagline'
              END
            ),
            true
          ),
          '{about_text}',
          to_jsonb(
            replace(
              replace(
                COALESCE(settings->>'about_text', 'KlikPesantren membantu pesantren mengelola administrasi santri, keuangan, dan komunikasi wali santri.'),
                'KlikSantri',
                'KlikPesantren'
              ),
              'Klikpesantren',
              'KlikPesantren'
            )
          ),
          true
        ),
        '{website_url}',
        to_jsonb(
          CASE
            WHEN lower(COALESCE(settings->>'website_url', '')) IN (
              '',
              'www.klikpesantren.com',
              'http://www.klikpesantren.com',
              'https://www.klikpesantren.com',
              'http://klikpesantren.com'
            ) THEN 'https://klikpesantren.com'
            ELSE settings->>'website_url'
          END
        ),
        true
      ),
      updated_at = NOW()
    WHERE id = 1;
  END IF;
END $$;
