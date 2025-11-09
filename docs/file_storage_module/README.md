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
- Deterministic verification fixtures live at `public/tests/file_storage_module/fixtures/ground-truth/`; use them with the smoke page plus `groundTruthManifest.js` to compare recorded counts against the known totals.

## Consumer Integration
- Import the module from `public/js/fileStorageModule.mjs` inside each consumer HTML page via `<script type="module">`. Call `await fileStorageModule.init()` on load so IndexedDB is ready before the user interacts with the UI.
- After a picker/drag-drop gesture, pass the returned handles/files into `await fileStorageModule.add(selection)`. The result includes `{ ok, key, storageType }`. Branch on `storageType` immediately:
  - `native-handle` (Chromium): Persisted in IndexedDB. Queue a follow-up button that calls `await fileStorageModule.requestPermissions(key)` to re-grant access whenever the page reloads or the user returns later. Show Chrome/Edge permission prompts before you attempt traversals.
  - `transient-session` (Safari/Firefox/dragged `File` objects): The in-memory entry vanishes on refresh, tab close, or crash. Surface an explicit “Keep this tab open; do not refresh” banner and provide a quick way to reselect files if the warning is ignored.
- Use `listKeys`, `getStorageType`, `exists`, and `getFileCount` to power dashboards. Call `getFileCount` (or the mutation harness) whenever you need to detect drift; the method performs a fresh traversal and can report `{ partial:true, reason:'entries-missing' }` when files disappear.
- When running multi-tab flows, remember that registry state lives in IndexedDB (shared) but transient sessions are tab-local. Only the tab that created a transient key can use it.
- Document any UI copy that references these behaviors alongside the harness scripts so future contributors know which prompts to keep in sync.

## Testing Workflow
- **Unit harness (`npm test` / `npm run test:watch`)** – fast Vitest suites running under `happy-dom` + `fake-indexeddb`. These cover registry lifecycle, IndexedDB migrations, native handle persistence/recounts, and transient expiration using the deterministic fixtures under `tests/file_storage_module/`.
- **Lightweight smoke automation (`npm run test:smoke`)** – executes `file_storage_smoke.test.js` in Web Test Runner + headless Chrome to ensure the module bundles, initializes, and exposes the public API without throwing. Treat this as a console-smoke, not a replacement for manual harness pages.
- **Manual ground-truth harness matrix (`public/tests/file_storage_module/*.html`)** – always open these in Chromium so persistent handles work as expected. Copy `fixtures/ground-truth` outside WSL (or somewhere Chrome can reach) before starting.
  1. `ground_truth_baseline.html` – resets the registry, runs native + transient selections against the fixture, and logs structured summaries. Use this first whenever behavior changes.
  2. `ground_truth_refresh.html` – store both types of selections, refresh, and confirm only the native key survives. Includes transient warning copy you should keep in sync with consumer pages.
  3. `ground_truth_reopen.html` – same as refresh but walks you through closing all Chromium windows before verifying persistence after a cold start.
  4. `ground_truth_multitab.html` – duplicates the tab, displays per-tab IDs, and proves native registry entries are shared while transient sessions remain tab-local.
  5. `ground_truth_mutations.html` – select an existing native key, mutate files on disk, and rerun traversals to detect missing/new entries. Mirrors how consumers should detect drift mid-transfer.
  6. `ground_truth_transient_mutations.html` – stores a transient selection, snapshots file metadata, and compares it after external mutations so you understand how stale transient `File` objects become.
- **Legacy manual pages** – `file_storage_ground_truth.html` (deprecated full walkthrough) and `file_storage_smoke.html` (button-driven smoke) still exist for historical debugging. Only open them when you need their specific logging; they are not part of the official verification flow.
