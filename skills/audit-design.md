# Skill: Design Audit (UX/UI)

## Overview

Design audit from **UX Designer** and **UI Designer** perspectives. Focuses on user experience, visual consistency, accessibility, and mobile responsiveness.

## When to Use

Invoke with `/audit-design` when:
- After building new UI components
- Before launch (first impressions matter)
- When users report confusion
- After adding new pages/flows
- When reviewing customer-facing app

## Technique: User-Centered Analysis

Analyze from TWO design perspectives:

### 1. UX Designer
- User flows logical and efficient
- Cognitive load minimized
- Error prevention over error handling
- Feedback for all actions
- Progressive disclosure of complexity

### 2. UI Designer
- Visual hierarchy clear
- Spacing and typography consistent
- Color usage purposeful
- Component patterns reused
- Brand identity maintained

## Audit Checklist

### User Flow
```
[ ] Can complete primary task in < 3 clicks
[ ] Back button works as expected
[ ] Breadcrumbs/progress indicator for multi-step
[ ] No dead ends (always a next action)
[ ] Cancel/exit always available
[ ] Success state confirms completion
```

### Visual Hierarchy
```
[ ] Primary CTA is most prominent
[ ] Section headings create scannable structure
[ ] Important info above the fold
[ ] Related items grouped visually
[ ] Whitespace creates breathing room
```

### Accessibility (WCAG 2.1 AA)
```
[ ] Color contrast ratio ≥ 4.5:1 for text
[ ] Color contrast ratio ≥ 3:1 for UI elements
[ ] All images have alt text
[ ] Form inputs have labels (not just placeholders)
[ ] Focus states visible for keyboard nav
[ ] Skip to content link for screen readers
[ ] No color-only indicators (add icons/text)
[ ] Touch targets ≥ 44x44px on mobile
```

### Mobile Responsiveness
```
[ ] Readable at 375px width
[ ] No horizontal scroll
[ ] Touch targets adequate size
[ ] Forms usable on mobile keyboard
[ ] Images scale appropriately
[ ] Navigation accessible (hamburger or bottom nav)
```

### Typography
```
[ ] Max 2-3 font sizes per page
[ ] Line height comfortable (1.5+ for body)
[ ] Line length 50-75 characters
[ ] Headings use consistent scale
[ ] Body text ≥ 16px on mobile
```

### Spacing
```
[ ] Consistent spacing scale used (8px, 16px, 24px, 32px)
[ ] Padding inside components consistent
[ ] Margins between sections consistent
[ ] No cramped or floating elements
```

### Feedback & States
```
[ ] Button hover states
[ ] Button active/pressed states
[ ] Button disabled states
[ ] Input focus states
[ ] Input error states (red border + message)
[ ] Input success states (checkmark)
[ ] Loading indicators
[ ] Toast/notification for async actions
```

### Consistency
```
[ ] Same button styles throughout
[ ] Same modal/dialog pattern
[ ] Same form layout pattern
[ ] Same card component style
[ ] Same color for same meaning
[ ] Same icon style (outlined vs filled)
```

## Execution Format

```markdown
# Design Audit Report

## Summary
- **UX Issues**: X
- **UI Issues**: X
- **Accessibility Issues**: X
- **Mobile Issues**: X

---

## UX Issues

### 1. [HIGH] Confusing navigation on mobile
**Location:** app/sidebar.js
**Problem:** Hamburger menu doesn't indicate current page
**Impact:** Users don't know where they are
**Fix:** Add active state indicator to mobile nav items

**Current:**
[Screenshot or description]

**Recommended:**
[Screenshot or description]

---

### 2. [MEDIUM] No confirmation before delete
**Location:** app/customers.js:deleteCustomer()
**Problem:** Clicking delete immediately removes customer
**Impact:** Accidental data loss
**Fix:** Add confirmation modal with customer name

---

## UI Issues

### 1. [MEDIUM] Inconsistent button sizes
**Locations:**
- app/dashboard.html: "Add Customer" = 40px height
- app/customers.html: "Import" = 36px height
- app/settings.html: "Save" = 44px height

**Fix:** Standardize to 40px height for all primary buttons

---

## Accessibility Issues

### 1. [HIGH] Form inputs missing labels
**Location:** app/login.html
**Problem:** Email and password inputs use placeholder only
**Impact:** Screen readers can't identify fields
**WCAG:** 1.3.1 Info and Relationships

**Fix:**
```html
<label for="email">Email</label>
<input id="email" type="email" placeholder="you@example.com">
```

---

### 2. [MEDIUM] Low contrast text
**Location:** app/dashboard.css .stat-label
**Current:** #999 on #fff = 2.8:1 ratio
**Required:** 4.5:1 for AA compliance
**Fix:** Change to #666 for 5.7:1 ratio

---

## Mobile Issues

### 1. [HIGH] Table overflows on mobile
**Location:** app/customers.html
**Problem:** Customer table wider than viewport
**Fix:** Use responsive table pattern (cards on mobile)

---

## Passed Checks

- [x] Primary CTA color consistent (#6366f1)
- [x] Card shadows consistent
- [x] Modal pattern reused correctly
- [x] Icons from same family (Lucide)
```

## Royalty-Specific Design Standards

### Brand Colors
```css
--color-primary: #6366f1 (Indigo - main actions)
--color-success: #10b981 (Green - positive)
--color-warning: #f59e0b (Amber - attention)
--color-danger: #ef4444 (Red - destructive)
--color-neutral: #6b7280 (Gray - secondary)
```

### Component Patterns
- **Cards**: 8px border-radius, subtle shadow
- **Buttons**: 6px border-radius, 40px height
- **Inputs**: 6px border-radius, 40px height, 1px border
- **Modals**: 12px border-radius, backdrop blur

### Customer App Specifics
The customer-facing app (`customer-app/`) needs extra attention:
- First impression of the business
- Must look professional and trustworthy
- Mobile-first (most users on phones)
- Fast load times (< 3 seconds)
- Clear value proposition immediately visible

## Design Review Checklist for New Features

Before considering a feature "done":

```
[ ] Works on mobile (375px)
[ ] Works on tablet (768px)
[ ] Works on desktop (1440px)
[ ] Has loading state
[ ] Has empty state
[ ] Has error state
[ ] Buttons have hover/active states
[ ] Inputs have focus/error states
[ ] Follows existing patterns
[ ] Uses design system colors
[ ] Accessible (can tab through, has labels)
```

## Tools for Design Audit

- **Contrast Checker**: webaim.org/resources/contrastchecker
- **Mobile Preview**: Chrome DevTools device mode
- **Accessibility**: axe DevTools extension
- **Visual Regression**: Screenshot before/after
