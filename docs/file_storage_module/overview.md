# Browser File Storage Module

## Summary

This module keeps track of file/directory selections in the browser without copying bytes. It exposes a small API that:
- Accepts any picker output (File System Access handles, dragged `File` objects, or `webkitEntry` trees).
- Persists Chromium selections as real `FileSystemHandle` objects in IndexedDB so they survive reloads, tab closes, and browser restarts.
- Falls back to an in-memory “transient session” for browsers that cannot persist handles and makes it explicit that those keys vanish when the tab goes away.
- Always returns an opaque key plus metadata so the caller can resume long transfers days later without reselecting files (assuming Chromium).

There is no snapshot backend, no DOM coupling, and no hidden copies of user data—only handles.

## Use case

The module was built for week-long WebRTC transfers of hundreds of gigabytes (e.g., uploading 100k photos or 100GB videos from a parent’s computer). Reliability beats absolute speed: Chromium users need durable handles that survive disconnects, while Safari/Firefox users need at least a transient attempt so they can send a single huge file if they keep the tab open. Migrations and multi-version schemas add risk for this scope, so the design deliberately keeps a single IndexedDB schema and favors determinism over bells and whistles.

## Storage modes

### Native-handle persistence (Chromium)
- Triggered when every selected item is a `FileSystemFileHandle` or `FileSystemDirectoryHandle`.
- Selections are normalized, deduped with `isSameEntry`, decorated with counts/timestamps, and stored under `nativeHandles` in IndexedDB via structured clone.
- `getFileCount` performs a fresh traversal every time; missing entries mark the result as `{ partial:true, reason:'entries-missing' }`.
- `requestPermissions(key)` must be called inside a user gesture whenever the browser loses `granted` status. The consumer is responsible for surfacing that CTA.

### Transient-session fallback (Safari/Firefox/legacy)
- Triggered when any selection entry is not a File System Access handle (dragged `File`, `webkitEntry`, etc.).
- The module records the selection only in memory. A registry tombstone notes `{ storageType:'transient-session', status:'expired' }` once the tab unloads so later lookups explain the disappearance.
- `getFileCount` and `exists` only work while the page is alive; once expired, they resolve to `{ ok:false, reason:'transient-expired' }`.
- Callers must warn users to keep the tab open. Every harness page includes copy you can reuse.

## Public API

- `await fileStorageModule.init()` — lazily opens the registry (`registry` store) and native handle store (`nativeHandles`). Safe to call multiple times.
- `await fileStorageModule.add(selection, metadata?)` — accepts anything array-like (single handle, array of handles/files, `DataTransferItemList`, etc.). Returns `{ ok, key, storageType }`. Throws no synchronous errors; failures surface as `{ ok:false, reason:'storage-failure' }`.
- `await fileStorageModule.listKeys({ includeTransient = true } = {})` — returns merged registry keys plus live transient keys. Pass `includeTransient:false` for pure IndexedDB state (useful when rendering on load).
- `await fileStorageModule.getStorageType(key)` — resolves `{ ok:true, storageType }` when known or `{ ok:false, reason }` when the key is missing/expired.
- `await fileStorageModule.exists(key, { verifyPermissions = false } = {})` — for native keys, optionally call `queryPermission` to ensure `granted` before returning `{ exists:true }`. For transient keys, only reports true while this tab stores the session.
- `await fileStorageModule.getFileCount(key)` — native mode recounts handles and may propagate traversal errors (`reason:'traversal-error'`). Transient mode summarizes the in-memory tree and returns the scheduled expiration timestamp so UIs can display countdowns.
- `await fileStorageModule.remove(key)` — deletes both registry + backend data. Removing an already-expired transient key succeeds with `{ ok:true, reason:'transient-expired' }` so cleanup flows stay idempotent.
- `await fileStorageModule.requestPermissions(key, options?)` — chromium-only helper that wraps each stored handle’s `requestPermission`. Returns `{ ok:true, state:'granted'|'denied'|'prompt' }` so the host app can branch on UI copy.

## Registry & backend internals

