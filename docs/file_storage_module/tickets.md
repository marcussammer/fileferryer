# File Storage Module Tickets

Work the tickets from top to bottom unless otherwise noted. Update the checklist when a ticket is completed or blocked.

## Active Tickets

1. [x] **Module foundation + registry + test harness**
   - Scaffold the browser module under `public/js/` with clear exports and zero DOM dependencies; wire a barebones registry/ID generator that no-ops for now.
   - Install and configure `vitest`, `happy-dom`, and `fake-indexeddb/auto`; add `npm test`, `npm run test:watch`, and ensure tests live under `tests/file_storage_module/` with a shared setup that registers the shims.
   - Create initial unit specs for the registry utilities (key generation, lazy DB init) so the harness is proven from day one.
   - Add `@web/test-runner/chrome` (or the CLI equivalent) plus `public/tests/file_storage_module/file_storage_smoke.html` that simply loads the module and reports “module loaded” to establish the smoke channel; expose it as `npm run test:smoke`.
   - Acceptance: `npm test` passes on a clean clone, the smoke page runs via `npm run test:smoke` without runtime errors, and the module initializes the IndexedDB scaffolding lazily.
   - Completed: `public/js/fileStorageModule.mjs` exports the registry + lazy IDB bootstrap, Vitest + happy-dom + fake-indexeddb are wired with a dedicated setup and registry specs, and `public/tests/file_storage_module/file_storage_smoke.html` exercises the module through `npm run test:smoke` (note: the CLI cannot bind to ports inside this sandbox, so run locally to verify the smoke page).

2. [x] **Native handle backend**
   - Implement native persistence: store/re-hydrate `FileSystemFileHandle` / `FileSystemDirectoryHandle` arrays in IndexedDB via structured clone, including metadata for counts and timestamps.
   - Provide `requestPermissions(key)` plumbing that callers can trigger inside a user gesture; return structured `{ ok, state }` responses for granted/denied/unknown outcomes.
   - Expand the Vitest suite with handle stubs that exercise permission success/failure, missing handles, and rehydration flows.
   - Update the smoke page + `npm run test:smoke` script to walk through a real Chromium add/list/remove cycle (manual button clicks are fine if permissions can’t be automated); log pass/fail to aid debugging.
   - Acceptance: All related Vitest suites pass headlessly, smoke page proves native handles persist through reload, and permission failures surface predictably.
   - Completed: `createNativeHandleBackend` stores native selections (counts + timestamps), exposes `requestPermissions`, has dedicated Vitest coverage with handle stubs, and the smoke test/page now picks directories, lists keys, requests permissions, and removes selections end-to-end.

3. [x] **Transient session backend**
   - Implement the in-memory map for legacy inputs (Files, `webkitEntry`, etc.) with `beforeunload` cleanup and expiration messaging.
   - Add Vitest coverage that injects fake `File` / entry objects to prove transient keys resolve, expire after unload, and never leak to IndexedDB.
   - Extend the smoke page with a “transient mode” demo that warns users to keep the tab open and confirms keys vanish after refresh (manual verification notes are acceptable in the page copy).
   - Acceptance: `npm test` covers both success and expiration paths for transient storage, and the smoke walkthrough confirms transient keys disappear after a page reload.
   - Completed: In-memory transient backend added with beforeunload cleanup, unit coverage, and a smoke-page demo that warns users about keeping the tab open.

4. [x] **Testing hardening + migration coverage**
   - Reproduce the missing object-store scenario by initializing the registry first, reopening the DB, and validating that `createNativeHandleBackend` either adds the store or bumps the version appropriately.
   - Add Vitest specs that simulate pre-existing IndexedDB versions, shared DB usage (registry + backend), structured clone persistence across reopen, and metadata integrity (counts, timestamps, storageType).
   - Expand the automated smoke test so it initializes twice, captures console logs, and asserts that stored keys survive a reload with non-zero counts.
   - Acceptance: `npm test` includes regression coverage for DB migrations and structured-clone rehydration, and the smoke test fails fast when object stores or counts drift.
   - Completed: default IndexedDB opener now retries with version bumps when stores are missing, migration + rehydration Vitest suites cover legacy databases, and the smoke test double-initializes, captures console.log output, and verifies keys survive reloads with intact counts.

