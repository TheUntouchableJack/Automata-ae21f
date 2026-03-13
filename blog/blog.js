// ===== Supabase Configuration =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

// Royalty's marketing blog — fixed app ID, no dynamic lookup needed
// (customer_apps has RLS that blocks anon reads, so we hardcode this)
const ROYALTY_MARKETING_BLOG_SLUG = 'royalty-marketing';
let ROYALTY_APP_ID = 'd0229946-0812-4a96-acc4-0344613ee8b1';

// Use a unique name to avoid conflicting with the global `supabase` from the CDN bundle
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Page Detection =====
const isPostPage = window.__POST_PAGE || window.location.pathname.includes('post.html');

if (isPostPage) {
    initPostPage();
} else {
    initBlogIndex();
}

// ===== Blog Index Page =====
async function initBlogIndex() {
    await detectBlogSource();
    await loadPosts();
    setupFilterListeners();
    setupSubscribeForm();
    loadDraftArticles();
}

async function loadDraftArticles() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return;
    const { data: profile } = await db.from('profiles').select('is_admin').eq('id', session.user.id).single();
    if (!profile?.is_admin) return;

    const { data: drafts, error } = await db.rpc('get_draft_articles_for_review');
    if (error || !drafts?.length) return;

    const grid = document.getElementById('posts-grid');
    if (!grid) return;

    if (grid.children.length > 0) {
        const sep = document.createElement('div');
        sep.style.cssText = 'grid-column: 1/-1; display:flex; align-items:center; gap:12px; color:var(--color-text-muted); font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.08em;';
        sep.innerHTML = `<span>Drafts (admin only)</span><span style="flex:1;height:1px;background:var(--color-border)"></span>`;
        grid.appendChild(sep);
    }

    drafts.forEach(post => {
        const card = document.createElement('a');
        card.href = `/blog/${post.slug}`;
        card.className = 'post-card post-card--draft';
        card.innerHTML = `
            <div class="post-card-image">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                    <rect x="8" y="6" width="32" height="36" rx="2"/>
                    <path d="M16 16H32M16 24H32M16 32H24" stroke-linecap="round"/>
                </svg>
            </div>
            <div class="post-card-content">
                <div class="post-card-meta">
                    <span class="post-card-industry">${escapeHtml(post.primary_topic || 'Draft')}</span>
                    <span class="draft-badge">DRAFT</span>
                </div>
                <h2 class="post-card-title">${escapeHtml(post.title)}</h2>
                <p class="post-card-excerpt">${escapeHtml(post.meta_description || '')}</p>
            </div>`;
        grid.appendChild(card);
    });

    grid.style.display = 'grid';
}

async function detectBlogSource() {
    try {
        const { data: app } = await db
            .from('customer_apps')
            .select('id, name, slug')
            .eq('app_type', 'newsletter')
            .eq('slug', ROYALTY_MARKETING_BLOG_SLUG)
            .eq('is_active', true)
            .is('deleted_at', null)
            .single();

        if (app) {
            ROYALTY_APP_ID = app.id;
        }
    } catch (e) {
        // Marketing blog app not found, use blog_posts fallback
        console.log('Using blog_posts fallback');
    }
}