- IndexedDB stores live under the `file-storage-module` database with two object stores:
  - `registry` (`keyPath:'key'`) — master list of selections and metadata (`storageType`, counts, created/updated timestamps, transient status).
  - `nativeHandles` (`keyPath:'key'`) — structured-cloned arrays of native handles plus cached counts.
- The module auto-creates missing stores and bumps versions when necessary. Each connection installs a `versionchange` handler that closes stale databases so upgrades are smooth.
- Transient sessions never touch IndexedDB until they expire. On `beforeunload`, the backend removes in-memory entries, sets a tombstone in `registry`, and keeps a small cache so follow-up calls can report `transient-expired`.

## Permissions, expiration, and multi-tab behavior

- Native handles survive across tabs and windows because the data lives in IndexedDB. Permission state is per-handle, so every resumed session must call `exists({ verifyPermissions:true })` or `requestPermissions` before assuming access.
- Transient sessions are tab-local. `listKeys()` merges registry keys with the current tab’s live session map so the UI can display “(transient, tab-local)” labels without another API call.
- Expiration metadata (`{ createdAt, updatedAt, expires }`) is available through `transientSessions.getStatus` (wired into `exists`, `getFileCount`, and `remove`) so you can display countdown timers or reconciliation messages.

## Example flows & harness pairings

1. **Transfer kickoff (Chromium)** — Follow `ground_truth_baseline.html`: reset the registry, run `add`, list keys, recount via `getFileCount`, and verify the console summary. This mirrors the production UI path when a user selects one or more directories on Chrome/Edge.
2. **Detecting drift / verifying mutations** — `ground_truth_mutations.html` loads a stored key, reruns `getFileCount`, and reports missing/new entries. Use the same flow in production before resuming a paused transfer so you can warn users about renamed or deleted files.
3. **Transient expiration messaging** — `ground_truth_refresh.html`, `ground_truth_reopen.html`, and `ground_truth_transient_mutations.html` show the entire lifecycle: add a transient selection, observe the warning, refresh/close to confirm it vanishes, and inspect how stale `File` snapshots behave after external edits. Copy that copy into your Safari/Firefox UI.
4. **Multi-tab coordination** — `ground_truth_multitab.html` surfaces tab IDs, shows that native keys synchronize instantly across tabs, and proves transient keys stay local. Use this to validate BroadcastChannel or storage-event messaging in the host app.

## Testing approach

- `npm test` / `npm run test:watch` — Vitest + `happy-dom` + `fake-indexeddb/auto`. Suites cover registry lifecycle, DB migrations, backend routing, permission plumbing, transient expiration, and contract-level API behavior.
- `npm run test:smoke` — Web Test Runner + headless Chrome exercising `public/tests/file_storage_module/file_storage_smoke.test.js`. Confirms the production bundle loads and touches IndexedDB without console errors.
- Manual harness pages in `public/tests/file_storage_module/` — baseline, refresh, reopen, multitab, mutations, and transient mutations. Copy `fixtures/ground-truth` somewhere Chrome can access (outside WSL sandboxes) before running them so counts match the deterministic manifest. Legacy pages (`file_storage_ground_truth.html`, `file_storage_smoke.html`) remain for ad-hoc debugging only.
- See `docs/file_storage_module/README.md` for the full checklist and instructions on when to run each surface.

## Deliberate exclusions

- No snapshot or byte-copy backend (would explode storage quotas with 100GB+ files).
- No automatic permission prompts — callers must drive `requestPermissions` from explicit user gestures.
- No long-term schema migrations — a single DB version with self-healing store creation keeps the footprint small and predictable.

## Operational notes for WebRTC transfers

- Handle traversal can take minutes on 100k-file directories. Use the provided `TraversalOptions` (AbortSignal + optional `onProgress`) when invoking `getFileCount` or future enumeration helpers so the UI can stay responsive.
- Treat `getFileCount` results as a health check before resuming a transfer. Partial results mean you should prompt the user to reselect or repair the selection.
- If you later add read/stream APIs, rely on `FileSystemFileHandle.getFile()` and `File.stream()` so you can send data in predictable chunks without buffering entire files in memory.
