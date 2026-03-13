-- SEO Topics queue for Royalty marketing blog generation.
-- Seeded from Royalty-SEO/topics/queue.json (top 30 by score, status='queued').
-- The blog review UI reads from this table to show AI-ranked topic recommendations.

CREATE TABLE IF NOT EXISTS seo_topics (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    keyword      TEXT NOT NULL,
    slug         TEXT,
    type         TEXT,     -- pillar, cluster, constraint, schema
    intent       TEXT,     -- problem-aware, solution-aware, product-aware
    category     TEXT,     -- primary_topic value: 'AI Insights' | 'Loyalty Programs' | 'Customer Retention'
    score        NUMERIC DEFAULT 0,
    status       TEXT DEFAULT 'queued',  -- queued | generating | drafted | published
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE seo_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read/write seo_topics" ON seo_topics
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- Top 30 topics from queue.json sorted by SEO opportunity score
INSERT INTO seo_topics (keyword, slug, type, intent, category, score) VALUES
    ('best loyalty program with AI automation',     'best-loyalty-program-with-ai-automation',     'constraint', 'solution-aware',  'AI Insights',        43.5),
    ('AI loyalty marketing automation',             'ai-loyalty-marketing-automation',             'cluster',    'problem-aware',   'AI Insights',        40.0),
    ('customer retention strategies',              'customer-retention-strategies',              'cluster',    'problem-aware',   'Customer Retention', 40.0),
    ('types of loyalty programs',                  'types-of-loyalty-programs',                  'cluster',    'problem-aware',   'Loyalty Programs',   40.0),
    ('royalty vs square loyalty coffee shop',      'royalty-vs-square-loyalty-coffee-shop',      'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty restaurant',       'royalty-vs-square-loyalty-restaurant',       'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty salon',            'royalty-vs-square-loyalty-salon',            'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty gym',              'royalty-vs-square-loyalty-gym',              'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty retail store',     'royalty-vs-square-loyalty-retail-store',     'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty food truck',       'royalty-vs-square-loyalty-food-truck',       'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty dental practice',  'royalty-vs-square-loyalty-dental-practice',  'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty real estate agency','royalty-vs-square-loyalty-real-estate-agency','schema',   'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty law firm',         'royalty-vs-square-loyalty-law-firm',         'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty insurance agency', 'royalty-vs-square-loyalty-insurance-agency', 'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty auto repair shop', 'royalty-vs-square-loyalty-auto-repair-shop', 'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty veterinary clinic','royalty-vs-square-loyalty-veterinary-clinic','schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty cleaning service', 'royalty-vs-square-loyalty-cleaning-service', 'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty accounting firm',  'royalty-vs-square-loyalty-accounting-firm',  'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty marketing agency', 'royalty-vs-square-loyalty-marketing-agency', 'schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('royalty vs square loyalty financial advisor','royalty-vs-square-loyalty-financial-advisor','schema',     'product-aware',   'Loyalty Programs',   38.0),
    ('best loyalty program for coffee shop',       'best-loyalty-program-for-coffee-shop',       'schema',     'solution-aware',  'Loyalty Programs',   35.0),
    ('best loyalty program for restaurant',        'best-loyalty-program-for-restaurant',        'schema',     'solution-aware',  'Loyalty Programs',   35.0),
    ('best loyalty program for salon',             'best-loyalty-program-for-salon',             'schema',     'solution-aware',  'Loyalty Programs',   35.0),
    ('best loyalty program for gym',               'best-loyalty-program-for-gym',               'schema',     'solution-aware',  'Loyalty Programs',   35.0),
    ('best loyalty program for retail store',      'best-loyalty-program-for-retail-store',      'schema',     'solution-aware',  'Loyalty Programs',   35.0),
    ('best loyalty program for food truck',        'best-loyalty-program-for-food-truck',        'schema',     'solution-aware',  'Loyalty Programs',   35.0),
    ('loyalty program ROI for small business',     'loyalty-program-roi-for-small-business',     'cluster',    'problem-aware',   'Loyalty Programs',   33.0),
    ('how to increase customer lifetime value',    'how-to-increase-customer-lifetime-value',    'cluster',    'problem-aware',   'Customer Retention', 33.0),
    ('SMS marketing for small business',           'sms-marketing-for-small-business',           'cluster',    'problem-aware',   'Customer Retention', 32.0),
    ('email marketing automation small business',  'email-marketing-automation-small-business',  'cluster',    'problem-aware',   'AI Insights',        30.0);
