# Automata — Automation Marketplace

## The Concept

**Every piece of content builds the product.**

When we create blog posts, case studies, or marketing content featuring "sample automations," those automations don't just inspire — they become real, usable templates in a searchable marketplace. Content and product are the same thing.

```
BLOG POST with sample automation
         ↓
Automation saved to MARKETPLACE
         ↓
User discovers via SEARCH or BROWSE
         ↓
ONE-CLICK activation into their account
         ↓
User customizes for their business
         ↓
AUTOMATION GOES LIVE
```

Think Bubble's plugin marketplace, but for automations.

---

## Why This Matters

### For Marketing
- Every blog post adds product value
- SEO-rich content tied to actual functionality
- "See this automation? Click here to use it."
- Content becomes infinitely more actionable

### For Users
- Don't start from scratch — browse proven templates
- Discover use cases they hadn't considered
- Learn by example
- Faster time-to-value

### For the Product
- Growing library of automations (network effect)
- Community contributions (future)
- Data on what automations are popular
- Reduces onboarding friction

---

## Automation Template Schema

Every automation in the marketplace follows this structure:

```typescript
interface AutomationTemplate {
  // Identity
  id: string;                          // Unique identifier
  slug: string;                        // URL-friendly name
  version: string;                     // Template version
  
  // Display
  title: string;                       // "Happy Hour Alert"
  description: string;                 // Short description (160 chars)
  longDescription: string;             // Full markdown description
  icon: string;                        // Emoji or icon identifier
  coverImage?: string;                 // Preview image URL
  
  // Categorization
  category: AutomationCategory;        // 'engagement' | 'retention' | 'acquisition' | etc.
  industries: Industry[];              // ['restaurant', 'retail', 'healthcare']
  tags: string[];                      // ['location-based', 'weekly', 'promotional']
  
  // Automation Config
  triggerType: TriggerType;            // 'scheduled' | 'event' | 'behavioral'
  triggerConfig: object;               // Trigger-specific settings
  channelType: ChannelType;            // 'email' | 'sms' | 'both'
  contentTemplate: string;             // Message template with {{tokens}}
  segmentationRules?: SegmentRule[];   // Default audience filters
  
  // Metadata
  author: 'automata' | string;         // Creator (us or community)
  sourceUrl?: string;                  // Link to blog post / case study
  createdAt: Date;
  updatedAt: Date;
  
  // Metrics
  installs: number;                    // How many users activated this
  rating?: number;                     // User rating (future)
  featured: boolean;                   // Highlighted in marketplace
  
  // Customization hints
  requiredFields: string[];            // Customer fields needed
  customizationGuide: string;          // Help text for setup
  estimatedSetupTime: string;          // "2 minutes"
}

// Enums
type AutomationCategory = 
  | 'engagement'      // Keep customers active
  | 'retention'       // Prevent churn
  | 'acquisition'     // Get new customers
  | 'reactivation'    // Win back lapsed customers
  | 'celebration'     // Birthdays, milestones
  | 'transactional'   // Order updates, confirmations
  | 'feedback'        // Surveys, reviews
  | 'promotional';    // Sales, offers

type Industry =
  | 'restaurant'
  | 'retail'
  | 'healthcare'
  | 'fitness'
  | 'beauty'
  | 'professional-services'
  | 'real-estate'
  | 'automotive'
  | 'hospitality'
  | 'entertainment'
  | 'education'
  | 'nonprofit'
  | 'political'
  | 'ecommerce'
  | 'saas'
  | 'other';

type TriggerType =
  | 'scheduled'       // Time-based (weekly, monthly)
  | 'event'           // Date-based (birthday, anniversary)
  | 'behavioral'      // Action-based (no login in 30 days)
  | 'one-time';       // Manual blast
```

---

## Database Schema

