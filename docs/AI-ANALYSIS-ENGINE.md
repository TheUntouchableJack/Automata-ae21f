# Automata — AI Automation Analysis Engine

## The Core Loop

This is the heart of Automata. The moment where data becomes insight, and insight becomes action.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA COLLECTION                              │
├─────────────────────────────────────────────────────────────────────┤
│  ORGANIZATION          PROJECT              CUSTOMERS                │
│  ─────────────         ───────              ─────────                │
│  • Business type       • Title              • Demographics           │
│  • Industry            • Description        • Contact info           │
│  • Goals               • Goals              • Custom fields          │
│  • Revenue             • Pain points        • Engagement history     │
│  • Location            • Target outcomes    • Segments               │
│  • Language                                                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         AI ANALYSIS                                  │
├─────────────────────────────────────────────────────────────────────┤
│  • Pattern recognition across customer data                          │
│  • Goal alignment with business objectives                           │
│  • Pain point → solution mapping                                     │
│  • Industry best practices injection                                 │
│  • Segmentation opportunity detection                                │
│  • Timing and frequency optimization                                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      OPPORTUNITY GENERATION                          │
├─────────────────────────────────────────────────────────────────────┤
│  5-10+ tailored automation proposals, each with:                     │
│  • Title & description                                               │
│  • Reasoning (why this matters for YOUR business)                    │
│  • Expected impact                                                   │
│  • Trigger type & timing                                             │
│  • Target segment                                                    │
│  • Message template                                                  │
│  • One-click "Add Automation" button                                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      HUMAN-IN-THE-LOOP                               │
├─────────────────────────────────────────────────────────────────────┤
│  User reviews each proposal:                                         │
│  • SKIP — Not interested                                             │
│  • ADD — Create automation (goes to draft)                           │
│  • EDIT — Customize before adding                                    │
│                                                                      │
│  Then for added automations:                                         │
│  • REVIEW — Check settings, preview message                          │
│  • TEST — Send test to self                                          │
│  • ACTIVATE — Go live                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Industry-Standard Fields & Custom Fields

### The Philosophy

**Start with what works, then let them expand.**

Every industry has standard customer data fields. We present these by default, making onboarding frictionless. But businesses are unique — so we let them add custom fields that matter to THEM.

### Industry-Standard Field Sets

```typescript
const INDUSTRY_FIELD_SETS: Record<Industry, FieldDefinition[]> = {
  restaurant: [
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: false },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
    { name: 'birthday', label: 'Birthday', type: 'date', required: false },
    { name: 'favorite_dish', label: 'Favorite Dish', type: 'text', required: false },
    { name: 'dietary_restrictions', label: 'Dietary Restrictions', type: 'multiselect', 
      options: ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut Allergy', 'None'] },
    { name: 'preferred_location', label: 'Preferred Location', type: 'text', required: false },
    { name: 'avg_party_size', label: 'Avg Party Size', type: 'number', required: false },
    { name: 'last_visit', label: 'Last Visit', type: 'date', required: false },
    { name: 'total_visits', label: 'Total Visits', type: 'number', required: false },
    { name: 'lifetime_spend', label: 'Lifetime Spend', type: 'currency', required: false },
  ],
  
  healthcare: [
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: false },
    { name: 'phone', label: 'Phone', type: 'phone', required: true },
    { name: 'birthday', label: 'Date of Birth', type: 'date', required: true },
    { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other', 'Prefer not to say'] },
    { name: 'address', label: 'Address', type: 'address', required: false },
    { name: 'insurance_provider', label: 'Insurance Provider', type: 'text', required: false },
    { name: 'primary_physician', label: 'Primary Physician', type: 'text', required: false },
    { name: 'last_appointment', label: 'Last Appointment', type: 'date', required: false },
    { name: 'next_appointment', label: 'Next Appointment', type: 'date', required: false },
    { name: 'preferred_contact', label: 'Preferred Contact Method', type: 'select', 
      options: ['Phone', 'Email', 'Text'] },
  ],
  
  retail: [
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
    { name: 'birthday', label: 'Birthday', type: 'date', required: false },
    { name: 'address', label: 'Shipping Address', type: 'address', required: false },
    { name: 'loyalty_points', label: 'Loyalty Points', type: 'number', required: false },
    { name: 'loyalty_tier', label: 'Loyalty Tier', type: 'select', 
      options: ['Bronze', 'Silver', 'Gold', 'Platinum'] },
    { name: 'favorite_category', label: 'Favorite Category', type: 'text', required: false },
    { name: 'shoe_size', label: 'Shoe Size', type: 'text', required: false },
    { name: 'clothing_size', label: 'Clothing Size', type: 'select', 
      options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
    { name: 'total_orders', label: 'Total Orders', type: 'number', required: false },
    { name: 'lifetime_spend', label: 'Lifetime Spend', type: 'currency', required: false },
    { name: 'last_purchase', label: 'Last Purchase', type: 'date', required: false },
  ],
  
  fitness: [
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
    { name: 'birthday', label: 'Birthday', type: 'date', required: false },
    { name: 'membership_type', label: 'Membership Type', type: 'select',
      options: ['Basic', 'Premium', 'VIP', 'Day Pass'] },
    { name: 'membership_start', label: 'Member Since', type: 'date', required: false },
    { name: 'membership_expiry', label: 'Membership Expires', type: 'date', required: false },
    { name: 'fitness_goals', label: 'Fitness Goals', type: 'multiselect',
      options: ['Weight Loss', 'Muscle Gain', 'Endurance', 'Flexibility', 'General Health'] },
    { name: 'preferred_classes', label: 'Preferred Classes', type: 'multiselect',
      options: ['Yoga', 'Spin', 'HIIT', 'Pilates', 'Swimming', 'Weights'] },
    { name: 'trainer', label: 'Personal Trainer', type: 'text', required: false },
    { name: 'visits_this_month', label: 'Visits This Month', type: 'number', required: false },
  ],
  
  professional_services: [
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
    { name: 'company', label: 'Company', type: 'text', required: false },
    { name: 'job_title', label: 'Job Title', type: 'text', required: false },
    { name: 'industry', label: 'Industry', type: 'text', required: false },
    { name: 'service_type', label: 'Service Type', type: 'text', required: false },
    { name: 'contract_value', label: 'Contract Value', type: 'currency', required: false },
    { name: 'contract_start', label: 'Contract Start', type: 'date', required: false },
    { name: 'contract_end', label: 'Contract End', type: 'date', required: false },
    { name: 'referral_source', label: 'Referral Source', type: 'text', required: false },
    { name: 'satisfaction_score', label: 'Satisfaction Score', type: 'number', required: false },
  ],
  
  // Default for any industry
  default: [
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: false },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
    { name: 'birthday', label: 'Birthday', type: 'date', required: false },
    { name: 'location', label: 'Location', type: 'text', required: false },
    { name: 'notes', label: 'Notes', type: 'textarea', required: false },
  ],
};
```

