// ===== Support Page Initialization =====
let currentUser = null;
let currentOrganization = null;
let customerApps = [];
let tickets = [];
let currentPage = 1;
const PAGE_SIZE = 25;
let totalTickets = 0;
let currentTicket = null;
let currentFilter = 'all';
let selectedAppId = null;

async function initSupport() {
    // Require authentication
    currentUser = await requireAuth();
    if (!currentUser) return;

    // Load user info and organization in parallel
    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(currentUser.id, currentUser.email),
        AppUtils.loadOrganization(supabase, currentUser.id)
    ]);

    currentOrganization = orgData.organization;

    // Initialize sidebar with user data
    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    // Load customer apps and tickets in parallel
    await Promise.all([
        loadCustomerApps(),
        loadStats(),
        loadTickets()
    ]);

    // Setup event listeners
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

        // Show app selector if multiple apps
        const appSelectorBar = document.getElementById('app-selector-bar');
        const appSelect = document.getElementById('app-select');

        if (customerApps.length > 1) {
            appSelectorBar.style.display = 'flex';
            appSelect.innerHTML = '<option value="">All Apps</option>' +
                customerApps.map(app => `<option value="${app.id}">${app.name}</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading customer apps:', error);
    }
}

// ===== Load Stats =====
async function loadStats() {
    if (!currentOrganization) return;

    try {
        // Get aggregate stats for all apps or selected app
        let query = supabase
            .from('support_tickets')
            .select('status, requires_human, ai_handled, satisfaction_rating', { count: 'exact' })
            .eq('organization_id', currentOrganization.id);

        if (selectedAppId) {
            query = query.eq('app_id', selectedAppId);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        const tickets = data || [];

        // Calculate stats
        const openTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length;
        const pendingResponse = tickets.filter(t => t.status === 'awaiting_response').length;
        const escalated = tickets.filter(t => t.requires_human && !['resolved', 'closed'].includes(t.status)).length;

        const aiHandled = tickets.filter(t => t.ai_handled);
        const aiResolved = aiHandled.filter(t => !t.requires_human);
        const aiResolutionRate = aiHandled.length > 0
            ? Math.round((aiResolved.length / aiHandled.length) * 100)
            : null;

        const withRating = tickets.filter(t => t.satisfaction_rating);
        const avgSatisfaction = withRating.length > 0
            ? (withRating.reduce((sum, t) => sum + t.satisfaction_rating, 0) / withRating.length).toFixed(1)
            : null;

        // Update UI
        document.getElementById('open-tickets').textContent = openTickets;
        document.getElementById('pending-response').textContent = pendingResponse;
        document.getElementById('escalated-tickets').textContent = escalated;
        document.getElementById('ai-resolution-rate').textContent = aiResolutionRate !== null ? `${aiResolutionRate}%` : '--';
        document.getElementById('satisfaction-rating').textContent = avgSatisfaction !== null ? `${avgSatisfaction}/5` : '--';

        // Highlight escalated if > 0
        const escalatedStat = document.getElementById('escalated-stat');
        if (escalated > 0) {
            escalatedStat.classList.add('stat-warning');
        } else {
            escalatedStat.classList.remove('stat-warning');
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// ===== Load Tickets =====
async function loadTickets() {
    const loading = document.getElementById('loading');
    const container = document.getElementById('tickets-container');
    const emptyState = document.getElementById('empty-state');
    const pagination = document.getElementById('pagination');

    loading.style.display = 'flex';
    container.style.display = 'none';
    emptyState.style.display = 'none';
    pagination.style.display = 'none';

    if (!currentOrganization) {
        loading.innerHTML = '<p style="color: var(--color-error);">No organization found.</p>';
        return;
    }

    try {
        // Get filters
        const search = document.getElementById('search-input').value.trim().toLowerCase();
        const typeFilter = document.getElementById('type-filter').value;
        const priorityFilter = document.getElementById('priority-filter').value;

        // Build query
        let query = supabase
            .from('support_tickets')
            .select(`
                *,
                app_members (
                    id,
                    first_name,
                    last_name,
                    display_name,
                    email,
                    avatar_url
                ),
                customer_apps (
                    id,
                    name,
                    slug
                )
            `, { count: 'exact' })
            .eq('organization_id', currentOrganization.id)
            .order('created_at', { ascending: false })
            .range((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE - 1);

        // Apply app filter
        if (selectedAppId) {
            query = query.eq('app_id', selectedAppId);
        }

        // Apply status filter
        if (currentFilter === 'open') {
            query = query.in('status', ['open', 'awaiting_response', 'in_progress']);
        } else if (currentFilter === 'escalated') {
            query = query.eq('requires_human', true).not('status', 'in', '("resolved","closed")');
        } else if (currentFilter === 'pending_customer') {
            query = query.eq('status', 'pending_customer');
        } else if (currentFilter === 'resolved') {
            query = query.in('status', ['resolved', 'closed']);
        }

        // Apply type filter
        if (typeFilter) {
            query = query.eq('ticket_type', typeFilter);
        }

        // Apply priority filter
        if (priorityFilter) {
            query = query.eq('priority', priorityFilter);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        tickets = data || [];
        totalTickets = count || 0;

        // Filter by search (client-side for now)
        if (search) {
            tickets = tickets.filter(t =>
                t.ticket_number.toLowerCase().includes(search) ||
                t.subject.toLowerCase().includes(search) ||
                (t.app_members?.email || '').toLowerCase().includes(search) ||
                (t.app_members?.first_name || '').toLowerCase().includes(search)
            );
        }

        loading.style.display = 'none';

        if (tickets.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        container.style.display = 'block';
        renderTickets();
        updatePagination();

    } catch (error) {
        console.error('Error loading tickets:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading tickets.</p>';
    }
}

// ===== Render Tickets =====
function renderTickets() {
    const tbody = document.getElementById('tickets-table-body');

    tbody.innerHTML = tickets.map(ticket => {
        const member = ticket.app_members;
        const app = ticket.customer_apps;
        const initials = member
            ? getInitials(member.first_name, member.last_name, member.display_name)
            : '?';
        const customerName = member
            ? (member.display_name || `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Unknown')
            : 'Anonymous';
        const customerEmail = member?.email || 'No email';

        const statusClass = ticket.requires_human && !['resolved', 'closed'].includes(ticket.status)
            ? 'escalated'
            : ticket.status;

        return `
            <tr data-ticket-id="${ticket.id}">
                <td class="ticket-number-cell">${ticket.ticket_number}</td>
                <td>
                    <div class="customer-cell">
                        <div class="customer-avatar" style="background: ${getColorForInitials(initials)}">
                            ${member?.avatar_url ? `<img src="${member.avatar_url}" alt="">` : initials}
                        </div>
                        <div class="customer-info">
                            <span class="customer-name">${escapeHtml(customerName)}</span>
                            <span class="customer-email">${escapeHtml(customerEmail)}</span>
                        </div>
                    </div>
                </td>
                <td class="subject-cell">
                    <span class="subject-text">${escapeHtml(ticket.subject)}</span>
                    <span class="subject-preview">${escapeHtml(truncate(ticket.description, 50))}</span>
                </td>
                <td><span class="type-badge ${ticket.ticket_type}">${formatType(ticket.ticket_type)}</span></td>
                <td><span class="priority-badge ${ticket.priority}">${capitalize(ticket.priority)}</span></td>
                <td><span class="status-badge ${statusClass}">${formatStatus(ticket.status, ticket.requires_human)}</span></td>
                <td class="time-cell">${formatTimeAgo(ticket.updated_at)}</td>
                <td>
                    <button class="action-btn" onclick="openTicketModal('${ticket.id}')">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M4 10H16M16 10L12 6M16 10L12 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Add row click handlers
    tbody.querySelectorAll('tr').forEach(row => {
        row.addEventListener('click', (e) => {
            if (!e.target.closest('.action-btn')) {
                openTicketModal(row.dataset.ticketId);
            }
        });
    });
}

// ===== Open Ticket Modal =====
async function openTicketModal(ticketId) {
    const modal = document.getElementById('ticket-modal');
    currentTicket = tickets.find(t => t.id === ticketId);

    if (!currentTicket) {
        // Fetch if not in current list
        const { data, error } = await supabase
            .from('support_tickets')
            .select(`
                *,
                app_members (id, first_name, last_name, display_name, email, avatar_url),
                customer_apps (id, name, slug)
            `)
            .eq('id', ticketId)
            .single();

        if (error || !data) {
            AppUtils.showToast('Ticket not found', 'error');
            return;
        }
        currentTicket = data;
    }

    // Populate modal
    const member = currentTicket.app_members;
    document.getElementById('modal-ticket-number').textContent = '#' + currentTicket.ticket_number;
    document.getElementById('modal-ticket-status').textContent = formatStatus(currentTicket.status, currentTicket.requires_human);
    document.getElementById('modal-ticket-status').className = 'ticket-status-badge status-badge ' +
        (currentTicket.requires_human && !['resolved', 'closed'].includes(currentTicket.status) ? 'escalated' : currentTicket.status);

    document.getElementById('modal-customer-name').textContent = member
        ? (member.display_name || `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Unknown')
        : 'Anonymous';
    document.getElementById('modal-customer-email').textContent = member?.email || 'No email';
    document.getElementById('modal-ticket-type').value = currentTicket.ticket_type;
    document.getElementById('modal-ticket-priority').value = currentTicket.priority;
    document.getElementById('modal-created-at').textContent = formatDate(currentTicket.created_at);

    // Show AI handled badge if applicable
    const aiRow = document.getElementById('ai-handled-row');
    aiRow.style.display = currentTicket.ai_handled ? 'flex' : 'none';

    // Load conversation
    await loadConversation(ticketId);

    // Show/hide buttons based on status
    const resolveBtn = document.getElementById('resolve-btn');
    const closeBtn = document.getElementById('close-ticket-btn');
    const replyForm = document.getElementById('reply-form');

    if (currentTicket.status === 'resolved') {
        resolveBtn.style.display = 'none';
        closeBtn.textContent = 'Close Ticket';
    } else if (currentTicket.status === 'closed') {
        resolveBtn.style.display = 'none';
        closeBtn.style.display = 'none';
        replyForm.style.display = 'none';
    } else {
        resolveBtn.style.display = 'inline-flex';
        closeBtn.style.display = 'inline-flex';
        replyForm.style.display = 'block';
    }

    modal.classList.add('active');
}

// ===== Load Conversation =====
async function loadConversation(ticketId) {
    const thread = document.getElementById('conversation-thread');
    thread.innerHTML = '<div class="loading-spinner" style="margin: 2rem auto;"></div>';

    try {
        let allMessages = [];

        // Check if this ticket has an AI session (for escalated tickets)
        const aiSessionId = currentTicket?.metadata?.ai_session_id;

        if (aiSessionId) {
            // Load AI conversation history first
            const { data: aiMessages, error: aiError } = await supabase
                .from('ai_support_messages')
                .select('id, role, content, created_at, metadata')
                .eq('session_id', aiSessionId)
                .order('created_at', { ascending: true })
                .limit(30);

            if (!aiError && aiMessages && aiMessages.length > 0) {
                // Convert AI messages to display format
                aiMessages.forEach(msg => {
                    allMessages.push({
                        id: msg.id,
                        sender_type: msg.role === 'user' ? 'customer' : 'ai',
                        sender_name: msg.role === 'user' ? 'Customer' : 'AI Assistant',
                        message: msg.content,
                        created_at: msg.created_at,
                        is_ai_history: true // Flag to show divider
                    });
                });
            }
        }

        // Load ticket messages (post-escalation)
        const { data: messages, error } = await supabase
            .from('ticket_messages')
            .select('*')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        // Reverse to show oldest first after limiting
        if (messages) {
            messages.reverse();
            allMessages = allMessages.concat(messages);
        }

        if (allMessages.length === 0) {
            thread.innerHTML = '<p style="text-align: center; color: var(--color-text-tertiary);">No messages yet.</p>';
            return;
        }

        // Check if we have AI history to show a divider
        const hasAiHistory = allMessages.some(m => m.is_ai_history);
        const firstNonAiIndex = allMessages.findIndex(m => !m.is_ai_history);

        thread.innerHTML = allMessages.map((msg, index) => {
            const isInternal = msg.is_internal;
            const senderType = msg.sender_type;
            const initials = msg.sender_name ? msg.sender_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) :
                (senderType === 'ai' ? 'AI' : senderType === 'customer' ? 'C' : 'S');

            let sourcesHtml = '';
            if (msg.ai_sources && msg.ai_sources.length > 0) {
                sourcesHtml = `
                    <div class="ai-sources">
                        <strong>Sources:</strong> ${msg.ai_sources.map(s => escapeHtml(s.title)).join(', ')}
                    </div>
                `;
            }

            // Add divider between AI history and ticket messages
            let dividerHtml = '';
            if (hasAiHistory && index === firstNonAiIndex && firstNonAiIndex > 0) {
                dividerHtml = `
                    <div class="conversation-divider">
                        <span>🚨 Escalated to Human Support</span>
                    </div>
                `;
            }

            return dividerHtml + `
                <div class="message-item ${senderType}${msg.is_ai_history ? ' ai-history' : ''}">
                    <div class="message-avatar">${initials}</div>
                    <div class="message-content ${isInternal ? 'message-internal' : ''}">
                        <div class="message-header">
                            <span class="message-sender">${escapeHtml(msg.sender_name || capitalize(senderType))}</span>
                            <span class="message-time">${formatTimeAgo(msg.created_at)}</span>
                        </div>
                        <div class="message-text">${escapeHtml(msg.message)}</div>
                        ${sourcesHtml}
                    </div>
                </div>
            `;
        }).join('');

        // Scroll to bottom
        thread.scrollTop = thread.scrollHeight;

    } catch (error) {
        console.error('Error loading conversation:', error);
        thread.innerHTML = '<p style="color: var(--color-error);">Error loading messages.</p>';
    }
}

