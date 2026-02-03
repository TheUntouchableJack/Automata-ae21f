# Automata — UX Communication & Feedback Patterns

## The Principle

**Every action deserves a reaction.**

Users should never wonder:
- "Did that work?"
- "Is it loading?"
- "Should I click again?"
- "What just happened?"

Silence is the enemy. The interface should feel alive, responsive, and communicative at every moment.

---

## The Feedback Hierarchy

```
USER ACTION
     ↓
IMMEDIATE FEEDBACK (0-100ms)
     ↓
PROGRESS INDICATION (100ms-3s)
     ↓
COMPLETION CONFIRMATION (on success)
     ↓
ERROR RECOVERY (on failure)
```

Every click, every submit, every interaction flows through this.

---

## Immediate Feedback (0-100ms)

The moment a user interacts, something must change. No exceptions.

### Button States

```jsx
// ❌ Bad: No feedback
<button onClick={handleSubmit}>Save</button>

// ✅ Good: Immediate state change
<button 
  onClick={handleSubmit}
  disabled={isLoading}
  className={`
    transition-all duration-200
    ${isLoading ? 'opacity-70 scale-98' : 'hover:scale-102 active:scale-98'}
  `}
>
  {isLoading ? <Spinner /> : 'Save'}
</button>
```

### Click Prevention Pattern

Prevent double/triple clicks with immediate disable + visual change:

```jsx
function ActionButton({ onClick, children, ...props }) {
  const [isProcessing, setIsProcessing] = useState(false);
  
  const handleClick = async (e) => {
    if (isProcessing) return; // Block repeated clicks
    
    setIsProcessing(true);
    
    try {
      await onClick(e);
    } finally {
      setIsProcessing(false);
    }
  };
  
  return (
    <button
      onClick={handleClick}
      disabled={isProcessing}
      className={`
        relative overflow-hidden
        transition-all duration-300 ease-out
        ${isProcessing 
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
          : 'bg-gray-900 text-white hover:shadow-lg hover:-translate-y-0.5'
        }
      `}
      {...props}
    >
      {/* Shimmer effect while processing */}
      {isProcessing && (
        <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      )}
      
      <span className={`flex items-center gap-2 ${isProcessing ? 'opacity-0' : 'opacity-100'}`}>
        {children}
      </span>
      
      {isProcessing && (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoadingSpinner size="sm" />
        </span>
      )}
    </button>
  );
}
```

### Micro-Interactions

Every interactive element needs hover/active states:

```css
/* Standard interaction pattern */
.interactive {
  transition: all 0.2s ease-out;
}

.interactive:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.interactive:active {
  transform: translateY(0) scale(0.98);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

/* Disabled state */
.interactive:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
```

---

## Loading States

### The Loading Spinner (Automata Style)

Fluid, glowing, on-brand:

```jsx
function LoadingSpinner({ size = 'md', className = '' }) {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-10 h-10',
    xl: 'w-16 h-16',
  };
  
  return (
    <div className={`relative ${sizes[size]} ${className}`}>
      {/* Outer glow */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-400/20 to-cyan-400/20 blur-md animate-pulse" />
      
      {/* Spinning ring */}
      <svg
        className="animate-spin"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="2"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="url(#spinner-gradient)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="spinner-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4285F4" />
            <stop offset="100%" stopColor="#00D4FF" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
```

### Skeleton Loading

For content that takes time to load:

```jsx
function SkeletonCard() {
  return (
    <div className="glass-card rounded-2xl p-6 animate-pulse">
      {/* Avatar skeleton */}
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-r from-gray-100 to-gray-200" />
        <div className="flex-1">
          <div className="h-4 w-32 rounded-full bg-gradient-to-r from-gray-100 to-gray-200 mb-2" />
          <div className="h-3 w-24 rounded-full bg-gradient-to-r from-gray-100 to-gray-200" />
        </div>
      </div>
      
      {/* Content skeleton */}
      <div className="space-y-3">
        <div className="h-3 rounded-full bg-gradient-to-r from-gray-100 to-gray-200" />
        <div className="h-3 rounded-full bg-gradient-to-r from-gray-100 to-gray-200 w-5/6" />
        <div className="h-3 rounded-full bg-gradient-to-r from-gray-100 to-gray-200 w-4/6" />
      </div>
    </div>
  );
}

// Shimmer animation
const shimmerStyle = `
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  
  .skeleton-shimmer {
    background: linear-gradient(
      90deg,
      #f1f3f4 0%,
      #e8eaed 50%,
      #f1f3f4 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
`;
```

### Progress Indicators

For operations with known duration:

```jsx
function ProgressBar({ progress, label }) {
  return (
    <div className="space-y-2">
      {label && (
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">{label}</span>
          <span className="text-gray-900 font-medium">{Math.round(progress)}%</span>
        </div>
      )}
      
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div 
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        >
          {/* Animated shine */}
          <div className="w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
        </div>
      </div>
    </div>
  );
}
```

### Full-Page Loading

For initial page loads or major transitions:

```jsx
function PageLoader({ message = 'Loading...' }) {
  return (
    <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="text-center">
        {/* Animated logo or orb */}
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-400/20 to-cyan-400/20 animate-ping" />
          <div className="absolute inset-2 rounded-full bg-gradient-to-r from-blue-400/30 to-cyan-400/30 animate-pulse" />
          <div className="absolute inset-4 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 flex items-center justify-center">
            <span className="text-white font-semibold text-lg">A</span>
          </div>
        </div>
        
        <p className="text-gray-600 animate-pulse">{message}</p>
      </div>
    </div>
  );
}
```

---

## Confirmation Modals

### Modal Component (Automata Style)

```jsx
function Modal({ isOpen, onClose, children, size = 'md' }) {
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-gray-900/20 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className={`
          relative ${sizes[size]} w-full
          glass-card rounded-3xl p-8
          animate-scale-in
          shadow-2xl shadow-gray-900/10
        `}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        {children}
      </div>
    </div>
  );
}

// Animation keyframes
const modalAnimations = `
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes scale-in {
    from { 
      opacity: 0; 
      transform: scale(0.95) translateY(10px); 
    }
    to { 
      opacity: 1; 
      transform: scale(1) translateY(0); 
    }
  }
  
  .animate-fade-in {
    animation: fade-in 0.2s ease-out;
  }
  
  .animate-scale-in {
    animation: scale-in 0.3s ease-out;
  }
`;
```

### Confirmation Modal Variants

**Standard Confirmation:**
```jsx
function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', danger = false }) {
  const [isLoading, setIsLoading] = useState(false);
  
  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="text-center">
        {/* Icon */}
        <div className={`
          w-14 h-14 mx-auto mb-5 rounded-2xl flex items-center justify-center
          ${danger ? 'bg-red-50' : 'bg-blue-50'}
        `}>
          {danger ? (
            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : (
            <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>
        
        <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 mb-8">{message}</p>
        
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className={`
              flex-1 py-3 px-4 rounded-xl font-medium transition-all
              flex items-center justify-center gap-2
              ${danger 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-gray-900 hover:bg-gray-800 text-white'
              }
              ${isLoading ? 'opacity-70' : ''}
            `}
          >
            {isLoading ? <LoadingSpinner size="sm" /> : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

**Success Celebration Modal:**
```jsx
function SuccessModal({ isOpen, onClose, title, message }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="text-center">
        {/* Animated checkmark */}
        <div className="w-20 h-20 mx-auto mb-6 relative">
          <div className="absolute inset-0 rounded-full bg-green-100 animate-ping opacity-50" />
          <div className="relative w-full h-full rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
            <svg 
              className="w-10 h-10 text-white animate-check" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={3} 
                d="M5 13l4 4L19 7" 
                className="animate-draw-check"
              />
            </svg>
          </div>
          
          {/* Confetti particles */}
          <div className="absolute inset-0 pointer-events-none">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="absolute w-2 h-2 rounded-full animate-confetti"
                style={{
                  background: ['#4285F4', '#00D4FF', '#8B5CF6', '#F472B6', '#FBBF24'][i % 5],
                  left: '50%',
                  top: '50%',
                  animationDelay: `${i * 0.1}s`,
                  '--angle': `${i * 45}deg`,
                }}
              />
            ))}
          </div>
        </div>
        
        <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 mb-8">{message}</p>
        
        <button
          onClick={onClose}
          className="w-full py-3 px-4 rounded-xl bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors"
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}