### Custom Field Types

```typescript
interface CustomFieldDefinition {
  id: string;
  organization_id: string;
  
  name: string;                    // Internal name (snake_case)
  label: string;                   // Display label
  type: FieldType;
  required: boolean;
  
  // Type-specific config
  options?: string[];              // For select/multiselect
  min?: number;                    // For number
  max?: number;
  placeholder?: string;
  help_text?: string;
  
  // Ordering
  sort_order: number;
  section: 'basic' | 'demographics' | 'business' | 'engagement' | 'custom';
  
  // Metadata
  created_at: Date;
  created_by: string;
}

type FieldType = 
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'url'
  | 'address';
```

### Field Management UI

```jsx
function FieldManager({ organizationId, industry }) {
  const standardFields = INDUSTRY_FIELD_SETS[industry] || INDUSTRY_FIELD_SETS.default;
  const { customFields, addField, removeField, updateField } = useCustomFields(organizationId);
  
  return (
    <div className="space-y-8">
      {/* Standard Fields */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Standard Fields</h3>
          <span className="text-sm text-gray-500">
            Recommended for {industry} businesses
          </span>
        </div>
        
        <div className="space-y-2">
          {standardFields.map(field => (
            <FieldRow 
              key={field.name}
              field={field}
              isStandard
              onToggle={() => toggleStandardField(field.name)}
            />
          ))}
        </div>
      </section>
      
      {/* Custom Fields */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Custom Fields</h3>
          <button 
            onClick={() => setShowAddField(true)}
            className="text-sm text-blue-600 flex items-center gap-1"
          >
            <PlusIcon className="w-4 h-4" /> Add Field
          </button>
        </div>
        
        {customFields.length === 0 ? (
          <EmptyState
            icon="📝"
            title="No custom fields yet"
            description="Add fields specific to your business needs"
          />
        ) : (
          <div className="space-y-2">
            {customFields.map(field => (
              <FieldRow
                key={field.id}
                field={field}
                onEdit={() => editField(field)}
                onRemove={() => removeField(field.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

---

## CSV Import with AI-Powered Column Mapping

### The Experience

Like Bubble and Mailchimp — but smarter. Claude AI analyzes CSV headers and suggests the best mapping automatically.

```
┌─────────────────────────────────────────────────────────────────────┐
│  UPLOAD CSV                                                         │
│  ─────────                                                          │
│  User drops/selects CSV file                                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  AI COLUMN DETECTION                                                 │
│  ───────────────────                                                 │
│  Claude analyzes headers:                                            │
│  • "First Name" → first_name (98% confidence)                        │
│  • "Email Address" → email (99% confidence)                          │
│  • "DOB" → birthday (85% confidence)                                 │
│  • "Fav Food" → favorite_dish (72% confidence) ← needs review        │
│  • "Member #" → ??? (suggests custom field)                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MAPPING REVIEW                                                      │
│  ──────────────                                                      │
│  User reviews AI suggestions:                                        │
│  • Confirm auto-mapped columns ✓                                     │
│  • Fix any mismatches                                                │
│  • Create custom fields for unknown columns                          │
│  • Skip columns they don't need                                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PREVIEW & IMPORT                                                    │
│  ────────────────                                                    │
│  Show sample rows with mapped data                                   │
│  Validate data types                                                 │
│  Import with progress indicator                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### AI Column Detection

```typescript
interface ColumnMapping {
  csv_column: string;              // Original header from CSV
  mapped_to: string | null;        // Our field name, or null if skipped
  confidence: number;              // 0-1 confidence score
  suggestions: Array<{             // Alternative mappings
    field: string;
    confidence: number;
  }>;
  is_new_field: boolean;           // Should we create a custom field?
  new_field_type?: FieldType;      // Suggested type for new field
  sample_values: string[];         // First 3 values for preview
}

async function detectColumnMappings(
  csvHeaders: string[], 
  sampleRows: string[][],
  organizationFields: FieldDefinition[]
): Promise<ColumnMapping[]> {
  
  const prompt = `
You are helping map CSV columns to customer database fields.

## AVAILABLE FIELDS
${organizationFields.map(f => `- ${f.name}: ${f.label} (${f.type})`).join('\n')}

## CSV COLUMNS TO MAP
${csvHeaders.map((header, i) => {
  const samples = sampleRows.slice(0, 3).map(row => row[i]).filter(Boolean);
  return `- "${header}" (samples: ${samples.join(', ')})`;
}).join('\n')}

## YOUR TASK
For each CSV column, determine:
1. Which field it should map to (or null to skip)
2. Confidence score (0-1)
3. Alternative suggestions if confidence < 0.9
4. If no good match, suggest creating a new custom field with appropriate type

Consider:
- Common variations ("First Name", "FirstName", "fname", "given_name" → first_name)
- Data patterns in samples (emails, phones, dates)
- Industry context

Respond in JSON:
{
  "mappings": [
    {
      "csv_column": "...",
      "mapped_to": "field_name" | null,
      "confidence": 0.95,
      "suggestions": [{"field": "...", "confidence": 0.8}],
      "is_new_field": false,
      "new_field_type": null
    }
  ]
}
`;

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });
  
  return JSON.parse(response.content[0].text).mappings;
}
```

### Column Mapping UI

