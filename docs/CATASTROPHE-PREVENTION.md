# Automata — Catastrophic Decision Prevention

## The Prime Directive

**Never propose, approve, or execute any action that could cause irreversible harm.**

When in doubt, don't. Ask. Verify. Add friction. The cost of being slow is nothing compared to the cost of being catastrophically wrong.

---

## What is a Catastrophic Decision?

A catastrophic decision is any action that:

1. **Cannot be undone** — Data deletion, sent communications, financial transactions
2. **Affects many users at once** — Bulk operations, system-wide changes
3. **Exposes sensitive data** — PII leaks, credential exposure, privacy violations
4. **Causes financial harm** — Incorrect billing, unauthorized charges, fraud enablement
5. **Damages trust** — Wrong messages to customers, broken promises, spam
6. **Violates laws** — GDPR, CAN-SPAM, TCPA, data protection regulations
7. **Compromises security** — Auth bypasses, privilege escalation, injection vulnerabilities

---

## The Catastrophe Categories

### 🔴 CRITICAL — Never Allow Without Extreme Safeguards

| Category | Examples |
|----------|----------|
| **Mass Data Deletion** | "Delete all customers", "Clear database", "Remove all automations" |
| **Mass Communication** | "Send to all customers now", "Blast everyone", bulk messages without review |
| **Credential Exposure** | Logging API keys, exposing tokens in client, committing secrets |
| **Auth Bypass** | Disabling RLS "temporarily", service role in client code, skipping validation |
| **Financial Operations** | Bulk refunds, pricing changes, subscription modifications |
| **PII Exposure** | Customer data in logs, unencrypted exports, public endpoints with private data |
| **Account Deletion** | Deleting user accounts, removing business profiles |
| **Production DB Changes** | Schema migrations, direct SQL on prod, dropping tables |

### 🟠 HIGH RISK — Require Confirmation + Audit Trail

| Category | Examples |
|----------|----------|
| **Bulk Updates** | Updating all customer records, changing automation settings in bulk |
| **Permission Changes** | Modifying RLS policies, changing user roles |
| **Integration Changes** | Updating SendGrid/Twilio credentials, changing webhook endpoints |
| **Export Operations** | Downloading customer data, generating reports with PII |
| **Automation Activation** | Turning on automations that will send real messages |

### 🟡 MODERATE — Require Review Before Execution

| Category | Examples |
|----------|----------|
| **Single Record Deletion** | Deleting one customer, removing one automation |
| **Communication Sends** | Sending to a segment, test sends |
| **Configuration Changes** | Updating business profile, changing settings |

---

## Safeguards Framework

### Level 1: Soft Confirmation
For moderate-risk actions.

```javascript
// Simple confirmation dialog
const handleDelete = async (customerId) => {
  const confirmed = await confirm('Delete this customer? This cannot be undone.');
  if (!confirmed) return;
  
  await deleteCustomer(customerId);
};
```

### Level 2: Hard Confirmation
For high-risk actions. Require typing to confirm.

```javascript
// Type-to-confirm pattern
const handleBulkDelete = async (customerIds) => {
  const input = await promptInput(
    `You are about to delete ${customerIds.length} customers. ` +
    `Type "DELETE ${customerIds.length} CUSTOMERS" to confirm.`
  );
  
  if (input !== `DELETE ${customerIds.length} CUSTOMERS`) {
    showError('Confirmation did not match. Action cancelled.');
    return;
  }
  
  await bulkDeleteCustomers(customerIds);
  logAudit('BULK_DELETE', { count: customerIds.length, userId: currentUser.id });
};
```

### Level 3: Time-Delayed Execution
For critical actions. Add a waiting period.