async function loadPosts(topic = 'all') {
    const loading = document.getElementById('loading');
    const postsGrid = document.getElementById('posts-grid');
    const emptyState = document.getElementById('empty-state');

    loading.style.display = 'flex';
    postsGrid.style.display = 'none';
    emptyState.style.display = 'none';

    try {
        let posts = [];

        if (ROYALTY_APP_ID) {
            // Use newsletter_articles via RPC
            const { data, error } = await db.rpc('get_published_articles', {
                p_app_id: ROYALTY_APP_ID,
                p_language: getCurrentLanguage(),
                p_topic: topic === 'all' ? null : topic,
                p_limit: 50
            });

            if (error) throw error;
            posts = (Array.isArray(data) ? data : data?.articles) || [];
        } else {
            // Fallback to blog_posts table
            let query = db
                .from('blog_posts')
                .select('*')
                .eq('status', 'published')
                .order('published_at', { ascending: false });

            if (topic !== 'all') {
                query = query.eq('industry', topic);
            }

            const { data, error } = await query;
            if (error) throw error;
            posts = data || [];
        }

        loading.style.display = 'none';

        if (posts.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        postsGrid.style.display = 'grid';
        renderPosts(posts);

    } catch (error) {
        console.error('Error loading posts:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading posts. Please refresh.</p>';
    }
}

function renderPosts(posts) {
    const postsGrid = document.getElementById('posts-grid');

    postsGrid.innerHTML = posts.map(post => {
        const publishedDate = new Date(post.published_at || post.created_at).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });

        // Handle both newsletter_articles and blog_posts schemas
        const excerpt = post.excerpt || extractExcerpt(post.content);
        const topic = post.primary_topic || post.industry;
        const tags = post.tags || post.seo_keywords || [];
        const image = post.og_image_url || null;

        // Keywords
        const keywords = tags.slice(0, 3);
        const keywordsHtml = keywords.length > 0 ? `
            <div class="post-card-keywords">
                ${keywords.map(kw => `<span class="post-card-keyword">${escapeHtml(kw)}</span>`).join('')}
            </div>
        ` : '';

        // Image or placeholder
        const imageHtml = image ? `
            <div class="post-card-image" style="background-image: url('${escapeHtml(image)}'); background-size: cover; background-position: center;">
            </div>
        ` : `
            <div class="post-card-image">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <rect x="8" y="6" width="32" height="36" rx="2" stroke="currentColor" stroke-width="2"/>
                    <path d="M16 16H32M16 24H32M16 32H24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
        `;

        return `
            <a href="/blog/${post.slug}" class="post-card">
                ${imageHtml}
                <div class="post-card-content">
                    <div class="post-card-meta">
                        ${topic ? `<span class="post-card-industry">${escapeHtml(topic)}</span>` : ''}
                        <span class="post-card-date">${publishedDate}</span>
                    </div>
                    <h2 class="post-card-title">${escapeHtml(post.title)}</h2>
                    <p class="post-card-excerpt">${escapeHtml(excerpt)}</p>
                    ${keywordsHtml}
                </div>
            </a>
        `;
    }).join('');
}

function extractExcerpt(content) {
    if (!content) return '';

    // Remove markdown headers
    let text = content.replace(/^#+\s+.+$/gm, '');

    // Remove markdown formatting
    text = text.replace(/\*\*(.+?)\*\*/g, '$1');
    text = text.replace(/\*(.+?)\*/g, '$1');
    text = text.replace(/\[(.+?)\]\(.+?\)/g, '$1');
    text = text.replace(/`(.+?)`/g, '$1');

    // Remove embed tags
    text = text.replace(/\[royalty:[^\]]+\]/g, '');

    // Get first meaningful paragraph
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 50);
    const firstParagraph = paragraphs[0] || text;

    // Truncate
    return firstParagraph.trim().substring(0, 200) + (firstParagraph.length > 200 ? '...' : '');
}

function setupFilterListeners() {
    const filterTabs = document.querySelectorAll('.filter-tab');

    filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active state
            filterTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Load posts for topic
            loadPosts(tab.dataset.topic || tab.dataset.industry || 'all');
        });
    });
}

function setupSubscribeForm() {
    const form = document.getElementById('subscribe-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = form.querySelector('input[type="email"]').value.trim();
        if (!email) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Subscribing...';
        submitBtn.disabled = true;

        try {
            if (ROYALTY_APP_ID) {
                const { error } = await db.rpc('subscribe_to_newsletter', {
                    p_app_id: ROYALTY_APP_ID,
                    p_email: email,
                    p_source: 'blog_footer',
                    p_preferred_language: getCurrentLanguage()
                });

                if (error) throw error;
            } else {
                // Fallback - just log for now
                console.log('Subscribe request:', email);
            }

            // Show success
            form.innerHTML = `
                <div class="subscribe-success">
                    <span class="success-icon">✓</span>
                    <span>Check your email to confirm!</span>
                </div>
            `;
        } catch (error) {
            console.error('Subscribe error:', error);
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
            alert('Failed to subscribe. Please try again.');
        }
    });
}