// ===== Send Reply =====
async function sendReply() {
    if (!currentTicket) return;

    const messageInput = document.getElementById('reply-message');
    const message = messageInput.value.trim();
    const isInternal = document.getElementById('internal-note-checkbox').checked;

    if (!message) {
        AppUtils.showToast('Please enter a message', 'error');
        return;
    }

    const sendBtn = document.getElementById('send-reply-btn');
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="loading-spinner" style="width: 16px; height: 16px;"></span>';

    try {
        // Get current user's name
        const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('id', currentUser.id)
            .single();

        const senderName = profile
            ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Staff'
            : 'Staff';

        // Insert message
        const { error: msgError } = await supabase
            .from('ticket_messages')
            .insert({
                ticket_id: currentTicket.id,
                sender_type: 'staff',
                sender_id: currentUser.id,
                sender_name: senderName,
                message: message,
                is_internal: isInternal
            });

        if (msgError) throw msgError;

        // Update ticket status if not internal
        if (!isInternal) {
            const { error: ticketError } = await supabase
                .from('support_tickets')
                .update({
                    status: 'pending_customer',
                    first_response_at: currentTicket.first_response_at || new Date().toISOString()
                })
                .eq('id', currentTicket.id);

            if (ticketError) throw ticketError;
        }

        // Clear input
        messageInput.value = '';
        document.getElementById('internal-note-checkbox').checked = false;

        // Reload conversation
        await loadConversation(currentTicket.id);

        // Update stats
        await loadStats();

        AppUtils.showToast(isInternal ? 'Internal note added' : 'Reply sent', 'success');

    } catch (error) {
        console.error('Error sending reply:', error);
        AppUtils.showToast('Error sending reply', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span>Send Reply</span>';
    }
}

// ===== Update Ticket Status =====
async function updateTicketStatus(status) {
    if (!currentTicket) return;

    try {
        const updates = { status };

        if (status === 'resolved') {
            updates.resolved_at = new Date().toISOString();
        } else if (status === 'closed') {
            updates.closed_at = new Date().toISOString();
        }

        const { error } = await supabase
            .from('support_tickets')
            .update(updates)
            .eq('id', currentTicket.id);

        if (error) throw error;

        currentTicket.status = status;

        // Update modal UI
        document.getElementById('modal-ticket-status').textContent = formatStatus(status);
        document.getElementById('modal-ticket-status').className = 'ticket-status-badge status-badge ' + status;

        // Reload data
        await Promise.all([loadTickets(), loadStats()]);

        AppUtils.showToast(`Ticket ${status}`, 'success');

        // Close modal if closed
        if (status === 'closed') {
            closeTicketModal();
        }

    } catch (error) {
        console.error('Error updating ticket:', error);
        AppUtils.showToast('Error updating ticket', 'error');
    }
}

// ===== Close Modal =====
function closeTicketModal() {
    document.getElementById('ticket-modal').classList.remove('active');
    currentTicket = null;
    document.getElementById('reply-message').value = '';
    document.getElementById('internal-note-checkbox').checked = false;
}

// ===== AI Suggest Response =====
async function aiSuggestResponse() {
    if (!currentTicket) return;

    const suggestBtn = document.getElementById('ai-suggest-btn');
    const messageInput = document.getElementById('reply-message');

    suggestBtn.disabled = true;
    suggestBtn.innerHTML = '<span class="loading-spinner" style="width: 16px; height: 16px;"></span> Thinking...';

    try {
        // For now, just show a placeholder - will be implemented with Edge Function
        // This would call the ai-support-agent Edge Function

        // Get context
        const { data: context } = await supabase.rpc('get_ai_support_context', {
            p_app_id: currentTicket.app_id,
            p_member_id: currentTicket.member_id
        });

        // Placeholder response
        const suggestions = [
            `Thank you for reaching out! I understand you're asking about "${currentTicket.subject}". Let me help you with that.`,
            `Hi! Thanks for contacting us. Regarding your ${currentTicket.ticket_type === 'bug_report' ? 'bug report' : 'inquiry'}, I wanted to let you know that we're looking into this.`,
            `Hello! I appreciate you bringing this to our attention. Let me address your concern about "${currentTicket.subject}".`
        ];

        messageInput.value = suggestions[Math.floor(Math.random() * suggestions.length)];

        AppUtils.showToast('AI suggestion generated. Feel free to edit before sending.', 'info');

    } catch (error) {
        console.error('Error generating AI suggestion:', error);
        AppUtils.showToast('Could not generate suggestion', 'error');
    } finally {
        suggestBtn.disabled = false;
        suggestBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                <path d="M6 6C6.5 5 7 4.5 8 4.5C9.5 4.5 10.5 5.5 10.5 7C10.5 8.5 9 9 8 9V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="8" cy="12" r="0.75" fill="currentColor"/>
            </svg>
            <span>AI Suggest</span>
        `;
    }
}

// ===== Update Pagination =====
function updatePagination() {
    const pagination = document.getElementById('pagination');
    const totalPages = Math.ceil(totalTickets / PAGE_SIZE);

    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }

    pagination.style.display = 'flex';
    document.getElementById('pagination-info').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('prev-page').disabled = currentPage === 1;
    document.getElementById('next-page').disabled = currentPage === totalPages;
}

// ===== Setup Event Listeners =====
function setupEventListeners() {
    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            currentPage = 1;
            loadTickets();
        });
    });

    // App selector
    document.getElementById('app-select')?.addEventListener('change', (e) => {
        selectedAppId = e.target.value || null;
        currentPage = 1;
        Promise.all([loadStats(), loadTickets()]);
    });

    // Search with debounce
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            loadTickets();
        }, 300);
    });

    // Type and priority filters
    document.getElementById('type-filter').addEventListener('change', () => {
        currentPage = 1;
        loadTickets();
    });

    document.getElementById('priority-filter').addEventListener('change', () => {
        currentPage = 1;
        loadTickets();
    });

    // Pagination
    document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadTickets();
        }
    });

    document.getElementById('next-page').addEventListener('click', () => {
        const totalPages = Math.ceil(totalTickets / PAGE_SIZE);
        if (currentPage < totalPages) {
            currentPage++;
            loadTickets();
        }
    });

    // Modal close
    document.getElementById('ticket-modal-close').addEventListener('click', closeTicketModal);
    document.getElementById('ticket-modal').addEventListener('click', (e) => {
        if (e.target.id === 'ticket-modal') closeTicketModal();
    });

    // Reply
    document.getElementById('send-reply-btn').addEventListener('click', sendReply);

    // AI suggest
    document.getElementById('ai-suggest-btn').addEventListener('click', aiSuggestResponse);

    // Status actions
    document.getElementById('mark-pending-btn').addEventListener('click', () => updateTicketStatus('awaiting_response'));
    document.getElementById('resolve-btn').addEventListener('click', () => updateTicketStatus('resolved'));
    document.getElementById('close-ticket-btn').addEventListener('click', () => updateTicketStatus('closed'));

    // Type/Priority changes in modal
    document.getElementById('modal-ticket-type').addEventListener('change', async (e) => {
        if (!currentTicket) return;
        await supabase.from('support_tickets').update({ ticket_type: e.target.value }).eq('id', currentTicket.id);
        currentTicket.ticket_type = e.target.value;
        loadTickets();
    });

    document.getElementById('modal-ticket-priority').addEventListener('change', async (e) => {
        if (!currentTicket) return;
        await supabase.from('support_tickets').update({ priority: e.target.value }).eq('id', currentTicket.id);
        currentTicket.priority = e.target.value;
        loadTickets();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTicketModal();
            closeNotificationsPanel();
        }
    });

    // Notifications dropdown
    const notificationsToggle = document.getElementById('notifications-toggle');
    const notificationsPanel = document.getElementById('notifications-panel');

    if (notificationsToggle && notificationsPanel) {
        notificationsToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = notificationsPanel.classList.toggle('open');
            if (isOpen) {
                loadNotifications();
            }
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!notificationsPanel.contains(e.target) && e.target !== notificationsToggle) {
                notificationsPanel.classList.remove('open');
            }
        });
    }

    // Mark all as read button
    document.getElementById('mark-all-read')?.addEventListener('click', markAllNotificationsRead);

    // Load notifications badge count and start polling
    loadNotificationCount();
    setInterval(loadNotificationCount, 30000); // Poll every 30 seconds
}

// ===== Notifications Functions =====

async function loadNotificationCount() {
    if (!currentOrganization) return;

    try {
        const { data, error } = await supabase.rpc('get_unread_notification_count', {
            p_organization_id: currentOrganization.id
        });

        if (error) throw error;

        const count = data || 0;
        const badge = document.getElementById('notifications-badge');

        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        // Also update sidebar badge
        if (typeof AppSidebar !== 'undefined' && currentOrganization) {
            AppSidebar.updateNotificationBadge(currentOrganization.id);
        }
    } catch (error) {
        console.warn('Error loading notification count:', error);
    }
}

async function loadNotifications() {
    if (!currentOrganization) return;

    const notificationsList = document.getElementById('notifications-list');
    if (!notificationsList) return;

    try {
        const { data, error } = await supabase.rpc('get_recent_notifications', {
            p_organization_id: currentOrganization.id,
            p_limit: 20
        });

        if (error) throw error;

        const notifications = data || [];

        if (notifications.length === 0) {
            notificationsList.innerHTML = `
                <div class="notifications-empty" data-i18n="support.noNotifications">
                    No new notifications
                </div>
            `;
            return;
        }

        notificationsList.innerHTML = notifications.map(n => {
            const iconClass = n.notification_type || 'escalation';
            const iconEmoji = getNotificationIcon(n.notification_type);

            return `
                <div class="notification-item ${n.is_read ? '' : 'unread'}"
                     data-notification-id="${n.id}"
                     data-ticket-id="${n.ticket_id || ''}"
                     data-priority="${n.priority || 'normal'}"
                     onclick="handleNotificationClick('${n.id}', '${n.ticket_id || ''}')">
                    <div class="notification-icon ${iconClass}">${iconEmoji}</div>
                    <div class="notification-content">
                        <div class="notification-title">${escapeHtml(n.title)}</div>
                        <div class="notification-message">${escapeHtml(n.message)}</div>
                        <div class="notification-time">${formatTimeAgo(n.created_at)}</div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading notifications:', error);
        notificationsList.innerHTML = `
            <div class="notifications-empty">
                Error loading notifications
            </div>
        `;
    }
}

function getNotificationIcon(type) {
    const icons = {
        'escalation': '🚨',
        'new_ticket': '🎫',
        'ticket_reply': '💬',
        'low_satisfaction': '😟'
    };
    return icons[type] || '📬';
}

async function handleNotificationClick(notificationId, ticketId) {
    // Mark as read
    await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId
    });

    // Update badge count
    loadNotificationCount();

    // Close panel
    closeNotificationsPanel();

    // Open ticket if available
    if (ticketId) {
        openTicket(ticketId);
    }
}

