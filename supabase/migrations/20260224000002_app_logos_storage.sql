-- Create app-logos storage bucket for customer app branding
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-logos',
  'app-logos',
  true,
  2097152, -- 2MB
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: Authenticated users can upload to their org's folder
CREATE POLICY "Users can upload logos for their org"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'app-logos'
  AND (storage.foldername(name))[1] IN (
    SELECT o.id::text FROM organizations o
    INNER JOIN organization_members om ON om.organization_id = o.id
    WHERE om.user_id = auth.uid()
  )
);

-- RLS: Anyone can read (public bucket)
CREATE POLICY "Anyone can read app logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'app-logos');

-- RLS: Authenticated users can update/delete their org's logos
CREATE POLICY "Users can manage logos for their org"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'app-logos'
  AND (storage.foldername(name))[1] IN (
    SELECT o.id::text FROM organizations o
    INNER JOIN organization_members om ON om.organization_id = o.id
    WHERE om.user_id = auth.uid()
  )
);