// ===== Single Post Page =====
async function initPostPage() {
    document.body.classList.add('is-post-page');
    await detectBlogSource();

    // Get slug from clean URL path, hash, or query param (backward compat)
    let slug = '';
    const pathname = window.location.pathname;
    const pathMatch = pathname.match(/^\/blog\/([^\/]+)$/);
    if (pathMatch && pathMatch[1] !== 'post.html' && pathMatch[1] !== 'index.html') {
        slug = pathMatch[1];
    } else if (window.location.hash) {
        slug = window.location.hash.slice(1);
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        slug = urlParams.get('slug') || '';
    }

    if (!slug) {
        showNotFound();
        return;
    }

    await loadPost(slug);
}

async function loadPost(slug) {
    const loading = document.getElementById('loading');
    const postContent = document.getElementById('post-content');
    const notFound = document.getElementById('not-found');

    try {
        let post = null;

        if (ROYALTY_APP_ID) {
            // Use newsletter_articles via RPC
            const { data, error } = await db.rpc('get_article_by_slug', {
                p_app_id: ROYALTY_APP_ID,
                p_slug: slug,
                p_language: getCurrentLanguage()
            });

            if (error) throw error;
            if (data?.article) {
                post = {
                    ...data.article,
                    series: data.series,
                    prev_in_series: data.prev_in_series,
                    next_in_series: data.next_in_series,
                    translations: data.translations
                };
            } else {
                post = data;
            }
        } else {
            // Fallback to blog_posts table
            const { data, error } = await db
                .from('blog_posts')
                .select('*')
                .eq('slug', slug)
                .eq('status', 'published')
                .single();

            if (error) throw error;
            post = data;
        }

        // Admin fallback: try loading draft directly if RPC returned nothing
        if (!post?.id) {
            const { data: { session } } = await db.auth.getSession();
            if (session) {
                const { data: profile } = await db.from('profiles').select('is_admin').eq('id', session.user.id).single();
                if (profile?.is_admin) {
                    let draftQuery = db.from('newsletter_articles').select('*').eq('slug', slug);
                    if (ROYALTY_APP_ID) draftQuery = draftQuery.eq('app_id', ROYALTY_APP_ID);
                    const { data: draft } = await draftQuery.single();
                    if (draft) post = draft;
                }
            }
        }

        if (!post) {
            showNotFound();
            return;
        }

        // Store article ID for embeds
        window.currentArticleId = post.id;

        loading.style.display = 'none';
        postContent.style.display = 'block';

        // Update page metadata
        document.title = `${post.meta_title || post.title} - Royalty Blog`;
        updateMetaTags(post);
        injectSchemaMarkup(post);

        // Render post
        renderPost(post);

        // Load related posts
        const relatedIds = post.related_article_ids || post.auto_related_ids || post.related_posts;
        if (relatedIds && relatedIds.length > 0) {
            await loadRelatedPosts(relatedIds);
        } else if (post.primary_topic || post.industry) {
            await loadRelatedByTopic(post.primary_topic || post.industry, post.id);
        }

    } catch (error) {
        console.error('Error loading post:', error);
        showNotFound();
    }
}

function updateMetaTags(post) {
    const description = post.meta_description || extractExcerpt(post.content);
    const image = post.og_image_url || 'https://royaltyapp.ai/og-default.png';
    const url = window.location.href;

    // Description
    let descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.content = description;

    // Open Graph
    const cleanUrl = `https://royaltyapp.ai/blog/${post.slug}`;
    updateOrCreateMeta('og:title', post.title);
    updateOrCreateMeta('og:description', description);
    updateOrCreateMeta('og:image', image);
    updateOrCreateMeta('og:url', cleanUrl);
    updateOrCreateMeta('og:type', 'article');

    // Twitter
    updateOrCreateMeta('twitter:card', 'summary_large_image');
    updateOrCreateMeta('twitter:title', post.title);
    updateOrCreateMeta('twitter:description', description);
    updateOrCreateMeta('twitter:image', image);

    // Canonical
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
    }
    canonical.href = post.canonical_url || `https://royaltyapp.ai/blog/${post.slug}`;

    // hreflang for translations
    if (post.translations && post.translations.length > 0) {
        post.translations.forEach(t => {
            const link = document.createElement('link');
            link.rel = 'alternate';
            link.hreflang = t.language;
            link.href = `https://royaltyapp.ai/blog/${t.slug}`;
            document.head.appendChild(link);
        });

        // x-default
        const xdefault = document.createElement('link');
        xdefault.rel = 'alternate';
        xdefault.hreflang = 'x-default';
        xdefault.href = url;
        document.head.appendChild(xdefault);
    }
}

