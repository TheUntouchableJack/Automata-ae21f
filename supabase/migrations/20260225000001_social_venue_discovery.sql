-- Social Venue Discovery: tables, indexes, RLS, RPCs, storage bucket
-- App type: 'social' on customer_apps

-- ===== VENUES TABLE =====
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Identity
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    handle TEXT,                            -- @TheBungalowSM style handle
    description TEXT,
    category TEXT DEFAULT 'nightlife',      -- nightlife, bar, club, lounge, restaurant, rooftop, event_space

    -- Location
    address_line1 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    country TEXT DEFAULT 'US',
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),

    -- Media
    cover_image_url TEXT,
    profile_image_url TEXT,                 -- venue avatar shown in feed cards

    -- Contact
    phone TEXT,
    website TEXT,
    instagram_handle TEXT,

    -- Details
    hours JSONB DEFAULT '{}',               -- {"mon": "5pm-2am", "tue": "5pm-2am", ...}
    tags TEXT[] DEFAULT '{}',               -- ['rooftop', 'dj', 'cocktails', 'latin']

    -- Counts
    media_count INTEGER DEFAULT 0,

    -- Ratings (future: computed from reviews)
    average_rating DECIMAL(2,1) DEFAULT 0,
    review_count INTEGER DEFAULT 0,

    -- Status
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,

    -- Soft delete + timestamps
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT venues_slug_app_unique UNIQUE(app_id, slug)
);

-- Indexes
CREATE INDEX idx_venues_app ON venues(app_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_venues_org ON venues(organization_id);
CREATE INDEX idx_venues_geo ON venues(latitude, longitude) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX idx_venues_category ON venues(app_id, category) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX idx_venues_featured ON venues(app_id, is_featured) WHERE is_active = true AND deleted_at IS NULL;

-- Enable RLS
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

-- RLS: Org members can manage venues
CREATE POLICY "Org members can manage venues"
ON venues FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = venues.organization_id
        AND om.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = venues.organization_id
        AND om.user_id = auth.uid()
    )
);

-- RLS: Public can view active venues in published apps
CREATE POLICY "Public can view active venues"
ON venues FOR SELECT
TO anon, authenticated
USING (
    is_active = true
    AND deleted_at IS NULL
    AND EXISTS (
        SELECT 1 FROM customer_apps ca
        WHERE ca.id = venues.app_id
        AND ca.is_published = true
        AND ca.is_active = true
        AND ca.deleted_at IS NULL
    )
);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION set_venues_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_venues_updated_at
    BEFORE UPDATE ON venues
    FOR EACH ROW
    EXECUTE FUNCTION set_venues_updated_at();


-- ===== VENUE MEDIA TABLE =====
CREATE TABLE venue_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Uploader
    uploaded_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

    -- Media info
    media_type TEXT NOT NULL DEFAULT 'video',  -- video, image
    storage_path TEXT NOT NULL,
    url TEXT NOT NULL,
    thumbnail_url TEXT,

    -- Metadata
    caption TEXT,
    duration_seconds INTEGER,
    file_size_bytes BIGINT,

    -- Moderation (admin uploads auto-approved; future UGC starts as 'pending')
    status TEXT DEFAULT 'approved',

    -- Engagement
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_venue_media_venue ON venue_media(venue_id) WHERE status = 'approved';
CREATE INDEX idx_venue_media_feed ON venue_media(app_id, status, created_at DESC) WHERE status = 'approved';
CREATE INDEX idx_venue_media_pending ON venue_media(app_id, status) WHERE status = 'pending';

-- Enable RLS
ALTER TABLE venue_media ENABLE ROW LEVEL SECURITY;

-- RLS: Org members can manage all media
CREATE POLICY "Org members can manage venue media"
ON venue_media FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM customer_apps ca
        JOIN organization_members om ON om.organization_id = ca.organization_id
        WHERE ca.id = venue_media.app_id
        AND om.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM customer_apps ca
        JOIN organization_members om ON om.organization_id = ca.organization_id
        WHERE ca.id = venue_media.app_id
        AND om.user_id = auth.uid()
    )
);

-- RLS: Public can view approved media in published apps
CREATE POLICY "Public can view approved venue media"
ON venue_media FOR SELECT
TO anon, authenticated
USING (
    status = 'approved'
    AND EXISTS (
        SELECT 1 FROM customer_apps ca
        WHERE ca.id = venue_media.app_id
        AND ca.is_published = true
        AND ca.is_active = true
        AND ca.deleted_at IS NULL
    )
);