async function markAllNotificationsRead() {
    if (!currentOrganization) return;

    try {
        await supabase.rpc('mark_all_notifications_read', {
            p_organization_id: currentOrganization.id
        });

        // Update UI
        loadNotificationCount();
        loadNotifications();
    } catch (error) {
        console.error('Error marking notifications as read:', error);
    }
}

function closeNotificationsPanel() {
    const panel = document.getElementById('notifications-panel');
    if (panel) {
        panel.classList.remove('open');
    }
}

// ===== Helper Functions =====

function getInitials(firstName, lastName, displayName) {
    if (displayName) {
        return displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    const first = (firstName || '')[0] || '';
    const last = (lastName || '')[0] || '';
    return (first + last).toUpperCase() || '?';
}

function getColorForInitials(initials) {
    const colors = [
        '#7c3aed', '#a855f7', '#ec4899', '#f43f5e', '#f97316',
        '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
    ];
    const charCode = (initials[0] || 'A').charCodeAt(0);
    return colors[charCode % colors.length];
}

// Use centralized escapeHtml from AppUtils
const escapeHtml = AppUtils.escapeHtml;

function truncate(str, length) {
    if (!str) return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

function formatType(type) {
    const types = {
        'question': 'Question',
        'bug_report': 'Bug Report',
        'feature_request': 'Feature',
        'complaint': 'Complaint',
        'feedback': 'Feedback'
    };
    return types[type] || capitalize(type);
}

function formatStatus(status, requiresHuman = false) {
    if (requiresHuman && !['resolved', 'closed'].includes(status)) {
        return 'Escalated';
    }
    const statuses = {
        'open': 'Open',
        'awaiting_response': 'Awaiting Response',
        'in_progress': 'In Progress',
        'pending_customer': 'Pending Customer',
        'resolved': 'Resolved',
        'closed': 'Closed'
    };
    return statuses[status] || capitalize(status);
}

function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initSupport);
