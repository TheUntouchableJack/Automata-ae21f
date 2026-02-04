// ===== Content Generator Page =====
// AI-powered blog content generation with quality control
// Accessed via: /app/content-generator.html?app_id=xxx

let currentUser = null;
let currentOrganization = null;
let newsletterApp = null;
let contentStrategy = null;
let selectedTopic = null;
let currentArticle = null;

// Get app_id from URL - REQUIRED
function getAppIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('app_id');
}

// Sample content queue (will be populated from content_strategies)
const defaultTopics = [
    {
        id: 'getting-started-automation',
        title: 'Getting Started with Customer Automation',
        topic: 'getting-started',
        status: 'ready',
        description: 'A beginner-friendly guide to automating customer relationships'
    },
    {
        id: 'loyalty-programs-101',
        title: 'Why Loyalty Programs Work (And How to Build One)',
        topic: 'customer-engagement',
        status: 'ready',
        description: 'The psychology behind loyalty and practical implementation tips'
    },
    {
        id: 'email-sequences-that-convert',
        title: 'Email Sequences That Actually Get Opened',
        topic: 'automation',
        status: 'ready',
        description: 'Crafting follow-up emails people want to read'
    },
    {
        id: 'restaurant-automation-playbook',
        title: 'The Restaurant Automation Playbook',
        topic: 'industry-playbooks',
        status: 'ready',
        description: 'Complete guide for food service businesses'
    },
    {
        id: 'ai-customer-insights',
        title: 'How AI Finds Opportunities You Miss',
        topic: 'ai-insights',
        status: 'ready',
        description: 'Using artificial intelligence to spot growth opportunities'
    }
];

let topicQueue = [...defaultTopics];

async function initContentGenerator() {
    // Check for required app_id parameter
    const appId = getAppIdFromUrl();
    if (!appId) {
        // Redirect to apps page if no app_id
        window.location.href = '/app/apps.html';
        return;
    }

    // Require authentication
    currentUser = await requireAuth();
    if (!currentUser) return;

    // Load user info and organization
    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(currentUser.id, currentUser.email),
        AppUtils.loadOrganization(supabase, currentUser.id)
    ]);

    currentOrganization = orgData.organization;

    // Initialize sidebar
    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    // Load the specific newsletter app
    await loadNewsletterApp(appId);

    // Load content strategy
    await loadContentStrategy();

    // Render topic queue
    renderTopicQueue();

    // Setup event listeners
    setupEventListeners();
}

async function loadNewsletterApp(appId) {
    if (!currentOrganization || !appId) {
        showError('App not found');
        window.location.href = '/app/apps.html';
        return;
    }

    try {
        const { data: app, error } = await supabase
            .from('customer_apps')
            .select('*')
            .eq('id', appId)
            .eq('organization_id', currentOrganization.id)
            .single();

        if (error || !app) {
            showError('App not found or access denied');
            window.location.href = '/app/apps.html';
            return;
        }

        if (app.app_type !== 'newsletter') {
            showError('This app does not support content generation');
            window.location.href = '/app/apps.html';
            return;
        }

        newsletterApp = app;

        // Update page header with app name
        const pageTitle = document.querySelector('.page-title');
        if (pageTitle) {
            pageTitle.textContent = `${app.name} - Content`;
        }
    } catch (e) {
        console.error('Failed to load app:', e);
        showError('Failed to load app');
        window.location.href = '/app/apps.html';
    }
}

function showError(message) {
    // Simple error display
    console.error(message);
    if (typeof showToast === 'function') {
        showToast('error', 'Error', message);
    }
}

async function loadContentStrategy() {
    if (!newsletterApp) return;

    try {
        const { data: strategy } = await supabase
            .from('content_strategies')
            .select('*')
            .eq('app_id', newsletterApp.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (strategy && strategy.topic_calendar) {
            // Merge strategy topics with queue
            const strategyTopics = strategy.topic_calendar.map(t => ({
                id: t.slug || generateSlug(t.title),
                title: t.title,
                topic: t.pillar || 'general',
                status: 'ready',
                description: t.angle || t.description
            }));

            // Add strategy topics to front of queue
            topicQueue = [...strategyTopics, ...topicQueue];
        }

        contentStrategy = strategy;
    } catch (e) {
        console.log('No content strategy found');
    }
}

function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 60);
}

