/**
 * Undo Toast Component
 * Shows a toast with undo option after soft delete
 *
 * Usage:
 *   UndoToast.show({
 *       message: 'Project deleted',
 *       entityType: 'projects',
 *       entityId: projectId,
 *       entityName: 'My Project',
 *       onUndo: () => { ... }, // Called after successful restore
 *       onExpire: () => { ... } // Called when undo window expires (toast dismissed)
 *   });
 */

// Active toasts (for management)
const _undoToastActiveToasts = new Map();

// CSS for undo toast (injected once)
let _undoToastStylesInjected = false;

function _injectUndoToastStyles() {
    if (_undoToastStylesInjected) return;
    _undoToastStylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
        .undo-toast-container {
            position: fixed;
            top: 80px;
            right: 24px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 12px;
            pointer-events: none;
        }

        .undo-toast {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 14px 20px;
            background: var(--color-surface-elevated, #1a1a2e);
            border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
            border-radius: var(--radius-lg, 12px);
            box-shadow: var(--shadow-xl, 0 20px 40px rgba(0, 0, 0, 0.4));
            color: var(--color-text, #fff);
            font-size: 14px;
            pointer-events: auto;
            animation: undoToastSlideIn 0.3s ease-out;
            min-width: 320px;
            max-width: 480px;
        }

        .undo-toast.hiding {
            animation: undoToastSlideOut 0.2s ease-in forwards;
        }

        @keyframes undoToastSlideIn {
            from {
                opacity: 0;
                transform: translateX(20px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }

        @keyframes undoToastSlideOut {
            from {
                opacity: 1;
                transform: translateX(0);
            }
            to {
                opacity: 0;
                transform: translateX(20px);
            }
        }

        .undo-toast__icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            flex-shrink: 0;
        }

        .undo-toast__content {
            flex: 1;
            min-width: 0;
        }

        .undo-toast__message {
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .undo-toast__timer {
            font-size: 12px;
            color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
            margin-top: 2px;
        }

        .undo-toast__actions {
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }

        .undo-toast__btn {
            padding: 8px 16px;
            border-radius: var(--radius-md, 8px);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            border: none;
        }

        .undo-toast__btn--undo {
            background: var(--color-primary, #7c3aed);
            color: white;
        }

        .undo-toast__btn--undo:hover {
            background: var(--color-primary-hover, #5558e3);
            transform: translateY(-1px);
        }

        .undo-toast__btn--undo:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .undo-toast__btn--dismiss {
            background: transparent;
            color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
            padding: 8px;
        }

        .undo-toast__btn--dismiss:hover {
            color: var(--color-text, #fff);
        }

        .undo-toast__progress {
            position: absolute;
            bottom: 0;
            left: 0;
            height: 3px;
            background: var(--color-primary, #7c3aed);
            border-radius: 0 0 var(--radius-lg, 12px) var(--radius-lg, 12px);
            transition: width 1s linear;
        }

        /* Position relative for progress bar */
        .undo-toast {
            position: relative;
            overflow: hidden;
        }
    `;
    document.head.appendChild(style);
}

function _getOrCreateUndoToastContainer() {
    let container = document.querySelector('.undo-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'undo-toast-container';
        document.body.appendChild(container);
    }
    return container;
}

// Helper to get translations (uses global t function if available)
function _undoToastT(key, fallback, vars = {}) {
    if (typeof t === 'function') {
        return t(key, fallback, vars);
    }
    // Simple variable substitution for fallback
    let result = fallback;
    for (const [k, v] of Object.entries(vars)) {
        result = result.replace(`{${k}}`, v);
    }
    return result;
}

// Helper to escape HTML
function _escapeHtmlForUndoToast(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.UndoToast = {
    /**
     * Show an undo toast after soft delete
     * @param {object} options
     * @param {string} options.message - Main message (e.g., "Project deleted")
     * @param {string} options.entityType - Entity type for restore (projects, automations, etc.)
     * @param {string} options.entityId - UUID of deleted item
     * @param {string} options.entityName - Name of deleted item (for display)
     * @param {function} options.onUndo - Callback after successful restore
     * @param {function} options.onExpire - Callback when undo window expires (toast dismissed)
     * @param {number} options.duration - Toast duration in ms (default: 10000 = 10 seconds)
     * @returns {string} Toast ID for manual control
     */
    show(options) {
        const {
            message,
            entityType,
            entityId,
            entityName,
            onUndo,
            onExpire,
            duration = 10000 // 10 second toast (undo available for 1 hour)
        } = options;

        _injectUndoToastStyles();
        const container = _getOrCreateUndoToastContainer();
        const toastId = `undo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'undo-toast';
        toast.id = toastId;

        toast.innerHTML = `
            <div class="undo-toast__icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </div>
            <div class="undo-toast__content">
                <div class="undo-toast__message">${_escapeHtmlForUndoToast(message)}</div>
                <div class="undo-toast__timer">${_undoToastT('undo.canRestore', 'You can restore this for up to 1 hour')}</div>
            </div>
            <div class="undo-toast__actions">
                <button class="undo-toast__btn undo-toast__btn--undo" data-action="undo">
                    ${_undoToastT('undo.undo', 'Undo')}
                </button>
                <button class="undo-toast__btn undo-toast__btn--dismiss" data-action="dismiss" title="${_undoToastT('undo.dismiss', 'Dismiss')}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="undo-toast__progress" style="width: 100%"></div>
        `;

        // Add to container
        container.appendChild(toast);

        // Store toast data
        const toastData = {
            element: toast,
            entityType,
            entityId,
            entityName,
            onUndo,
            onExpire,
            createdAt: Date.now()
        };
        _undoToastActiveToasts.set(toastId, toastData);

        // Animate progress bar
        const progressBar = toast.querySelector('.undo-toast__progress');
        requestAnimationFrame(() => {
            progressBar.style.width = '0%';
            progressBar.style.transitionDuration = `${duration}ms`;
        });

        // Auto-dismiss timer
        const dismissTimer = setTimeout(() => {
            this.dismiss(toastId, true);
        }, duration);
        toastData.dismissTimer = dismissTimer;

        // Event listeners
        toast.addEventListener('click', async (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action === 'undo') {
                await this._handleUndo(toastId);
            } else if (action === 'dismiss') {
                this.dismiss(toastId);
            }
        });

        return toastId;
    },

    /**
     * Handle undo action
     */
    async _handleUndo(toastId) {
        const toastData = _undoToastActiveToasts.get(toastId);
        if (!toastData) return;

        const { element, entityType, entityId, entityName, onUndo } = toastData;
        const undoBtn = element.querySelector('[data-action="undo"]');

        // Disable button during restore
        undoBtn.disabled = true;
        undoBtn.textContent = _undoToastT('undo.restoring', 'Restoring...');

        try {
            const result = await SoftDelete.restore(entityType, entityId);

            if (result.success) {
                // Update toast to show success
                element.querySelector('.undo-toast__icon').innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                `;
                element.querySelector('.undo-toast__icon').style.background = 'rgba(16, 185, 129, 0.15)';
                element.querySelector('.undo-toast__message').textContent = _undoToastT('undo.restored', '{name} restored', { name: entityName || 'Item' });
                element.querySelector('.undo-toast__timer').textContent = '';

                // Hide actions
                element.querySelector('.undo-toast__actions').style.display = 'none';
                element.querySelector('.undo-toast__progress').style.display = 'none';

                // Call callback
                if (onUndo) {
                    try {
                        await onUndo(result.data);
                    } catch (err) {
                        console.error('[UndoToast] onUndo callback error:', err);
                    }
                }

                // Auto-dismiss after showing success
                setTimeout(() => this.dismiss(toastId), 2000);
            } else {
                // Show error
                undoBtn.disabled = false;
                undoBtn.textContent = _undoToastT('undo.undo', 'Undo');
                element.querySelector('.undo-toast__timer').textContent = result.error || _undoToastT('undo.restoreFailed', 'Failed to restore');
                element.querySelector('.undo-toast__timer').style.color = '#ef4444';
            }
        } catch (err) {
            console.error('[UndoToast] Restore error:', err);
            undoBtn.disabled = false;
            undoBtn.textContent = _undoToastT('undo.undo', 'Undo');
            element.querySelector('.undo-toast__timer').textContent = _undoToastT('undo.restoreFailed', 'Failed to restore');
            element.querySelector('.undo-toast__timer').style.color = '#ef4444';
        }
    },

    /**
     * Dismiss a toast
     * @param {string} toastId - Toast ID to dismiss
     * @param {boolean} expired - Whether toast expired (vs manual dismiss)
     */
    dismiss(toastId, expired = false) {
        const toastData = _undoToastActiveToasts.get(toastId);
        if (!toastData) return;

        const { element, dismissTimer, onExpire } = toastData;

        // Clear timer
        if (dismissTimer) {
            clearTimeout(dismissTimer);
        }

        // Animate out
        element.classList.add('hiding');

        setTimeout(() => {
            element.remove();
            _undoToastActiveToasts.delete(toastId);

            // Clean up container if empty
            const container = document.querySelector('.undo-toast-container');
            if (container && container.children.length === 0) {
                container.remove();
            }

            // Call expire callback if toast expired (not manually dismissed)
            if (expired && onExpire) {
                try {
                    onExpire();
                } catch (err) {
                    console.error('[UndoToast] onExpire callback error:', err);
                }
            }
        }, 200);
    },

    /**
     * Dismiss all active toasts
     */
    dismissAll() {
        for (const toastId of _undoToastActiveToasts.keys()) {
            this.dismiss(toastId);
        }
    },

    /**
     * Get count of active toasts
     */
    getActiveCount() {
        return _undoToastActiveToasts.size;
    }
};
