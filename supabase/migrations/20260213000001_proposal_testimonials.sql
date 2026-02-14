-- Proposal testimonials persistence for 24hd-proposals admin panel
CREATE TABLE IF NOT EXISTS proposal_testimonials (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    proposal_id text NOT NULL UNIQUE,
    testimonials jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);

ALTER TABLE proposal_testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read" ON proposal_testimonials FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert" ON proposal_testimonials FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update" ON proposal_testimonials FOR UPDATE USING (true);
