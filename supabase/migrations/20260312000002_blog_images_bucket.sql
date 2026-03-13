-- Create blog-images storage bucket for article hero images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'blog-images',
    'blog-images',
    true,
    5242880,  -- 5MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read access (anyone can view blog images)
DO $$ BEGIN
  CREATE POLICY "blog-images public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'blog-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admin-only upload (only is_admin profiles can upload)
DO $$ BEGIN
  CREATE POLICY "blog-images admin upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
      bucket_id = 'blog-images'
      AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND is_admin = true
      )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admin-only delete (only is_admin profiles can delete)
DO $$ BEGIN
  CREATE POLICY "blog-images admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
      bucket_id = 'blog-images'
      AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND is_admin = true
      )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
