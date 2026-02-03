# Skill: Business Audit (GTM & Economics)

## Overview

Business audit from **Business Development**, **Product Manager**, and **Financial Analyst** perspectives. Focuses on go-to-market strategy, unit economics, pricing, competitive positioning, and growth opportunities.

## When to Use

Invoke with `/audit-business` when:
- Before launch (pricing and positioning)
- Planning marketing campaigns
- Evaluating new features
- Quarterly business review
- When growth stalls
- Before investor conversations

## Technique: Strategic Business Analysis

Analyze from THREE business perspectives:

### 1. Business Development
- Market positioning
- Competitive landscape
- Partnership opportunities
- Distribution channels
- Growth levers

### 2. Product Manager
- Feature prioritization
- Product-market fit signals
- User feedback themes
- Roadmap alignment
- Value proposition clarity

### 3. Financial Analyst
- Unit economics
- Pricing strategy
- Revenue projections
- Cost structure
- LTV/CAC ratios

## Audit Checklist

### Value Proposition
```
[ ] Can explain value in one sentence
[ ] Clear differentiation from competitors
[ ] Solves real pain point
[ ] Value > Price (10x ideal)
[ ] Easy to understand benefits
```

### Pricing Strategy
```
[ ] Pricing aligns with value delivered
[ ] Price anchoring used effectively
[ ] Clear upgrade path between tiers
[ ] Competitive pricing analysis done
[ ] Psychological pricing considered ($99 vs $100)
```

### Unit Economics
```
[ ] CAC (Customer Acquisition Cost) calculated
[ ] LTV (Lifetime Value) calculated
[ ] LTV:CAC ratio > 3:1
[ ] Payback period < 12 months
[ ] Gross margin > 70% (for SaaS)
```

### Go-to-Market
```
[ ] Target customer clearly defined
[ ] Customer acquisition channels identified
[ ] Marketing message resonates
[ ] Sales process documented
[ ] Referral mechanism in place
```

### Competitive Positioning
```
[ ] Know top 5 competitors
[ ] Clear differentiation points
[ ] Competitive advantages documented
[ ] Weaknesses acknowledged and mitigated
[ ] Market trends understood
```

### Growth Levers
```
[ ] Viral/referral loop built-in
[ ] Network effects possible
[ ] Expansion revenue opportunity
[ ] Low churn mechanisms
[ ] Word-of-mouth potential
```

## Execution Format

```markdown
# Business Audit Report

## Summary
- **Product-Market Fit Signal**: X/10
- **Pricing Health**: X/10
- **GTM Readiness**: X/10
- **Competitive Position**: X/10

---

## Value Proposition Analysis

### Current Positioning
"Royalty helps local businesses create AI-powered loyalty programs in 60 seconds"

### Strengths
- Speed (60 seconds) is compelling
- AI differentiator
- Targets underserved market (local businesses)

### Gaps
- "AI-powered" is vague - what does AI actually do?
- "Loyalty programs" is generic - what makes it different?

### Recommended Refinement
"Turn every customer into a regular. Royalty uses AI to automatically reward, engage, and bring back your customers - no marketing degree required."

---

## Pricing Analysis

### Current Pricing
| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | ... |
| Pro | $X/mo | ... |
| Business | $X/mo | ... |

### Assessment
- [ ] Free tier demonstrates value
- [ ] Pro tier has clear upgrade trigger
- [ ] Business tier justifies price jump
- [ ] Annual discount incentivizes commitment

### Recommendations
1. Add usage-based component for growth
2. Consider per-location pricing for scale
3. Add enterprise tier for chains

---

## Unit Economics

### Estimates (Validate with Real Data)
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| CAC | $X | <$50 | ? |
| LTV | $X | >$150 | ? |
| LTV:CAC | X:1 | >3:1 | ? |
| Payback | X months | <12 mo | ? |
| Gross Margin | X% | >70% | ? |

### Cost Structure
- Supabase: $X/month
- Claude API: $X per 1000 users
- Hosting: $X/month
- Support: $X/month

---

## Competitive Landscape

### Direct Competitors
| Competitor | Strength | Weakness | Our Edge |
|------------|----------|----------|----------|
| Square Loyalty | Brand trust | Complex setup | 60-sec setup |
| Stamp Me | Simple | No AI | AI-powered |
| Belly | Established | Expensive | Price |

### Positioning Matrix
```
           High Touch
              |
    [Belly]   |   [Custom]
              |