function renderTopicQueue() {
    const list = document.getElementById('topic-list');
    if (!list) return;

    list.innerHTML = topicQueue.map((topic, index) => `
        <div class="topic-item ${topic.id === selectedTopic?.id ? 'selected' : ''} ${topic.status === 'generating' ? 'generating' : ''}"
             data-topic-id="${escapeHtml(topic.id)}"
             data-index="${index}">
            <div class="topic-item-info">
                <div class="topic-item-title">${escapeHtml(topic.title)}</div>
                <div class="topic-item-topic">${escapeHtml(topic.topic)}</div>
            </div>
            <span class="topic-item-status ${topic.status}">${getStatusLabel(topic.status)}</span>
        </div>
    `).join('');

    // Add click handlers
    list.querySelectorAll('.topic-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            selectTopic(topicQueue[index]);
        });
    });
}

function getStatusLabel(status) {
    const labels = {
        ready: 'Ready',
        generating: 'Generating...',
        draft: 'Draft',
        published: 'Published'
    };
    return labels[status] || status;
}

function selectTopic(topic) {
    selectedTopic = topic;

    // Update UI
    document.querySelectorAll('.topic-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.topicId === topic.id);
    });

    // Update generate button
    const btn = document.getElementById('generate-btn');
    const btnText = document.getElementById('generate-btn-text');

    if (topic.status === 'draft') {
        btnText.textContent = 'View Draft';
        btn.disabled = false;
    } else if (topic.status === 'published') {
        btnText.textContent = 'View Article';
        btn.disabled = false;
    } else if (topic.status === 'generating') {
        btnText.textContent = 'Generating...';
        btn.disabled = true;
    } else {
        btnText.textContent = 'Generate Article';
        btn.disabled = false;
    }
}

function setupEventListeners() {
    // Generate button
    document.getElementById('generate-btn')?.addEventListener('click', () => {
        if (selectedTopic) {
            if (selectedTopic.status === 'draft' || selectedTopic.status === 'published') {
                // Load existing article
                loadArticle(selectedTopic);
            } else {
                generateArticle(selectedTopic);
            }
        }
    });

    // Tab switching
    document.querySelectorAll('.preview-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });

    // Custom topic
    document.getElementById('add-custom-topic')?.addEventListener('click', addCustomTopic);
    document.getElementById('custom-topic')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addCustomTopic();
    });

    // Save draft
    document.getElementById('save-draft-btn')?.addEventListener('click', saveDraft);

    // Publish
    document.getElementById('publish-btn')?.addEventListener('click', publishArticle);

    // Editor changes update preview
    document.getElementById('edit-title')?.addEventListener('input', updatePreviewFromEditor);
    document.getElementById('edit-excerpt')?.addEventListener('input', updatePreviewFromEditor);
    document.getElementById('edit-content')?.addEventListener('input', updatePreviewFromEditor);

    // SEO field changes
    document.getElementById('seo-meta-title')?.addEventListener('input', updateSeoPreview);
    document.getElementById('seo-meta-desc')?.addEventListener('input', updateSeoPreview);
    document.getElementById('seo-slug')?.addEventListener('input', updateSeoPreview);
}

function addCustomTopic() {
    const input = document.getElementById('custom-topic');
    const title = input.value.trim();

    if (!title) return;

    const newTopic = {
        id: generateSlug(title),
        title: title,
        topic: 'custom',
        status: 'ready',
        description: 'Custom topic'
    };

    topicQueue.unshift(newTopic);
    input.value = '';

    renderTopicQueue();
    selectTopic(newTopic);
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.preview-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update content visibility
    document.getElementById('preview-content').style.display = tabName === 'preview' ? 'block' : 'none';
    document.getElementById('editor-content').style.display = tabName === 'editor' ? 'block' : 'none';
    document.getElementById('seo-content').style.display = tabName === 'seo' ? 'block' : 'none';
}