// Confetti animation
const confettiAnimation = `
  @keyframes confetti {
    0% {
      transform: translate(-50%, -50%) rotate(0deg);
      opacity: 1;
    }
    100% {
      transform: translate(
        calc(-50% + cos(var(--angle)) * 60px), 
        calc(-50% + sin(var(--angle)) * 60px)
      ) rotate(720deg);
      opacity: 0;
    }
  }
  
  .animate-confetti {
    animation: confetti 0.6s ease-out forwards;
  }
  
  @keyframes draw-check {
    from { stroke-dashoffset: 24; }
    to { stroke-dashoffset: 0; }
  }
  
  .animate-draw-check {
    stroke-dasharray: 24;
    animation: draw-check 0.4s ease-out 0.2s forwards;
    stroke-dashoffset: 24;
  }
`;
```

---

## Toast Notifications

Non-blocking feedback for background actions:

```jsx
// Toast context and provider
const ToastContext = createContext();

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  
  const addToast = (toast) => {
    const id = Date.now();
    setToasts(prev => [...prev, { ...toast, id }]);
    
    // Auto-dismiss
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, toast.duration || 4000);
  };
  
  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };
  
  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      {toasts.map((toast, index) => (
        <Toast 
          key={toast.id} 
          {...toast} 
          onRemove={() => onRemove(toast.id)}
          style={{ animationDelay: `${index * 0.1}s` }}
        />
      ))}
    </div>
  );
}

