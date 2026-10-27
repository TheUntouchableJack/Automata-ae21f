-- ViibeView's splash video (Jay, 2026-10-27).
--
-- Why
-- ---
-- The splash screen (Jay's board: "Splash Screen with Video Background") has
-- played branding.splash_video_url since it was built, but nothing writes that
-- key: My App does not expose it and the App Builder has no field for it. Jay
-- supplied the clip (a walk into a concert, 21 s, no sound); a 720x1280 copy
-- (1.4 MB) ships with the site at /customer-app/media/viibeview-splash-v1.mp4.
--
-- A path on this site, not a Supabase URL: the clip is served by Netlify, so
-- it costs no Supabase egress, and the CSP's media-src 'self' already allows
-- it. ViibeView has no custom domain, so the path resolves on royaltyapp.ai.
--
-- ⚠️ Apply only AFTER social.js v29 is live. Older social.js sets the video's
-- src at boot, which downloads the whole clip for every visitor.
--
-- What it does
-- ------------
-- Merges one key into this one row's branding. Every other branding key is
-- untouched. Matched by id, slug and app_type; running it twice sets the same
-- value again.
--
-- Rollback:
--   UPDATE customer_apps SET branding = branding - 'splash_video_url'
--   WHERE id = '6119865e-83f8-4731-b320-8ea705a2ac18';

DO $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE customer_apps
    SET branding = COALESCE(branding, '{}'::jsonb)
                   || jsonb_build_object('splash_video_url', '/customer-app/media/viibeview-splash-v1.mp4')
    WHERE id = '6119865e-83f8-4731-b320-8ea705a2ac18'
      AND slug = 'viibeview'
      AND app_type = 'social';

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> 1 THEN
        RAISE EXCEPTION 'ViibeView splash video: % rows matched, expected 1', v_updated;
    END IF;
END $$;
