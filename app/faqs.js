// ===== FAQ Manager Page =====
let currentUser = null;
let currentOrganization = null;
let customerApps = [];
let faqs = [];
let selectedAppId = null;
let currentCategory = 'all';
let editingFaqId = null;
let deletingFaqId = null;

async function initFaqs() {
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
            await loadFaqs();
        }
    } catch (error) {
        console.error('Error loading apps:', error);
        AppUtils.showToast('Error loading apps', 'error');
    }
}

// ===== Load FAQs =====
async function loadFaqs() {
    if (!selectedAppId) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('faq-list').style.display = 'none';
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('no-app-state').style.display = 'block';
        return;
    }

    document.getElementById('no-app-state').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('faq-list').style.display = 'none';
    document.getElementById('empty-state').style.display = 'none';

    try {
        let query = supabase
            .from('faq_items')
            .select('*')
            .eq('app_id', selectedAppId)
            .order('display_order')
            .order('created_at', { ascending: false });

        if (currentCategory !== 'all') {
            query = query.eq('category', currentCategory);
        }

        const { data, error } = await query;
        if (error) throw error;

        faqs = data || [];

        document.getElementById('loading').style.display = 'none';

        if (faqs.length === 0) {
            document.getElementById('empty-state').style.display = 'block';
            document.getElementById('empty-title').textContent =
                currentCategory === 'all' ? 'No FAQs yet' : `No FAQs in "${formatCategory(currentCategory)}"`;
            document.getElementById('empty-desc').textContent =
                currentCategory === 'all'
                    ? 'Add your first FAQ to help customers find answers quickly.'
                    : 'Add FAQs to this category or select a different category.';
            return;
        }

        document.getElementById('faq-list').style.display = 'flex';
        renderFaqs();

    } catch (error) {
        console.error('Error loading FAQs:', error);
        document.getElementById('loading').innerHTML = '<p style="color: var(--color-error);">Error loading FAQs</p>';
    }
}