function Toast({ type = 'info', title, message, onRemove, action }) {
  const icons = {
    success: (
      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    ),
    error: (
      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
        <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    ),
    warning: (
      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
        <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
    ),
    info: (
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
        <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
    ),
  };
  
  return (
    <div className="glass-card rounded-2xl p-4 min-w-80 max-w-md animate-slide-in-right shadow-lg">
      <div className="flex gap-3">
        {icons[type]}
        
        <div className="flex-1 min-w-0">
          {title && <p className="font-medium text-gray-900 text-sm">{title}</p>}
          {message && <p className="text-gray-600 text-sm mt-0.5">{message}</p>}
          
          {action && (
            <button
              onClick={action.onClick}
              className="text-blue-500 text-sm font-medium mt-2 hover:text-blue-600"
            >
              {action.label}
            </button>
          )}
        </div>
        
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Usage hook
function useToast() {
  const context = useContext(ToastContext);
  
  return {
    success: (title, message) => context.addToast({ type: 'success', title, message }),
    error: (title, message) => context.addToast({ type: 'error', title, message }),
    warning: (title, message) => context.addToast({ type: 'warning', title, message }),
    info: (title, message) => context.addToast({ type: 'info', title, message }),
  };
}

// Example usage
function SaveButton() {
  const toast = useToast();
  
  const handleSave = async () => {
    try {
      await saveData();
      toast.success('Saved!', 'Your changes have been saved.');
    } catch (error) {
      toast.error('Save failed', 'Please try again.');
    }
  };
}
```

---

## Form Feedback

### Input Validation States

```jsx
function FormInput({ label, error, success, hint, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      
      <div className="relative">
        <input
          className={`
            w-full px-4 py-3 rounded-xl border transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-offset-0
            ${error 
              ? 'border-red-300 focus:border-red-400 focus:ring-red-100' 
              : success
                ? 'border-green-300 focus:border-green-400 focus:ring-green-100'
                : 'border-gray-200 focus:border-blue-400 focus:ring-blue-100'
            }
          `}
          {...props}
        />
        
        {/* Status icon */}
        {(error || success) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {error ? (
              <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}
      </div>
      
      {/* Feedback text */}
      {error && <p className="text-sm text-red-500 flex items-center gap-1">{error}</p>}
      {success && <p className="text-sm text-green-500 flex items-center gap-1">{success}</p>}
      {hint && !error && !success && <p className="text-sm text-gray-500">{hint}</p>}
    </div>
  );
}
```

### Real-Time Validation Feedback

```jsx
function EmailInput({ value, onChange }) {
  const [status, setStatus] = useState('idle'); // idle, checking, valid, invalid
  
  useEffect(() => {
    if (!value) {
      setStatus('idle');
      return;
    }
    
    // Basic format check
    const isValidFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    
    if (!isValidFormat) {
      setStatus('invalid');
      return;
    }
    
    // Debounced server check
    setStatus('checking');
    const timer = setTimeout(async () => {
      const isAvailable = await checkEmailAvailable(value);
      setStatus(isAvailable ? 'valid' : 'invalid');
    }, 500);
    
    return () => clearTimeout(timer);
  }, [value]);
  
  return (
    <FormInput
      type="email"
      value={value}
      onChange={onChange}
      label="Email"
      error={status === 'invalid' ? 'Please enter a valid email' : null}
      success={status === 'valid' ? 'Looks good!' : null}
      hint={status === 'checking' ? 'Checking...' : 'We\'ll never share your email'}
    />
  );
}
```

---

## Optimistic UI Updates

Show success immediately, rollback on failure:

```jsx
function CustomerList() {
  const [customers, setCustomers] = useState([]);
  const toast = useToast();
  
  const deleteCustomer = async (customerId) => {
    // 1. Store previous state for rollback
    const previousCustomers = [...customers];
    
    // 2. Optimistically remove from UI immediately
    setCustomers(prev => prev.filter(c => c.id !== customerId));
    
    // 3. Show optimistic feedback
    toast.info('Deleting...', 'Customer is being removed');
    
    try {
      // 4. Actually delete on server
      await api.deleteCustomer(customerId);
      
      // 5. Confirm success
      toast.success('Deleted', 'Customer has been removed');
      
    } catch (error) {
      // 6. Rollback on failure
      setCustomers(previousCustomers);
      toast.error('Failed to delete', 'Please try again');
    }
  };
}
```

---

## Empty States

Never show a blank screen:

```jsx
function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {/* Animated icon/illustration */}
      <div className="w-24 h-24 mb-6 relative">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-50 to-cyan-50 animate-pulse" />
        <div className="relative w-full h-full flex items-center justify-center text-4xl">
          {icon}
        </div>
      </div>
      
      <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 max-w-sm mb-8">{description}</p>
      
      {action && (
        <button
          onClick={action.onClick}
          className="px-6 py-3 rounded-xl bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors flex items-center gap-2"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}

// Usage
<EmptyState
  icon="📬"
  title="No automations yet"
  description="Create your first automation and start connecting with customers at scale."
  action={{
    label: 'Create Automation',
    icon: <PlusIcon />,
    onClick: () => navigate('/automations/new')
  }}
/>
```

---

## Transition States

Smooth transitions between states:

```jsx
function DataLoader({ isLoading, isEmpty, error, children, skeleton }) {
  // Loading state
  if (isLoading) {
    return (
      <div className="animate-fade-in">
        {skeleton || <SkeletonCard />}
      </div>
    );
  }
  
  // Error state
  if (error) {
    return (
      <div className="animate-fade-in">
        <ErrorState 
          message={error.message} 
          onRetry={error.retry}
        />
      </div>
    );
  }
  
  // Empty state
  if (isEmpty) {
    return (
      <div className="animate-fade-in">
        <EmptyState {...emptyProps} />
      </div>
    );
  }
  
  // Content (with staggered animation)
  return (
    <div className="animate-fade-in">
      {children}
    </div>
  );
}
```

---

## The Communication Checklist

For every user action, verify:

### Immediate (0-100ms)
- [ ] Button shows pressed/active state
- [ ] Interactive element is disabled during processing
- [ ] Visual change confirms the click registered

### Progress (100ms-10s)
- [ ] Loading spinner or skeleton is visible
- [ ] Progress bar for long operations (>3s)
- [ ] User can cancel if appropriate

### Completion
- [ ] Success state is clearly shown (toast, modal, or inline)
- [ ] User knows what happened and what to do next
- [ ] Celebration for significant achievements (confetti!)

### Failure
- [ ] Error message is human-readable
- [ ] User knows how to recover (retry, fix input, contact support)
- [ ] State rolls back cleanly (optimistic UI)

### Transitions
- [ ] No jarring layout shifts
- [ ] Smooth fade/slide animations
- [ ] Consistent timing across the app

---

## Animation Timing Reference

| Context | Duration | Easing |
|---------|----------|--------|
| Button feedback | 100-200ms | ease-out |
| Toast enter | 300ms | ease-out |
| Toast exit | 200ms | ease-in |
| Modal enter | 300ms | ease-out |
| Modal exit | 200ms | ease-in |
| Page transition | 400-600ms | ease-in-out |
| Skeleton pulse | 1.5s | ease-in-out (loop) |
| Spinner | 1s | linear (loop) |
| Confetti | 600ms | ease-out |

---

## Anti-Patterns to Avoid

❌ **Silent failures** — Action fails but UI shows nothing  
❌ **Clickable while loading** — User can double-click and cause duplicate actions  
❌ **No loading state** — User wonders if their click worked  
❌ **Alert boxes** — Ugly, jarring, breaks flow  
❌ **Console errors only** — User has no idea what went wrong  
❌ **Infinite spinners** — No timeout, no way out  
❌ **Layout shift on load** — Content jumps around as it loads  
❌ **Generic error messages** — "Something went wrong" with no actionable info  

---

*"A responsive interface isn't just fast — it's communicative. Every moment of waiting should feel intentional, every action should feel acknowledged, and every outcome should feel clear."*
