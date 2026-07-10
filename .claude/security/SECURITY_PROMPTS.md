# Security Workflow - Launcher Prompts

> **Setup**: Place `SECURITY.md` in `$APP_DIR/.claude/security`.
> Use these prompts for threat-informed security review with orchestrated remediation.

---

## 1. Start (Plan Mode)

```text
Read and execute $APP_DIR/.claude/security/SECURITY.md

Repos:
- Backend: $APP_DIR/[your-app]-backend
- Frontend: $APP_DIR/[your-app]-frontend
- Claude dir: $APP_DIR/.claude

Issue: [ISSUE_NAME]

Review mode:
[Optional: focused | full | compliance | release-gate]

Scope notes:
[Optional: changed files, PR link, architecture focus]

Compliance notes:
[Optional: standards, policy constraints, audit requirements]
```

> The agent performs threat modeling and category-based analysis, then presents a scope checkpoint.

---

## 2. After Threat Scope Checkpoint

If scope and attack-surface mapping are accurate:

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

If finding categories/severity look correct:

```text
proceed
```

If updates are needed:

```text
[your feedback]
```

To stop:

```text
abort
```

---

## 4. After Security Report Is Generated

If residual risk is acceptable:

```text
accepted-risk
```

If you want mitigation planning + execution:

```text
remediate
```

If code changed and you want a fresh security pass:

```text
reassess
```

To stop:

```text
abort
```

---

## 5. Remediation Handoff Flow

When you respond with `remediate`, the workflow should:
1. Launch `CREATE_PROMPT_PLAN.md` using `tickets/[ISSUE_NAME]_SECURITY_REVIEW.md`.
2. Pause at planning checkpoints until `tickets/[ISSUE_NAME]_PROMPT_PLAN.md` is approved.
3. Launch `UNIVERSAL_ORCHESTRATOR.md` with the approved prompt plan.
4. Execute tasks with validation and incremental git commits.

---

## 6. After Orchestrator Execution

If you want another security pass:

```text
reassess
```

If risk posture is now acceptable:

```text
accepted-risk
```

If additional remediation is required:

```text
remediate
```

To stop:

```text
abort
```

---

## Quick Reference

| Response        | Meaning                                                            |
| --------------- | ------------------------------------------------------------------ |
| `correct`       | Confirm threat scope and attack-surface mapping                    |
| `proceed`       | Approve findings preview and generate final security report        |
| `accepted-risk` | Accept residual risk and finalize                                  |
| `remediate`     | Trigger `CREATE_PROMPT_PLAN` then `UNIVERSAL_ORCHESTRATOR` flow   |
| `reassess`      | Re-run security review on updated code/context                     |
| `abort`         | Stop workflow immediately                                          |
