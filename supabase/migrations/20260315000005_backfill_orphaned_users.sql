-- Backfill orphaned users: create profile + org + membership for any
-- auth.users row that has no matching profiles row.
-- This fixes users who signed up while handle_new_user trigger was missing.

DO $$
DECLARE
    r RECORD;
    new_org_id UUID;
    user_first_name TEXT;
    user_last_name TEXT;
    v_org_name TEXT;
    v_org_slug TEXT;
BEGIN
    FOR r IN
        SELECT u.id, u.email, u.raw_user_meta_data
        FROM auth.users u
        LEFT JOIN public.profiles p ON p.id = u.id
        WHERE p.id IS NULL
    LOOP
        user_first_name := r.raw_user_meta_data->>'first_name';
        user_last_name := r.raw_user_meta_data->>'last_name';

        -- Create profile
        INSERT INTO public.profiles (id, email, first_name, last_name)
        VALUES (r.id, r.email, user_first_name, user_last_name)
        ON CONFLICT (id) DO NOTHING;

        -- Create default organization
        v_org_name := COALESCE(user_first_name || '''s Organization', 'My Organization');
        v_org_slug := LOWER(REPLACE(r.email, '@', '-at-') || '-' || SUBSTRING(r.id::TEXT, 1, 8));

        INSERT INTO public.organizations (id, name, slug)
        VALUES (gen_random_uuid(), v_org_name, v_org_slug)
        RETURNING id INTO new_org_id;

        -- Add user as owner
        INSERT INTO public.organization_members (organization_id, user_id, role)
        VALUES (new_org_id, r.id, 'owner');

        RAISE NOTICE 'Backfilled user % (%)', r.email, r.id;
    END LOOP;
END;
$$;
