# Browser ID Module Docs

This folder tracks the identity module that issues stable browser IDs and per-tab IDs for the WebRTC file transfer app. Review this README before each session, then follow the pointers to the detailed specs and ticket backlog.

## Layout
- `overview.md` – motivation, requirements, API surface, and testing strategy.
- `tickets.md` – ordered backlog of completed work plus upcoming tasks.
- Future specs / research notes can live alongside these files. Keep everything ASCII so diffs stay readable.

## Working Agreement
1. Skim `overview.md` at the start of each session or whenever requirements change.
2. Use `tickets.md` to drive focused work. Update the checklist when a ticket is shipped, blocked, or replaced.
3. Document discoveries (browser quirks, manual repro steps, etc.) in this folder so the next session has identical context.
4. Keep implementation files under `public/js/` and browser-facing tests in `public/tests/browser_id_module/`. Automated specs stay inside `tests/browser_id_module/`.

## Quickstart
- Module entry: `public/js/browserIdModule.mjs` (default export + `createBrowserIdModule` factory).
- Primary consumers: multi-tab harness in `public/tests/file_storage_module/ground_truth_multitab.html` and any future WebRTC flows that need to label tabs before establishing peer connections.
- Tests:
  - `npm test` (Vitest + happy-dom) covers the module in isolation.
  - `npm run test:smoke` (Web Test Runner + headless Chrome) imports `public/tests/browser_id_module/browser_id_smoke.test.js`.
  - Manual harness pages live under `public/tests/browser_id_module/` (`tab_identity_baseline.html`, `tab_identity_multitab.html`).

## Notes
- The module intentionally avoids DOM coupling—the only globals it touches are storage APIs, cookies, and optional BroadcastChannel support.
- A `browserId` represents the profile/device; a `tabId` represents the active tab. Transient file selections must be tagged with both so operators can confirm which tab “owns” an in-memory selection.
- When BroadcastChannel is unavailable, a localStorage “storage event” bus provides best-effort duplicate detection. If both are blocked, IDs remain best-effort but deterministic.