function updateOrCreateMeta(property, content) {
    const isOg = property.startsWith('og:');
    const selector = isOg
        ? `meta[property="${property}"]`
        : `meta[name="${property}"]`;

    let meta = document.querySelector(selector);
    if (!meta) {
        meta = document.createElement('meta');
        if (isOg) {
            meta.setAttribute('property', property);
        } else {
            meta.setAttribute('name', property);
        }
        document.head.appendChild(meta);
    }
    meta.content = content;
}

function injectSchemaMarkup(post) {
    // Article schema
    const articleSchema = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        'headline': post.title,
        'description': post.meta_description || extractExcerpt(post.content),
        'image': post.og_image_url || 'https://royaltyapp.ai/og-default.png',
        'author': {
            '@type': 'Organization',
            'name': 'Royalty',
            'url': 'https://royaltyapp.ai'
        },
        'publisher': {
            '@type': 'Organization',
            'name': 'Royalty',
            'logo': {
                '@type': 'ImageObject',
                'url': 'https://royaltyapp.ai/logo.png'
            }
        },
        'datePublished': post.published_at,
        'dateModified': post.updated_at || post.published_at,
        'mainEntityOfPage': `https://royaltyapp.ai/blog/${post.slug}`,
        'inLanguage': post.language || 'en',
        'articleSection': post.primary_topic || post.industry || 'Automation',
        'keywords': (post.tags || post.seo_keywords || []).join(', ')
    };

    // Inject into page
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(articleSchema);
    document.head.appendChild(script);

    // Breadcrumb schema
    const breadcrumbSchema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': 1,
                'name': 'Blog',
                'item': 'https://royaltyapp.ai/blog/'
            },
            {
                '@type': 'ListItem',
                'position': 2,
                'name': post.primary_topic || post.industry || 'Articles',
                'item': `https://royaltyapp.ai/blog/?topic=${encodeURIComponent(post.primary_topic || post.industry || 'all')}`
            },
            {
                '@type': 'ListItem',
                'position': 3,
                'name': post.title,
                'item': `https://royaltyapp.ai/blog/${post.slug}`
            }
        ]
    };

    const breadcrumbScript = document.createElement('script');
    breadcrumbScript.type = 'application/ld+json';
    breadcrumbScript.textContent = JSON.stringify(breadcrumbSchema);
    document.head.appendChild(breadcrumbScript);
}

