-- app_members.gender, and an aggregate-only, suppression-gated crowd mix RPC.
--
-- Why
-- ---
-- The venue page's new "Who's here" section shows how many people have posted
-- recently and who they are. The third thing it shows is a gender split bar.
--
-- ⚠️ NO GENDER DATA EXISTS ANYWHERE IN THIS SCHEMA TODAY. There is no column,
-- no survey answer, no inference. Per the product decision the section is
-- designed now and the data arrives later, so this file ships the column and
-- the reader — the plumbing is real and lights up the day an Edit Profile
-- selector exists — and the client renders an honest "Gender mix unlocks once
-- enough members share it" state until then.
--
-- Collecting the value (an optional selector in Edit Profile, 8 locales, a
-- privacy-policy line) is deliberately NOT in this file. Nothing writes this
-- column yet.
--
-- ⚠️ TWO PRIVACY CONSTRAINTS. BOTH SERVER-ENFORCED. BOTH NON-NEGOTIABLE.
--
-- 1. AGGREGATE OVER ALL-TIME DISTINCT POSTERS, NEVER "HERE TONIGHT".
--    "2 men, 1 woman here tonight", rendered next to a grid of avatars that
--    names and pictures those same people, is re-identification of a specific
--    person at a named bar at a known time. It does not matter that each half
--    is individually harmless. The window is deliberately unbounded so the
--    number cannot be intersected with the here_now count or the faces row.
--
-- 2. SUPPRESS BELOW THE THRESHOLD BY RETURNING ZERO ROWS, NOT SMALL COUNTS.
--    A function that returns {female: 1, male: 0} has published one person's
--    gender. Returning the row and letting the client decide whether to draw
--    it is not suppression — the row is already on the wire, in a response any
--    visitor can read. The gate is inside the function, below.
--
-- The threshold is 10 RESPONDENTS (people who set a gender), not 10 posters.
-- Counting posters would let a venue with 40 regulars and 2 respondents
-- through the gate and then publish those 2.
--
-- Rollback
-- --------
-- DROP FUNCTION IF EXISTS get_venue_crowd_mix(UUID, UUID);
-- ALTER TABLE app_members DROP COLUMN gender;
-- The client renders the locked state when the RPC errors, so dropping the
-- function degrades to exactly the pre-data appearance.


-- ===== 1. app_members.gender =====
--
-- Nullable with no default: "has not said" is the honest starting state for
-- every existing member and must stay distinguishable from every answer.
--
-- 'undisclosed' is a CHOICE, not the absence of one — someone who opens the
-- selector and deliberately declines is saying something different from
-- someone who never opened it. The RPC counts neither toward the split, but
-- the distinction has to survive in the column or it cannot be recovered.

ALTER TABLE app_members
    ADD COLUMN IF NOT EXISTS gender TEXT;

ALTER TABLE app_members
    DROP CONSTRAINT IF EXISTS app_members_gender_valid;

ALTER TABLE app_members
    ADD CONSTRAINT app_members_gender_valid
    CHECK (gender IS NULL OR gender IN ('female', 'male', 'nonbinary', 'undisclosed'));

COMMENT ON COLUMN app_members.gender IS
    'Optional self-reported gender. NULL = never asked/never answered; '
    '"undisclosed" = asked and declined, which is a different fact. Read ONLY '
    'in aggregate by get_venue_crowd_mix, which suppresses below 10 '
    'respondents. Never expose this column per-member on any read path.';


-- ===== 2. get_venue_crowd_mix =====
--
-- Returns ZERO ROWS when the venue is below the threshold. The client treats
-- no-rows and an error identically — both render the locked state — so there
-- is no shape of response that leaks a small count.
--
-- Deliberately returns counts rather than percentages: the client needs the
-- total to decide whether to draw anything at all, and rounding two
-- percentages that must sum to 100 is a client concern.
--
-- Only 'female' and 'male' feed the bar. 'nonbinary' and 'undisclosed' are
-- counted toward the RESPONDENT total (they are answers, and they are what
-- makes the threshold meaningful) but are not given their own segment: at the
-- volumes ViibeView operates at, a third segment over a handful of people is
-- the re-identification risk in constraint 1 wearing a different shape.

DROP FUNCTION IF EXISTS get_venue_crowd_mix(UUID, UUID);

