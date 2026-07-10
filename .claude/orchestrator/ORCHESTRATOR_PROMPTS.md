# Universal Orchestrator — Launcher Prompts

> **Setup**: Place `UNIVERSAL_ORCHESTRATOR.md` and `PROMPT_PLAN_TEMPLATE.md` in your `$APP_DIR/.claude/orchestrator` folder once.
> Create a prompt plan for each project using the template (or via `CREATE_PROMPT_PLAN.md`).
> These are the only prompts you'll ever need for orchestrated task execution.

---

## 1. Start (Auto-Accept Mode)

```
Read and execute $APP_DIR/.claude/orchestrator/UNIVERSAL_ORCHESTRATOR.md

Prompt plan: $APP_DIR/.claude/tickets/[YOUR_PROMPT_PLAN].md
```

That's it. The orchestrator reads everything else (repo paths, fix plan path, task count, dependencies, validation commands) from your prompt plan's `## Configuration` and `## Validation Registry` sections.

> Claude runs pre-flight checks, discovers tasks, then begins executing sequentially.

---

## 2. At `confirm`-Flagged Task Checkpoints

The orchestrator pauses before any task flagged `confirm` in your Validation Registry.

**If you want to execute it:**

```
a
```

**If you want to skip it:**

```
b
```

> Example: A data migration task flagged `confirm` will pause and show you what the migration does before running it.

---

## 3. If Something Goes Wrong Mid-Run

**If you need to stop entirely:**

```
stop — [reason]
```

**If a task failed and you want to provide context for the retry:**

```
[Your context — e.g., "The tsc error is because JobService
still imports from the old path. Check the barrel export in index.ts."]
```

> The orchestrator retries failed tasks once automatically. You only need to intervene if both attempts fail and you want to provide guidance.

---

## 4. At Post-Task Audit Checkpoint

After all tasks complete, the orchestrator runs build/lint/test on both repos and presents results.

**Fix only issues caused by this project (recommended):**

```
a
```

**Fix everything, including pre-existing issues:**

```
b
```

**Skip audit fixes and finalize as-is:**

```
c
```

---

## 5. After Completion

The orchestrator automatically:

- Runs the post-task audit
- Updates CLAUDE.md and README.md context files with what was built
- Prints a final status log and summary

No prompt needed.

**If you want to see the status mid-run:**

```
print status log
```

**If tasks were skipped and you want to retry them after fixing a dependency:**

```
Re-run tasks [N, N, N] — the dependency issue has been fixed manually.
```

---

## Quick Reference

| Situation                         | What to Type                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| Start a project                   | `Read and execute $APP_DIR/.claude/orchestrator/UNIVERSAL_ORCHESTRATOR.md` + prompt plan path |
| Approve a `confirm` task          | `a`                                                                                           |
| Skip a `confirm` task             | `b`                                                                                           |
| Audit: fix introduced issues only | `a`                                                                                           |
| Audit: fix all issues             | `b`                                                                                           |
| Audit: skip fixes                 | `c`                                                                                           |
| Check progress                    | `print status log`                                                                            |
| Help a failed retry               | `[your debugging context]`                                                                    |
| Stop everything                   | `stop`                                                                                        |

---

## Example

```
Read and execute $APP_DIR/.claude/orchestrator/UNIVERSAL_ORCHESTRATOR.md

Prompt plan: $APP_DIR/.claude/tickets/AUTH_REFRESH_FEATURE_PROMPT_PLAN.md
```

> The orchestrator finds `PROJECT_ID`, `PRIMARY_DIR`, `SECONDARY_DIR`, `FIX_PLAN`, all tasks,
> their dependencies, and validation commands from the prompt plan. Tasks flagged `confirm`
> in the Validation Registry pause automatically. After all tasks, CLAUDE.md files are updated.