function renderPost(post) {
    const publishedDate = new Date(post.published_at || post.created_at).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });

    document.getElementById('post-title').textContent = post.title;
    document.getElementById('post-date').textContent = publishedDate;

    showEditButtonIfAdmin(post.slug);

    const topic = post.primary_topic || post.industry;
    if (topic) {
        document.getElementById('post-industry').textContent = topic;
        document.getElementById('post-industry').style.display = 'inline-flex';
    } else {
        document.getElementById('post-industry').style.display = 'none';
    }

    // Hero image
    const heroEl = document.getElementById('post-hero');
    const heroImg = document.getElementById('post-hero-img');
    if (heroEl && heroImg) {
        if (post.og_image_url) {
            heroImg.src = post.og_image_url;
            heroImg.alt = post.title;
            heroImg.onerror = () => { heroEl.style.display = 'none'; };
            heroEl.style.display = 'block';
        } else {
            heroEl.style.display = 'none';
        }
    }

    // Render markdown content
    let contentHtml = typeof marked !== 'undefined'
        ? marked.parse(post.content || '')
        : post.content.replace(/\n/g, '<br>');

    // Replace AI-generated author bio placeholders with Felix attribution
    const felixCard = `<div class="post-author-felix"><div class="post-author-felix-brand"><img src="/logo.svg" alt="Royalty" class="post-author-felix-logo"><strong>Written by Royalty AI</strong></div><p>This article was researched and written by Royalty's autonomous AI — built to help small businesses understand, build, and run loyalty programs that actually work.</p></div>`;
    contentHtml = contentHtml.replace(/<p>Written by \[Name\][^<]*<\/p>/gi, felixCard);

    // Parse and render embed widgets
    if (typeof parseEmbeds === 'function') {
        contentHtml = parseEmbeds(contentHtml);
    }

    const postBody = document.getElementById('post-body');
    postBody.innerHTML = contentHtml;

    injectTOC(postBody);
    buildFloatingTOC(postBody);
    injectMidCTA(postBody);

    // Render keywords/tags
    const tags = post.tags || post.seo_keywords || [];
    if (tags.length > 0) {
        document.getElementById('post-keywords').innerHTML = tags
            .map(kw => `<span class="post-card-keyword">${escapeHtml(kw)}</span>`)
            .join('');
    }

    // Render series navigation if part of series
    if (post.series_id) {
        renderSeriesNav(post);
    }
}

async function showEditButtonIfAdmin(slug) {
    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) return;
        const { data: profile } = await db
            .from('profiles')
            .select('is_admin')
            .eq('id', session.user.id)
            .single();
        if (!profile?.is_admin) return;
        const editBtn = document.getElementById('post-edit-btn');
        if (editBtn) {
            editBtn.href = `/app/blog-review.html?slug=${slug}`;
            editBtn.style.display = 'flex';
        }
    } catch (e) { /* fail silently — button stays hidden */ }
}

function buildFloatingTOC(container) {
    const tocEl = document.getElementById('post-toc');
    if (!tocEl) return;

    const headings = Array.from(container.querySelectorAll('h2, h3'));
    if (headings.length < 3) { tocEl.style.display = 'none'; return; }

    // Ensure headings have IDs (injectTOC already sets section-N on h2s)
    headings.forEach((h, i) => {
        if (!h.id) {
            h.id = 'ftoc-' + i + '-' + h.textContent.trim()
                .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }
    });

    const items = headings.map(h => {
        const indent = h.tagName === 'H3' ? ' style="padding-left:20px;font-size:0.775rem;"' : '';
        return `<a href="#${h.id}" class="toc-link" data-target="${h.id}"${indent}>${escapeHtml(h.textContent.trim())}</a>`;
    }).join('');

    tocEl.innerHTML = `<div class="toc-label">Jump to section</div>${items}`;
    tocEl.style.display = 'block';

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const link = tocEl.querySelector(`[data-target="${entry.target.id}"]`);
            if (link) link.classList.toggle('toc-active', entry.isIntersecting);
        });
    }, { rootMargin: '-10% 0px -75% 0px' });

    headings.forEach(h => observer.observe(h));
}

function injectTOC(container) {
    const headings = container.querySelectorAll('h2');
    if (headings.length < 3) return;
    headings.forEach((h, i) => { h.id = `section-${i}`; });
    const tocItems = Array.from(headings).map((h, i) =>
        `<li><a href="#section-${i}">${h.textContent}</a></li>`
    ).join('');
    const toc = document.createElement('nav');
    toc.className = 'article-toc';
    toc.innerHTML = `<p class="toc-label">In this article</p><ol>${tocItems}</ol>`;
    headings[0].before(toc);
}

function injectMidCTA(container) {
    const paras = container.querySelectorAll('p');
    if (paras.length < 4) return;
    const midIndex = Math.floor(paras.length * 0.6);
    const cta = document.createElement('div');
    cta.className = 'article-cta';
    cta.innerHTML = `
        <p class="article-cta-headline">Set up your loyalty program in 60 seconds</p>
        <p class="article-cta-sub">Join local businesses using Royalty to bring customers back — no technical skills needed.</p>
        <a href="/app/signup.html" class="btn btn-primary">Start free →</a>
    `;
    paras[midIndex].after(cta);
}