// ===== Render FAQs =====
function renderFaqs() {
    const list = document.getElementById('faq-list');

    list.innerHTML = faqs.map(faq => `
        <div class="faq-card ${faq.is_active ? '' : 'inactive'}" data-faq-id="${faq.id}">
            <div class="faq-card-header">
                <div class="faq-card-content">
                    <h3 class="faq-question">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2"/>
                            <path d="M8 8C8 6.89543 8.89543 6 10 6C11.1046 6 12 6.89543 12 8C12 9.10457 11.1046 10 10 10V11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <circle cx="10" cy="14" r="1" fill="currentColor"/>
                        </svg>
                        ${escapeHtml(faq.question)}
                    </h3>
                    <p class="faq-answer">${escapeHtml(faq.answer)}</p>
                </div>
                <div class="faq-card-actions">
                    <button class="btn-icon" onclick="editFaq('${faq.id}')" title="Edit">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <path d="M13.5 2.25L15.75 4.5L6.75 13.5H4.5V11.25L13.5 2.25Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="btn-icon danger" onclick="confirmDeleteFaq('${faq.id}')" title="Delete">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <path d="M3 5H15M7 5V3H11V5M6 5V15H12V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="faq-card-meta">
                <span class="faq-category-badge">${formatCategory(faq.category)}</span>
                ${!faq.is_active ? '<span class="faq-inactive-badge">Inactive</span>' : ''}
                <div class="faq-stats">
                    <span class="faq-stat" title="Times shown">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M7 3C4 3 1.5 7 1.5 7C1.5 7 4 11 7 11C10 11 12.5 7 12.5 7C12.5 7 10 3 7 3Z" stroke="currentColor" stroke-width="1.5"/>
                            <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                        ${faq.times_shown}
                    </span>
                    <span class="faq-stat helpful" title="Helpful">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M4 7L6 9L10 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        ${faq.times_helpful}
                    </span>
                    <span class="faq-stat not-helpful" title="Not helpful">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M4 4L10 10M10 4L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                        ${faq.times_not_helpful}
                    </span>
                </div>
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

    editingFaqId = null;
    document.getElementById('modal-title').textContent = 'Add FAQ';
    document.getElementById('modal-submit').textContent = 'Add FAQ';
    document.getElementById('faq-form').reset();
    document.getElementById('faq-active').checked = true;
    document.getElementById('faq-modal').classList.add('active');
    document.getElementById('faq-question').focus();
}

// ===== Edit FAQ =====
function editFaq(faqId) {
    const faq = faqs.find(f => f.id === faqId);
    if (!faq) return;

    editingFaqId = faqId;
    document.getElementById('modal-title').textContent = 'Edit FAQ';
    document.getElementById('modal-submit').textContent = 'Save Changes';

    document.getElementById('faq-question').value = faq.question;
    document.getElementById('faq-answer').value = faq.answer;
    document.getElementById('faq-category').value = faq.category;
    document.getElementById('faq-order').value = faq.display_order;
    document.getElementById('faq-active').checked = faq.is_active;

    document.getElementById('faq-modal').classList.add('active');
    document.getElementById('faq-question').focus();
}

// ===== Close Modal =====
function closeModal() {
    document.getElementById('faq-modal').classList.remove('active');
    editingFaqId = null;
}

// ===== Save FAQ =====
async function saveFaq(e) {
    e.preventDefault();

    const question = document.getElementById('faq-question').value.trim();
    const answer = document.getElementById('faq-answer').value.trim();
    const category = document.getElementById('faq-category').value;
    const displayOrder = parseInt(document.getElementById('faq-order').value) || 0;
    const isActive = document.getElementById('faq-active').checked;

    if (!question || !answer) {
        AppUtils.showToast('Please fill in all required fields', 'error');
        return;
    }

    const submitBtn = document.getElementById('modal-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner" style="width: 16px; height: 16px;"></span>';

    try {
        if (editingFaqId) {
            // Update existing FAQ
            const { error } = await supabase
                .from('faq_items')
                .update({
                    question,
                    answer,
                    category,
                    display_order: displayOrder,
                    is_active: isActive,
                    updated_at: new Date().toISOString()
                })
                .eq('id', editingFaqId);

            if (error) throw error;
            AppUtils.showToast('FAQ updated', 'success');
        } else {
            // Create new FAQ
            const { error } = await supabase
                .from('faq_items')
                .insert({
                    app_id: selectedAppId,
                    organization_id: currentOrganization.id,
                    question,
                    answer,
                    category,
                    display_order: displayOrder,
                    is_active: isActive
                });

            if (error) throw error;
            AppUtils.showToast('FAQ added', 'success');
        }

        closeModal();
        await loadFaqs();

    } catch (error) {
        console.error('Error saving FAQ:', error);
        AppUtils.showToast('Error saving FAQ', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editingFaqId ? 'Save Changes' : 'Add FAQ';
    }
}

// ===== Confirm Delete =====
function confirmDeleteFaq(faqId) {
    deletingFaqId = faqId;
    document.getElementById('delete-modal').classList.add('active');
}

// ===== Delete FAQ =====
async function deleteFaq() {
    if (!deletingFaqId) return;

    const confirmBtn = document.getElementById('delete-confirm');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="loading-spinner" style="width: 16px; height: 16px;"></span>';

    try {
        const { error } = await supabase
            .from('faq_items')
            .delete()
            .eq('id', deletingFaqId);

        if (error) throw error;

        AppUtils.showToast('FAQ deleted', 'success');
        document.getElementById('delete-modal').classList.remove('active');
        deletingFaqId = null;
        await loadFaqs();

    } catch (error) {
        console.error('Error deleting FAQ:', error);
        AppUtils.showToast('Error deleting FAQ', 'error');
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
        currentCategory = 'all';
        document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.category-tab[data-category="all"]').classList.add('active');
        await loadFaqs();
    });

    // Category tabs
    document.getElementById('category-tabs').addEventListener('click', async (e) => {
        if (e.target.classList.contains('category-tab')) {
            document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.dataset.category;
            await loadFaqs();
        }
    });

    // Add buttons
    document.getElementById('add-faq-btn').addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn').addEventListener('click', openAddModal);

    // Modal controls
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('faq-form').addEventListener('submit', saveFaq);

    // Delete modal
    document.getElementById('delete-cancel').addEventListener('click', () => {
        document.getElementById('delete-modal').classList.remove('active');
        deletingFaqId = null;
    });
    document.getElementById('delete-confirm').addEventListener('click', deleteFaq);

    // Modal overlay clicks
    document.getElementById('faq-modal').addEventListener('click', (e) => {
        if (e.target.id === 'faq-modal') closeModal();
    });
    document.getElementById('delete-modal').addEventListener('click', (e) => {
        if (e.target.id === 'delete-modal') {
            document.getElementById('delete-modal').classList.remove('active');
            deletingFaqId = null;
        }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.getElementById('delete-modal').classList.remove('active');
            deletingFaqId = null;
        }
    });
}

// ===== Helpers =====
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatCategory(category) {
    const categories = {
        'getting_started': 'Getting Started',
        'rewards': 'Rewards',
        'points': 'Points',
        'account': 'Account',
        'general': 'General'
    };
    return categories[category] || category;
}

// Initialize
document.addEventListener('DOMContentLoaded', initFaqs);
