# Code Review Workflow - Launcher Prompts

> **Setup**: Place `CODE_REVIEW.md` in `$APP_DIR/.claude/code-review`.
> Use these prompts for deep cross-repository code review with orchestrated remediation.

---

## 1. Start (Plan Mode)

```text
Read and execute $APP_DIR/.claude/code-review/CODE_REVIEW.md

Repos:
- Backend: $APP_DIR/[your-app]-backend
- Frontend: $APP_DIR/[your-app]-frontend
- Claude dir: $APP_DIR/.claude

Issue: [ISSUE_NAME]

Review mode:
[Optional: changes-only | full | release-gate | audit]

Scope notes:
[Optional: PR link, changed files, acceptance criteria, risk areas]
```

> The agent performs scope intake, builds a review matrix, and pauses for scope confirmation.

---

## 2. After Scope Confirmation Checkpoint

If scope and assumptions are correct:

```text
correct
```

If corrections are needed:

```text
[your feedback]
```

To stop:

```text
abort
```

---

## 3. After Findings Preview Checkpoint

If findings preview is accurate:

```text
proceed
```

If refinements are needed:

```text
[your feedback]
```

To stop:

```text
abort
```

---

## 4. After Code Review Report Is Generated

If the review is acceptable:

```text
approved
```

If you want remediation planning + execution:

```text
needs-fix-plan
```

If code changed and you want another review pass:

```text
re-review
```

To stop:

```text
abort
```

---

## 5. Remediation Handoff Flow

When you respond with `needs-fix-plan`, the workflow should:
1. Launch `CREATE_PROMPT_PLAN.md` using `tickets/[ISSUE_NAME]_CODE_REVIEW.md`.
2. Pause at planning checkpoints until `tickets/[ISSUE_NAME]_PROMPT_PLAN.md` is approved.
3. Launch `UNIVERSAL_ORCHESTRATOR.md` with the approved prompt plan.
4. Execute tasks with validation and incremental git commits.

---

## 6. After Orchestrator Execution

If you want a fresh code review pass:

```text
re-review
```

If review confidence is now sufficient:

```text
approved
```

If more implementation work is needed:

```text
needs-fix-plan
```

To stop:

```text
abort
```

---

## Quick Reference

| Response           | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `correct`          | Confirm review scope and assumptions                               |
| `proceed`          | Approve findings preview and generate final code review report     |
| `approved`         | Accept review result and finalize                                  |
| `needs-fix-plan`   | Trigger `CREATE_PROMPT_PLAN` then `UNIVERSAL_ORCHESTRATOR` flow   |
| `re-review`        | Re-run review after updates                                        |
| `abort`            | Stop workflow immediately                                          |