```jsx
function CSVColumnMapper({ csvData, organizationFields, onComplete }) {
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  
  useEffect(() => {
    async function analyze() {
      const detected = await detectColumnMappings(
        csvData.headers,
        csvData.rows.slice(0, 10),
        organizationFields
      );
      setMappings(detected);
      setIsAnalyzing(false);
    }
    analyze();
  }, [csvData]);
  
  if (isAnalyzing) {
    return (
      <div className="text-center py-12">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-gray-600">AI is analyzing your columns...</p>
      </div>
    );
  }
  
  const highConfidence = mappings.filter(m => m.confidence >= 0.85);
  const needsReview = mappings.filter(m => m.confidence < 0.85 && m.confidence > 0);
  const unmatched = mappings.filter(m => m.mapped_to === null);
  
  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="glass-card rounded-xl p-4 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-sm">{highConfidence.length} auto-mapped</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-sm">{needsReview.length} need review</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-gray-300" />
          <span className="text-sm">{unmatched.length} unmatched</span>
        </div>
      </div>
      
      {/* Mapping Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                CSV Column
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                Sample Data
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                Maps To
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {mappings.map((mapping, index) => (
              <ColumnMappingRow
                key={index}
                mapping={mapping}
                availableFields={organizationFields}
                onChange={(newMapping) => updateMapping(index, newMapping)}
              />
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Actions */}
      <div className="flex justify-end gap-4">
        <button className="btn btn-secondary">Back</button>
        <button 
          className="btn btn-primary"
          onClick={() => onComplete(mappings)}
        >
          Continue to Preview
        </button>
      </div>
    </div>
  );
}

function ColumnMappingRow({ mapping, availableFields, onChange }) {
  const confidenceColor = 
    mapping.confidence >= 0.85 ? 'text-green-600 bg-green-50' :
    mapping.confidence >= 0.5 ? 'text-amber-600 bg-amber-50' :
    'text-gray-600 bg-gray-50';
  
  return (
    <tr className={mapping.confidence < 0.85 ? 'bg-amber-50/30' : ''}>
      <td className="px-4 py-3">
        <span className="font-medium text-gray-900">{mapping.csv_column}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-gray-500">
          {mapping.sample_values.slice(0, 2).join(', ')}
        </span>
      </td>
      <td className="px-4 py-3">
        <select
          value={mapping.mapped_to || ''}
          onChange={(e) => onChange({ ...mapping, mapped_to: e.target.value || null })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        >
          <option value="">— Skip this column —</option>
          <optgroup label="Standard Fields">
            {availableFields.filter(f => !f.isCustom).map(field => (
              <option key={field.name} value={field.name}>
                {field.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Custom Fields">
            {availableFields.filter(f => f.isCustom).map(field => (
              <option key={field.name} value={field.name}>
                {field.label}
              </option>
            ))}
          </optgroup>
          <option value="__new__">+ Create new field...</option>
        </select>
      </td>
      <td className="px-4 py-3">
        {mapping.mapped_to && (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${confidenceColor}`}>
            {Math.round(mapping.confidence * 100)}%
          </span>
        )}
      </td>
    </tr>
  );
}
```

---

## Data Model

### Organization (Company)

```typescript
interface Organization {
  id: string;
  name: string;
  
  // Business Context
  business_type: string;           // "Restaurant", "Dental Practice", "Retail Store"
  industry: Industry;              // Enum for categorization
  description: string;             // What they do
  
  // Goals & Challenges
  primary_goals: string[];         // ["Increase repeat visits", "Reduce no-shows"]
  current_challenges: string[];    // Pain points
  
  // Operational Details
  revenue_range?: string;          // "< $100k", "$100k-$500k", etc.
  customer_count_range?: string;   // "1-100", "100-1000", etc.
  team_size?: number;
  
  // Location & Language
  country: string;
  timezone: string;
  language: string;                // For message generation
  
  // Metadata
  created_at: Date;
  updated_at: Date;
}
```

### Project

```typescript
interface Project {
  id: string;
  organization_id: string;
  
  // Identity
  name: string;
  description: string;
  
  // Context for AI
  goals: string[];                 // What they want to achieve
  pain_points: string[];           // Why it's been difficult
  target_outcomes: string[];       // Success metrics
  
  // Customer Subset
  customer_ids: string[];          // Customers in this project
  customer_count: number;
  
  // Analysis State
  last_analyzed_at?: Date;
  analysis_status: 'pending' | 'analyzing' | 'complete' | 'error';
  
  // Metadata
  created_at: Date;
  updated_at: Date;
}
```

### Customer

```typescript
interface Customer {
  id: string;
  organization_id: string;
  
  // Core Fields
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  
  // Demographics
  birthday?: Date;
  gender?: string;
  location?: {
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    coordinates?: { lat: number; lng: number };
  };
  
  // Business-Specific
  occupation?: string;
  company?: string;
  
  // Engagement
  first_contact_date?: Date;
  last_contact_date?: Date;
  total_visits?: number;
  total_spend?: number;
  
  // Segmentation
  tags: string[];
  segments: string[];              // Auto-calculated or manual
  
  // Custom Fields (dynamic)
  custom_fields: Record<string, any>;
  
  // Notes
  notes?: string;
  
  // Metadata
  created_at: Date;
  updated_at: Date;
}

// Project-Customer relationship (subset with project-specific data)
interface ProjectCustomer {
  project_id: string;
  customer_id: string;
  
  // Project-specific overrides or additions
  project_tags?: string[];
  project_notes?: string;
  project_custom_fields?: Record<string, any>;
  
  added_at: Date;
}
```

---

## Project Creation Flow

### Step 1: Project Details

```jsx
function ProjectCreationStep1() {
  return (
    <div className="space-y-6">
      <FormInput
        label="Project Name"
        placeholder="e.g., Q1 Customer Retention Campaign"
        required
      />
      
      <FormTextarea
        label="Description"
        placeholder="What is this project about?"
        hint="Help the AI understand the context"
      />
      
      <FormTagInput
        label="Goals"
        placeholder="Add a goal and press Enter"
        hint="What do you want to achieve?"
        suggestions={[
          "Increase repeat visits",
          "Reduce customer churn",
          "Boost average order value",
          "Improve customer satisfaction",
          "Re-engage inactive customers",
          "Grow referral rate"
        ]}
      />
      
      <FormTagInput
        label="Pain Points"
        placeholder="Add a challenge and press Enter"
        hint="Why has this been difficult?"
        suggestions={[
          "Don't have time for manual outreach",
          "Don't know which customers to target",
          "Messages feel impersonal",
          "No system for tracking engagement",
          "Customers forget about us"
        ]}
      />
    </div>
  );
}
```

### Step 2: Add Customers

```jsx
function ProjectCreationStep2() {
  const [mode, setMode] = useState<'csv' | 'manual' | 'existing'>('existing');
  
  return (
    <div className="space-y-6">
      {/* Mode Selection */}
      <div className="grid grid-cols-3 gap-4">
        <ModeCard
          icon="📁"
          title="Upload CSV"
          description="Import from spreadsheet"
          selected={mode === 'csv'}
          onClick={() => setMode('csv')}
        />
        <ModeCard
          icon="✏️"
          title="Add Manually"
          description="Enter one by one"
          selected={mode === 'manual'}
          onClick={() => setMode('manual')}
        />
        <ModeCard
          icon="👥"
          title="Existing Customers"
          description="Select from your list"
          selected={mode === 'existing'}
          onClick={() => setMode('existing')}
        />
      </div>
      
      {/* Mode-specific content */}
      {mode === 'csv' && <CSVUploader />}
      {mode === 'manual' && <ManualCustomerForm />}
      {mode === 'existing' && <ExistingCustomerSelector />}
    </div>
  );
}
```

### Manual Customer Form (Expandable Fields)

```jsx
function ManualCustomerForm() {
  const [expandedSections, setExpandedSections] = useState(['basic']);
  
  const sections = [
    {
      id: 'basic',
      title: 'Basic Info',
      required: true,
      fields: ['first_name', 'last_name', 'email', 'phone']
    },
    {
      id: 'demographics',
      title: 'Demographics',
      fields: ['birthday', 'gender', 'location']
    },
    {
      id: 'business',
      title: 'Business Details',
      fields: ['occupation', 'company', 'total_visits', 'total_spend']
    },
    {
      id: 'custom',
      title: 'Custom Fields',
      fields: [] // Dynamic
    }
  ];
  
  return (
    <div className="space-y-4">
      {sections.map(section => (
        <ExpandableSection
          key={section.id}
          title={section.title}
          required={section.required}
          expanded={expandedSections.includes(section.id)}
          onToggle={() => toggleSection(section.id)}
        >
          <FieldGroup fields={section.fields} />
        </ExpandableSection>
      ))}
      
      <button 
        onClick={addCustomField}
        className="text-sm text-blue-600 flex items-center gap-2"
      >
        <PlusIcon /> Add Custom Field
      </button>
    </div>
  );
}
```

---

## AI Analysis Pipeline

### Trigger Analysis

Analysis runs when:
1. Project is created with customers
2. New customers are added to project
3. User manually requests re-analysis
4. Significant time has passed since last analysis

```typescript
async function triggerAnalysis(projectId: string) {
  // 1. Update status
  await updateProject(projectId, { 
    analysis_status: 'analyzing',
    last_analyzed_at: new Date()
  });
  
  // 2. Gather context
  const context = await gatherAnalysisContext(projectId);
  
  // 3. Run AI analysis
  const opportunities = await generateOpportunities(context);
  
  // 4. Save results
  await saveOpportunities(projectId, opportunities);
  
  // 5. Update status
  await updateProject(projectId, { analysis_status: 'complete' });
  
  return opportunities;
}
```

### Context Gathering

```typescript
interface AnalysisContext {
  organization: {
    name: string;
    business_type: string;
    industry: string;
    goals: string[];
    challenges: string[];
    location: string;
    language: string;
  };
  