```sql
-- Automation templates table
CREATE TABLE automation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(255) UNIQUE NOT NULL,
  version VARCHAR(20) DEFAULT '1.0.0',
  
  -- Display
  title VARCHAR(255) NOT NULL,
  description VARCHAR(500) NOT NULL,
  long_description TEXT,
  icon VARCHAR(50),
  cover_image_url TEXT,
  
  -- Categorization
  category VARCHAR(50) NOT NULL,
  industries TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  
  -- Automation config (JSONB for flexibility)
  trigger_type VARCHAR(50) NOT NULL,
  trigger_config JSONB DEFAULT '{}',
  channel_type VARCHAR(20) NOT NULL,
  content_template TEXT NOT NULL,
  segmentation_rules JSONB DEFAULT '[]',
  
  -- Metadata
  author VARCHAR(100) DEFAULT 'automata',
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Metrics
  installs INTEGER DEFAULT 0,
  rating DECIMAL(2,1),
  featured BOOLEAN DEFAULT FALSE,
  
  -- Customization
  required_fields TEXT[] DEFAULT '{}',
  customization_guide TEXT,
  estimated_setup_time VARCHAR(50),
  
  -- Status
  status VARCHAR(20) DEFAULT 'published', -- draft, published, archived
  
  -- Search
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(long_description, '')), 'C') ||
    setweight(to_tsvector('english', array_to_string(tags, ' ')), 'B')
  ) STORED
);

-- Full-text search index
CREATE INDEX idx_templates_search ON automation_templates USING GIN(search_vector);

-- Category/industry indexes for filtering
CREATE INDEX idx_templates_category ON automation_templates(category);
CREATE INDEX idx_templates_industries ON automation_templates USING GIN(industries);
CREATE INDEX idx_templates_tags ON automation_templates USING GIN(tags);

-- Featured/popular queries
CREATE INDEX idx_templates_featured ON automation_templates(featured, installs DESC);

-- Template installs tracking
CREATE TABLE template_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES automation_templates(id),
  business_id UUID REFERENCES businesses(id),
  automation_id UUID REFERENCES automations(id), -- The created automation
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(template_id, business_id, automation_id)
);

-- RLS: Templates are public read, admin write
ALTER TABLE automation_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Templates are publicly readable"
  ON automation_templates FOR SELECT
  USING (status = 'published');

CREATE POLICY "Only admins can modify templates"
  ON automation_templates FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');
```

---

## Marketplace UI Components

### Browse/Search Interface

```jsx
function AutomationMarketplace() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    category: null,
    industry: null,
    channel: null,
  });
  
  const { templates, isLoading } = useTemplates({ search, ...filters });
  
  return (
    <div className="max-w-7xl mx-auto px-8 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-semibold text-gray-900 mb-4">
          Automation Marketplace
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Browse proven automation templates. Click to activate. 
          Customize for your business. Go live in minutes.
        </p>
      </div>
      
      {/* Search */}
      <div className="max-w-xl mx-auto mb-8">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search automations..."
        />
      </div>
      
      {/* Filters */}
      <div className="flex flex-wrap gap-4 justify-center mb-12">
        <FilterDropdown
          label="Category"
          options={CATEGORIES}
          value={filters.category}
          onChange={(v) => setFilters({ ...filters, category: v })}
        />
        <FilterDropdown
          label="Industry"
          options={INDUSTRIES}
          value={filters.industry}
          onChange={(v) => setFilters({ ...filters, industry: v })}
        />
        <FilterDropdown
          label="Channel"
          options={CHANNELS}
          value={filters.channel}
          onChange={(v) => setFilters({ ...filters, channel: v })}
        />
      </div>
      
      {/* Featured Section */}
      {!search && !filters.category && (
        <FeaturedTemplates templates={templates.filter(t => t.featured)} />
      )}
      
      {/* Results Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map(template => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>
    </div>
  );
}
```

### Template Card

