# Automata — Session Recaps

## Purpose

This folder contains session recaps that help Claude Code maintain continuity between coding sessions. Since conversation context gets compressed over long sessions, these recaps ensure critical context is preserved.

## How It Works

```
SESSION START
     │
     ▼
┌─────────────────────────────┐
│  Claude reads:              │
│  1. /mnt/project/ files     │
│  2. Latest recap            │
│  3. Relevant skill docs     │
└─────────────────────────────┘
     │
     ▼
[Full context restored]
     │
     ▼
[Development continues]
     │
     ▼
SESSION END
     │
     ▼
┌─────────────────────────────┐
│  Create/Update recap:       │
│  - What was built           │
│  - Pending items            │
│  - Technical decisions      │
│  - File changes             │
└─────────────────────────────┘
```

## Folder Structure

```
/recaps
├── README.md                    # This file
├── 2026-01-28-session-recap.md  # Most recent
├── 2026-01-27-session-recap.md  # Previous
└── ...                          # Older recaps
```

## Recap Template

Each recap should include:

1. **Session Overview** — What was accomplished
2. **Features Implemented** — Detailed breakdown
3. **File Structure Changes** — New/modified files
4. **Database Changes** — Schema updates
5. **Security Review** — RLS status, any concerns
6. **QA Results** — Testing summary
7. **Pending Items** — What's next
8. **Technical Decisions** — Why things were built a certain way

## For Claude Code

**At session start:**
```
1. Read the latest recap in /recaps/
2. Note any pending database migrations
3. Check pending items for priorities
4. Reference skill documents as needed
```

**At session end (when user requests):**
```
1. Summarize what was built
2. List all file changes
3. Note any pending migrations
4. Update pending items
5. Save to /recaps/YYYY-MM-DD-session-recap.md
```

## For Jay

**End of each session:**
- Ask Claude to generate a session recap
- Review the recap for accuracy
- Add any personal notes

**Start of each session:**
- Claude Code will read the recap automatically if it's in the project
- Mention specific features if you want to continue where you left off
- Clarify anything that seems incorrect

## Related Skill Documents

| Document | Purpose |
|----------|---------|
| `automata-project-description.md` | Core vision and features |
| `automata-project-instructions.md` | Development rules |
| `automata-design-system.md` | Visual design guide |
| `automata-ai-analysis-engine.md` | AI opportunity system |
| `automata-qa-security-testing.md` | Testing protocols |

## Naming Convention

```
YYYY-MM-DD-session-recap.md
```

Examples:
- `2026-01-28-session-recap.md`
- `2026-01-29-session-recap.md`

## Tips

1. **Keep recaps focused** — Include what matters, not every small change
2. **Always list pending items** — Future you will thank present you
3. **Note technical decisions** — The "why" is as important as the "what"
4. **Link to relevant skills** — Don't duplicate info, reference it

---

*"The best code is the code you can pick up again after a week away."*
