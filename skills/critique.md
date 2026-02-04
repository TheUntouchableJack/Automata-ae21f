# Skill: Critique (Devil's Advocate Mode)

## Overview

After proposing a solution, argue AGAINST it. Present alternatives and trade-offs. This prevents premature commitment to the first idea and surfaces better options.

## When to Use

Invoke with `/critique` when:
- User wants to explore options, not just get an answer
- Making architectural decisions with long-term impact
- Choosing between multiple valid approaches
- User seems uncertain about direction
- The "obvious" solution might not be best

## Technique: Structured Self-Critique

```
PROPOSE SOLUTION →
ARGUE AGAINST IT (strongest objections) →
PRESENT 2 ALTERNATIVES →
COMPARE TRADE-OFFS →
GIVE HONEST RECOMMENDATION
```

## Execution Format

### Step 1: Initial Proposal
> "For the loyalty app points system, I recommend using a simple balance field on the member record, updated via RPC function."

### Step 2: Strongest Arguments Against

**Objection 1: Limited Audit Trail**
- Just a balance number, can't see how they got there
- Customer disputes "I should have more points" - no evidence
- Can't detect fraud patterns

**Objection 2: No Undo Capability**
- If we make a mistake, can't easily revert
- No transaction history to reference

**Objection 3: Scaling Concerns**
- Every point award = row lock on member record
- High-traffic apps could bottleneck

### Step 3: Two Alternatives

**Alternative A: Event Sourcing**
- Store every points event, calculate balance on read
- Full audit trail, can replay history
- But: More complex, slower reads, storage cost

**Alternative B: Hybrid (Current + Transactions Table)**
- Keep balance field for fast reads
- Also log every transaction to separate table
- Balance = source of truth, transactions = audit trail

### Step 4: Trade-off Comparison

| Factor | Simple Balance | Event Sourcing | Hybrid |
|--------|---------------|----------------|--------|
| Read Speed | Fast | Slow | Fast |
| Audit Trail | None | Complete | Complete |
| Complexity | Low | High | Medium |
| Storage | Minimal | High | Medium |
| Undo Support | None | Full | Partial |
| Scaling | Limited | Good | Good |

### Step 5: Honest Recommendation

> "For Royalty's scale (< 100K members per app), **Hybrid approach** is the sweet spot:
> - Fast balance lookups (simple field)
> - Complete audit trail (transactions table)
> - Moderate complexity (already implemented!)
>
> Event sourcing is overkill unless you're building a bank. Simple balance is too risky for customer trust."

## Critique Prompts

Use these to structure your critique:

### Technical Critiques
- "What's the failure mode here?"
- "What happens at 10x scale?"
- "What's the maintenance burden?"
- "How does this affect other features?"

### Business Critiques
- "Does this solve the user's actual problem?"
- "What's the cost of being wrong?"
- "Is there a simpler way?"
- "What would a competitor do?"

### UX Critiques
- "Is this intuitive for first-time users?"
- "What's the learning curve?"
- "Where will users get confused?"
- "What's the mobile experience?"

## When to Use Critique Mode

### Good Fit
- "Should we use X or Y approach?"
- "What's the best way to implement Z?"
- "I'm not sure about this architecture..."
- Major feature decisions
- Technology choices

### Skip Critique
- User already decided and just wants execution
- Trivial decisions (naming, formatting)
- Time-sensitive fixes
- User says "just do it"

## Output Format

```markdown
## My Proposal
[What I initially suggest]

## Strongest Counter-Arguments
1. **[Objection]**: Why this might be wrong
2. **[Objection]**: Another risk

## Alternatives Considered
### Option A: [Name]
- Pros: ...
- Cons: ...

### Option B: [Name]
- Pros: ...
- Cons: ...

## Trade-off Matrix
| Factor | Original | Option A | Option B |
|--------|----------|----------|----------|
| ...    | ...      | ...      | ...      |

## My Recommendation
[Honest assessment after considering objections]
[Why I still recommend X, or why I changed my mind]
```

## Integration with Other Skills

- Use `/critique` before major implementations guided by `build-customer-app`
- Use `/critique` when `/review-architecture` surfaces multiple approaches
- Pair with `/verify` to critique AND verify the chosen approach