```jsx
function TemplateCard({ template }) {
  return (
    <div className="glass-card rounded-2xl p-6 hover:shadow-lg transition-all group">
      {/* Header */}
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 flex items-center justify-center text-2xl">
          {template.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
            {template.title}
          </h3>
          <p className="text-sm text-gray-500">
            {template.installs.toLocaleString()} installs
          </p>
        </div>
      </div>
      
      {/* Description */}
      <p className="text-gray-600 text-sm mb-4 line-clamp-2">
        {template.description}
      </p>
      
      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
          {template.category}
        </span>
        {template.industries.slice(0, 2).map(industry => (
          <span key={industry} className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs">
            {industry}
          </span>
        ))}
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          {template.channelType === 'email' && <MailIcon className="w-4 h-4" />}
          {template.channelType === 'sms' && <PhoneIcon className="w-4 h-4" />}
          <span>{template.triggerType}</span>
        </div>
        
        <button className="text-sm font-medium text-blue-600 hover:text-blue-700">
          View details →
        </button>
      </div>
    </div>
  );
}
```

### Template Detail Modal

```jsx
function TemplateDetailModal({ template, isOpen, onClose }) {
  const [isInstalling, setIsInstalling] = useState(false);
  const toast = useToast();
  
  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const automation = await installTemplate(template.id);
      toast.success('Installed!', 'Automation added to your account.');
      navigate(`/automations/${automation.id}/edit`);
    } catch (error) {
      toast.error('Installation failed', error.message);
    } finally {
      setIsInstalling(false);
    }
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-cyan-50 flex items-center justify-center text-3xl">
            {template.icon}
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">{template.title}</h2>
            <p className="text-gray-500">{template.installs.toLocaleString()} businesses use this</p>
          </div>
        </div>
        
        {/* Description */}
        <div className="prose prose-gray max-w-none">
          <ReactMarkdown>{template.longDescription}</ReactMarkdown>
        </div>
        
        {/* Preview */}
        <div className="rounded-xl bg-gray-50 p-6">
          <h4 className="font-medium text-gray-900 mb-3">Message Preview</h4>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-gray-700 whitespace-pre-wrap">
              {template.contentTemplate}
            </p>
          </div>
        </div>
        
        {/* Details */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-2">Trigger</h4>
            <p className="text-gray-900">{formatTrigger(template.triggerType, template.triggerConfig)}</p>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-2">Channel</h4>
            <p className="text-gray-900">{template.channelType}</p>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-2">Best for</h4>
            <p className="text-gray-900">{template.industries.join(', ')}</p>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-2">Setup time</h4>
            <p className="text-gray-900">{template.estimatedSetupTime}</p>
          </div>
        </div>
        
        {/* Required fields warning */}
        {template.requiredFields.length > 0 && (
          <div className="rounded-xl bg-amber-50 p-4 flex gap-3">
            <AlertIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800">Required customer data</p>
              <p className="text-sm text-amber-700">
                This automation needs: {template.requiredFields.join(', ')}
              </p>
            </div>
          </div>
        )}
        
        {/* Source link */}
        {template.sourceUrl && (
          <a 
            href={template.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            Read the full case study <ExternalLinkIcon className="w-4 h-4" />
          </a>
        )}
        
        {/* Actions */}
        <div className="flex gap-4 pt-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="flex-1 py-3 px-4 rounded-xl bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            {isInstalling ? (
              <LoadingSpinner size="sm" />
            ) : (
              <>
                <PlusIcon className="w-5 h-5" />
                Add to my automations
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

---

## Installation Flow

When a user clicks "Add to my automations":

```typescript
async function installTemplate(templateId: string, businessId: string) {
  // 1. Fetch the template
  const template = await getTemplate(templateId);
  
  // 2. Create automation from template
  const automation = await supabase
    .from('automations')
    .insert({
      business_id: businessId,
      title: template.title,
      description: template.description,
      trigger_type: template.triggerType,
      trigger_config: template.triggerConfig,
      channel_type: template.channelType,
      content: template.contentTemplate,
      segmentation_rules: template.segmentationRules,
      status: 'draft', // Always start as draft for review
      source_template_id: template.id,
    })
    .select()
    .single();
  
  // 3. Track the install
  await supabase
    .from('template_installs')
    .insert({
      template_id: templateId,
      business_id: businessId,
      automation_id: automation.id,
    });
  
  // 4. Increment install count
  await supabase.rpc('increment_template_installs', { template_id: templateId });
  
  // 5. Return the new automation for editing
  return automation;
}
```

---

## Content-to-Marketplace Pipeline

### When Writing Blog Posts

Every blog post with sample automations should include structured data:

```markdown
---
title: "5 Automations Every Restaurant Needs"
date: 2024-01-28
author: "Automata Team"
---

