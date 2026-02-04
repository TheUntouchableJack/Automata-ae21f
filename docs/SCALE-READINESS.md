# Royalty Scale Readiness Plan

> Last updated: January 30, 2026

## Current Status: 10x Ready (7.5/10)

The codebase has been optimized to handle 10x current load. This document tracks completed optimizations and plans for future scaling milestones.

---

## Stage 1: 10x Scale (COMPLETE)

### Database Optimizations
- [x] Composite indexes for soft-delete queries (`organization_id + deleted_at`)
- [x] GIN index for tags array column
- [x] RPC function: `get_org_usage_counts()` - single query for all usage metrics
- [x] RPC function: `get_unique_customer_tags()` - optimized tag aggregation
- [x] RPC function: `get_customer_stats()` - dashboard statistics
- [x] RPC function: `batch_update_customers()` - bulk operations

### Query Pattern Fixes
- [x] Eliminated N+1 in CSV import (batch updates)
- [x] Parallel data loading with `Promise.all()`
- [x] Replaced 4 sequential usage queries with single RPC

### Client-Side Optimizations
- [x] Event delegation for dynamic elements
- [x] Debounced search inputs (250ms)
- [x] Throttled scroll handlers
- [x] Pagination on automations page (12 items/page)

### Code Quality
- [x] Centralized utilities in `/app/utils.js`
- [x] Shared escapeHtml, debounce, throttle, delegate functions
- [x] Consistent error handling patterns

### Testing Infrastructure
- [x] Vitest for unit tests (75 tests)
- [x] Playwright for E2E tests (26 tests)
- [x] Test coverage for critical business logic

### Build Tooling
- [x] Vite configured for development and production
- [x] Multi-page app support
- [x] CSS code splitting

---

## Stage 2: 100x Scale (PLANNED)

Target: Handle 100x current user base without performance degradation.

### Database Optimizations

#### Server-Side Pagination
```sql
-- Add to existing RPC or create new ones
CREATE OR REPLACE FUNCTION get_customers_paginated(
  p_organization_id UUID,
  p_page INT DEFAULT 1,
  p_per_page INT DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  customers JSONB,
  total_count BIGINT,
  page INT,
  per_page INT,
  total_pages INT
) AS $$
  -- Implementation moves filtering to database
$$ LANGUAGE plpgsql;
```

- [ ] Server-side pagination for customers (critical for >1000 customers)
- [ ] Server-side pagination for automations
- [ ] Server-side search/filter (move from client to database)
- [ ] Database connection pooling configuration review

#### Indexes to Add
```sql
-- For server-side search
CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX idx_customers_email_trgm ON customers USING gin (email gin_trgm_ops);

-- For date-range queries
CREATE INDEX idx_automations_created_at ON automations(created_at DESC);
CREATE INDEX idx_customers_created_at ON customers(created_at DESC);
```

- [ ] Trigram indexes for fast text search
- [ ] Partial indexes for active-only queries
- [ ] Index usage audit (remove unused indexes)

### Caching Layer

#### Option A: Supabase Edge Functions Cache
```javascript
// Edge function with cache headers
export default async function handler(req) {
  const data = await supabase.from('...').select('...');
  return new Response(JSON.stringify(data), {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
    }
  });
}
```

#### Option B: Service Worker Cache
```javascript
// sw.js - Cache API responses
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/rest/v1/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetched = fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open('api-cache').then((cache) => {
            cache.put(event.request, clone);
          });
          return response;
        });
        return cached || fetched;
      })
    );
  }
});
```

- [ ] Implement caching strategy (choose A or B)
- [ ] Cache invalidation on mutations
- [ ] Cache warming for dashboard data

### Client-Side Optimizations

#### Virtual Scrolling
```javascript
// For lists with 1000+ items
import { VirtualList } from './virtual-list.js';

const list = new VirtualList({
  container: document.getElementById('customers-list'),
  itemHeight: 72,
  renderItem: (customer) => `<div class="customer-row">...</div>`,
  data: customers
});
```

- [ ] Virtual scrolling for large lists
- [ ] Lazy loading for off-screen content
- [ ] Image optimization (WebP, lazy loading)

#### Bundle Optimization
- [ ] Convert scripts to ES modules
- [ ] Tree shaking for unused code
- [ ] Code splitting per route
- [ ] Preload critical resources

### Infrastructure

- [ ] CDN for static assets
- [ ] Supabase connection pool sizing
- [ ] Rate limiting review and adjustment
- [ ] Error tracking (Sentry or similar)
- [ ] Performance monitoring (Web Vitals)

### Testing for Scale

- [ ] Load testing with k6 or Artillery
- [ ] Database query performance benchmarks
- [ ] Lighthouse performance audits
- [ ] Memory leak detection

---

## Stage 3: 1000x Scale (FUTURE)

For massive scale, consider:

### Architecture Changes
- [ ] Read replicas for Supabase
- [ ] Microservices for heavy processing (AI analysis)
- [ ] Message queues for async operations
- [ ] Dedicated search service (Typesense/Meilisearch)

### Advanced Caching
- [ ] Redis for session/real-time data
- [ ] CDN edge caching for API responses
- [ ] GraphQL with DataLoader pattern

### Global Distribution
- [ ] Multi-region deployment
- [ ] Edge functions for latency-sensitive operations
- [ ] Geo-based routing

---

## Quick Reference: Commands

```bash
# Run unit tests
npm run test

# Run E2E tests
npm run test:e2e

# Build for production
npm run build

# Start dev server
npm run dev

# Check i18n completeness
npm run check-i18n
```

## Files Modified for Scale

| File | Optimization |
|------|--------------|
| `database/scale-optimization-migration.sql` | Indexes + RPC functions |
| `app/utils.js` | Shared utilities |
| `app/customers.js` | Batch operations, optimized queries |
| `app/dashboard.js` | Parallel loading, event delegation |
| `app/automations.js` | Pagination, debounced search |
| `script.js` | Throttled scroll |

## Performance Benchmarks

Track these metrics as you scale:

| Metric | 10x Target | Current | 100x Target |
|--------|------------|---------|-------------|
| Dashboard load | <2s | TBD | <1s |
| Customer list (1000) | <1s | TBD | <500ms |
| Search response | <300ms | TBD | <100ms |
| CSV import (1000 rows) | <10s | TBD | <5s |

---

## Checklist Before Each Scale Stage

### Before 10x (DONE)
- [x] No N+1 queries
- [x] Indexes on filtered columns
- [x] Client-side pagination
- [x] Basic test coverage

### Before 100x
- [ ] Server-side pagination
- [ ] Caching layer
- [ ] Load testing passed
- [ ] Error monitoring active
- [ ] Performance baselines documented

### Before 1000x
- [ ] Read replicas configured
- [ ] Async processing for heavy ops
- [ ] Multi-region ready
- [ ] 99.9% uptime SLA achievable
