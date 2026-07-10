# Testing Workflow - Launcher Prompts

> **Setup**: Place `TEST.md` in `$APP_DIR/.claude/test`.
> Use these prompts to run structured diagnostics, test-quality analysis, and orchestrated remediation.

---

## 1. Start (Plan Mode)

```text
Read and execute $APP_DIR/.claude/test/TEST.md

Repos:
- Backend: $APP_DIR/[your-app]-backend
- Frontend: $APP_DIR/[your-app]-frontend
- Claude dir: $APP_DIR/.claude

Issue: [ISSUE_NAME]

Audit mode:
[Optional: e2e-frontend | e2e-backend | quality | all]

Test focus:
[Optional: critical features, APIs, flows, or components]

Risk areas:
[Optional: flaky tests, recent regressions, fragile modules]
```

> The agent runs baseline metrics (`npm run test`, `npm run test:coverage`), executes diagnostics, and produces `tickets/[ISSUE_NAME]_TEST_REPORT.md`.

---

## 2. After Diagnostic Summary Table (Checkpoint Before Fixes)

If the failure table and proposed fixes are accurate:

```text
approved
```

If you want corrections before continuing:

```text
[your feedback]
```

If you want to stop:

```text
abort
```

---

## 3. After Test Report Is Generated

If results are acceptable and no remediation is needed:

```text
passed
```

If you want remediation planning + execution via orchestrator:

```text
needs-fix-plan
```

or

```text
remediate
```

If you want another validation cycle:

```text
rerun
```

To stop:

```text
abort
```

---

## 4. Remediation Handoff Flow

When you respond with `needs-fix-plan` or `remediate`, the workflow should:
1. Launch `CREATE_PROMPT_PLAN.md` using `tickets/[ISSUE_NAME]_TEST_REPORT.md` as the work request source.
2. Pause at planning checkpoints until `tickets/[ISSUE_NAME]_PROMPT_PLAN.md` is approved.
3. Launch `UNIVERSAL_ORCHESTRATOR.md` with the approved prompt plan.
4. Execute tasks with validation and incremental git commits.

---

## 5. After Orchestrator Execution

If you want a fresh validation pass on updated code:

```text
rerun
```

If testing confidence is sufficient:

```text
passed
```

If more remediation is required:

```text
needs-fix-plan
```

To stop:

```text
abort
```

---

## Quick Reference

| Response                         | Meaning                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `approved`                       | Accept the diagnostic failure table and proposed fix directions    |
| `passed`                         | Accept current test status and finalize                            |
| `needs-fix-plan` / `remediate`   | Trigger `CREATE_PROMPT_PLAN` then `UNIVERSAL_ORCHESTRATOR` flow   |
| `rerun`                          | Re-execute selected test scope and regenerate report               |
| `abort`                          | Stop workflow immediately                                          |