```javascript
// Delayed execution with cancellation window
const handleMassCommunication = async (automation) => {
  // 1. Hard confirmation
  const confirmed = await typeToConfirm(
    `This will send to ${automation.recipientCount} customers. ` +
    `Type "SEND TO ${automation.recipientCount}" to confirm.`
  );
  if (!confirmed) return;
  
  // 2. Schedule with delay
  const scheduledTime = new Date(Date.now() + 15 * 60 * 1000); // 15 min delay
  const job = await scheduleAutomation(automation, scheduledTime);
  
  // 3. Show cancellation option
  showNotification(
    `Scheduled for ${scheduledTime.toLocaleTimeString()}. ` +
    `You have 15 minutes to cancel.`,
    { action: 'Cancel', onAction: () => cancelJob(job.id) }
  );
  
  // 4. Log for audit
  logAudit('MASS_COMM_SCHEDULED', { 
    automationId: automation.id, 
    recipientCount: automation.recipientCount,
    scheduledTime,
    userId: currentUser.id 
  });
};
```

### Level 4: Multi-Party Approval
For the most critical actions. Require a second human.

```javascript
// Two-person rule for catastrophic actions
const handleDatabaseMigration = async (migration) => {
  // 1. Initiator submits request
  const request = await createApprovalRequest({
    type: 'DATABASE_MIGRATION',
    details: migration,
    initiator: currentUser.id,
  });
  
  // 2. Notify approvers
  await notifyApprovers(request);
  
  // 3. Block until approved by different user
  showNotification(
    'Migration request submitted. Requires approval from another admin.'
  );
  
  // 4. Approval happens async, execution only after approval
};
```

---

## The "Blast Radius" Assessment

Before ANY bulk operation, calculate the blast radius:

```javascript
function assessBlastRadius(operation) {
  const assessment = {
    affectedRecords: operation.targetCount,
    affectedUsers: operation.uniqueBusinesses || 1,
    reversible: operation.type !== 'DELETE' && operation.type !== 'SEND',
    financialImpact: calculateFinancialImpact(operation),
    reputationRisk: operation.type === 'SEND' ? 'HIGH' : 'LOW',
  };
  
  // Calculate risk score
  let riskScore = 0;
  if (assessment.affectedRecords > 100) riskScore += 2;
  if (assessment.affectedRecords > 1000) riskScore += 3;
  if (!assessment.reversible) riskScore += 5;
  if (assessment.financialImpact > 0) riskScore += 3;
  if (assessment.reputationRisk === 'HIGH') riskScore += 4;
  
  assessment.riskLevel = 
    riskScore >= 10 ? 'CRITICAL' :
    riskScore >= 5 ? 'HIGH' :
    riskScore >= 2 ? 'MODERATE' : 'LOW';
  
  return assessment;
}

// Use it
const risk = assessBlastRadius({ type: 'SEND', targetCount: 5000 });
if (risk.riskLevel === 'CRITICAL') {
  // Require Level 3 or 4 safeguards
}
```

---

## Communication Safeguards

Sending messages is **irreversible**. Once sent, you cannot unsend.

### Pre-Send Checklist (Enforce in Code)

```javascript
async function validateBeforeSend(automation) {
  const errors = [];
  const warnings = [];
  
  // 1. Content validation
  if (!automation.content || automation.content.trim() === '') {
    errors.push('Message content is empty');
  }
  
  if (automation.content.includes('{{') && automation.content.includes('}}')) {
    // Check all tokens are valid
    const tokens = extractTokens(automation.content);
    const invalidTokens = tokens.filter(t => !isValidToken(t));
    if (invalidTokens.length > 0) {
      errors.push(`Invalid personalization tokens: ${invalidTokens.join(', ')}`);
    }
  }
  
  // 2. Recipient validation
  if (automation.recipientCount === 0) {
    errors.push('No recipients match the criteria');
  }
  
  if (automation.recipientCount > 1000) {
    warnings.push(`Large send: ${automation.recipientCount} recipients`);
  }
  
  // 3. Timing validation
  const hour = new Date().getHours();
  if (hour < 8 || hour > 21) {
    warnings.push('Sending outside business hours (8am-9pm)');
  }
  
  // 4. Duplicate check
  const recentSends = await getRecentSends(automation.businessId, 24); // Last 24 hours
  if (recentSends.some(s => s.automationId === automation.id)) {
    warnings.push('This automation was already sent in the last 24 hours');
  }
  
  // 5. Rate limit check
  const dailySendCount = await getDailySendCount(automation.businessId);
  if (dailySendCount + automation.recipientCount > 10000) {
    errors.push('Daily send limit (10,000) would be exceeded');
  }
  
  return { 
    valid: errors.length === 0, 
    errors, 
    warnings,
    requiresReview: warnings.length > 0 
  };
}
```

