# Skill: Verify (Self-Correction Loop)

## Overview

After writing code, automatically identify potential bugs, edge cases, and issues - then fix them BEFORE presenting the final result. Self-correction catches logical errors that slip past single-pass generation.

## When to Use

Invoke with `/verify` or use automatically when:
- Writing complex functions (auth, payments, data mutations)
- Database queries with multiple joins or conditions
- Any code handling user input
- Business logic with multiple branches
- Code that will be hard to test manually

## Technique: Verification Loop

```
WRITE CODE →
EXPLAIN REASONING →
IDENTIFY 3 POTENTIAL BUGS →
FIX EACH BUG →
PRESENT FINAL CODE
```

## Execution Format

### Step 1: Write Initial Code
```javascript
// Initial implementation
async function awardPoints(memberId, points, reason) {
    const { data, error } = await supabase
        .from('app_members')
        .update({ points_balance: points })
        .eq('id', memberId);
    return { success: !error };
}
```

### Step 2: Explain Reasoning
> "This function awards points to a member by updating their balance. It uses a simple update query and returns success/failure."

### Step 3: Identify 3 Potential Bugs/Edge Cases

**Bug 1: Overwrites balance instead of incrementing**
- Current code sets balance TO `points`, not adds to it
- User with 100 points getting 10 more would have 10, not 110

**Bug 2: No transaction/atomicity**
- If two awards happen simultaneously, race condition
- Could lose points or double-count

**Bug 3: No validation**
- Negative points could be passed
- Non-existent member ID not handled
- No audit trail of the transaction

### Step 4: Fix Each Bug

```javascript
// FIXED implementation
async function awardPoints(memberId, points, reason) {
    // Bug 3 fix: Validate input
    if (!memberId || typeof points !== 'number' || points <= 0) {
        return { success: false, error: 'Invalid input' };
    }

    // Bug 1 & 2 fix: Use RPC for atomic increment
    const { data, error } = await supabase.rpc('award_points', {
        p_member_id: memberId,
        p_points: points,
        p_reason: reason,
        p_type: 'bonus'
    });

    if (error) {
        console.error('Award points failed:', error);
        return { success: false, error: error.message };
    }

    return {
        success: true,
        new_balance: data.new_balance,
        tier_changed: data.tier_changed
    };
}
```

### Step 5: Present Final Code

> "Here's the verified implementation. Fixed 3 issues:
> 1. Now uses atomic RPC instead of direct update (prevents race conditions)
> 2. Increments balance instead of overwriting
> 3. Added input validation and error handling"

## Common Bug Categories to Check

### Data Integrity
- [ ] Race conditions (use atomic operations)
- [ ] Overwrites vs increments
- [ ] Missing foreign key checks
- [ ] Orphaned records

### Input Handling
- [ ] Null/undefined values
- [ ] Type mismatches
- [ ] Boundary values (0, negative, max int)
- [ ] Empty strings vs null

### Error Handling
- [ ] Network failures
- [ ] Database errors
- [ ] Missing data (not found)
- [ ] Permission denied

### Security
- [ ] SQL/XSS injection
- [ ] Missing auth checks
- [ ] Exposed sensitive data
- [ ] Missing rate limits

### Edge Cases
- [ ] First item (empty list)
- [ ] Last item
- [ ] Single item
- [ ] Duplicate items

## Quick Verification Checklist

Before presenting ANY code, ask yourself:

```
[ ] What happens if input is null/undefined?
[ ] What happens if database call fails?
[ ] What happens if user not found?
[ ] What happens if called twice rapidly?
[ ] Am I exposing any sensitive data?
[ ] Did I validate all user input?
[ ] Is there an audit trail if needed?
```

## When to Skip Verification

- Simple one-liners with obvious behavior
- Code that's already been verified
- Trivial changes (typos, formatting)
- When user explicitly says "just do it quick"

## Integration with Other Skills

- Use `/verify` after `/build-customer-app` creates database functions
- Use `/verify` on any code flagged by `/security-audit`
- Use `/verify` on complex logic identified by `/review-architecture`
