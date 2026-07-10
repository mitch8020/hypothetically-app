# Plan Creator — Launcher Prompts

> **Setup**: Place `CREATE_PROMPT_PLAN.md` and `PROMPT_PLAN_TEMPLATE.md` in your `$APP_DIR/.claude/orchestrator/` folder once.
> These are the only prompts you'll ever need to create orchestrator-ready plans.

---

## 1. Start (Plan Mode)

```
Read and execute $APP_DIR/.claude/orchestrator/CREATE_PROMPT_PLAN.md

Repos:
- Backend: $APP_DIR/[your-app]-backend
- Frontend: $APP_DIR/[your-app]-frontend
- Claude dir: $APP_DIR/.claude

Issue: [ISSUE_NAME]

[Describe what you need. Examples:]

Feature: "Add a bulk move feature that lets users select multiple items
from one group and move them to another group. Should work from the group
detail page."

Refactor: "Consolidate the two separate job management systems into a single
unified module with retry and checkpointing support."

Test audit: "Audit test quality for the auth and subscription modules in
the backend. Exclude unrelated utility modules."

Performance: "The project list page takes 8+ seconds to load for companies
with 50+ projects. Needs to be under 2 seconds."
```

> Claude classifies the work type, asks targeted questions, then stops for confirmation.
>
> **Bug fixes?** Use `BUG_FIX.md` instead — it handles investigation, implementation, audit, and commits in one session.

---

## 2. After Discovery Questions

**Answer Claude's questions, then it confirms understanding.**

If the summary is accurate:

```
correct
```

If something needs correction:

```
[Your corrections — e.g., "This also affects the billing module,
and we need backward compatibility with V2 API consumers."]
```

> On "correct": Claude investigates both repos and creates ANALYSIS.md, then stops.

---

## 3. After Reviewing Analysis

**If the analysis is solid:**

```
proceed
```

**If you have corrections or additions:**

```
[Your feedback — e.g., "You missed the webhook handler in
procore.service.ts — that's also part of this flow."]
```

> On "proceed": Claude creates the FIX_PLAN.md (design document), then stops.

---

## 4. After Reviewing Fix Plan

**If the design is approved:**

```
proceed
```

**If you want changes:**

```
[Your feedback — e.g., "I'd prefer to keep backward compatibility
for 2 sprints rather than removing the old API immediately."]
```

> On "proceed": Claude reads the PROMPT_PLAN_TEMPLATE.md, decomposes the work
> into tasks, creates the PROMPT_PLAN.md, then stops.

---

## 5. After Reviewing Prompt Plan

**If everything looks good:**

```
approved
```

**If you want to adjust the task breakdown:**

```
[Your feedback — e.g., "Task 5 is too large — split the migration
script creation and the migration execution into separate tasks.
Also flag the execution task as 'confirm'."]
```

> On "approved": Both files are finalized and ready for the orchestrator.

---

## 6. Run the Orchestrator

Once plans are approved, switch to a new Claude Code session in auto-accept mode:

```
Read and execute $APP_DIR/.claude/orchestrator/UNIVERSAL_ORCHESTRATOR.md

Prompt plan: $APP_DIR/.claude/tickets/[ISSUE_NAME]_PROMPT_PLAN.md
```

---

## Quick Reference

| Situation                     | What to Type                                    |
| ----------------------------- | ----------------------------------------------- |
| Start planning                | Launcher prompt (Step 1) with issue description |
| Confirm understanding         | `correct`                                       |
| Approve analysis              | `proceed`                                       |
| Approve fix plan              | `proceed`                                       |
| Approve prompt plan           | `approved`                                      |
| Give corrections at any stage | `[your feedback in plain English]`              |
| Stop everything               | `abort`                                         |
| Run the plans                 | Switch to orchestrator (Step 6)                 |

---

## Full Lifecycle

```
New App Development:

  PRD Creation (one-time)        Plan Mode                    Auto-Accept Mode
  ───────────────────            ─────────                    ────────────────
  CREATE_PRD.md                  CREATE_PROMPT_PLAN.md        UNIVERSAL_ORCHESTRATOR.md
    └→ PRD.md                      └→ ANALYSIS.md               └→ Executes tasks 1..N
    └→ CLAUDE.md (×3)              └→ FIX_PLAN.md               └→ Updates CLAUDE.md
    └→ README.md (×2)              └→ PROMPT_PLAN.md ─── hand off ──→  └→ Post-task audit
                                                                       └→ Commits & summary

Features / Refactors / Audits / Performance:

  Plan Mode                              Auto-Accept Mode
  ─────────                              ─────────────────
  CREATE_PROMPT_PLAN.md                  UNIVERSAL_ORCHESTRATOR.md
    └→ tickets/ANALYSIS.md                 └→ Executes tasks 1..N
    └→ tickets/FIX_PLAN.md                 └→ Updates CLAUDE.md + README.md
    └→ tickets/PROMPT_PLAN.md ── hand off ──→  └→ Post-task audit
                                               └→ Commits & summary

Bug Fixes (separate workflow):

  Plan Mode
  ─────────
  BUG_FIX.md → Investigate → Implement → Audit → Commit (all in one session)
```

**Six workflow files, any project.**
