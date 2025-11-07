# File Storage Module Docs

This directory contains everything needed to get up to speed on the browser-based file storage module. Start each session by skimming this README, then follow the pointers to the detailed documents.

## Layout
- `overview.md` – problem statement, requirements, constraints, rationale.
- `tickets.md` – ordered list of actionable tasks. Work straight down unless a ticket explicitly depends on another.
- (Future) Additional specs or notes can live alongside these files.

## Workflow for Future Sessions
1. Read `overview.md` for background or when requirements change.
2. Open `tickets.md`, find the first unchecked ticket, and focus the session on that one.
3. When a ticket is completed, update `tickets.md` (check it off, add notes, or append follow-ups).
4. Keep any new discoveries or decisions in this folder so the next session has the same context.

## Notes
- The module is browser-only (no Node APIs) and will be consumed by HTML files under `public/`.
- Prioritize Chromium’s persistent handle support; provide a transient fallback for non-supporting browsers as described in `overview.md`.
- No binary snapshots/copies of file contents are allowed—handles only.

## Testing Workflow
- **Unit harness (`npm test` / `npm run test:watch`)** – runs Vitest with `happy-dom` + `fake-indexeddb` shims; specs live under `tests/file_storage_module/` and should cover registry/back-end logic with no DOM usage.
- **Browser smoke (`npm run test:smoke`)** – launches Chromium via `@web/test-runner/chrome`, loads `public/tests/file_storage_smoke.test.js`, and asserts that the production module can initialize IndexedDB and write/read registry entries end-to-end. Requires a locally installed Chromium/Chrome that matches the path in `web-test-runner.config.js`.
- The legacy `public/tests/file_storage_smoke.html` page still exists for manual sanity checks, but only `.test.js` files participate in the automated smoke script.