  project: {
    name: string;
    description: string;
    goals: string[];
    pain_points: string[];
  };
  
  customers: {
    total_count: number;
    
    // Aggregated insights
    demographics: {
      has_birthdays: number;
      has_emails: number;
      has_phones: number;
      location_distribution: Record<string, number>;
      gender_distribution: Record<string, number>;
    };
    
    // Engagement patterns
    engagement: {
      avg_visits: number;
      avg_spend: number;
      inactive_30_days: number;
      inactive_60_days: number;
      inactive_90_days: number;
      new_last_30_days: number;
    };
    
    // Segments
    segments: Array<{
      name: string;
      count: number;
      criteria: string;
    }>;
    
    // Custom fields available
    custom_fields: string[];
  };
  
  // What templates/automations already exist
  existing_automations: Array<{
    type: string;
    status: string;
  }>;
}

async function gatherAnalysisContext(projectId: string): Promise<AnalysisContext> {
  const project = await getProject(projectId);
  const organization = await getOrganization(project.organization_id);
  const customers = await getProjectCustomers(projectId);
  const existingAutomations = await getProjectAutomations(projectId);
  
  return {
    organization: {
      name: organization.name,
      business_type: organization.business_type,
      industry: organization.industry,
      goals: organization.primary_goals,
      challenges: organization.current_challenges,
      location: organization.country,
      language: organization.language,
    },
    project: {
      name: project.name,
      description: project.description,
      goals: project.goals,
      pain_points: project.pain_points,
    },
    customers: aggregateCustomerInsights(customers),
    existing_automations: existingAutomations.map(a => ({
      type: a.type,
      status: a.status,
    })),
  };
}
```

### Enhanced Analysis Context

The AI doesn't just look at customer data — it considers the FULL picture:

```typescript
interface EnhancedAnalysisContext extends AnalysisContext {
  // Everything from base AnalysisContext, plus:
  
  market_intelligence: {
    // Competitors (from public data + AI knowledge)
    competitors: Array<{
      name: string;
      known_strategies: string[];
    }>;
    
    // Industry benchmarks
    industry_benchmarks: {
      avg_email_open_rate: number;
      avg_sms_response_rate: number;
      avg_customer_retention: number;
      typical_automation_types: string[];
    };
    
    // Market conditions
    market_trends: string[];
    seasonal_factors: string[];
    
    // Location-specific
    local_factors: {
      population_density: string;
      economic_indicators: string;
      local_events: string[];
    };
    
    // Regulatory
    regulations: {
      sms_requirements: string[];    // TCPA, consent requirements
      email_requirements: string[];  // CAN-SPAM, GDPR
      industry_specific: string[];   // HIPAA for healthcare, etc.
    };
  };
  
  // Previously generated opportunities (to avoid duplicates)
  previous_opportunities: string[];  // Titles of already-generated ones
  
  // Current page for pagination
  page: number;
}

async function gatherEnhancedContext(projectId: string, page: number = 1): Promise<EnhancedAnalysisContext> {
  const baseContext = await gatherAnalysisContext(projectId);
  
  // Get previously generated opportunities (for pagination)
  const previousOpportunities = await getPreviousOpportunities(projectId);
  
  // Gather market intelligence using AI
  const marketIntelligence = await gatherMarketIntelligence(
    baseContext.organization.industry,
    baseContext.organization.location,
    baseContext.organization.business_type
  );
  
  return {
    ...baseContext,
    market_intelligence: marketIntelligence,
    previous_opportunities: previousOpportunities.map(o => o.title),
    page,
  };
}

