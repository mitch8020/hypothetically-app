# PRD Creator — Launcher Prompts

> **Setup**: Place `CREATE_PRD.md` in your `$APP_DIR/.claude/prd/` folder once.
> These are the only prompts you'll ever need to create a PRD and initialize project context.

---

## 1. Start (Plan Mode)

```
Read and execute $APP_DIR/.claude/prd/CREATE_PRD.md

App Name: [YOUR APP NAME]
App Slug: [your-app-slug]

Repos:
- Backend: $APP_DIR/[your-app-slug]-backend
- Frontend: $APP_DIR/[your-app-slug]-frontend
- Claude dir: $APP_DIR/.claude

Tech Stack:
- Frontend: Vite + React, TypeScript, TanStack, TailwindCSS
- Backend: NestJS, TypeScript
- Database: MongoDB
- Error Tracking: Rollbar
[Adjust the above to match your actual stack]

[Describe your app idea here. Include as much as you can about:
- What the app does and why it exists
- Who will use it (user roles)
- Core features and capabilities (list them all)
- Main goals and success criteria
- Any integrations with external services
- Monetization model (if any)
- Any constraints or strong preferences

The more detail you provide here, the fewer questions
the agent needs to ask.]
```

> Claude reads your description, asks product discovery questions, then stops for confirmation.

---

## 2. After Product Vision Questions

**Answer Claude's questions, then it confirms understanding.**

If the summary is accurate:

```
correct
```

If something needs correction:

```
[Your corrections — e.g., "There are actually three user roles,
not two. Viewers can only see reports, they can't edit anything."]
```

> On "correct": Claude asks deep specification questions about modules, schemas, and flows.

---

## 3. After Deep Specification Questions

**Answer Claude's module/schema questions, then it presents proposed schemas.**

If the schemas and modules look right:

```
correct
```

If you have corrections:

```
[Your feedback — e.g., "The Task schema needs a 'priority' field
with values: low, medium, high, urgent. Also, tasks should have
an optional 'dueDate' field."]
```

> On "correct": Claude generates the full PRD.md document, then stops.

---

## 4. After Reviewing PRD

**If the PRD looks good:**

```
approved
```

**If you want changes:**

```
[Your feedback — e.g., "Section 7.3 needs to include the bulk
export feature I mentioned. Also, the API for projects should
support filtering by status and date range."]
```

> On "approved": Claude generates all context files (CLAUDE.md × 3, README.md × 2).

---

## 5. After Context File Generation

All files are created. Review them, make any manual tweaks, and commit.

**To start planning your first feature:**

Switch to plan mode and use the CREATE_PROMPT_PLAN workflow:

```
Read and execute $APP_DIR/.claude/orchestrator/CREATE_PROMPT_PLAN.md

Repos:
- Backend: $APP_DIR/[your-app-slug]-backend
- Frontend: $APP_DIR/[your-app-slug]-frontend
- Claude dir: $APP_DIR/.claude

Issue: [FIRST_FEATURE_NAME]

[Copy the feature specification from PRD.md Section 7 here,
or describe it in your own words referencing the PRD]
```

---

## Quick Reference

| Situation                     | What to Type                                  |
| ----------------------------- | --------------------------------------------- |
| Start PRD creation            | Launcher prompt (Step 1) with app description |
| Confirm product vision        | `correct`                                     |
| Confirm schemas/modules       | `correct`                                     |
| Approve PRD                   | `approved`                                    |
| Give corrections at any stage | `[your feedback in plain English]`            |
| Stop everything               | `abort`                                       |

---

## Full Lifecycle

```
New App Development:

  PRD Creation                   Plan Mode                    Auto-Accept Mode
  ────────────                   ─────────                    ────────────────
  CREATE_PRD.md                  CREATE_PROMPT_PLAN.md        UNIVERSAL_ORCHESTRATOR.md
    └→ PRD.md                      └→ ANALYSIS.md               └→ Executes tasks 1..N
    └→ CLAUDE.md (×3)              └→ FIX_PLAN.md               └→ Updates CLAUDE.md + README.md
    └→ README.md (×2)              └→ PROMPT_PLAN.md ─── hand off ──→  └→ Post-task audit
                                                                       └→ Commits & summary

  Bug Fixes (separate workflow):
  BUG_FIX.md → Investigate → Implement → Audit → Commit (all in one session)
```

**Start with the PRD, plan features one at a time, execute with the orchestrator.**