# 5 Automations Every Restaurant Needs

[Blog content...]

## 1. Happy Hour Alert

[Description of the automation...]

<!-- AUTOMATION_TEMPLATE
id: happy-hour-alert
title: Happy Hour Alert
description: Send location-based happy hour reminders to nearby customers every Thursday afternoon.
icon: 🍺
category: promotional
industries: [restaurant, bar, hospitality]
tags: [location-based, weekly, promotional, sms]
triggerType: scheduled
triggerConfig: { "dayOfWeek": 4, "time": "15:00", "timezone": "local" }
channelType: sms
contentTemplate: |
  Hey {{first_name}}! 🍺 Happy Hour starts in 1 hour at {{business_name}}. 
  
  $5 drinks & half-price apps until 7pm. 
  
  See you soon?
  
  Reply STOP to unsubscribe
segmentationRules: [{ "field": "distance_miles", "operator": "<=", "value": 5 }]
requiredFields: [first_name, location]
estimatedSetupTime: 2 minutes
-->

[More content...]
```

### Automated Extraction

Build system parses blog posts and extracts templates:

```typescript
async function extractTemplatesFromContent(markdownContent: string, sourceUrl: string) {
  const templateRegex = /<!-- AUTOMATION_TEMPLATE\n([\s\S]*?)\n-->/g;
  const templates = [];
  
  let match;
  while ((match = templateRegex.exec(markdownContent)) !== null) {
    const templateYaml = match[1];
    const templateData = yaml.parse(templateYaml);
    
    templates.push({
      ...templateData,
      sourceUrl,
      author: 'automata',
      status: 'draft', // Review before publishing
    });
  }
  
  return templates;
}

// On blog post publish
async function onBlogPostPublish(post: BlogPost) {
  const templates = await extractTemplatesFromContent(post.content, post.url);
  
  for (const template of templates) {
    // Upsert to allow updates
    await supabase
      .from('automation_templates')
      .upsert(template, { onConflict: 'slug' });
  }
  
  // Notify team to review new templates
  await notifyTeam('New templates extracted from blog post', { post, templates });
}
```

---

## Search & Discovery

### Full-Text Search

```typescript
async function searchTemplates(query: string, filters: Filters) {
  let queryBuilder = supabase
    .from('automation_templates')
    .select('*')
    .eq('status', 'published');
  
  // Full-text search
  if (query) {
    queryBuilder = queryBuilder.textSearch('search_vector', query, {
      type: 'websearch',
      config: 'english',
    });
  }
  
  // Filters
  if (filters.category) {
    queryBuilder = queryBuilder.eq('category', filters.category);
  }
  
  if (filters.industry) {
    queryBuilder = queryBuilder.contains('industries', [filters.industry]);
  }
  
  if (filters.channel) {
    queryBuilder = queryBuilder.eq('channel_type', filters.channel);
  }
  
  // Sorting
  queryBuilder = queryBuilder.order('featured', { ascending: false });
  queryBuilder = queryBuilder.order('installs', { ascending: false });
  
  return queryBuilder;
}
```

### Smart Recommendations

```typescript
async function getRecommendedTemplates(businessId: string) {
  // Get business profile
  const business = await getBusiness(businessId);
  
  // Get already installed templates
  const installed = await getInstalledTemplates(businessId);
  const installedIds = installed.map(t => t.id);
  
  // Find templates matching business industry
  const { data: recommended } = await supabase
    .from('automation_templates')
    .select('*')
    .eq('status', 'published')
    .contains('industries', [business.industry])
    .not('id', 'in', `(${installedIds.join(',')})`)
    .order('installs', { ascending: false })
    .limit(6);
  
  return recommended;
}
```

---

## Metrics & Analytics

### Track What Matters

```typescript
// Dashboard for marketplace health
interface MarketplaceMetrics {
  totalTemplates: number;
  totalInstalls: number;
  installsThisMonth: number;
  topTemplates: Array<{ template: Template; installs: number }>;
  topCategories: Array<{ category: string; installs: number }>;
  topIndustries: Array<{ industry: string; installs: number }>;
  conversionRate: number; // Views → Installs
  activationRate: number; // Installs → Active automations
}

