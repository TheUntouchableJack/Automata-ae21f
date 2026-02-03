# Parallel Claude Sessions Workflow

Use this skill to coordinate multiple Claude Code sessions working simultaneously on different branches.

## How It Works

1. **Create a branch per session** - Each Claude instance works on its own feature branch
2. **Document ownership** - Track which session owns which files/features
3. **Avoid conflicts** - Sessions work on non-overlapping areas
4. **Merge strategically** - Bring work together via PRs

---

## Quick Setup

### Terminal 1: Session A
```bash
git checkout -b feature/support-enhancements
# Start Claude Code here - works on support system
```

### Terminal 2: Session B
```bash
git checkout -b feature/dashboard-charts
# Start Claude Code here - works on dashboard
```

### Terminal 3: Session C
```bash
git checkout -b feature/branding-cleanup
# Start Claude Code here - works on Automata → Royalty rebrand
```

---

## Session Coordination File

Create a `.claude-sessions.md` file in your repo root to track active sessions:

```markdown
# Active Claude Sessions

## Session A: Support Enhancements
- **Branch:** feature/support-enhancements
- **Owner:** Terminal 1
- **Files:**
  - supabase/functions/ai-support-agent/*
  - customer-app/app.html (Help tab only)
  - app/support.js
  - database/support-*.sql
- **Status:** In Progress

## Session B: Dashboard Charts
- **Branch:** feature/dashboard-charts
- **Owner:** Terminal 2
- **Files:**
  - app/dashboard.html
  - app/dashboard.js
  - app/dashboard.css
- **Status:** In Progress

## Session C: Branding
- **Branch:** feature/branding-cleanup
- **Owner:** Terminal 3
- **Files:**
  - index.html
  - i18n/*.json (branding strings only)
  - styles.css (brand colors)
- **Status:** Pending
```

---

## Rules for Parallel Sessions

### 1. File Ownership
- Each session "owns" specific files/directories
- If you need a file another session owns, coordinate first
- Shared files (like `i18n/*.json`) should have clear section ownership

### 2. No Overlapping Edits
- Session A edits lines 1-100 of a file
- Session B edits lines 200-300 of the same file
- This works! But both editing lines 50-60 = merge conflict

### 3. Regular Commits
- Commit frequently with clear messages
- Push to remote often so other sessions can see progress
- Use conventional commits: `feat:`, `fix:`, `refactor:`

### 4. Merge Strategy
```bash
# When Session A is done:
git checkout main
git pull
git merge feature/support-enhancements
git push

# Session B can then rebase:
git checkout feature/dashboard-charts
git rebase main
```

---

## Starting a New Parallel Session

When starting Claude Code in a new terminal, give it context:

```
I'm working on the [FEATURE NAME] branch.

Other active sessions:
- Session A: Support system (owns: support.js, ai-support-agent/*)
- Session B: Dashboard (owns: dashboard.*)

My scope: [YOUR SCOPE]
Files I own: [YOUR FILES]

Please don't modify files outside my scope without asking.
```

---

## Skill: /parallel-setup

When invoked, this skill will:
1. Check current branch
2. Read `.claude-sessions.md` if it exists
3. Show which files this session should focus on
4. Warn if about to edit a file owned by another session

### Usage
```
/parallel-setup feature/my-branch "Dashboard improvements"
```

---

## Example: Royalty Parallel Work Plan

### Session 1: Testing & Bug Fixes
```bash
git checkout -b fix/support-testing
```
- Run migrations
- Test customer flow
- Fix any bugs found
- **Owns:** Bug fixes only, no new features

### Session 2: Branding (Automata → Royalty)
```bash
git checkout -b refactor/royalty-rebrand
```
- Global find/replace in code comments
- Update i18n strings
- Update meta tags
- **Owns:** Branding text only

### Session 3: Dashboard Reporting
```bash
git checkout -b feature/dashboard-charts
```
- ApexCharts integration
- New dashboard components
- **Owns:** app/dashboard.*

---

## Conflict Resolution

If merge conflicts occur:

1. **Small conflicts:** Resolve manually in VS Code
2. **Large conflicts:**
   - Create a new session dedicated to merging
   - Give it both branches' context
   - Let Claude help resolve intelligently

```bash
git checkout main
git merge feature/branch-a
# Conflicts!
git checkout -b merge/resolve-conflicts
# Start Claude here with conflict context
```

---

## Best Practices

1. **Start with a plan** - Before spawning sessions, plan which owns what
2. **Use the coordination file** - Keep `.claude-sessions.md` updated
3. **Communicate via commits** - Clear commit messages help other sessions
4. **Merge incrementally** - Don't let branches diverge too far
5. **One "main" session** - Have a primary session that coordinates merges

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `git branch` | See current branch |
| `git stash` | Temporarily save changes |
| `git log --oneline -10` | Recent commits |
| `git diff main` | Changes from main |
| `git merge --abort` | Cancel a bad merge |

---

*Skill created: Feb 2, 2026*
*For Royalty (royaltyapp.ai)*
