# Prompt Plan Template — Orchestrator-Compatible Format

> **Usage**: Copy this template to create a new prompt plan for any project.
> The Universal Orchestrator reads this file's structure to discover tasks,
> parse dependencies, and run validation. Follow the conventions below.
>
> **Location**: Save prompt plans to `$CLAUDE_DIR/tickets/[ISSUE_NAME]_PROMPT_PLAN.md`

---

# [PROJECT NAME] - Implementation Roadmap

**Issue ID**: [PROJECT_ID]
**Created**: [Date]
**Task Count**: [N]
**Scope**: [Brief scope description]

---

## Configuration

> The orchestrator reads this table to set project-wide variables.
> All paths must be absolute.

| Variable        | Value                                       |
| --------------- | ------------------------------------------- |
| `PROJECT_ID`    | `YOUR_PROJECT_ID`                           |
| `COMMIT_PREFIX` | `feat(module-name)`                         |
| `PRIMARY_DIR`   | `$APP_DIR/your-app-backend`                 |
| `SECONDARY_DIR` | `$APP_DIR/your-app-frontend`                |
| `FIX_PLAN`      | `$APP_DIR/.claude/tickets/YOUR_FIX_PLAN.md` |

**Field notes:**

- `PROJECT_ID` — Used in commit messages and status log header. Convention: `UPPER_SNAKE_CASE`.
- `COMMIT_PREFIX` — Conventional commit prefix. Examples: `feat(auth)`, `fix(billing)`, `refactor(db)`.
- `PRIMARY_DIR` — The main repository where most tasks execute. Usually the backend.
- `SECONDARY_DIR` — Optional. A second repository (e.g., frontend). Set to `N/A` or remove the row if not applicable.
- `FIX_PLAN` — Optional. Path to the design/architecture document in the `tickets/` folder. Subagents reference this for broader context. Remove the row if not applicable.

---

## Validation Registry

> The orchestrator reads this table to validate each task independently after the subagent completes.
> One row per task. Tasks not listed here will fall back to extracting validation from the task section's `### Validation` block.

| Task | Validation Command                                      | Dir       | Flags            |
| ---- | ------------------------------------------------------- | --------- | ---------------- |
| 1    | `npx tsc --noEmit src/path/to/file.ts`                  | primary   |                  |
| 2    | `npx tsc --noEmit src/path/to/file.ts`                  | primary   |                  |
| 3    | `npx tsc --noEmit src/path/to/file.ts`                  | primary   |                  |
| 4    | `npx tsc --noEmit src/path/to/file.ts`                  | primary   | confirm          |
| 5    | `npm run typecheck`                                     | secondary | secondary-commit |
| 6    | `npx tsc --noEmit && npm run test -- --passWithNoTests` | primary   | full-test        |

**Column reference:**

| Column                 | Description                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| **Task**               | Task number (must match `### Task N:` heading)                                               |
| **Validation Command** | Shell command(s). Exit code 0 = pass. Wrap in backticks. Multiple commands joined with `&&`. |
| **Dir**                | `primary` → runs in `PRIMARY_DIR`. `secondary` → runs in `SECONDARY_DIR`.                    |
| **Flags**              | Comma-separated. See below. Leave blank for default behavior.                                |

**Available flags:**

| Flag               | Behavior                                                           |
| ------------------ | ------------------------------------------------------------------ |
| `confirm`          | Orchestrator pauses and asks user before executing this task       |
| `secondary-commit` | Git commit in BOTH primary (allow-empty) and secondary directories |
| `full-test`        | If tests fail but compilation passes, record as pass with caveat   |

---

## Task Dependency Graph

> Visual representation of task dependencies. Helps humans understand the flow.
> The orchestrator does NOT parse this section — it reads `**Dependencies**:` from each task.

```
Phase 1 (Foundation):
  [Task 1] ──► [Task 2] ──► [Task 3]

Phase 2 (Migration):
  [Task 4] ◄── (parallel) ──► [Task 5]

Phase 3 (Cleanup):
  [Task 6]
```

---

<!-- ═══════════════════════════════════════════════════ -->
<!-- TASK SECTIONS START HERE                            -->
<!-- ═══════════════════════════════════════════════════ -->