async function generateArticle(topic) {
    // Check plan limits before generating (client-side check, server also enforces)
    if (typeof checkLimit === 'function' && typeof getOrgLimits === 'function') {
        const limits = getOrgLimits(currentOrganization);
        const usage = await getArticleUsageThisMonth();

        const limitCheck = checkLimit(currentOrganization, { articles_monthly: usage }, 'articles_monthly');

        if (!limitCheck.allowed) {
            showToast('error', 'Limit Reached', limitCheck.message);

            // Show upgrade options if available
            if (typeof getUpgradeOptions === 'function') {
                const options = getUpgradeOptions(currentOrganization);
                if (options.length > 0) {
                    showUpgradePrompt(options);
                }
            }
            return;
        }

        // Show warning if approaching limit
        if (limitCheck.warning) {
            showToast('warning', 'Approaching Limit', limitCheck.message);
        }
    }

    // Show generating modal
    const modal = document.getElementById('generate-modal');
    modal.classList.add('active');

    // Update topic status
    topic.status = 'generating';
    renderTopicQueue();

    try {
        // Step 1: Gathering context
        updateGenerationStep('step-research', 'active', 'Gathering business context...');

        // Get content context from the app settings
        const contentContext = await getContentContext();

        await markStepComplete('step-research');

        // Step 2: Preparing outline
        updateGenerationStep('step-outline', 'active', 'Preparing content strategy...');
        await sleep(500); // Brief pause for UX
        await markStepComplete('step-outline');

        // Step 3: Call Claude API via Edge Function
        updateGenerationStep('step-write', 'active', 'Writing with Claude AI...');

        const response = await callGenerateArticleAPI(topic, contentContext);

        if (!response.success) {
            throw new Error(response.error || 'Failed to generate article');
        }

        await markStepComplete('step-write');

        // Step 4: Quality check was done server-side, show result
        updateGenerationStep('step-quality', 'active', 'Quality check complete...');
        await sleep(300);
        await markStepComplete('step-quality');

        // Step 5: SEO optimization was done server-side
        updateGenerationStep('step-seo', 'active', 'SEO optimized...');
        await sleep(300);
        await markStepComplete('step-seo');

        // Set the article from API response
        currentArticle = response.article;
        currentArticle.status = 'draft';

        // Update topic status
        topic.status = 'draft';
        renderTopicQueue();

        // Hide modal and show article
        modal.classList.remove('active');
        resetGenerationSteps();

        // Display the article
        displayArticle(currentArticle);

        // Show success message with quality score
        const score = currentArticle.quality_score?.total || 0;
        showToast('success', 'Article Generated!', `Quality score: ${score}/10`);

    } catch (error) {
        console.error('Generation error:', error);
        modal.classList.remove('active');
        resetGenerationSteps();
        topic.status = 'ready';
        renderTopicQueue();

        // Handle rate limit exceeded specifically
        if (error.limitExceeded) {
            showToast('error', 'Limit Reached', error.message);
            if (typeof getUpgradeOptions === 'function') {
                const options = getUpgradeOptions(currentOrganization);
                if (options.length > 0) {
                    setTimeout(() => showUpgradePrompt(options), 500);
                }
            }
        } else {
            showToast('error', 'Generation Failed', error.message || 'Please try again.');
        }
    }
}

// Get content context from newsletter app settings
async function getContentContext() {
    if (!newsletterApp) return {};

    const settings = newsletterApp.settings || {};
    const newsletterSettings = settings.newsletter || {};
    const contentContext = newsletterSettings.content_context || {};

    return {
        business_name: newsletterApp.name || currentOrganization?.name || 'Our Business',
        story: contentContext.story || {},
        audience: contentContext.audience || {},
        voice: contentContext.voice || {
            personality: 'friendly and professional',
            tone: 'warm, practical, no jargon',
            avoid: ['synergy', 'leverage', 'disrupt']
        }
    };
}