async function gatherMarketIntelligence(
  industry: string, 
  location: string, 
  businessType: string
): Promise<MarketIntelligence> {
  
  const prompt = `
You are a market research analyst. Provide intelligence for a ${businessType} in the ${industry} industry located in ${location}.

Return JSON with:
{
  "competitors": [
    { "name": "...", "known_strategies": ["..."] }
  ],
  "industry_benchmarks": {
    "avg_email_open_rate": 0.22,
    "avg_sms_response_rate": 0.45,
    "avg_customer_retention": 0.65,
    "typical_automation_types": ["birthday", "win-back", "review-request"]
  },
  "market_trends": ["..."],
  "seasonal_factors": ["..."],
  "local_factors": {
    "population_density": "urban/suburban/rural",
    "economic_indicators": "...",
    "local_events": ["..."]
  },
  "regulations": {
    "sms_requirements": ["Must have opt-in consent", "Include opt-out instructions"],
    "email_requirements": ["CAN-SPAM compliant", "Physical address required"],
    "industry_specific": ["..."]
  }
}
`;

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });
  
  return JSON.parse(response.content[0].text);
}
```

### AI Prompt Structure (Full Context)

```typescript
function buildAnalysisPrompt(context: EnhancedAnalysisContext): string {
  return `
You are an AI automation strategist for Automata, helping businesses scale customer relationships through intelligent automation.

## BUSINESS CONTEXT

**Organization:** ${context.organization.name}
**Type:** ${context.organization.business_type}
**Industry:** ${context.organization.industry}
**Location:** ${context.organization.location}
**Language:** ${context.organization.language}

**Business Goals:**
${context.organization.goals.map(g => `- ${g}`).join('\n')}

**Current Challenges:**
${context.organization.challenges.map(c => `- ${c}`).join('\n')}

## PROJECT CONTEXT

**Project:** ${context.project.name}
**Description:** ${context.project.description}

**Project Goals:**
${context.project.goals.map(g => `- ${g}`).join('\n')}

**Pain Points:**
${context.project.pain_points.map(p => `- ${p}`).join('\n')}

## CUSTOMER DATA

**Total Customers:** ${context.customers.total_count}

**Data Availability:**
- Customers with birthdays: ${context.customers.demographics.has_birthdays}
- Customers with emails: ${context.customers.demographics.has_emails}
- Customers with phones: ${context.customers.demographics.has_phones}
- Location data available: ${context.customers.demographics.has_location}

**Engagement Insights:**
- Average visits: ${context.customers.engagement.avg_visits}
- Average spend: $${context.customers.engagement.avg_spend}
- Inactive 30+ days: ${context.customers.engagement.inactive_30_days}
- Inactive 60+ days: ${context.customers.engagement.inactive_60_days}
- Inactive 90+ days: ${context.customers.engagement.inactive_90_days}
- New customers (last 30 days): ${context.customers.engagement.new_last_30_days}
- VIP/High-value customers: ${context.customers.engagement.high_value_count}

**Segments Identified:**
${context.customers.segments.map(s => `- ${s.name}: ${s.count} customers`).join('\n')}

**Custom Fields Available:** ${context.customers.custom_fields.join(', ') || 'None'}

## MARKET INTELLIGENCE

**Industry Benchmarks:**
- Typical email open rate: ${context.market_intelligence.industry_benchmarks.avg_email_open_rate * 100}%
- Typical SMS response rate: ${context.market_intelligence.industry_benchmarks.avg_sms_response_rate * 100}%
- Average customer retention: ${context.market_intelligence.industry_benchmarks.avg_customer_retention * 100}%
- Common automation types in this industry: ${context.market_intelligence.industry_benchmarks.typical_automation_types.join(', ')}

**Competitor Landscape:**
${context.market_intelligence.competitors.map(c => 
  `- ${c.name}: Known for ${c.known_strategies.join(', ')}`
).join('\n')}

**Market Trends:**
${context.market_intelligence.market_trends.map(t => `- ${t}`).join('\n')}

**Seasonal Factors:**
${context.market_intelligence.seasonal_factors.map(s => `- ${s}`).join('\n')}

**Local Factors (${context.organization.location}):**
- Area type: ${context.market_intelligence.local_factors.population_density}
- Economic context: ${context.market_intelligence.local_factors.economic_indicators}
- Upcoming local events: ${context.market_intelligence.local_factors.local_events.join(', ') || 'None identified'}

**Regulatory Requirements:**
- SMS: ${context.market_intelligence.regulations.sms_requirements.join('; ')}
- Email: ${context.market_intelligence.regulations.email_requirements.join('; ')}
- Industry-specific: ${context.market_intelligence.regulations.industry_specific.join('; ') || 'Standard regulations apply'}

## EXISTING AUTOMATIONS
${context.existing_automations.length > 0 
  ? context.existing_automations.map(a => `- ${a.type} (${a.status})`).join('\n')
  : 'None yet'}

## PREVIOUSLY SUGGESTED (DO NOT REPEAT)
${context.previous_opportunities.length > 0
  ? context.previous_opportunities.map(t => `- ${t}`).join('\n')
  : 'None - this is the first batch'}

## YOUR TASK

Generate exactly 5 NEW automation opportunities (page ${context.page}).

Each opportunity must:
1. **Address a specific goal or pain point** mentioned above
2. **Be actionable with the available data** (don't suggest birthday campaigns if no birthday data)
3. **Consider competitor strategies** — what can this business do better?
4. **Account for market trends** — what's working in this industry now?
5. **Respect regulatory requirements** — ensure compliance
6. **Be unique** — do not repeat previous suggestions or existing automations
7. **Include clear reasoning** why this matters for THIS specific business
8. **Provide realistic expected impact** based on industry benchmarks

For each opportunity, provide:
- title: Short, action-oriented name
- description: 2-3 sentences explaining what it does
- reasoning: Why this is valuable for this specific business (reference their goals/challenges)
- impact: Expected outcome with realistic numbers based on benchmarks
- trigger_type: "scheduled" | "event" | "behavioral"
- trigger_config: Specific timing/conditions
- channel: "email" | "sms" | "both"
- segment: Who receives this (be specific)
- segment_count: Estimated number of recipients from current data
- message_template: Draft message content with {{personalization}} tokens (must comply with regulations)
- priority: "high" | "medium" | "low"
- competitive_advantage: How this helps them stand out from competitors

Order by priority (high first).

Respond in JSON format:
{
  "analysis_summary": "Brief overview of key findings for this batch",
  "opportunities": [...],
  "has_more": true/false // Are there more meaningful opportunities to suggest?
}
`;
}
```

### Opportunity Schema

```typescript
interface AutomationOpportunity {
  id: string;                        // Generated UUID
  project_id: string;
  
  // Display
  title: string;
  description: string;
  reasoning: string;                 // Why this matters for THIS business
  impact: string;                    // Expected outcome with realistic numbers
  priority: 'high' | 'medium' | 'low';
  priority_order: number;            // For sorting within page
  competitive_advantage: string;     // How this helps them stand out
  
  // Automation Config
  trigger_type: 'scheduled' | 'event' | 'behavioral';
  trigger_config: {
    // Scheduled
    frequency?: 'daily' | 'weekly' | 'monthly';
    day_of_week?: number;
    day_of_month?: number;
    time?: string;
    
    // Event
    event_type?: 'birthday' | 'anniversary' | 'signup';
    days_before?: number;
    days_after?: number;
    
    // Behavioral
    condition?: string;
    threshold?: number;
  };
  
  channel: 'email' | 'sms' | 'both';
  
  // Targeting
  segment_description: string;
  segment_criteria: SegmentRule[];
  estimated_recipients: number;
  
  // Content
  message_template: string;
  subject_line?: string;             // For email
  
  // Pagination
  page: number;                      // Which "batch" this came from
  
  // State
  status: 'proposed' | 'skipped' | 'added' | 'active';
  added_at?: Date;
  skipped_at?: Date;
  
  // Link to created automation (if added)
  automation_id?: string;
  