### Mandatory Test Send

Before any automation goes live:

```javascript
async function requireTestSend(automation) {
  // Check if test was sent
  const testSent = await getTestSendStatus(automation.id);
  
  if (!testSent) {
    throw new Error(
      'Test send required. Send a test to yourself before activating.'
    );
  }
  
  // Check if test was recent (within last hour of edits)
  if (automation.updatedAt > testSent.sentAt) {
    throw new Error(
      'Automation was modified after test send. Please send another test.'
    );
  }
  
  return true;
}
```

---

## Data Deletion Safeguards

### Soft Delete First

Never hard delete immediately. Use soft delete with recovery window.

```sql
-- Add soft delete columns to tables
ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE customers ADD COLUMN deleted_by UUID;

-- "Delete" = set timestamp
UPDATE customers 
SET deleted_at = NOW(), deleted_by = auth.uid()
WHERE id = $1;

-- Recovery: clear timestamp
UPDATE customers 
SET deleted_at = NULL, deleted_by = NULL
WHERE id = $1;

-- Hard delete only after recovery window (30 days)
-- Run via scheduled job, not user action
DELETE FROM customers 
WHERE deleted_at < NOW() - INTERVAL '30 days';
```

### Bulk Delete Limits

```javascript
const MAX_BULK_DELETE = 100; // Never delete more than 100 at once

async function bulkDeleteCustomers(customerIds) {
  if (customerIds.length > MAX_BULK_DELETE) {
    throw new Error(
      `Cannot delete more than ${MAX_BULK_DELETE} records at once. ` +
      `Please delete in smaller batches.`
    );
  }
  
  // Proceed with soft delete
  await softDeleteCustomers(customerIds);
}
```

---

## Database Protection

### Production Database Rules

1. **No direct SQL in production** — All changes via migrations
2. **No dropping tables** — Rename to `_deprecated_` instead
3. **No schema changes without backup** — Snapshot before migration
4. **No service role in application code** — Only in secure server functions

### Migration Safety

```javascript
// migrations/20240128_add_column.js

export async function up(db) {
  // 1. Pre-flight check
  const backup = await createBackup();
  console.log(`Backup created: ${backup.id}`);
  
  // 2. Non-destructive change
  await db.schema.alterTable('customers', table => {
    table.string('new_column').nullable(); // Always nullable first
  });
  
  // 3. Verify
  const columns = await db.schema.columnInfo('customers');
  if (!columns.new_column) {
    throw new Error('Migration verification failed');
  }
}

export async function down(db) {
  // Reversible migrations only
  await db.schema.alterTable('customers', table => {
    table.dropColumn('new_column');
  });
}
```

---

## The Review Gate

### AI Proposal Filtering

The AI should NEVER propose automations that:

```javascript
const FORBIDDEN_PROPOSALS = [
  // Mass actions without segmentation
  { pattern: /send to (all|every) customer/i, reason: 'Mass send without segmentation' },
  { pattern: /delete (all|every)/i, reason: 'Mass deletion' },
  
  // Sensitive content
  { pattern: /(password|credit card|ssn|social security)/i, reason: 'Sensitive data in content' },
  
  // Excessive frequency
  { pattern: /every (hour|minute|day)/i, check: (a) => a.frequency < 7, reason: 'Too frequent' },
  
  // Potentially offensive
  { pattern: /(political|religious|adult)/i, reason: 'Sensitive topic' },
];

function filterProposals(proposals) {
  return proposals.filter(proposal => {
    for (const rule of FORBIDDEN_PROPOSALS) {
      if (rule.pattern.test(proposal.content) || rule.pattern.test(proposal.title)) {
        logFiltered(proposal, rule.reason);
        return false;
      }
      if (rule.check && rule.check(proposal)) {
        logFiltered(proposal, rule.reason);
        return false;
      }
    }
    return true;
  });
}
```