// Call the Edge Function to generate article
async function callGenerateArticleAPI(topic, context) {
    const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
    const SUPABASE_ANON_KEY = supabase.supabaseKey || localStorage.getItem('supabase.auth.token');

    // Get the session for auth
    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-article`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
            topic: {
                id: topic.id,
                title: topic.title,
                description: topic.description,
                topic: topic.topic
            },
            context: context,
            app_id: newsletterApp?.id,
            organization_id: currentOrganization?.id
        })
    });

    const data = await response.json();

    // Handle rate limit exceeded (429)
    if (response.status === 429 || data.limit_exceeded) {
        const error = new Error(data.message || 'Article limit reached');
        error.limitExceeded = true;
        error.current = data.current;
        error.limit = data.limit;
        throw error;
    }

    if (!response.ok) {
        throw new Error(data.error || `API error: ${response.status}`);
    }

    return data;
}

// Helper to update generation step UI
function updateGenerationStep(stepId, state, message) {
    const step = document.getElementById(stepId);
    if (!step) return;

    const icon = step.querySelector('.generate-step-icon');
    const text = step.querySelector('.generate-step-text');

    if (state === 'active') {
        icon.className = 'generate-step-icon active';
        text.className = 'generate-step-text active';
    }

    if (message) {
        document.getElementById('generate-status').textContent = message;
    }
}

// Helper to mark step complete
async function markStepComplete(stepId) {
    const step = document.getElementById(stepId);
    if (!step) return;

    const icon = step.querySelector('.generate-step-icon');
    icon.className = 'generate-step-icon completed';
    icon.textContent = '✓';

    await sleep(200);
}

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Get article usage count for this month
async function getArticleUsageThisMonth() {
    if (!newsletterApp) return 0;

    try {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { count } = await supabase
            .from('content_generation_log')
            .select('*', { count: 'exact', head: true })
            .eq('app_id', newsletterApp.id)
            .gte('generation_completed_at', startOfMonth.toISOString());

        return count || 0;
    } catch (e) {
        console.error('Failed to get article usage:', e);
        return 0;
    }
}

// Show upgrade prompt when limit is reached
function showUpgradePrompt(options) {
    // Simple prompt - in a real app this would be a modal
    const firstOption = options[0];
    if (firstOption && confirm(`${firstOption.description}\n\nWould you like to upgrade?`)) {
        if (firstOption.action === 'upgrade') {
            window.location.href = '/app/settings.html#billing';
        } else if (firstOption.action === 'redeem') {
            window.location.href = '/app/settings.html#redeem';
        }
    }
}

// simulateGenerationStep removed - now using real Claude API

function resetGenerationSteps() {
    const steps = ['step-research', 'step-outline', 'step-write', 'step-quality', 'step-seo'];
    steps.forEach((stepId, index) => {
        const step = document.getElementById(stepId);
        const icon = step.querySelector('.generate-step-icon');
        const text = step.querySelector('.generate-step-text');

        icon.className = 'generate-step-icon pending';
        icon.textContent = (index + 1).toString();
        text.className = 'generate-step-text pending';
    });

    document.getElementById('generate-status').textContent = 'Writing your article...';
}

function generateSampleArticle(topic) {
    // FALLBACK: Only used if API fails
    // Real generation happens via Edge Function

    const titles = {
        'getting-started-automation': 'Getting Started with Customer Automation: A Practical Guide',
        'loyalty-programs-101': 'Why Loyalty Programs Work (And How to Build One That Actually Does)',
        'email-sequences-that-convert': '7 Email Sequences That Get Opened, Read, and Clicked',
        'restaurant-automation-playbook': 'The Restaurant Automation Playbook: From First Visit to Regular',
        'ai-customer-insights': 'How AI Spots the Growth Opportunities You Keep Missing'
    };

    const content = `
When Sarah opened her coffee shop, she had a notebook. Every regular got a handwritten thank-you note. Every birthday got a free pastry. It worked beautifully—until she had 200 regulars and couldn't remember their names.

That notebook system? It doesn't scale. But the *feeling* it created—being recognized, appreciated, remembered—that's what customers actually want.

This is what automation does right: it lets you give every customer the notebook treatment, even when you have thousands of them.

## The Problem Isn't More Marketing

Most business owners think they need more marketing. More ads. More social posts. More emails. But the businesses that grow fastest usually do something different: they focus on the customers they already have.

Here's a stat that should change how you think about growth: **acquiring a new customer costs 5-7x more than keeping an existing one.** Yet most businesses spend 80% of their energy chasing new customers and 20% on retention.

Flip that ratio, and interesting things happen.

## What Automation Actually Means

Let's be clear about what we're NOT talking about:

- Spammy blast emails
- Robotic-sounding messages
- Creepy "we noticed you looked at this" tracking

What we ARE talking about:

- Remembering birthdays without a spreadsheet
- Following up after purchases without forgetting
- Recognizing your best customers and treating them accordingly

**The goal isn't to sound automated. It's to be so personal that people can't believe you have time for it.**

## Three Automations Every Business Should Run

### 1. The Welcome Sequence

When someone becomes a customer, don't just say "thanks for your order." Tell them:
- What makes you different
- What to expect next
- How to get the most value

This isn't about you—it's about reducing their buyer's remorse and setting expectations.

### 2. The Check-In

After a purchase, a simple "How's everything going?" message does two things:
- Catches problems before they become complaints
- Creates opportunities for reviews and referrals

Timing matters. For a restaurant, that's 24 hours. For a service business, maybe a week. For a product, after they've had time to use it.

### 3. The Loyalty Recognition

When someone crosses a milestone—fifth visit, $500 spent, one-year anniversary—acknowledge it. Not with a generic coupon, but with genuine recognition.

"You've been coming here for a year now. That means something to us. Here's something for you."

## Getting Started (Without Overwhelm)

The biggest mistake is trying to do everything at once. Start with ONE automation:

1. Pick the moment that matters most (first purchase, return visit, complaint resolved)
2. Write what you'd say if you had infinite time
3. Set it up to send automatically
4. Watch what happens

Most businesses see results within the first week. Not because automation is magic, but because *consistent, thoughtful follow-up* is rare enough to be remarkable.

## What This Looks Like in Practice

Let's say you run a fitness studio. Here's a simple automation sequence:

**Day 1 after first class:** "How was your first class? Any questions I can answer?"

**Day 3:** "Here's a quick tip most new members don't know..." (something genuinely useful)

**Day 7:** If they haven't returned: "We noticed you haven't been back—everything okay?" (with an easy way to reschedule)

**Day 7:** If they HAVE returned: "You're off to a great start. Here's what happens when you stick with it for 30 days."

This sequence takes 30 minutes to set up. But it runs forever, making every new member feel seen.

## The Bottom Line

Automation isn't about doing less work. It's about making your work count for more people.

Sarah eventually got an automated system for her coffee shop. She still writes handwritten notes—but only for the moments that truly matter. The everyday check-ins happen automatically. And her customers? They still feel like they're getting the notebook treatment.

That's the goal: technology that makes you *more* human, not less.

---

[royalty:cta text="See Automation in Action" href="/signup" style="primary"]
`;

    const qualityScore = {
        total: 8.4,
        specificity: 9,
        voice: 8,
        value: 9,
        hook: 8,
        human: 8
    };

    return {
        id: null, // Will be assigned on save
        title: titles[topic.id] || topic.title,
        slug: topic.id,
        excerpt: topic.description || 'Learn how to implement automation that feels personal.',
        content: content.trim(),
        primary_topic: topic.topic,
        tags: ['automation', 'customer-engagement', 'getting-started'],
        meta_title: (titles[topic.id] || topic.title).substring(0, 60),
        meta_description: (topic.description || 'Learn how to implement automation that feels personal.').substring(0, 160),
        quality_score: qualityScore,
        status: 'draft'
    };
}

function displayArticle(article) {
    // Show preview content, hide empty state
    document.getElementById('preview-empty').style.display = 'none';
    document.getElementById('preview-content').style.display = 'block';
    document.getElementById('preview-actions').style.display = 'flex';

    // Display quality scores
    const score = article.quality_score;
    document.getElementById('total-score').textContent = score.total.toFixed(1);
    document.getElementById('score-specificity').textContent = score.specificity;
    document.getElementById('score-voice').textContent = score.voice;
    document.getElementById('score-value').textContent = score.value;
    document.getElementById('score-hook').textContent = score.hook;
    document.getElementById('score-human').textContent = score.human;

    // Update score badge color
    const scoreBadge = document.getElementById('total-score');
    scoreBadge.className = 'quality-score-badge';
    if (score.total >= 8) scoreBadge.classList.add('excellent');
    else if (score.total >= 7) scoreBadge.classList.add('good');
    else scoreBadge.classList.add('needs-work');

    // Display article preview
    document.getElementById('article-topic').textContent = article.primary_topic;
    document.getElementById('article-title').textContent = article.title;
    document.getElementById('article-excerpt').textContent = article.excerpt;

    // Parse and render markdown content with embeds
    let htmlContent = marked.parse(article.content);
    if (typeof parseEmbeds === 'function') {
        htmlContent = parseEmbeds(htmlContent);
    }
    document.getElementById('article-content').innerHTML = htmlContent;

    // Populate editor
    document.getElementById('edit-title').value = article.title;
    document.getElementById('edit-excerpt').value = article.excerpt;
    document.getElementById('edit-content').value = article.content;

    // Populate SEO
    document.getElementById('seo-meta-title').value = article.meta_title;
    document.getElementById('seo-meta-desc').value = article.meta_description;
    document.getElementById('seo-slug').value = article.slug;
    document.getElementById('seo-tags').value = article.tags.join(', ');
    updateSeoPreview();
}

function updatePreviewFromEditor() {
    if (!currentArticle) return;

    currentArticle.title = document.getElementById('edit-title').value;
    currentArticle.excerpt = document.getElementById('edit-excerpt').value;
    currentArticle.content = document.getElementById('edit-content').value;

    // Update preview
    document.getElementById('article-title').textContent = currentArticle.title;
    document.getElementById('article-excerpt').textContent = currentArticle.excerpt;

    let htmlContent = marked.parse(currentArticle.content);
    if (typeof parseEmbeds === 'function') {
        htmlContent = parseEmbeds(htmlContent);
    }
    document.getElementById('article-content').innerHTML = htmlContent;
}

function updateSeoPreview() {
    const title = document.getElementById('seo-meta-title').value;
    const desc = document.getElementById('seo-meta-desc').value;
    const slug = document.getElementById('seo-slug').value;

    document.getElementById('seo-title').textContent = title || 'Article Title';
    document.getElementById('seo-desc').textContent = desc || 'Article description will appear here...';
    document.getElementById('seo-url').textContent = `royaltyapp.ai/blog/${slug || 'article-slug'}`;

    // Update article object
    if (currentArticle) {
        currentArticle.meta_title = title;
        currentArticle.meta_description = desc;
        currentArticle.slug = slug;
        currentArticle.tags = document.getElementById('seo-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    }
}

async function saveDraft() {
    if (!currentArticle || !newsletterApp) {
        showToast('error', 'Cannot save draft', 'No newsletter app configured');
        return;
    }

    const btn = document.getElementById('save-draft-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const articleData = {
            app_id: newsletterApp.id,
            title: currentArticle.title,
            slug: currentArticle.slug,
            excerpt: currentArticle.excerpt,
            content: currentArticle.content,
            meta_title: currentArticle.meta_title,
            meta_description: currentArticle.meta_description,
            primary_topic: currentArticle.primary_topic,
            tags: currentArticle.tags,
            status: 'draft',
            language: 'en'
        };

        if (currentArticle.id) {
            // Update existing
            const { error } = await supabase
                .from('newsletter_articles')
                .update(articleData)
                .eq('id', currentArticle.id);

            if (error) throw error;
        } else {
            // Create new
            const { data, error } = await supabase
                .from('newsletter_articles')
                .insert(articleData)
                .select()
                .single();

            if (error) throw error;
            currentArticle.id = data.id;
        }

        showToast('success', 'Draft saved', 'Your article has been saved');
    } catch (error) {
        console.error('Save error:', error);
        showToast('error', 'Save failed', error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Draft';
    }
}

async function publishArticle() {
    if (!currentArticle) return;

    // Save first if needed
    if (!currentArticle.id && newsletterApp) {
        await saveDraft();
    }

    const btn = document.getElementById('publish-btn');
    btn.disabled = true;
    btn.textContent = 'Publishing...';

    try {
        if (currentArticle.id && newsletterApp) {
            const { error } = await supabase
                .from('newsletter_articles')
                .update({
                    status: 'published',
                    published_at: new Date().toISOString()
                })
                .eq('id', currentArticle.id);

            if (error) throw error;
        }

        // Update topic status
        if (selectedTopic) {
            selectedTopic.status = 'published';
            renderTopicQueue();
        }

        currentArticle.status = 'published';

        showToast('success', 'Article published!', 'Your article is now live on the blog');

        // Celebrate!
        if (typeof celebrate === 'function') {
            celebrate();
        }

    } catch (error) {
        console.error('Publish error:', error);
        showToast('error', 'Publish failed', error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Published!';
    }
}

async function loadArticle(topic) {
    // In production, this would load the article from the database
    // For now, show a placeholder
    if (topic.article) {
        currentArticle = topic.article;
        displayArticle(currentArticle);
    } else {
        showToast('info', 'Loading...', 'Article data not available');
    }
}

// Toast helper (use utils.js if available)
function showToast(type, title, message) {
    if (typeof AppUtils !== 'undefined' && AppUtils.showToast) {
        AppUtils.showToast(type, title, message);
    } else {
        console.log(`[${type}] ${title}: ${message}`);
    }
}

// Escape HTML helper
function escapeHtml(text) {
    // Use AppUtils if available (preferred), otherwise fallback to DOM method
    if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
        return AppUtils.escapeHtml(text);
    }
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initContentGenerator);