  // Metadata
  generated_at: Date;
}
```

---

## Paginated Opportunity Generation

### The Experience

We don't overwhelm users with 20 opportunities at once. We show **5 at a time**, letting them digest and act before seeing more.

```
┌─────────────────────────────────────────────────────────────────────┐
│  INITIAL ANALYSIS                                                    │
│  ────────────────                                                    │
│  AI generates first 5 opportunities (high priority first)            │
│  User reviews: Skip / Edit / Add                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [ Show More Opportunities ]                                         │
│  ────────────────────────────                                        │
│  User clicks → AI generates next 5                                   │
│  Considers what was already suggested                                │
│  Digs deeper into data for new angles                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  REPEAT UNTIL...                                                     │
│  ──────────────                                                      │
│  • User has enough automations                                       │
│  • AI indicates no more meaningful opportunities                     │
│  • Reasonable limit reached (e.g., 25 total)                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Paginated Generation Logic

```typescript
const OPPORTUNITIES_PER_PAGE = 5;
const MAX_PAGES = 5;  // 25 total max

interface OpportunityPage {
  page: number;
  opportunities: AutomationOpportunity[];
  summary: string;
  has_more: boolean;
}

async function generateOpportunityPage(
  projectId: string, 
  page: number
): Promise<OpportunityPage> {
  
  // 1. Check if we've hit the limit
  if (page > MAX_PAGES) {
    return {
      page,
      opportunities: [],
      summary: "You've explored all available opportunities!",
      has_more: false,
    };
  }
  
  // 2. Gather enhanced context (includes previous opportunities)
  const context = await gatherEnhancedContext(projectId, page);
  
  // 3. Build prompt and generate
  const prompt = buildAnalysisPrompt(context);
  
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });
  
  const result = JSON.parse(response.content[0].text);
  
  // 4. Save opportunities
  const savedOpportunities = await saveOpportunities(projectId, result.opportunities, page);
  
  return {
    page,
    opportunities: savedOpportunities,
    summary: result.analysis_summary,
    has_more: result.has_more && page < MAX_PAGES,
  };
}

// Get all opportunities for a project (across all pages)
async function getAllOpportunities(projectId: string): Promise<AutomationOpportunity[]> {
  const { data } = await supabase
    .from('automation_opportunities')
    .select('*')
    .eq('project_id', projectId)
    .order('page', { ascending: true })
    .order('priority_order', { ascending: true });
  
  return data || [];
}

// Get previously generated opportunity titles (for AI context)
async function getPreviousOpportunities(projectId: string): Promise<{ title: string }[]> {
  const { data } = await supabase
    .from('automation_opportunities')
    .select('title')
    .eq('project_id', projectId);
  
  return data || [];
}
```

### Opportunity Results UI (with Pagination)

