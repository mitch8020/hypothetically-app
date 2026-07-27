# How Many, Though? Web

The mobile-first React interface for the random question, locked answer,
animated crowd reveal, and leaderboard loop.

## Local development

Start the API on port `7000`, then:

```powershell
npm.cmd install
npm.cmd run dev -- --port 7073
```

Vite proxies `/api` to `http://localhost:7000`. Override that only when needed
with `VITE_API_PROXY_TARGET`.

## Verification

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

The Playwright suite expects the backend to be running with its test-only auth
adapter and covers desktop and mobile Chrome, keyboard focus, reduced motion,
snapshot behavior, accessibility, and the no-repeat question loop.
