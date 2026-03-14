-- Backfill users who have a profile but no organization membership.
-- The handle_new_user trigger partially ran (created profile) but failed
-- before creating the org + membership.

DO $$
DECLARE
    r RECORD;
    new_org_id UUID;
    v_org_name TEXT;
    v_org_slug TEXT;
BEGIN
    FOR r IN
        SELECT p.id, p.email, p.first_name
        FROM public.profiles p
        LEFT JOIN public.organization_members om ON om.user_id = p.id
        WHERE om.id IS NULL
    LOOP
        v_org_name := COALESCE(r.first_name || '''s Organization', 'My Organization');
        v_org_slug := LOWER(REPLACE(r.email, '@', '-at-') || '-' || SUBSTRING(r.id::TEXT, 1, 8));

        -- Create organization
        INSERT INTO public.organizations (id, name, slug)
        VALUES (gen_random_uuid(), v_org_name, v_org_slug)
        RETURNING id INTO new_org_id;

        -- Create membership
        INSERT INTO public.organization_members (organization_id, user_id, role)
        VALUES (new_org_id, r.id, 'owner');

        RAISE NOTICE 'Created org for user % (%)', r.email, r.id;
    END LOOP;
END;
$$;