// Per-template metrics
interface TemplateMetrics {
  views: number;
  installs: number;
  activeAutomations: number;
  messagesSent: number;
  avgOpenRate: number;
  avgClickRate: number;
}
```

### Use Data to Improve

- **Low installs, high views** → Improve description/preview
- **High installs, low activation** → Simplify setup process
- **Popular industries** → Create more templates for them
- **Popular categories** → Feature them prominently

---

## Future: Community Contributions

### Phase 1 (Current)
- Automata team creates all templates
- Extracted from blog posts and marketing content

### Phase 2 (Future)
- Users can submit automations as templates
- Review/approval process
- Credit to creators

### Phase 3 (Future)
- Creators can charge for premium templates
- Revenue share model
- Ratings and reviews

---

## Integration with Marketing Strategy

### The Flywheel

```
CONTENT MARKETING
    ↓
Blog post with sample automations
    ↓
Reader discovers useful automation
    ↓
CTA: "Use this automation →"
    ↓
Reader signs up / logs in
    ↓
TEMPLATE INSTALLED (instant value!)
    ↓
User customizes and activates
    ↓
User sees results
    ↓
User explores MORE templates
    ↓
User becomes advocate
    ↓
Creates content about their success
    ↓
MORE CONTENT MARKETING
```

### Blog Post CTAs

Every automation mentioned in content should have:

```jsx
<AutomationCTA 
  templateSlug="happy-hour-alert"
  title="Happy Hour Alert"
  description="Send location-based reminders to nearby customers."
/>

// Renders as:
<div className="glass-card rounded-xl p-6 my-8">
  <div className="flex items-center gap-4">
    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-2xl">
      🍺
    </div>
    <div className="flex-1">
      <h4 className="font-semibold text-gray-900">Happy Hour Alert</h4>
      <p className="text-sm text-gray-600">Send location-based reminders to nearby customers.</p>
    </div>
    <button className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium">
      Use this automation →
    </button>
  </div>
</div>
```

---

## The Marketplace Checklist

For every template added:

### Content Quality
- [ ] Title is clear and benefit-focused
- [ ] Description explains the value (not just what it does)
- [ ] Long description includes use cases and tips
- [ ] Icon is relevant and visually distinct

### Technical Quality
- [ ] Trigger config is valid and tested
- [ ] Content template has correct {{tokens}}
- [ ] Segmentation rules are logical
- [ ] Required fields are accurately listed

### Discoverability
- [ ] Category is correct
- [ ] Industries are comprehensive (not too narrow)
- [ ] Tags cover search terms users might use
- [ ] Slug is SEO-friendly

### Documentation
- [ ] Customization guide helps users adapt it
- [ ] Estimated setup time is realistic
- [ ] Source URL links to full context (if applicable)

---

*"Every piece of content we create adds value to the product. The marketplace is where content becomes capability."*