### Human Approval is Mandatory

```javascript
// No automation can execute without explicit human approval
const AUTOMATION_STATES = {
  PROPOSED: 'proposed',     // AI suggested, awaiting review
  APPROVED: 'approved',     // Human approved, ready to activate
  ACTIVE: 'active',         // Running
  PAUSED: 'paused',         // Temporarily stopped
  ARCHIVED: 'archived',     // No longer used
};

// Automations can ONLY transition:
// PROPOSED -> APPROVED (requires human action)
// APPROVED -> ACTIVE (requires human action)
// ACTIVE -> PAUSED (human or system)
// Any state -> ARCHIVED (human only)

// NEVER: PROPOSED -> ACTIVE (skipping approval)
```

---

## Audit Trail Requirements

Every catastrophic-potential action must be logged:

```javascript
interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  businessId: string;
  action: string;           // 'BULK_DELETE', 'MASS_SEND', 'RLS_CHANGE', etc.
  targetType: string;       // 'customer', 'automation', 'policy'
  targetIds: string[];      // What was affected
  previousState?: object;   // For reversibility
  newState?: object;
  ipAddress: string;
  userAgent: string;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  approved: boolean;
  approvedBy?: string;      // If different from userId
}

async function logAudit(action: string, details: Partial<AuditLog>) {
  await supabase.from('audit_logs').insert({
    ...details,
    action,
    timestamp: new Date(),
    userId: getCurrentUserId(),
    businessId: getCurrentBusinessId(),
    ipAddress: getClientIP(),
    userAgent: getUserAgent(),
  });
}
```

---

## The Catastrophe Checklist

Before approving ANY feature that involves:
- Bulk operations
- Data deletion
- Sending communications
- Modifying permissions
- Financial transactions
- External integrations

Ask:

- [ ] **What's the worst case?** If this goes wrong, what's the damage?
- [ ] **Is it reversible?** Can we undo it? How long do we have?
- [ ] **What's the blast radius?** How many users/records affected?
- [ ] **Is there a confirmation?** Does the user have to actively confirm?
- [ ] **Is there an audit trail?** Can we see who did what and when?
- [ ] **Is there a test mode?** Can they try it safely first?
- [ ] **Is there a rate limit?** Can they accidentally do it 1000x?
- [ ] **Is there human review?** Does a human see it before it executes?

If ANY answer is concerning, add safeguards before shipping.

---

## Emergency Procedures

### If Something Goes Wrong

1. **STOP THE BLEEDING**
   - Pause all automations: `UPDATE automations SET status = 'paused' WHERE business_id = $1`
   - Disable the feature flag
   - Scale down workers

2. **ASSESS THE DAMAGE**
   - How many affected?
   - What data was lost/exposed/sent?
   - Is it ongoing or contained?

3. **COMMUNICATE**
   - Notify affected users immediately
   - Be honest about what happened
   - Provide timeline for resolution

4. **RECOVER**
   - Restore from backup if needed
   - Reverse transactions if possible
   - Document everything

5. **POST-MORTEM**
   - What went wrong?
   - Why didn't safeguards catch it?
   - What changes prevent recurrence?

### Kill Switches

```javascript
// Global kill switches for emergencies
const KILL_SWITCHES = {
  DISABLE_ALL_SENDS: 'kill_all_sends',
  DISABLE_AUTOMATIONS: 'kill_automations',
  DISABLE_SIGNUPS: 'kill_signups',
  MAINTENANCE_MODE: 'maintenance',
};

// Check before any critical operation
async function checkKillSwitch(switch: string) {
  const status = await getFeatureFlag(switch);
  if (status) {
    throw new Error(`Operation blocked: ${switch} is active`);
  }
}
```

---

## The Golden Rule

> **"Would I be comfortable if this action was taken on MY data, MY customers, MY business?"**

If no, don't ship it. Add safeguards. Sleep on it. Ask someone else.

The features we don't ship because they're too risky are just as important as the ones we do.

---

*"Move fast and break things" is not our motto. "Move thoughtfully and protect everything" is.*