-- ===== STORAGE BUCKET: venue-media =====
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'venue-media',
    'venue-media',
    true,
    52428800, -- 50MB
    ARRAY['video/mp4', 'video/webm', 'video/quicktime', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Org members can upload to their org's folder
CREATE POLICY "Users can upload venue media for their org"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'venue-media'
    AND (storage.foldername(name))[1] IN (
        SELECT o.id::text FROM organizations o
        INNER JOIN organization_members om ON om.organization_id = o.id
        WHERE om.user_id = auth.uid()
    )
);

-- Storage RLS: Anyone can read (public bucket)
CREATE POLICY "Anyone can read venue media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-media');

-- Storage RLS: Org members can delete their org's media
CREATE POLICY "Users can delete venue media for their org"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'venue-media'
    AND (storage.foldername(name))[1] IN (
        SELECT o.id::text FROM organizations o
        INNER JOIN organization_members om ON om.organization_id = o.id
        WHERE om.user_id = auth.uid()
    )
);


-- ===== RPC: Get venues for map view (lightweight) =====
CREATE OR REPLACE FUNCTION get_venues_for_map(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    handle TEXT,
    category TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    cover_image_url TEXT,
    profile_image_url TEXT,
    is_featured BOOLEAN,
    average_rating DECIMAL,
    review_count INTEGER,
    media_count BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id, v.name, v.slug, v.handle, v.category,
        v.latitude, v.longitude,
        v.cover_image_url, v.profile_image_url,
        v.is_featured,
        v.average_rating, v.review_count,
        COALESCE(mc.cnt, 0) AS media_count
    FROM venues v
    LEFT JOIN (
        SELECT vm.venue_id, COUNT(*) AS cnt
        FROM venue_media vm
        WHERE vm.status = 'approved'
        GROUP BY vm.venue_id
    ) mc ON mc.venue_id = v.id
    WHERE v.app_id = p_app_id
      AND v.is_active = true
      AND v.deleted_at IS NULL
      AND v.latitude IS NOT NULL
      AND v.longitude IS NOT NULL
    ORDER BY v.is_featured DESC, v.name;
END;
$$;


-- ===== RPC: Get venue feed (paginated) =====
CREATE OR REPLACE FUNCTION get_venue_feed(
    p_app_id UUID,
    p_category TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    venue_id UUID,
    venue_name TEXT,
    venue_handle TEXT,
    venue_category TEXT,
    venue_city TEXT,
    venue_state TEXT,
    venue_latitude DECIMAL,
    venue_longitude DECIMAL,
    venue_profile_image_url TEXT,
    media_type TEXT,
    url TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    duration_seconds INTEGER,
    view_count INTEGER,
    like_count INTEGER,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        v.name AS venue_name,
        v.handle AS venue_handle,
        v.category AS venue_category,
        v.city AS venue_city,
        v.state AS venue_state,
        v.latitude AS venue_latitude,
        v.longitude AS venue_longitude,
        v.profile_image_url AS venue_profile_image_url,
        vm.media_type, vm.url, vm.thumbnail_url,
        vm.caption, vm.duration_seconds,
        vm.view_count, vm.like_count,
        vm.created_at
    FROM venue_media vm
    JOIN venues v ON v.id = vm.venue_id
    WHERE vm.app_id = p_app_id
      AND vm.status = 'approved'
      AND v.is_active = true
      AND v.deleted_at IS NULL
      AND (p_category IS NULL OR v.category = p_category)
    ORDER BY vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- ===== RPC: Get venue detail =====
CREATE OR REPLACE FUNCTION get_venue_detail(p_venue_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    handle TEXT,
    description TEXT,
    category TEXT,
    address_line1 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    cover_image_url TEXT,
    profile_image_url TEXT,
    phone TEXT,
    website TEXT,
    instagram_handle TEXT,
    hours JSONB,
    tags TEXT[],
    average_rating DECIMAL,
    review_count INTEGER,
    is_featured BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id, v.name, v.slug, v.handle, v.description, v.category,
        v.address_line1, v.city, v.state, v.postal_code,
        v.latitude, v.longitude,
        v.cover_image_url, v.profile_image_url,
        v.phone, v.website, v.instagram_handle,
        v.hours, v.tags,
        v.average_rating, v.review_count,
        v.is_featured
    FROM venues v
    WHERE v.id = p_venue_id
      AND v.is_active = true
      AND v.deleted_at IS NULL;
END;
$$;
