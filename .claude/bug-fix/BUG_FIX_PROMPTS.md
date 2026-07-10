# Bug Fix Workflow — Launcher Prompts

> **Setup**: Place `BUG_FIX.md` in your `$APP_DIR/.claude/bug-fix` folder once.
> These are the only prompts you'll ever need for bug fixing.

---

## 1. Start (Plan Mode)

```
Read and execute $APP_DIR/.claude/bug-fix/BUG_FIX.md

Repos:
- Backend: $APP_DIR/[your-app]-backend
- Frontend: $APP_DIR/[your-app]-frontend
- Claude dir: $APP_DIR/.claude

Issue: [ISSUE_NAME]

[Describe the bug here. Include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Any error messages you saw]
```

> Claude investigates, asks questions, creates `tickets/[ISSUE_NAME]_ANALYSIS.md`, then stops.

---

## 2. After Reviewing Analysis

**If the analysis and proposed fix look good:**

```
proceed
```

**If you have feedback or corrections:**

```
[Your feedback — e.g., "The bug only happens when the user is on the
free plan, not all users. Also check the subscription middleware."]
```

**If you want to abandon:**

```
abort
```

> On "proceed": Claude implements the fix, runs build/lint/test on both repos, then stops.

---

## 3. After Verifying in the App

**If the bug is fixed:**

```
fixed
```

**If the bug persists:**

```
still broken: [Describe what's still wrong — new error messages,
different behavior than before, same exact issue, etc.]
```

**If you want to review changes before deciding:**

```
review first
```

> On "fixed": Claude generates commit plan, stages commits, prints summary.
> On "still broken": Claude re-investigates with accumulated context, then stops for review again.

---

## That's it.

**Before (your old workflow):** 5+ long prompts, 3 mode switches, separate audit steps.

**Now:** 1 launcher prompt + single-word responses at checkpoints.

The audit (build/lint/test) runs automatically after every implementation — no separate prompt needed.