```jsx
function ProjectAnalysisResults({ projectId }) {
  const [opportunities, setOpportunities] = useState<AutomationOpportunity[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [summary, setSummary] = useState('');
  
  // Initial load
  useEffect(() => {
    loadInitialOpportunities();
  }, [projectId]);
  
  async function loadInitialOpportunities() {
    setIsLoading(true);
    const result = await generateOpportunityPage(projectId, 1);
    setOpportunities(result.opportunities);
    setSummary(result.summary);
    setHasMore(result.has_more);
    setCurrentPage(1);
    setIsLoading(false);
  }
  
  async function loadMoreOpportunities() {
    setIsLoadingMore(true);
    const nextPage = currentPage + 1;
    const result = await generateOpportunityPage(projectId, nextPage);
    setOpportunities(prev => [...prev, ...result.opportunities]);
    setHasMore(result.has_more);
    setCurrentPage(nextPage);
    setIsLoadingMore(false);
  }
  
  if (isLoading) {
    return <AnalysisLoadingState />;
  }
  
  // Group opportunities by status
  const proposed = opportunities.filter(o => o.status === 'proposed');
  const added = opportunities.filter(o => o.status === 'added');
  const skipped = opportunities.filter(o => o.status === 'skipped');
  
  return (
    <div className="space-y-8">
      {/* Summary Card */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
            <span className="text-2xl">🧠</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">AI Analysis Complete</h2>
            <p className="text-gray-600">{summary}</p>
          </div>
        </div>
        
        <div className="grid grid-cols-4 gap-4 mt-6">
          <StatCard 
            label="Found" 
            value={opportunities.length} 
            icon="💡"
          />
          <StatCard 
            label="Added" 
            value={added.length}
            icon="✅"
            color="green"
          />
          <StatCard 
            label="To Review" 
            value={proposed.length}
            icon="👀"
            color="amber"
          />
          <StatCard 
            label="Skipped" 
            value={skipped.length}
            icon="⏭️"
            color="gray"
          />
        </div>
      </div>
      
      {/* Opportunities List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recommended Automations</h2>
          <span className="text-sm text-gray-500">
            Showing {opportunities.length} opportunities
          </span>
        </div>
        
        {/* Proposed Opportunities (Actionable) */}
        {proposed.length > 0 && (
          <div className="space-y-4">
            {proposed.map(opportunity => (
              <OpportunityCard 
                key={opportunity.id} 
                opportunity={opportunity}
                onAdd={() => handleAdd(opportunity)}
                onSkip={() => handleSkip(opportunity)}
                onEdit={() => handleEdit(opportunity)}
              />
            ))}
          </div>
        )}
        
        {/* Already Added */}
        {added.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-medium text-gray-500 mb-3">
              ✅ Added to Automations ({added.length})
            </h3>
            <div className="space-y-2">
              {added.map(opportunity => (
                <CompactOpportunityRow
                  key={opportunity.id}
                  opportunity={opportunity}
                  status="added"
                />
              ))}
            </div>
          </div>
        )}
        
        {/* Skipped */}
        {skipped.length > 0 && (
          <div className="mt-6">
            <button 
              onClick={() => setShowSkipped(!showSkipped)}
              className="text-sm text-gray-500 flex items-center gap-2"
            >
              {showSkipped ? '▼' : '▶'} Skipped ({skipped.length})
            </button>
            {showSkipped && (
              <div className="mt-2 space-y-2">
                {skipped.map(opportunity => (
                  <CompactOpportunityRow
                    key={opportunity.id}
                    opportunity={opportunity}
                    status="skipped"
                    onRestore={() => handleRestore(opportunity)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Show More Button */}
      {hasMore && (
        <div className="text-center pt-8">
          <button
            onClick={loadMoreOpportunities}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-3 px-8 py-4 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl transition-all"
          >
            {isLoadingMore ? (
              <>
                <LoadingSpinner size="sm" />
                <span className="text-gray-600">Finding more opportunities...</span>
              </>
            ) : (
              <>
                <span className="text-2xl">✨</span>
                <div className="text-left">
                  <span className="font-semibold text-gray-900 block">
                    Show More Opportunities
                  </span>
                  <span className="text-sm text-gray-500">
                    AI will find 5 more automation ideas
                  </span>
                </div>
              </>
            )}
          </button>
        </div>
      )}
      
      {/* No More Opportunities */}
      {!hasMore && opportunities.length > 0 && (
        <div className="text-center pt-8 pb-4">
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-green-50 text-green-700 rounded-xl">
            <span>🎉</span>
            <span>You've explored all available opportunities!</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

### "Show More" Loading State

```jsx
function LoadingMoreState() {
  const hints = [
    "Analyzing deeper patterns in your data...",
    "Checking industry best practices...",
    "Finding unique angles for your business...",
    "Considering seasonal opportunities...",
    "Looking at competitor strategies...",
  ];
  
  const [currentHint, setCurrentHint] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentHint(prev => (prev + 1) % hints.length);
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  
  return (
    <div className="glass-card rounded-2xl p-8 text-center animate-pulse">
      <LoadingSpinner size="lg" className="mx-auto mb-4" />
      <p className="text-gray-600">{hints[currentHint]}</p>
    </div>
  );
}
```

### Compact Row for Added/Skipped

```jsx
function CompactOpportunityRow({ opportunity, status, onRestore }) {
  return (
    <div className={`
      flex items-center justify-between p-4 rounded-xl border
      ${status === 'added' ? 'bg-green-50/50 border-green-100' : 'bg-gray-50 border-gray-100'}
    `}>
      <div className="flex items-center gap-3">
        <span className="text-lg">
          {status === 'added' ? '✅' : '⏭️'}
        </span>
        <div>
          <span className="font-medium text-gray-900">{opportunity.title}</span>
          {status === 'added' && opportunity.automation_id && (
            <a 
              href={`/app/automation.html?id=${opportunity.automation_id}`}
              className="ml-2 text-sm text-blue-600 hover:underline"
            >
              View automation →
            </a>
          )}
        </div>
      </div>
      
      {status === 'skipped' && onRestore && (
        <button
          onClick={onRestore}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Restore
        </button>
      )}
    </div>
  );
}
```

---

## Opportunity Presentation UI

### Analysis Results Page

```jsx
function ProjectAnalysisResults({ projectId }) {
  const { opportunities, summary, isLoading } = useProjectAnalysis(projectId);
  
  if (isLoading) {
    return <AnalysisLoadingState />;
  }
  
  return (
    <div className="space-y-8">
      {/* Summary Card */}
      <div className="glass-card rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4">Analysis Summary</h2>
        <p className="text-gray-600">{summary}</p>
        
        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatCard 
            label="Opportunities Found" 
            value={opportunities.length} 
          />
          <StatCard 
            label="High Priority" 
            value={opportunities.filter(o => o.priority === 'high').length} 
          />
          <StatCard 
            label="Est. Total Reach" 
            value={opportunities.reduce((sum, o) => sum + o.estimated_recipients, 0)} 
          />
        </div>
      </div>
      
      {/* Opportunities List */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Recommended Automations</h2>
        
        {opportunities
          .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
          .map(opportunity => (
            <OpportunityCard 
              key={opportunity.id} 
              opportunity={opportunity}
              onAdd={() => handleAdd(opportunity)}
              onSkip={() => handleSkip(opportunity)}
              onEdit={() => handleEdit(opportunity)}
            />
          ))
        }
      </div>
    </div>
  );
}
```

### Opportunity Card

```jsx
function OpportunityCard({ opportunity, onAdd, onSkip, onEdit }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const priorityColors = {
    high: 'bg-red-50 text-red-600 border-red-200',
    medium: 'bg-amber-50 text-amber-600 border-amber-200',
    low: 'bg-blue-50 text-blue-600 border-blue-200',
  };
  
  const channelIcons = {
    email: '📧',
    sms: '💬',
    both: '📱',
  };
  
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{channelIcons[opportunity.channel]}</span>
            <div>
              <h3 className="font-semibold text-gray-900">{opportunity.title}</h3>
              <p className="text-sm text-gray-500">
                {opportunity.trigger_type} • {opportunity.estimated_recipients} recipients
              </p>
            </div>
          </div>
          
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${priorityColors[opportunity.priority]}`}>
            {opportunity.priority} priority
          </span>
        </div>
        
        <p className="text-gray-600 mb-4">{opportunity.description}</p>
        
        {/* Why This Matters */}
        <div className="bg-gray-50 rounded-xl p-4 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-1">Why this matters for you:</p>
          <p className="text-sm text-gray-600">{opportunity.reasoning}</p>
        </div>
        
        {/* Expected Impact & Competitive Edge */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="flex items-start gap-2 text-sm">
            <span className="text-green-600 mt-0.5">📈</span>
            <div>
              <span className="text-gray-500 block">Expected impact:</span>
              <span className="font-medium text-gray-900">{opportunity.impact}</span>
            </div>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="text-purple-600 mt-0.5">🏆</span>
            <div>
              <span className="text-gray-500 block">Competitive edge:</span>
              <span className="font-medium text-gray-900">{opportunity.competitive_advantage}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Expandable Details */}
      {isExpanded && (
        <div className="px-6 pb-6 pt-0 border-t border-gray-100">
          <div className="pt-4 space-y-4">
            {/* Message Preview */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Message Preview:</p>
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                {opportunity.subject_line && (
                  <p className="text-sm font-medium text-gray-900 mb-2 pb-2 border-b border-gray-100">
                    Subject: {opportunity.subject_line}
                  </p>
                )}
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {opportunity.message_template}
                </p>
              </div>
            </div>
            
            {/* Segment */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Target Audience:</p>
              <p className="text-sm text-gray-600">{opportunity.segment_description}</p>
            </div>
            
            {/* Timing */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Timing:</p>
              <p className="text-sm text-gray-600">{formatTrigger(opportunity)}</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Actions */}
      <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
        >
          {isExpanded ? (
            <>
              <ChevronUpIcon className="w-4 h-4" /> Show less
            </>
          ) : (
            <>
              <ChevronDownIcon className="w-4 h-4" /> Show details
            </>
          )}
        </button>
        
        <div className="flex items-center gap-3">
          <button
            onClick={onSkip}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Skip
          </button>
          <button
            onClick={onEdit}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-100"
          >
            Edit
          </button>
          <button
            onClick={onAdd}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 flex items-center gap-2"
          >
            <PlusIcon className="w-4 h-4" />
            Add Automation
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Analysis Loading State

```jsx
function AnalysisLoadingState() {
  const steps = [
    { id: 'customers', label: 'Analyzing customer data', duration: 2000 },
    { id: 'patterns', label: 'Identifying patterns', duration: 3000 },
    { id: 'matching', label: 'Matching with goals', duration: 2000 },
    { id: 'generating', label: 'Generating opportunities', duration: 3000 },
  ];
  
  const [currentStep, setCurrentStep] = useState(0);
  
  useEffect(() => {
    // Animate through steps
    const timer = setInterval(() => {
      setCurrentStep(prev => (prev < steps.length - 1 ? prev + 1 : prev));
    }, steps[currentStep]?.duration || 2000);
    
    return () => clearInterval(timer);
  }, [currentStep]);
  
  return (
    <div className="glass-card rounded-2xl p-12 text-center">
      {/* Animated Brain/AI Icon */}
      <div className="w-20 h-20 mx-auto mb-8 relative">
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-400/20 to-violet-400/20 animate-ping" />
        <div className="relative w-full h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 flex items-center justify-center">
          <span className="text-3xl">🧠</span>
        </div>
      </div>
      
      <h3 className="text-xl font-semibold text-gray-900 mb-2">
        Analyzing Your Data
      </h3>
      <p className="text-gray-600 mb-8">
        Our AI is finding the best automation opportunities for your business.
      </p>
      
      {/* Progress Steps */}
      <div className="max-w-md mx-auto space-y-3">
        {steps.map((step, index) => (
          <div 
            key={step.id}
            className={`flex items-center gap-3 text-left ${
              index <= currentStep ? 'text-gray-900' : 'text-gray-400'
            }`}
          >
            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
              index < currentStep 
                ? 'bg-green-500 text-white' 
                : index === currentStep
                  ? 'bg-blue-500 text-white animate-pulse'
                  : 'bg-gray-200'
            }`}>
              {index < currentStep ? '✓' : index + 1}
            </div>
            <span className="text-sm">{step.label}</span>
            {index === currentStep && (
              <LoadingSpinner size="sm" className="ml-auto" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Add → Review → Activate Flow

### Step 1: Add (Create Draft)

```typescript
async function addOpportunityAsAutomation(opportunity: AutomationOpportunity) {
  // 1. Create automation in draft state
  const automation = await supabase
    .from('automations')
    .insert({
      project_id: opportunity.project_id,
      organization_id: opportunity.organization_id,
      
      // From opportunity
      name: opportunity.title,
      description: opportunity.description,
      trigger_type: opportunity.trigger_type,
      trigger_config: opportunity.trigger_config,
      channel_type: opportunity.channel,
      content: opportunity.message_template,
      subject_line: opportunity.subject_line,
      segmentation_rules: opportunity.segment_criteria,
      
      // State
      status: 'draft',
      source: 'ai_proposal',
      source_opportunity_id: opportunity.id,
    })
    .select()
    .single();
  
  // 2. Update opportunity status
  await supabase
    .from('automation_opportunities')
    .update({ 
      status: 'added',
      automation_id: automation.id,
      added_at: new Date()
    })
    .eq('id', opportunity.id);
  
  // 3. Return automation for redirect
  return automation;
}
```

### Step 2: Review (Automation Detail Page)

User lands on automation detail page where they can:
- Edit title and description
- Modify message content
- Adjust targeting/segmentation
- Change timing/trigger
- Preview how it will look

### Step 3: Activate

```typescript
async function activateAutomation(automationId: string) {
  // 1. Validate automation is ready
  const automation = await getAutomation(automationId);
  const validation = validateAutomation(automation);
  
  if (!validation.valid) {
    throw new Error(`Cannot activate: ${validation.errors.join(', ')}`);
  }
  
  // 2. Check for test send
  const hasTestSend = await checkTestSendStatus(automationId);
  if (!hasTestSend) {
    throw new Error('Please send a test before activating');
  }
  
  // 3. Update status
  await supabase
    .from('automations')
    .update({ 
      status: 'active',
      activated_at: new Date()
    })
    .eq('id', automationId);
  
  // 4. Schedule first run (if scheduled type)
  if (automation.trigger_type === 'scheduled') {
    await scheduleNextRun(automationId);
  }
  
  // 5. Log for audit
  await logAudit('AUTOMATION_ACTIVATED', {
    automationId,
    trigger: automation.trigger_type,
    recipientCount: automation.estimated_recipients,
  });
}
```

---

## Re-Analysis Triggers

### When to Re-Analyze

```typescript
const REANALYSIS_TRIGGERS = {
  // Manual
  USER_REQUESTED: 'user_requested',
  
  // Automatic
  CUSTOMERS_ADDED: 'customers_added',           // New customers added to project
  CUSTOMERS_UPDATED: 'customers_updated',       // Significant data changes
  PROJECT_GOALS_CHANGED: 'project_goals_changed',
  TIME_ELAPSED: 'time_elapsed',                 // 30 days since last analysis
  AUTOMATION_COMPLETED: 'automation_completed', // A campaign finished, new opportunities?
};

async function shouldReanalyze(projectId: string): Promise<boolean> {
  const project = await getProject(projectId);
  
  // Never analyzed
  if (!project.last_analyzed_at) return true;
  
  // More than 30 days
  const daysSinceAnalysis = daysBetween(project.last_analyzed_at, new Date());
  if (daysSinceAnalysis > 30) return true;
  
  // Significant customer changes
  const customerChanges = await getCustomerChangesSince(projectId, project.last_analyzed_at);
  if (customerChanges.added > 0.1 * project.customer_count) return true; // 10% growth
  
  return false;
}
```

---

## Integration with Marketplace

When AI generates an opportunity, check if it matches an existing template:

```typescript
async function matchOpportunityToTemplate(opportunity: AutomationOpportunity) {
  // Find similar templates
  const templates = await supabase
    .from('automation_templates')
    .select('*')
    .eq('category', mapTriggerToCategory(opportunity.trigger_type))
    .contains('industries', [opportunity.organization_industry]);
  
  // Score similarity
  const matches = templates.map(template => ({
    template,
    score: calculateSimilarity(opportunity, template),
  }));
  
  // Return best match if score > threshold
  const bestMatch = matches.sort((a, b) => b.score - a.score)[0];
  
  if (bestMatch && bestMatch.score > 0.7) {
    return bestMatch.template;
  }
  
  return null;
}
```

This allows us to show "Similar to [Template Name]" and potentially use template's proven content as a starting point.

---

## The Analysis Checklist

Before presenting opportunities to user:

- [ ] All opportunities are actionable with available data
- [ ] No duplicate automation types (unless segmented differently)
- [ ] Message templates use only available personalization tokens
- [ ] Timing makes sense for the business type
- [ ] Impact estimates are realistic and specific
- [ ] High-priority items actually address stated pain points
- [ ] Content is appropriate for the business's language setting

---

*"The AI doesn't just analyze data — it translates business goals into actionable automations. Every proposal should feel like a recommendation from a marketing expert who deeply understands THIS specific business."*