## Phase 1: [Phase Name]

### Task 1: [Task Name]

**Scope**: [One sentence describing what this task does]

**Files to Create/Modify**:

- `src/path/to/file.ts` (CREATE)
- `src/path/to/other-file.ts` (MODIFY)

**Dependencies**: None

**Isolation Rules**:

- DO NOT modify [files owned by other tasks]
- DO NOT delete [files that will be removed in later tasks]

````markdown
## Claude Code Prompt - Task 1

### Context

[Provide the subagent with enough context to understand the codebase state.
Reference what previous tasks have done if relevant.
Keep this concise — the subagent also has access to the FIX_PLAN for deeper context.]

### Task

[Clear, specific statement of what to implement.]

### Requirements

1. **[Requirement group 1]**:
   - Detail A
   - Detail B

   ```typescript
   // Code examples if helpful
   ```

2. **[Requirement group 2]**:
   - Detail C
   - Detail D

### Validation

```bash
cd $APP_DIR/your-repo
npx tsc --noEmit src/path/to/file.ts
npm run test -- --testPathPattern="file" --passWithNoTests
```

### DO NOT

- [Constraint 1 — prevents conflicts with other tasks]
- [Constraint 2]
- [Constraint 3]
````

---

### Task 2: [Task Name]

**Scope**: [One sentence]

**Files to Create/Modify**:

- `src/path/to/file.ts` (MODIFY)

**Dependencies**: 1

**Isolation Rules**:

- DO NOT modify [files from Task 1]

````markdown
## Claude Code Prompt - Task 2

### Context

Task 1 created [brief description of what exists now].

### Task

[What to implement]

### Requirements

1. ...
2. ...

### Validation

```bash
cd $APP_DIR/your-repo
npx tsc --noEmit src/path/to/file.ts
```

### DO NOT

- ...
````

---

<!-- Repeat for all tasks -->
<!-- Every task section MUST end with a --- separator -->

---

<!-- ═══════════════════════════════════════════════════ -->
<!-- EXECUTION SUMMARY                                   -->
<!-- ═══════════════════════════════════════════════════ -->

## Execution Summary

| Task | Phase      | Dependencies | Est. Time |
| ---- | ---------- | ------------ | --------- |
| 1    | Foundation | None         | 1-2 hrs   |
| 2    | Foundation | 1            | 2-3 hrs   |
| 3    | Migration  | 1, 2         | 1-2 hrs   |
| 4    | Migration  | 3            | 1-2 hrs   |
| 5    | Cleanup    | 4            | 1-2 hrs   |
| 6    | Cleanup    | 5            | 1-2 hrs   |

**Total Estimated Time**: X hours

---

## Notes for Execution

1. **Validate Each Task** before proceeding to dependent tasks
2. **Commit Frequently** — one commit per task recommended
3. **Test on Dev First** — especially for data migrations or destructive operations
4. **Keep Old Code** until final cleanup task is verified

<!-- ═══════════════════════════════════════════════════ -->
<!-- CONVENTIONS REFERENCE (delete before use)           -->
<!-- ═══════════════════════════════════════════════════ -->

<!--
CONVENTIONS CHECKLIST — Delete this section from your actual prompt plan

✅ File starts with: # [Name] - Implementation Roadmap
✅ Has ## Configuration section with table (before first task)
✅ Has ## Validation Registry section with table (before first task)
✅ Each task heading: ### Task N: Name (exactly this format)
✅ Each task has **Dependencies**: line (number list or "None")
✅ Each task has **Isolation Rules**: (DO NOT constraints)
✅ Each task section contains a Claude Code Prompt block with:
   - ### Context
   - ### Task
   - ### Requirements
   - ### Validation (with ```bash block)
   - ### DO NOT
✅ Each task section ends with --- separator
✅ Dependencies use simple format: "None" or "1" or "1, 2, 3" or "1-3"
✅ Validation commands use exit code 0 = success convention
✅ Files marked (CREATE) or (MODIFY) in the file list
✅ FIX_PLAN path points to tickets/ folder
✅ Prompt plan saved in tickets/ folder
-->
