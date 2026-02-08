// ===== Knowledge Base Manager Page =====
let currentUser = null;
let currentOrganization = null;
let customerApps = [];
let articles = [];
let selectedAppId = null;
let currentFilter = 'all';
let editingArticleId = null;
let deletingArticleId = null;
let searchTimeout = null;

async function initKnowledgebase() {
    currentUser = await requireAuth();
    if (!currentUser) return;

    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(currentUser.id, currentUser.email),
        AppUtils.loadOrganization(supabase, currentUser.id)
    ]);

    currentOrganization = orgData.organization;

    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    await loadCustomerApps();
    setupEventListeners();
}

// ===== Load Customer Apps =====
async function loadCustomerApps() {
    if (!currentOrganization) return;

    try {
        const { data, error } = await supabase
            .from('customer_apps')
            .select('id, name, slug')
            .eq('organization_id', currentOrganization.id)
            .eq('is_active', true)
            .order('name');

        if (error) throw error;
        customerApps = data || [];

        const appSelect = document.getElementById('app-select');
        appSelect.innerHTML = '<option value="">Select an app...</option>' +
            customerApps.map(app => `<option value="${app.id}">${app.name}</option>`).join('');

        // Auto-select if only one app
        if (customerApps.length === 1) {
            appSelect.value = customerApps[0].id;
            selectedAppId = customerApps[0].id;
            await loadArticles();
        }
    } catch (error) {
        console.error('Error loading apps:', error);
        AppUtils.showToast('Error loading apps', 'error');
    }
}

// ===== Load Articles =====
async function loadArticles() {
    if (!selectedAppId) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('articles-grid').style.display = 'none';
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('no-app-state').style.display = 'block';
        return;
    }

    document.getElementById('no-app-state').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('articles-grid').style.display = 'none';
    document.getElementById('empty-state').style.display = 'none';

    try {
        const search = document.getElementById('search-input').value.trim().toLowerCase();

        let query = supabase
            .from('knowledgebase_articles')
            .select('*')
            .eq('app_id', selectedAppId)
            .order('display_order')
            .order('created_at', { ascending: false });

        if (currentFilter === 'published') {
            query = query.eq('is_published', true);
        } else if (currentFilter === 'draft') {
            query = query.eq('is_published', false);
        }

        const { data, error } = await query;
        if (error) throw error;

        articles = data || [];

        // Client-side search
        if (search) {
            articles = articles.filter(a =>
                a.title.toLowerCase().includes(search) ||
                (a.excerpt || '').toLowerCase().includes(search) ||
                (a.content || '').toLowerCase().includes(search)
            );
        }

        document.getElementById('loading').style.display = 'none';

        if (articles.length === 0) {
            document.getElementById('empty-state').style.display = 'block';
            document.getElementById('empty-title').textContent =
                search ? 'No articles found' : 'No articles yet';
            document.getElementById('empty-desc').textContent =
                search ? 'Try a different search term.' : 'Create your first knowledge base article to help customers.';
            return;
        }

        document.getElementById('articles-grid').style.display = 'grid';
        renderArticles();

    } catch (error) {
        console.error('Error loading articles:', error);
        document.getElementById('loading').innerHTML = '<p style="color: var(--color-error);">Error loading articles</p>';
    }
}

