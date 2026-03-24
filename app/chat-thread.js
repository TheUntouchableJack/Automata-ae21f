// ===== Chat Thread Module =====
// Manages chat threads, message rendering, and thread switching

const ChatThread = (function() {
    let currentThreadId = null;
    let threads = [];
    let isLoadingThreads = false;
    let dropdownOpen = false;

    async function init() {
        setupTabSwitching();
        setupThreadSelector();
        setupChatTabInput();
        await loadThreads();

        // Check for sidebar chat message (sent from sidebar on another page)
        checkForSidebarMessage();
    }

    function setupChatTabInput() {
        const input = document.getElementById('chat-tab-input');
        const sendBtn = document.getElementById('chat-tab-send');
        const charCount = document.querySelector('.chat-tab-char-count');

        if (!input || !sendBtn) return;

        input.addEventListener('input', () => {
            // Auto-resize
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';

            // Update char count
            if (charCount) charCount.textContent = `${input.value.length}/500`;

            // Enable/disable send
            sendBtn.disabled = !input.value.trim();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.value.trim()) sendChatTabMessage();
            }
        });

        sendBtn.addEventListener('click', () => {
            if (input.value.trim()) sendChatTabMessage();
        });
    }

    async function sendChatTabMessage() {
        const input = document.getElementById('chat-tab-input');
        const sendBtn = document.getElementById('chat-tab-send');
        const charCount = document.querySelector('.chat-tab-char-count');
        const message = input.value.trim();
        if (!message) return;

        // Clear input
        input.value = '';
        input.style.height = 'auto';
        if (charCount) charCount.textContent = '0/500';
        sendBtn.disabled = true;

        // Use existing chat submit handler
        if (typeof CrownDashboard !== 'undefined' && typeof CrownDashboard.handleChatSubmit === 'function') {
            CrownDashboard.handleChatSubmit(message);
        }
    }

    // Handle messages sent from sidebar chat on other pages
    function checkForSidebarMessage() {
        const sidebarMessage = sessionStorage.getItem('sidebar_chat_message');
        if (sidebarMessage) {
            sessionStorage.removeItem('sidebar_chat_message');

            // Wait for page to be ready, then send the message
            setTimeout(() => {
                const chatInput = document.getElementById('chat-input');
                const chatForm = document.getElementById('chat-form');

                if (chatInput && chatForm) {
                    chatInput.value = sidebarMessage;

                    // Trigger form submit
                    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                    chatForm.dispatchEvent(submitEvent);
                } else if (typeof CrownDashboard !== 'undefined' && typeof CrownDashboard.handleChatSubmit === 'function') {
                    // Fallback: call CrownDashboard directly
                    CrownDashboard.handleChatSubmit(sidebarMessage);
                }
            }, 500);
        }
    }

    function setupTabSwitching() {
        const dropdown = document.getElementById('panel-tab-dropdown');
        const trigger = document.getElementById('panel-tab-trigger');
        const menu = document.getElementById('panel-tab-menu');
        const options = menu ? menu.querySelectorAll('.panel-tab-option') : [];

        const contentChat = document.getElementById('tab-content-chat');
        const contentActivity = document.getElementById('tab-content-activity');
        const contentIntel = document.getElementById('tab-content-intel');
        const contentKnowledge = document.getElementById('tab-content-knowledge');
        const panelStats = document.getElementById('cards-panel-stats');
        const threadSectionHeader = document.querySelector('.thread-section-header');
        const threadSelector = document.getElementById('thread-selector');

        if (!trigger || !menu) return;

        const contents = {
            activity: contentActivity,
            intel: contentIntel,
            knowledge: contentKnowledge,
            chat: contentChat
        };

        // Toggle dropdown open/close
        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdown.classList.toggle('open');
            trigger.setAttribute('aria-expanded', dropdown.classList.contains('open'));
        });

        // Close on click outside
        document.addEventListener('click', function() {
            if (dropdown.classList.contains('open')) {
                dropdown.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        menu.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        // Tab option clicks
        options.forEach(function(option) {
            option.addEventListener('click', function() {
                var tabId = this.dataset.tab;
                switchTab(tabId, this);
                dropdown.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
            });
        });

        function switchTab(tabId, optionEl) {
            // Deactivate all
            options.forEach(function(opt) { opt.classList.remove('active'); });
            Object.values(contents).forEach(function(c) { if (c) c.classList.remove('active'); });

            // Activate selected
            if (optionEl) optionEl.classList.add('active');
            if (contents[tabId]) contents[tabId].classList.add('active');

            // Update trigger to show active tab
            var icon = optionEl.querySelector('svg');
            var text = optionEl.querySelector('span[data-i18n]');
            var triggerIcon = trigger.querySelector('.panel-tab-trigger-icon');
            var triggerText = trigger.querySelector('.panel-tab-trigger-text');
            if (icon && triggerIcon) triggerIcon.innerHTML = icon.innerHTML;
            if (text && triggerText) {
                triggerText.textContent = text.textContent;
                triggerText.setAttribute('data-i18n', text.getAttribute('data-i18n'));
            }

            // Tab-specific logic
            if (panelStats) panelStats.style.display = tabId === 'activity' ? 'flex' : 'none';

            if (tabId === 'chat') {
                if (threadSectionHeader) threadSectionHeader.style.display = '';
                if (threadSelector) threadSelector.style.display = '';
            } else {
                if (threadSectionHeader) threadSectionHeader.style.display = 'none';
                if (threadSelector) threadSelector.style.display = 'none';
            }

            // Clear badges
            if (tabId === 'activity') {
                var badge = document.getElementById('activity-badge');
                if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
                var menuBadge = document.getElementById('activity-badge-menu');
                if (menuBadge) { menuBadge.style.display = 'none'; menuBadge.textContent = '0'; }
            }
            if (tabId === 'intel') {
                var intelBadge = document.getElementById('intel-badge');
                if (intelBadge) { intelBadge.style.display = 'none'; intelBadge.textContent = '0'; }
            }

            // Load knowledge on first visit
            if (tabId === 'knowledge' && typeof CrownDashboard !== 'undefined' && typeof CrownDashboard.loadKnowledge === 'function') {
                CrownDashboard.loadKnowledge();
            }
        }

        // Setup panel toggle (hides/shows right cards panel)
        var panelToggle = document.getElementById('panel-sidebar-toggle');
        if (panelToggle) {
            panelToggle.addEventListener('click', function() {
                var dashboard = document.getElementById('crown-dashboard');
                if (dashboard) dashboard.classList.toggle('panel-hidden');
                window.dispatchEvent(new Event('resize'));
            });
        }

        // Panel reopen button (visible in viewport when panel is hidden)
        var panelReopen = document.getElementById('panel-reopen-btn');
        if (panelReopen) {
            panelReopen.addEventListener('click', function() {
                var dashboard = document.getElementById('crown-dashboard');
                if (dashboard) dashboard.classList.remove('panel-hidden');
                window.dispatchEvent(new Event('resize'));
            });
        }

        // Panel expand button (modal view)
        var panelExpandBtn = document.getElementById('panel-expand-btn');
        var panelBackdrop = document.getElementById('panel-expand-backdrop');
        var cardsPanel = document.querySelector('.crown-cards-panel');

        function togglePanelExpand() {
            if (!cardsPanel) return;
            var isExpanded = cardsPanel.classList.toggle('panel-expanded');
            if (panelBackdrop) panelBackdrop.classList.toggle('active', isExpanded);
            document.body.style.overflow = isExpanded ? 'hidden' : '';
        }

        if (panelExpandBtn) {
            panelExpandBtn.addEventListener('click', togglePanelExpand);
        }
        if (panelBackdrop) {
            panelBackdrop.addEventListener('click', togglePanelExpand);
        }

        // ESC to close expanded panel
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && cardsPanel && cardsPanel.classList.contains('panel-expanded')) {
                togglePanelExpand();
            }
        });

        // Hide HISTORY by default (Actions tab is active on page load)
        if (threadSectionHeader) threadSectionHeader.style.display = 'none';
        if (threadSelector) threadSelector.style.display = 'none';
    }

    function setupThreadSelector() {
        const selectorBtn = document.getElementById('thread-selector-btn');
        const dropdown = document.getElementById('thread-dropdown');
        const newThreadBtn = document.getElementById('new-thread-btn');

        if (!selectorBtn || !dropdown) return;

        // Toggle dropdown
        selectorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownOpen = !dropdownOpen;
            dropdown.style.display = dropdownOpen ? 'block' : 'none';
            selectorBtn.classList.toggle('open', dropdownOpen);
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.thread-selector')) {
                dropdownOpen = false;
                dropdown.style.display = 'none';
                selectorBtn.classList.remove('open');
            }
        });

        // New thread button
        if (newThreadBtn) {
            newThreadBtn.addEventListener('click', () => {
                startNewThread();
                dropdownOpen = false;
                dropdown.style.display = 'none';
                selectorBtn.classList.remove('open');
            });
        }
    }

    async function loadThreads() {
        if (isLoadingThreads || typeof supabase === 'undefined') return;
        isLoadingThreads = true;

        try {
            const user = await getCurrentUser();
            if (!user) return;

            const orgResult = await AppUtils.loadOrganization(supabase, user.id);
            if (!orgResult || !orgResult.organization) return;

            const { data, error } = await supabase
                .from('ai_threads')
                .select('id, title, mode, created_at, updated_at')
                .eq('organization_id', orgResult.organization.id)
                .eq('user_id', user.id)
                .eq('is_active', true)
                .order('updated_at', { ascending: false })
                .limit(20);

            if (error) {
                console.error('Failed to load threads:', error);
                return;
            }

            threads = data || [];
            renderThreadList();

            // If we have threads, load the most recent one
            if (threads.length > 0 && !currentThreadId) {
                await selectThread(threads[0].id);
            }
        } catch (e) {
            console.error('Error loading threads:', e);
        } finally {
            isLoadingThreads = false;
        }
    }

    function renderThreadList() {
        const listEl = document.getElementById('thread-list');
        if (!listEl) return;

        if (threads.length === 0) {
            listEl.innerHTML = '<div class="thread-list-empty">No conversations yet</div>';
            return;
        }

        listEl.innerHTML = threads.map(thread => `
            <button class="thread-item ${thread.id === currentThreadId ? 'active' : ''}" data-thread-id="${thread.id}">
                <span class="thread-item-title">${escapeHtml(thread.title || 'Untitled')}</span>
                <span class="thread-item-time">${formatTimeAgo(thread.updated_at)}</span>
            </button>
        `).join('');

        // Bind click handlers
        listEl.querySelectorAll('.thread-item').forEach(item => {
            item.addEventListener('click', async () => {
                const threadId = item.dataset.threadId;
                await selectThread(threadId);

                // Close dropdown
                const dropdown = document.getElementById('thread-dropdown');
                const selectorBtn = document.getElementById('thread-selector-btn');
                if (dropdown) dropdown.style.display = 'none';
                if (selectorBtn) selectorBtn.classList.remove('open');
                dropdownOpen = false;
            });
        });
    }

    async function selectThread(threadId) {
        currentThreadId = threadId;

        // Update selector title
        const thread = threads.find(t => t.id === threadId);
        const titleEl = document.getElementById('current-thread-title');
        if (titleEl && thread) {
            titleEl.textContent = thread.title || 'Untitled';
        }

        // Update active state in list
        document.querySelectorAll('.thread-item').forEach(item => {
            item.classList.toggle('active', item.dataset.threadId === threadId);
        });

        // Load thread messages
        await loadThreadMessages(threadId);

        // Notify CrownDashboard of the current thread
        if (typeof window.setCurrentThreadId === 'function') {
            window.setCurrentThreadId(threadId);
        }
    }

    async function loadThreadMessages(threadId) {
        const messagesEl = document.getElementById('chat-messages');
        const welcomeEl = document.getElementById('chat-welcome');

        if (!messagesEl) return;

        try {
            const { data, error } = await supabase
                .from('ai_prompts')
                .select('id, prompt_text, response, mode, created_at')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true });

            if (error) {
                console.error('Failed to load messages:', error);
                return;
            }

            // Clear messages but keep welcome if no messages
            const existingMessages = messagesEl.querySelectorAll('.chat-message');
            existingMessages.forEach(m => m.remove());

            if (!data || data.length === 0) {
                if (welcomeEl) welcomeEl.style.display = 'flex';
                return;
            }

            // Hide welcome message
            if (welcomeEl) welcomeEl.style.display = 'none';

            // Render messages
            data.forEach(msg => {
                // User message
                appendMessage('user', msg.prompt_text, msg.created_at);

                // Assistant message
                if (msg.response) {
                    const assistantContent = msg.response.message ||
                        (msg.response.ideas && msg.response.ideas.length > 0
                            ? `I have ${msg.response.ideas.length} suggestion${msg.response.ideas.length > 1 ? 's' : ''} for you. Check the Activity tab to see them!`
                            : 'I processed your request.');
                    appendMessage('assistant', assistantContent, msg.created_at);
                }
            });

            // Scroll to bottom
            scrollToBottom();

        } catch (e) {
            console.error('Error loading messages:', e);
        }
    }

    function startNewThread() {
        currentThreadId = null;

        // Update UI
        const titleEl = document.getElementById('current-thread-title');
        if (titleEl) titleEl.textContent = 'New Conversation';

        // Clear messages, show welcome
        const messagesEl = document.getElementById('chat-messages');
        const welcomeEl = document.getElementById('chat-welcome');
        if (messagesEl) {
            const existingMessages = messagesEl.querySelectorAll('.chat-message');
            existingMessages.forEach(m => m.remove());
        }
        if (welcomeEl) welcomeEl.style.display = 'flex';

        // Update list active state
        document.querySelectorAll('.thread-item').forEach(item => {
            item.classList.remove('active');
        });

        // Notify CrownDashboard
        if (typeof window.setCurrentThreadId === 'function') {
            window.setCurrentThreadId(null);
        }
    }

    function appendMessage(role, content, timestamp) {
        const messagesEl = document.getElementById('chat-messages');
        const welcomeEl = document.getElementById('chat-welcome');

        if (!messagesEl) return;

        // Hide welcome message
        if (welcomeEl) welcomeEl.style.display = 'none';

        const msgEl = document.createElement('div');
        msgEl.className = `chat-message ${role}`;

        const time = timestamp ? new Date(timestamp) : new Date();
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msgEl.innerHTML = `
            <div class="message-avatar">
                ${role === 'user'
                    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
                    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>'
                }
            </div>
            <div class="message-content">
                <div class="message-text">${escapeHtml(content)}</div>
                <div class="message-time">${timeStr}</div>
            </div>
        `;

        messagesEl.appendChild(msgEl);
    }

    function appendTypingIndicator() {
        const messagesEl = document.getElementById('chat-messages');
        if (!messagesEl) return;

        // Remove any existing typing indicator
        removeTypingIndicator();

        const typingEl = document.createElement('div');
        typingEl.className = 'chat-message assistant typing-indicator';
        typingEl.id = 'typing-indicator';
        typingEl.innerHTML = `
            <div class="message-avatar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                </svg>
            </div>
            <div class="message-content">
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        messagesEl.appendChild(typingEl);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    function scrollToBottom() {
        const messagesEl = document.getElementById('chat-messages');
        if (messagesEl) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    }

    function updateThreadTitle(threadId, title) {
        // Update in local cache
        const thread = threads.find(t => t.id === threadId);
        if (thread) {
            thread.title = title;
            renderThreadList();
        }

        // Update current thread title if it matches
        if (currentThreadId === threadId) {
            const titleEl = document.getElementById('current-thread-title');
            if (titleEl) titleEl.textContent = title;
        }
    }

    function addNewThreadToList(threadId, title) {
        const newThread = {
            id: threadId,
            title: title,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        threads.unshift(newThread);
        currentThreadId = threadId;
        renderThreadList();

        // Update selector title
        const titleEl = document.getElementById('current-thread-title');
        if (titleEl) titleEl.textContent = title;
    }

    function incrementActivityBadge() {
        const badge = document.getElementById('activity-badge');
        const menuBadge = document.getElementById('activity-badge-menu');
        const tabActivity = document.getElementById('tab-activity');

        // Only show badge if Activity tab is not active
        if (tabActivity && !tabActivity.classList.contains('active')) {
            [badge, menuBadge].forEach(function(b) {
                if (b) {
                    const current = parseInt(b.textContent) || 0;
                    b.textContent = current + 1;
                    b.style.display = 'inline-flex';
                }
            });
        }
    }

    // Helpers - delegates to AppUtils
    function escapeHtml(str) {
        if (!str) return '';
        if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
            return AppUtils.escapeHtml(str);
        }
        // Fallback for safety
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 7) return `${diffDays}d`;
        return date.toLocaleDateString();
    }

    /**
     * Programmatically switch to the Chat tab
     * Used when sending messages from other tabs
     */
    function activateChatTab() {
        const tabChat = document.getElementById('tab-chat');
        if (tabChat && !tabChat.classList.contains('active')) {
            tabChat.click();
        }
    }

    // Public API
    return {
        init,
        loadThreads,
        selectThread,
        startNewThread,
        appendMessage,
        appendTypingIndicator,
        removeTypingIndicator,
        scrollToBottom,
        updateThreadTitle,
        addNewThreadToList,
        incrementActivityBadge,
        activateChatTab,
        getCurrentThreadId: () => currentThreadId,
        setCurrentThreadId: (id) => { currentThreadId = id; }
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for auth and other modules to be ready
    setTimeout(() => {
        ChatThread.init();
    }, 500);
});

// Expose globally
window.ChatThread = ChatThread;
window.setCurrentThreadId = ChatThread.setCurrentThreadId;