async function renderSeriesNav(post) {
    try {
        const { data: seriesArticles, error } = await db
            .from('newsletter_articles')
            .select('id, title, slug, series_order')
            .eq('series_id', post.series_id)
            .eq('status', 'published')
            .order('series_order', { ascending: true });

        if (error || !seriesArticles || seriesArticles.length < 2) return;

        const currentIndex = seriesArticles.findIndex(a => a.id === post.id);
        const prev = currentIndex > 0 ? seriesArticles[currentIndex - 1] : null;
        const next = currentIndex < seriesArticles.length - 1 ? seriesArticles[currentIndex + 1] : null;

        if (!prev && !next) return;

        const seriesNav = document.createElement('nav');
        seriesNav.className = 'series-nav';
        seriesNav.innerHTML = `
            <div class="series-nav-header">Part ${post.series_order || currentIndex + 1} of ${seriesArticles.length} in this series</div>
            <div class="series-nav-links">
                ${prev ? `<a href="/blog/${prev.slug}" class="series-nav-prev">← ${escapeHtml(prev.title)}</a>` : '<span></span>'}
                ${next ? `<a href="/blog/${next.slug}" class="series-nav-next">${escapeHtml(next.title)} →</a>` : '<span></span>'}
            </div>
        `;

        document.getElementById('post-body').after(seriesNav);
    } catch (e) {
        console.error('Error loading series nav:', e);
    }
}

async function loadRelatedPosts(relatedIds) {
    if (!relatedIds || relatedIds.length === 0) return;

    try {
        const { data: posts, error } = await db
            .from(ROYALTY_APP_ID ? 'newsletter_articles' : 'blog_posts')
            .select('*')
            .in('id', relatedIds)
            .eq('status', 'published')
            .limit(3);

        if (error || !posts || posts.length === 0) return;

        renderRelatedPosts(posts);

    } catch (error) {
        console.error('Error loading related posts:', error);
    }
}

async function loadRelatedByTopic(topic, excludeId) {
    try {
        const table = ROYALTY_APP_ID ? 'newsletter_articles' : 'blog_posts';
        const topicField = ROYALTY_APP_ID ? 'primary_topic' : 'industry';

        const { data: posts, error } = await db
            .from(table)
            .select('*')
            .eq(topicField, topic)
            .eq('status', 'published')
            .neq('id', excludeId)
            .order('published_at', { ascending: false })
            .limit(3);

        if (error || !posts || posts.length === 0) return;

        renderRelatedPosts(posts);

    } catch (error) {
        console.error('Error loading related posts:', error);
    }
}

function renderRelatedPosts(posts) {
    const relatedSection = document.getElementById('related-posts');
    const relatedGrid = document.getElementById('related-posts-grid');

    relatedSection.style.display = 'block';

    relatedGrid.innerHTML = posts.map(post => {
        const publishedDate = new Date(post.published_at || post.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });

        const topic = post.primary_topic || post.industry;

        return `
            <a href="/blog/${post.slug}" class="post-card">
                <div class="post-card-content" style="padding: 20px;">
                    <div class="post-card-meta">
                        ${topic ? `<span class="post-card-industry">${escapeHtml(topic)}</span>` : ''}
                        <span class="post-card-date">${publishedDate}</span>
                    </div>
                    <h3 class="post-card-title" style="font-size: 1rem;">${escapeHtml(post.title)}</h3>
                </div>
            </a>
        `;
    }).join('');
}

function showNotFound() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('not-found').style.display = 'block';
}

// ===== Utility Functions =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getCurrentLanguage() {
    // Check for i18n library
    if (window.i18n && typeof window.i18n.getCurrentLanguage === 'function') {
        return window.i18n.getCurrentLanguage();
    }
    // Fallback to URL param or localStorage or default
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('lang') || localStorage.getItem('language') || 'en';
}