// ===== Render Articles =====
function renderArticles() {
    const grid = document.getElementById('articles-grid');

    grid.innerHTML = articles.map(article => `
        <div class="article-card ${article.is_published ? '' : 'draft'}" data-article-id="${article.id}">
            <div class="article-card-header">
                <div class="article-badges">
                    ${article.is_published
                        ? '<span class="article-badge published">Published</span>'
                        : '<span class="article-badge draft">Draft</span>'}
                    ${article.is_featured ? '<span class="article-badge featured">Featured</span>' : ''}
                    <span class="article-badge category">${formatCategory(article.category)}</span>
                </div>
                <div class="article-card-actions">
                    <button class="btn-icon" onclick="editArticle('${article.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M12 1.5L14.5 4L5.5 13H3V10.5L12 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="btn-icon danger" onclick="confirmDeleteArticle('${article.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M2 4H14M6 4V2H10V4M5 4V14H11V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
            <h3 class="article-title">${escapeHtml(article.title)}</h3>
            <p class="article-excerpt">${escapeHtml(article.excerpt || truncate(article.content, 120))}</p>
            <div class="article-card-footer">
                <div class="article-stats">
                    <span class="article-stat" title="Views">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M7 3C4 3 1.5 7 1.5 7C1.5 7 4 11 7 11C10 11 12.5 7 12.5 7C12.5 7 10 3 7 3Z" stroke="currentColor" stroke-width="1.5"/>
                            <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                        ${article.view_count}
                    </span>
                    <span class="article-stat helpful" title="Helpful">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M4 7L6 9L10 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        ${article.helpful_count}
                    </span>
                </div>
                <span class="article-date">${formatDate(article.created_at)}</span>
            </div>
        </div>
    `).join('');
}

// ===== Open Add Modal =====
function openAddModal() {
    if (!selectedAppId) {
        AppUtils.showToast('Please select an app first', 'error');
        return;
    }

    editingArticleId = null;
    document.getElementById('modal-title').textContent = 'New Article';
    document.getElementById('modal-submit').textContent = 'Create Article';
    document.getElementById('article-form').reset();
    document.getElementById('article-modal').classList.add('active');
    document.getElementById('article-title').focus();
}

// ===== Edit Article =====
function editArticle(articleId) {
    const article = articles.find(a => a.id === articleId);
    if (!article) return;

    editingArticleId = articleId;
    document.getElementById('modal-title').textContent = 'Edit Article';
    document.getElementById('modal-submit').textContent = 'Save Changes';

    document.getElementById('article-title').value = article.title;
    document.getElementById('article-excerpt').value = article.excerpt || '';
    document.getElementById('article-content').value = article.content;
    document.getElementById('article-category').value = article.category;
    document.getElementById('article-slug').value = article.slug;
    document.getElementById('article-order').value = article.display_order;
    document.getElementById('article-published').checked = article.is_published;
    document.getElementById('article-featured').checked = article.is_featured;
    document.getElementById('article-meta-title').value = article.meta_title || '';
    document.getElementById('article-meta-desc').value = article.meta_description || '';

    document.getElementById('article-modal').classList.add('active');
    document.getElementById('article-title').focus();
}

// ===== Close Modal =====
function closeModal() {
    document.getElementById('article-modal').classList.remove('active');
    editingArticleId = null;
}

// ===== Generate Slug =====
function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 100);
}