Low Tech -----+------ High Tech
              |
   [Stamp Me] |  [ROYALTY]
              |
           Self-Serve
```

### Differentiation Statement
"Only loyalty platform that uses AI to automatically optimize your program"

---

## Go-to-Market Strategy

### Target Customer Profile
- Local business owner
- 1-10 locations
- Non-technical
- Values simplicity over features
- Coffee shops, salons, restaurants, fitness

### Acquisition Channels
| Channel | Cost | Volume | Priority |
|---------|------|--------|----------|
| AppSumo | Revenue share | High | P0 |
| SEO/Content | Low | Medium | P1 |
| Referrals | Low | Medium | P1 |
| Facebook Ads | Medium | Medium | P2 |
| Partnerships | Low | Low-Med | P2 |

### Launch Checklist
- [ ] AppSumo listing optimized
- [ ] Review response templates ready
- [ ] Support documentation complete
- [ ] Onboarding flow tested
- [ ] Social proof collected

---

## Growth Opportunities

### Quick Wins
1. **Referral Program**: Give $20 credit for referrals
2. **Case Studies**: Document 3 success stories
3. **Templates**: Industry-specific loyalty templates

### Medium Term
1. **Partnerships**: POS integrations
2. **API**: Let developers build on platform
3. **White Label**: For agencies

### Long Term
1. **International**: Localization beyond 8 languages
2. **Enterprise**: Multi-location chains
3. **Platform**: Marketplace of loyalty add-ons

---

## Recommended Actions

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| P0 | Finalize AppSumo pricing | High | Low |
| P0 | Create 3 case studies | High | Medium |
| P1 | Build referral system | High | Medium |
| P1 | SEO content calendar | Medium | Medium |
| P2 | Explore POS partnerships | High | High |
```

## Royalty-Specific Business Context

### AppSumo Launch (Feb 28, 2026)

**Target:** $500K in LTD sales
**Price Points:** $59 / $119 / $199

**Key Success Factors:**
1. Strong listing copy (60-second claim front and center)
2. Fast onboarding (prove value immediately)
3. Review velocity (respond within 2 hours)
4. Demo video showing AI in action

### Competitive Advantages

1. **Speed**: 60-second setup vs hours
2. **AI**: Automatic optimization vs manual
3. **Simplicity**: Visit-based vs complex point rules
4. **Price**: LTD vs monthly subscription

### Key Metrics to Track

```
Acquisition:
- AppSumo conversion rate
- CAC by channel
- Demo-to-signup rate

Activation:
- Time to first loyalty app created
- First customer signup rate
- 7-day retention

Revenue:
- MRR/ARR (post-LTD)
- LTV by cohort
- Expansion revenue

Engagement:
- DAU/MAU ratio
- Features used per user
- Support tickets per user
```

### Business Model Evolution

**Phase 1 (Launch):** LTD on AppSumo
- Validate product-market fit
- Build user base
- Collect feedback

**Phase 2 (Growth):** Subscription
- Monthly/annual plans
- Usage-based components
- Team seats

**Phase 3 (Scale):** Platform
- API access
- Integrations marketplace
- White label for agencies

## Questions to Answer Before Launch

1. What's our unfair advantage?
2. Why will customers choose us over established players?
3. What's our 10x better value proposition?
4. How will we acquire first 100 paying customers?
5. What's our path to $1M ARR?
