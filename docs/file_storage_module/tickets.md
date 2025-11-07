# File Storage Module Tickets

Work the tickets from top to bottom unless otherwise noted. Update the checklist when a ticket is completed or blocked.

## Active Tickets

1. [x] **Module foundation + registry + test harness**
   - Scaffold the browser module under `public/js/` with clear exports and zero DOM dependencies; wire a barebones registry/ID generator that no-ops for now.
   - Install and configure `vitest`, `happy-dom`, and `fake-indexeddb/auto`; add `npm test`, `npm run test:watch`, and ensure tests live under `tests/file_storage_module/` with a shared setup that registers the shims.
   - Create initial unit specs for the registry utilities (key generation, lazy DB init) so the harness is proven from day one.
   - Add `@web/test-runner/chrome` (or the CLI equivalent) plus `public/tests/file_storage_smoke.html` that simply loads the module and reports “module loaded” to establish the smoke channel; expose it as `npm run test:smoke`.
   - Acceptance: `npm test` passes on a clean clone, the smoke page runs via `npm run test:smoke` without runtime errors, and the module initializes the IndexedDB scaffolding lazily.
   - Completed: `public/js/fileStorageModule.mjs` exports the registry + lazy IDB bootstrap, Vitest + happy-dom + fake-indexeddb are wired with a dedicated setup and registry specs, and `public/tests/file_storage_smoke.html` exercises the module through `npm run test:smoke` (note: the CLI cannot bind to ports inside this sandbox, so run locally to verify the smoke page).

2. [x] **Native handle backend**
   - Implement native persistence: store/re-hydrate `FileSystemFileHandle` / `FileSystemDirectoryHandle` arrays in IndexedDB via structured clone, including metadata for counts and timestamps.
   - Provide `requestPermissions(key)` plumbing that callers can trigger inside a user gesture; return structured `{ ok, state }` responses for granted/denied/unknown outcomes.
   - Expand the Vitest suite with handle stubs that exercise permission success/failure, missing handles, and rehydration flows.
   - Update the smoke page + `npm run test:smoke` script to walk through a real Chromium add/list/remove cycle (manual button clicks are fine if permissions can’t be automated); log pass/fail to aid debugging.
   - Acceptance: All related Vitest suites pass headlessly, smoke page proves native handles persist through reload, and permission failures surface predictably.
   - Completed: `createNativeHandleBackend` stores native selections (counts + timestamps), exposes `requestPermissions`, has dedicated Vitest coverage with handle stubs, and the smoke test/page now picks directories, lists keys, requests permissions, and removes selections end-to-end.

3. [ ] **Transient session backend**
   - Implement the in-memory map for legacy inputs (Files, `webkitEntry`, etc.) with `beforeunload` cleanup and expiration messaging.
   - Add Vitest coverage that injects fake `File` / entry objects to prove transient keys resolve, expire after unload, and never leak to IndexedDB.
   - Extend the smoke page with a “transient mode” demo that warns users to keep the tab open and confirms keys vanish after refresh (manual verification notes are acceptable in the page copy).
   - Acceptance: `npm test` covers both success and expiration paths for transient storage, and the smoke walkthrough confirms transient keys disappear after a page reload.

4. [ ] **Public API surface**
   - Wire `add`, `listKeys`, `getStorageType`, `exists`, `getFileCount`, `remove`, and `requestPermissions` through the container with capability detection that selects the correct backend automatically.
   - Ensure `getFileCount` performs fresh traversals and reports `{ partial:true }` when entries disappear; unify error codes so callers can branch on `reason`.
   - Build contract-level Vitest suites that exercise the public API against native stubs, transient stubs, and mixed inputs; include edge cases (missing key, permissions denied mid-call, transient expired).
   - Update the smoke page buttons to call each public method in both storage modes and print structured responses so regressions are easy to spot manually.
   - Acceptance: All public API methods have deterministic unit coverage, and the smoke page demonstrates the happy-path flows for both backends without console errors.

5. [ ] **Consumer guidance + docs**
   - Document how future `public/*.html` files import the module, outlining Safari warnings, Chromium prompts, and how/when to call `requestPermissions`.
   - Capture the testing workflow (when to run `npm test`, when to run `npm run test:smoke`, how to interpret smoke-page logs) so future contributors inherit the methodology.
   - Provide example flows for starting a transfer, handling re-permission requests, and falling back to transient sessions, referencing the relevant smoke-page controls where useful.
   - Acceptance: README/overview/tickets stay in sync with the implemented APIs, and the docs explicitly describe the automated tests and manual smoke expectations.

## Backlog / Nice-to-haves

- [ ] Async enumeration helpers (`enumerate`, `openFile`, `createReadableStream`).
- [ ] BroadcastChannel coordination for multi-tab safety.
- [ ] “Heal” flow that lets users rebind missing handles by re-selecting folders when drift is detected.