CREATE FUNCTION get_venue_crowd_mix(
    p_app_id UUID,
    p_venue_id UUID
)
RETURNS TABLE (
    female_count INTEGER,
    male_count INTEGER,
    respondent_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_min_respondents CONSTANT INTEGER := 10;
    v_female INTEGER;
    v_male INTEGER;
    v_respondents INTEGER;
BEGIN
    -- DISTINCT poster, over ALL TIME. See constraint 1 — there is no time
    -- window here on purpose, and adding one is the change that would make
    -- this function unsafe.
    SELECT
        COUNT(*) FILTER (WHERE am.gender = 'female')::INTEGER,
        COUNT(*) FILTER (WHERE am.gender = 'male')::INTEGER,
        COUNT(*)::INTEGER
    INTO v_female, v_male, v_respondents
    FROM (
        SELECT DISTINCT vm.uploaded_by_user_id
        FROM venue_media vm
        WHERE vm.app_id = p_app_id
          AND vm.venue_id = p_venue_id
          AND vm.status = 'approved'
          AND vm.uploaded_by_user_id IS NOT NULL
    ) posters
    JOIN app_members am
      ON am.user_id = posters.uploaded_by_user_id
     AND am.app_id  = p_app_id
     AND am.deleted_at IS NULL
    WHERE am.gender IS NOT NULL;

    -- ⚠️ THE SUPPRESSION GATE. Returning without RETURN QUERY yields zero
    -- rows, which is the whole mechanism. Do not "helpfully" return a row of
    -- zeroes here — a client cannot tell that apart from a real 0/0 and would
    -- have to guess, and the point is that the number never leaves the server.
    IF v_respondents < v_min_respondents THEN
        RETURN;
    END IF;

    -- A venue where every respondent is nonbinary or undisclosed passes the
    -- threshold but has nothing for a two-segment bar. Suppress that too
    -- rather than emitting 0/0, which the client would have to special-case.
    IF v_female + v_male = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT v_female, v_male, v_respondents;
END;
$$;

COMMENT ON FUNCTION get_venue_crowd_mix(UUID, UUID) IS
    'All-time aggregate gender split of a venue''s distinct posters. Returns '
    'ZERO ROWS below 10 respondents — suppression is inside the function, not '
    'in the client. Never window this by time: an aggregate over "tonight", '
    'next to a grid that names and pictures tonight''s posters, re-identifies '
    'a specific person at a named place at a known time.';


-- ===== 3. Grants =====
--
-- ⚠️ NO FOOTER, deliberately — same rule as the venue page's other readers.
-- The venue page is anon-browsable (get_venue_detail, get_venue_page_feed),
-- and a footer here would blank this one section for every signed-out visitor
-- while the rest of the page rendered, which reads as a bug rather than as a
-- permission.
--
-- That is only safe because of the suppression gate above: what anon can read
-- is an aggregate over at least 10 people, which is the same thing an
-- authenticated visitor can read. If the threshold were ever removed, this
-- decision would have to be revisited in the same edit.


-- ===== 4. Post-install assertions =====

DO $$
DECLARE
    v_rows INTEGER;
BEGIN
    -- 4a. The constraint actually rejects a value outside the vocabulary.
    -- A CHECK that was written but not applied is indistinguishable from none.
    BEGIN
        ALTER TABLE app_members ADD CONSTRAINT app_members_gender_probe
            CHECK (gender IS NULL OR gender IN ('female', 'male', 'nonbinary', 'undisclosed'));
        ALTER TABLE app_members DROP CONSTRAINT app_members_gender_probe;
    EXCEPTION WHEN check_violation THEN
        RAISE EXCEPTION
            'app_members already holds a gender value outside the allowed set — the CHECK cannot be trusted';
    END;

    -- 4b. The suppression gate returns NOTHING for a venue that does not exist,
    -- which is the same path a below-threshold venue takes. A function that
    -- returned a row here would be returning a row for every venue.
    SELECT COUNT(*) INTO v_rows
    FROM get_venue_crowd_mix(
        '00000000-0000-0000-0000-000000000000'::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    );
    IF v_rows <> 0 THEN
        RAISE EXCEPTION
            'get_venue_crowd_mix returned % row(s) for a venue with no posters — the suppression gate is not firing', v_rows;
    END IF;

    -- 4c. Must stay reachable by anon. See section 3.
    IF NOT has_function_privilege('anon', 'public.get_venue_crowd_mix(uuid, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION
            'get_venue_crowd_mix is not EXECUTEable by anon — the Who''s here section is blank for signed-out visitors';
    END IF;
END $$;
