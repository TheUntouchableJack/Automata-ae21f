-- content_reports: the log behind the feed's Report action.
--
-- Why a table and not just an email
-- ---------------------------------
-- Reporting emails pahkie@viibeview.com (the report-content edge function),
-- but an inbox is not a record: it cannot be counted, deduped, or queried for
-- "which post has been reported five times". The email is the alert; this
-- table is the evidence. The edge function inserts here FIRST — an email
-- outage must not lose a report.
--
-- Touches: creates content_reports. Nothing else.
--
-- Rollback
-- --------
--   DROP TABLE content_reports;   -- takes the policies and indexes with it


CREATE TABLE IF NOT EXISTS content_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- ON DELETE SET NULL, deliberately: the report has to survive the author
    -- deleting the post. Cascading would make the evidence disappear together
    -- with the offence, which is exactly backwards.
    media_id UUID REFERENCES venue_media(id) ON DELETE SET NULL,

    -- NULL for an anonymous report. Reporting bad content should never require
    -- an account, so the edge function accepts the anon key too.
    reporter_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

    reason TEXT,
    reporter_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One report per user per post. Partial, because anonymous reports have no
-- identity to dedupe on and must not collapse into a single row.
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_once_per_user
    ON content_reports(media_id, reporter_user_id)
    WHERE reporter_user_id IS NOT NULL;

-- Triage order for the owner: newest first, per app.
CREATE INDEX IF NOT EXISTS idx_content_reports_app
    ON content_reports(app_id, created_at DESC);

COMMENT ON TABLE content_reports IS
    'Reports raised from the ViibeView feed. Written only by the report-content edge function (service role); readable only by org members of the app. Members must not be able to enumerate reports — see the RLS below.';


ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- Read: org members of the app the report belongs to.
--
-- There is deliberately NO client-facing INSERT policy. The only writer is the
-- edge function running as the service role, which bypasses RLS entirely. A
-- client INSERT policy would let anyone forge reports at scale, and would also
-- hand them a way to probe which media ids exist (the unique index turns a
-- duplicate into a distinguishable 23505).
DROP POLICY IF EXISTS "Org members can read content reports" ON content_reports;
CREATE POLICY "Org members can read content reports"
ON content_reports FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM customer_apps ca
        JOIN organization_members om ON om.organization_id = ca.organization_id
        WHERE ca.id = content_reports.app_id
          AND om.user_id = auth.uid()
    )
);
