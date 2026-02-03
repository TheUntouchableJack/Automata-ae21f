# Session Recaps Skill

## Overview

Session recaps provide continuity between Claude Code sessions by preserving context that might otherwise be lost to conversation compression.

## When to Use This Skill

- **At the start of a new session** — Read the latest recap to restore context
- **At the end of a session** — Create a new recap when the user requests
- **When context seems missing** — Reference recaps if the user mentions something unfamiliar

## Location

```
/recaps/
├── README.md
├── SKILL.md                     # This file
└── YYYY-MM-DD-session-recap.md  # Date-stamped recaps
```

## Reading a Recap (Session Start)

1. Find the most recent recap by date
2. Read the "Pending Items" section first — these are priorities
3. Note any database migrations that need to run
4. Understand the current file structure

## Creating a Recap (Session End)

When the user asks for a recap, include:

```markdown
# Automata Session Recap — [DATE]

## Quick Context for New Sessions
[1-2 sentence description of the project]

## Session Overview
[What was accomplished this session]

## Features Implemented This Session
### 1. [Feature Name]
- Description
- Files created/modified
- Technical details

### 2. [Feature Name]
...

## File Structure Changes
[Show tree of new/modified files]

## Database Changes
[Any schema updates, migrations needed]

## Security Review
[RLS status, any security concerns]

## QA Results
[Testing summary]

## Pending Items / Next Steps
### High Priority
1. ...
### Medium Priority
1. ...

## Key Technical Decisions Made
1. [Decision]: [Reasoning]

## Notes from [User]
[Any user quotes or preferences noted]
```

## Best Practices

1. **Be specific** — "Added customers.js" not "updated files"
2. **Include code snippets** — Especially for pending migrations
3. **Link to skills** — Don't duplicate, reference
4. **Note the "why"** — Technical decisions need reasoning
5. **Keep it scannable** — Use headers, tables, bullet points

## Integration with Other Skills

Recaps should reference but not duplicate:
- `automata-project-description.md` — Core vision
- `automata-design-system.md` — Visual design
- `automata-ai-analysis-engine.md` — AI system details
- Other skill documents as relevant

## Example Usage

**User:** "Let's continue from yesterday"

**Claude:** 
1. Reads latest recap
2. Summarizes what was built
3. Lists pending items
4. Asks what to work on today

**User:** "Can you create a recap for today's work?"

**Claude:**
1. Summarizes the session's work
2. Creates dated recap file
3. Includes all required sections
4. Highlights pending items for next session
