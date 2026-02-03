# Skill: Content Quality

## Overview

Use this skill when writing ANY content for Automata or clients. It ensures content reads like a talented publicist wrote it, not AI slop.

**Invoke with:** `/content-quality`

### Production Implementation

This skill is enforced in production via:
- **Edge Function:** `supabase/functions/generate-article/index.ts`
- **Taboo Scan:** Deterministic check for 80+ banned phrases
- **Quality Gate:** AI scoring (1-10) on 5 traits
- **Auto-Rewrite:** Score < 7 OR taboo phrases found → automatic rewrite (up to 3 attempts)

The quality score returned includes:
- `specificity`, `voice`, `value`, `hook`, `human` (1-10 each)
- `taboo_violations` (count of AI-isms found, 0 = clean)

---

## When to Use

- Writing blog articles
- Creating email sequences
- Drafting landing page copy
- Generating social media content
- Any user-facing text that matters

---

## The Quality Framework

### Before Writing: Gather Context

Ask these questions (or find answers in content_context):

**Who are we writing for?**
- Primary audience description
- Their pain points
- Their aspirations
- Their objections

**What voice should we use?**
- Brand personality
- Tone (formal/casual/witty/warm)
- Words to NEVER use
- Examples of content they love

**What makes this business unique?**
- Origin story
- What they believe that others don't
- What they can do that competitors can't

---

## The Writing Rules

### Rule 1: Lead with Specificity

**NEVER start with:**
- "In today's fast-paced world..."
- "Are you struggling with..."
- "It's no secret that..."
- "When it comes to..."
- Any generic statement

**ALWAYS start with:**
- A specific scenario
- A concrete example
- A surprising fact (real, not made up)
- A story that happened

```
BAD: "Email marketing is an important tool for businesses looking to grow."

GOOD: "When Maria's Bakery started sending 'Fresh from the Oven' texts at 6am,
regulars started lining up before doors opened. Her secret wasn't fancy
marketing—it was timing."
```

### Rule 2: Match the Voice Exactly

Before writing, define:
- If this brand were a person, how would they talk?
- What would they NEVER say?

Then read every sentence aloud. Does it sound like that person?

```
BRAND VOICE: "Friendly expert, like a smart friend who happens to know a lot"

BAD: "Leverage our synergistic solutions to optimize your customer journey."

GOOD: "Here's what actually works: treat your customers like people, not data points."
```

### Rule 3: Cut All Filler

Delete any sentence that:
- States the obvious
- Says nothing actionable
- Uses buzzwords without meaning
- Starts with "It's important to note that..."

```
FILLER: "It's worth mentioning that customer retention is crucial for business success."

BETTER: [Delete it. Everyone knows this. Move to HOW.]
```

### Rule 4: Specific > Generic

Replace vague statements with concrete examples.

```
GENERIC: "Many businesses struggle with customer retention."

SPECIFIC: "Coffee shops typically lose 60% of first-time visitors forever.
The ones that don't? They follow up within 24 hours."
```

### Rule 5: End with Action

The reader should know exactly what to DO next.

```
WEAK: "We hope this article was helpful!"

STRONG: "Try this today: Text your last 10 customers a simple 'thanks for
coming in.' See what happens."
```

---

## The Quality Check

After writing, score 1-10 on each:

| Criteria | Question | Score |
|----------|----------|-------|
| **Specificity** | Could this be about ANY business, or specifically THIS one? | /10 |
| **Voice Match** | Does this sound like the brand's personality? | /10 |
| **Value Density** | Can readers DO something after each section? | /10 |
| **Hook Strength** | Would you keep reading after paragraph 1? | /10 |
| **AI Slop Check** | Does this feel human-written? | /10 |

**Score < 7?** Rewrite.
**Score 7-8?** Apply suggested edits.
**Score 9-10?** Ready to publish.

---

## AI Slop Detector

**PRODUCTION ENFORCEMENT:** The Edge Function (`generate-article`) automatically scans for these phrases and forces rewrites until they're removed. This is a hard gate - articles with taboo phrases will not pass.

### Banned Phrases (Taboo List)

**Opening Clichés:**
- "in today's world" / "in today's fast-paced" / "in today's digital"
- "in the ever-evolving" / "in the rapidly changing"
- "it's no secret that" / "it goes without saying"
- "as we all know" / "needless to say"

**Buzzwords That Scream AI:**
- "delve" / "delving" (MAJOR red flag)
- "leverage" (as a verb)
- "utilize" / "utilizing"
- "synergy" / "paradigm" / "paradigm shift"
- "game-changer" / "cutting-edge" / "best-in-class"
- "holistic" / "robust" / "seamless" / "seamlessly"
- "streamline" / "optimize" / "empower" / "unlock"

**Filler Phrases:**
- "it's important to note" / "it's worth noting"
- "it should be noted" / "importantly"
- "interestingly" / "notably" / "essentially"
- "basically" / "fundamentally" / "ultimately"

**Vague Transitions:**
- "that being said" / "having said that"
- "at the end of the day" / "when all is said and done"
- "all things considered" / "by the same token"

**Weak Conclusions:**
- "in conclusion" / "to summarize" / "in summary"
- "embrace the future" / "the possibilities are endless"
- "only time will tell"

**Overused AI Metaphors:**
- "navigate the landscape" / "deep dive" / "unpack this"
- "tip of the iceberg" / "at its core" / "the bottom line"

**Padding Phrases:**
- "there's no doubt that" / "make no mistake"
- "the fact of the matter" / "the reality is"
- "when it comes to" / "in terms of" / "in order to"

---

## Voice Examples by Type

### Friendly Expert (Most Common)
```
"Look, I get it—marketing feels overwhelming when you're already juggling
everything else. Here's the thing: you don't need to do more. You need to
do the right things. Let me show you what actually moves the needle."
```

### Professional but Warm
```
"After analyzing over 500 customer journeys, we've identified a pattern
that separates thriving businesses from struggling ones. It's not what
most people expect."
```

### Direct and Practical
```
"Step 1: Email your top 10 customers. Step 2: Ask what they wish you offered.
Step 3: Do that thing. That's it. That's the strategy."
```

### Inspiring and Aspirational
```
"Your customers don't just buy your product—they buy what it represents.
When someone chooses your coffee shop over the chain across the street,
they're saying something about who they are."
```

---

## Quick Reference Mantras

- **"Could this be about anyone?"** → Rewrite with specifics
- **"Would I share this?"** → If no, add more value
- **"Does this sound like the brand?"** → Match the voice
- **"Is there filler?"** → Cut it ruthlessly
- **"Where's the example?"** → Add a concrete one
- **"What can they DO?"** → End with action

---

## Self-Critique Prompt

After writing, ask Claude to review:

```
You are a tough editor. Review this content for quality:

[Content here]

Score 1-10 on:
1. Specificity - Is this about THIS business specifically?
2. Voice Match - Does it sound like [brand personality]?
3. Value Density - Is every sentence actionable or insightful?
4. Hook Strength - Would you keep reading after paragraph 1?
5. AI Slop - Does this feel human-written?

Flag any phrases that scream "AI wrote this."
Suggest specific improvements.
```

---

## Usage

```
/content-quality [type]
```

Examples:
- `/content-quality article` - Review article draft
- `/content-quality email` - Check email sequence
- `/content-quality landing` - Audit landing page copy

---

*The goal isn't more content. It's content so good that readers think "this company gets me."*
