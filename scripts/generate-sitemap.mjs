#!/usr/bin/env node
/**
 * Generates sitemap.xml with static pages + dynamic blog posts from Supabase.
 * Run: node scripts/generate-sitemap.mjs
 * Add to deploy pipeline to keep sitemap fresh.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vhpmmfhfwnpmavytoomd.supabase.co';
// Anon key. Not a secret — the identical key already ships in the client bundle —
// but read from env first so there is one place to rotate it. The literal stays as
// a fallback so a Netlify build without the env var still produces a correct
// sitemap instead of silently dropping every blog URL.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';
const SITE_URL = process.env.SITE_URL || 'https://royaltyapp.ai';

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// MUST list every live public page. This array is the whole static sitemap — an
// omission here silently deletes a live URL on the next build. Keep the URL form
// (.html vs clean) identical to each page's rel=canonical.
const staticPages = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/pricing.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/blog/', changefreq: 'daily', priority: '0.9' },
  { loc: '/automations/', changefreq: 'monthly', priority: '0.7' },
  { loc: '/royalty-vs-loyalty.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/about.html', changefreq: 'monthly', priority: '0.7' },
  { loc: '/contact.html', changefreq: 'monthly', priority: '0.6' },
  { loc: '/estimate.html', changefreq: 'monthly', priority: '0.7' },
  { loc: '/roadmap', changefreq: 'weekly', priority: '0.6' },
  { loc: '/privacy.html', changefreq: 'yearly', priority: '0.3' },
  { loc: '/terms.html', changefreq: 'yearly', priority: '0.3' },
];

async function fetchPublishedPosts() {
  // Try newsletter_articles first, fall back to blog_posts
  let anyRequestSucceeded = false;

  for (const table of ['newsletter_articles', 'blog_posts']) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?status=eq.published&select=slug,published_at,updated_at&order=published_at.desc`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
    } catch (err) {
      console.error(`Request to ${table} threw: ${err.message}`);
      continue;
    }

    if (res.ok) {
      anyRequestSucceeded = true;
      const posts = await res.json();
      if (posts.length > 0) {
        console.log(`Found ${posts.length} published posts in ${table}`);
        return posts;
      }
    } else {
      console.error(`Request to ${table} failed: ${res.status}`);
    }
  }

  // A reachable API that returns zero rows is a real "no posts yet" — write the
  // sitemap. Every request failing is NOT: writing then would silently strip
  // every blog URL out of a live sitemap over a transient Supabase blip.
  if (!anyRequestSucceeded) {
    throw new Error('Could not reach Supabase — refusing to rewrite sitemap.xml');
  }

  console.log('No published posts found');
  return [];
}

function toXmlDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toISOString().split('T')[0];
}

function buildSitemap(posts) {
  const today = new Date().toISOString().split('T')[0];
  const urls = staticPages.map(p => `  <url>
    <loc>${SITE_URL}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`);

  for (const post of posts) {
    const lastmod = post.updated_at || post.published_at;
    urls.push(`  <url>
    <loc>${SITE_URL}/blog/${post.slug}</loc>
    <lastmod>${toXmlDate(lastmod)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

async function main() {
  const posts = await fetchPublishedPosts();
  const sitemap = buildSitemap(posts);
  const outPath = join(__dirname, '..', 'sitemap.xml');
  writeFileSync(outPath, sitemap, 'utf-8');
  console.log(`Sitemap written to ${outPath} (${staticPages.length} static + ${posts.length} blog posts)`);
}

main().catch(err => {
  console.error('Sitemap generation failed:', err);
  process.exit(1);
});