// ===== Save Article =====
async function saveArticle(e) {
    e.preventDefault();

    const title = document.getElementById('article-title').value.trim();
    const excerpt = document.getElementById('article-excerpt').value.trim();
    const content = document.getElementById('article-content').value.trim();
    const category = document.getElementById('article-category').value;
    let slug = document.getElementById('article-slug').value.trim();
    const displayOrder = parseInt(document.getElementById('article-order').value) || 0;
    const isPublished = document.getElementById('article-published').checked;
    const isFeatured = document.getElementById('article-featured').checked;
    const metaTitle = document.getElementById('article-meta-title').value.trim();
    const metaDesc = document.getElementById('article-meta-desc').value.trim();

    if (!title || !content) {
        AppUtils.showToast('Please fill in title and content', 'error');
        return;
    }

    // Auto-generate slug if empty
    if (!slug) {
        slug = generateSlug(title);
    }

    const submitBtn = document.getElementById('modal-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner" style="width: 16px; height: 16px;"></span>';

    try {
        const articleData = {
            title,
            excerpt: excerpt || null,
            content,
            category,
            slug,
            display_order: displayOrder,
            is_published: isPublished,
            is_featured: isFeatured,
            meta_title: metaTitle || null,
            meta_description: metaDesc || null,
            updated_at: new Date().toISOString(),
            updated_by: currentUser.id
        };

        if (isPublished && !editingArticleId) {
            articleData.published_at = new Date().toISOString();
        }

        if (editingArticleId) {
            // Update existing article
            const { error } = await supabase
                .from('knowledgebase_articles')
                .update(articleData)
                .eq('id', editingArticleId);

            if (error) throw error;
            AppUtils.showToast('Article updated', 'success');
        } else {
            // Create new article
            articleData.app_id = selectedAppId;
            articleData.organization_id = currentOrganization.id;
            articleData.created_by = currentUser.id;

            const { error } = await supabase
                .from('knowledgebase_articles')
                .insert(articleData);

            if (error) {
                if (error.code === '23505') {
                    AppUtils.showToast('An article with this slug already exists', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Create Article';
                    return;
                }
                throw error;
            }
            AppUtils.showToast('Article created', 'success');
        }

        closeModal();
        await loadArticles();

    } catch (error) {
        console.error('Error saving article:', error);
        AppUtils.showToast('Error saving article', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editingArticleId ? 'Save Changes' : 'Create Article';
    }
}

// ===== Confirm Delete =====
function confirmDeleteArticle(articleId) {
    deletingArticleId = articleId;
    document.getElementById('delete-modal').classList.add('active');
}

// ===== Delete Article =====
async function deleteArticle() {
    if (!deletingArticleId) return;

    const confirmBtn = document.getElementById('delete-confirm');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="loading-spinner" style="width: 16px; height: 16px;"></span>';

    try {
        const { error } = await supabase
            .from('knowledgebase_articles')
            .delete()
            .eq('id', deletingArticleId);

        if (error) throw error;

        AppUtils.showToast('Article deleted', 'success');
        document.getElementById('delete-modal').classList.remove('active');
        deletingArticleId = null;
        await loadArticles();

    } catch (error) {
        console.error('Error deleting article:', error);
        AppUtils.showToast('Error deleting article', 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete';
    }
}

// ===== Setup Event Listeners =====
function setupEventListeners() {
    // App selector
    document.getElementById('app-select').addEventListener('change', async (e) => {
        selectedAppId = e.target.value || null;
        currentFilter = 'all';
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.filter-tab[data-filter="all"]').classList.add('active');
        await loadArticles();
    });

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', async () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            await loadArticles();
        });
    });

    // Search with debounce
    document.getElementById('search-input').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(loadArticles, 300);
    });

    // Add buttons
    document.getElementById('add-article-btn').addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn').addEventListener('click', openAddModal);

    // Modal controls
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('article-form').addEventListener('submit', saveArticle);

    // Auto-generate slug from title
    document.getElementById('article-title').addEventListener('blur', () => {
        const slugInput = document.getElementById('article-slug');
        if (!slugInput.value && !editingArticleId) {
            slugInput.value = generateSlug(document.getElementById('article-title').value);
        }
    });

    // Delete modal
    document.getElementById('delete-cancel').addEventListener('click', () => {
        document.getElementById('delete-modal').classList.remove('active');
        deletingArticleId = null;
    });
    document.getElementById('delete-confirm').addEventListener('click', deleteArticle);

    // Modal overlay clicks
    document.getElementById('article-modal').addEventListener('click', (e) => {
        if (e.target.id === 'article-modal') closeModal();
    });
    document.getElementById('delete-modal').addEventListener('click', (e) => {
        if (e.target.id === 'delete-modal') {
            document.getElementById('delete-modal').classList.remove('active');
            deletingArticleId = null;
        }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.getElementById('delete-modal').classList.remove('active');
            deletingArticleId = null;
        }
    });
}

// ===== Helpers =====
// Use centralized escapeHtml from AppUtils
const escapeHtml = AppUtils.escapeHtml;

function truncate(str, length) {
    if (!str) return '';
    // Strip markdown for preview
    const plain = str.replace(/[#*_`\[\]]/g, '').replace(/\n+/g, ' ');
    return plain.length > length ? plain.substring(0, length) + '...' : plain;
}

function formatCategory(category) {
    const categories = {
        'getting_started': 'Getting Started',
        'rewards': 'Rewards',
        'points': 'Points',
        'account': 'Account',
        'troubleshooting': 'Troubleshooting'
    };
    return categories[category] || category;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', initKnowledgebase);