5. [x] **Ground-truth harness + testing realignment**
   - Baseline harness (`ground_truth_baseline.html`) resets the registry, runs native + transient flows against the bundled fixture, logs human-readable + structured summaries, and exposes Reset controls.
   - Refresh harness (`ground_truth_refresh.html`) lets you store a transient in-page, prove it exists pre-refresh, reload, and confirm native persistence vs. transient expiration.
   - Reopen harness (`ground_truth_reopen.html`) mirrors the refresh test but guides you through closing/reopening the browser before verifying the stored native key and confirming transient cleanup.
   - Multi-tab harness (`ground_truth_multitab.html`) surfaces browser/tab IDs, allows per-tab transient selection, and proves registry entries are shared while transient sessions remain tab-scoped; links to both mutation harnesses.
   - Native mutation harness (`ground_truth_mutations.html`) loads existing native keys and revalidates stored handles to flag missing files, new files, traversal errors, and updated metadata after on-disk edits.
   - Transient mutation harness (`ground_truth_transient_mutations.html`) stores a transient selection, captures baseline snapshots of the `File` objects, and captures post-mutation snapshots so you can see how transient snapshots behave when files change or disappear.
   - README/testing docs describe how to copy the fixture outside WSL, when to click “Reset Registry,” how to capture logs from each page, and reiterate that `npm run test:smoke` is only a sanity check.

6. [x] **Public API surface**
   - Wire `add`, `listKeys`, `getStorageType`, `exists`, `getFileCount`, `remove`, and `requestPermissions` through the container with capability detection that selects the correct backend automatically.
   - Ensure `getFileCount` performs fresh traversals and reports `{ partial:true }` when entries disappear; unify error codes so callers can branch on `reason`.
   - Build contract-level Vitest suites that exercise the public API against native stubs, transient stubs, and mixed inputs; include edge cases (missing key, permissions denied mid-call, transient expired).
   - Update the ground-truth harness to call each public method where meaningful so regressions are visible without digging through internals.
   - Acceptance: All public API methods have deterministic unit coverage, and the harness demonstrates the happy-path flows for both backends without console errors.
   - Completed: Public API routing now auto-selects native vs transient with structured errors + partial counts, Vitest contract suites cover native/transient/mixed flows, and each harness (baseline, refresh, reopen, multi-tab, smoke, etc.) exercises the new methods end-to-end.

7. [x] **Consumer guidance + docs**
   - Document how future `public/*.html` files import the module, outlining Safari warnings, Chromium prompts, and how/when to call `requestPermissions`.
   - Capture the revised testing workflow (Vitest, each interactive harness page, and the minimal `npm run test:smoke`) so future contributors inherit the methodology step by step.
   - Provide example flows for starting a transfer, detecting drift (native mutation harness), transient expiration, and multi-tab coordination, referencing the specific harness pages where useful.
   - Acceptance: README/overview/tickets stay in sync with the implemented APIs, the new transient mutation harness is documented alongside the native one, and the docs clearly instruct contributors how to run and interpret every test page.
   - Completed: README now includes consumer-integration guidance plus an expanded testing checklist, and `overview.md` captures the finalized API, storage modes, and example flows (transfer kickoff, drift detection, transient expiration, and multi-tab coordination) with direct harness references; tickets updated to reflect the finished docs.

## Next Steps

- **High-volume read/stream support**
  - Design chunked read APIs that can handle directories with hundreds of thousands of files and individual files exceeding 100 GB without exhausting memory.
  - Prototype both native-handle and transient flows to understand how browsers behave when underlying files are deleted/modified after selection (including whether transient snapshots can scale to that many entries).
  - Document what errors surface when attempting to read large/deleted files in transient mode and whether we need resumable re-selection flows for native handles.
