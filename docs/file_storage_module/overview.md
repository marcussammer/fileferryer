# Browser File Storage Module

## Summary

A small, reusable storage module that:
- Accepts “file handles” produced by any picker/drag-drop method.
- Persists them as robustly as the platform allows:
- Chromium → persist real FileSystemFileHandle/FileSystemDirectoryHandle.
- Non-Chromium → fall back to the “most robust” alternative (discussed below).
- Returns a key on success for future access.
- Exposes a tiny API:
- add(handles) → { ok, key, storageType }
- listKeys() → string[]
- getStorageType(key) → "native-handle" | "snapshot" | "transient" | ...
- exists(key) → boolean
- getFileCount(key) → number
- remove(key) → boolean
- The design goal is simple, robust, reusable, with room to add read/enumerate APIs later.

## Use case

For my application I am assuming large files (e.g. 100GB video files) and large directories (e.g. potentially over a hundred thousand photos), so the snapshot fallback won't work. Also, for my application, this is not intended for long-term storage, so the versioning and migrations are unnecessary. I guess I should just mention this is for a webrtc file transfer application, originally motivated by the need to transfer all the photos and videos from my mother's computer to my own after she passed away. So I need persistence over a day or two with possible browser closings etc. Slow connections may even require up to a week to transfer and there may be disconnects and reconnects, etc. Having a robust handle on the files is important because it's not like they are just selecting a few files and uploading all in a couple minutes. But on the other hand, it's not an application trying to do long term file management - after a transfer is complete that's it. I understand chromium is best, but there may be some situations where the program will be used to say transfer a single very large video file from a computer that only has safari. Allowing the user to attempt this, while warning they need to keep the tab open and not refresh, I think there is a use case for the legacy fallback (though not the snapshot backup)

Got it—given your constraints (very large files, very large folders, no long-term archival, and Chromium-first with a **no-copy** policy), here’s how I’d shape the module.

## Core stance

* **No snapshot backend at all.** We never copy file data into storage. This avoids quota issues and respects 100GB+ files.
* Two modes only:

  1. **Native-handle (persistent)** — Chromium (Chrome/Edge) using `FileSystemFileHandle` / `FileSystemDirectoryHandle` saved in IndexedDB via structured clone. Survives reloads and closures; requires permission checks on return.
  2. **Transient-session (non-persistent)** — “legacy” inputs (Safari/Firefox) via `File` objects or `webkitEntry` trees. These cannot be rehydrated after a reload, so they live in memory **only**; if the tab closes or reloads, the key becomes invalid. The module should **explicitly warn** the host app to inform users (“keep this tab open”).

That’s it. Keep it simple and honest.

---

## API surface (conceptual)

* `add(handles, opts?) → { ok, key, storageType }`

  * **Decides backend automatically**: if *all* inputs are true FSA handles, store persistently (“native-handle”). Otherwise, register a **transient session** and return that key with `storageType="transient-session"`.
  * **No copies, no snapshots.**

* `listKeys() → string[]`

  * Keys visible in the **registry**. For transient keys, include them only while the page is alive.

* `getStorageType(key) → "native-handle" | "transient-session"`

* `exists(key, opts?) → boolean`

  * For native: defaults to a registry-only lookup for speed. Pass `opts?.verifyPermissions === true` to run `queryPermission` before returning; if the handle is missing or permission isn’t `granted`, the method returns `false`.
  * For transient: true only while this page context holds the in-memory entry; `verifyPermissions` is ignored because legacy objects don’t support it.

* `getFileCount(key, traversalOpts?) → { ok, count, partial? }`

  * **Fresh traversal** each time (no cheating).
  * For native: traverse handles; if some entries fail (renamed/missing), return `partial:true`.
  * For transient: traverse in-memory entries. If user navigates away → key invalid.
  * Accepts an optional `TraversalOptions` object (`{ signal?, onProgress?, maxDepth? }`) so callers can cancel work or surface progress in the UI.

* `remove(key) → { ok }`

  * Deletes registry entry (and in-memory map for transient).

* `requestPermissions(key) → { ok, state:"granted"|"denied" }`

  * The host must call this in a **user gesture** (e.g., button click) to re-grant Chromium permissions.

* (For later) non-breaking additions:

  * `enumerate(key, opts) → AsyncIterator<{ path, kind, size, lastModified }>`
  * `openFile(key, path) → File | Blob` (native returns `File` via `.getFile()`)
  * `createReadableStream(key, path) → ReadableStream` (best match for WebRTC chunking)

---

## Module boundaries & structure

### Container + strategies (kept minimal)

* **Container module** exposes the small API and owns:

  * The **registry** (IndexedDB) for keys + metadata.
  * **Capability detection** and backend routing.
  * Basic **error mapping** (`permission`, `unsupported`, `not-found`, `disconnected`, `internal`).
* **Backends**:

  * `NativeHandleBackend` (“native-handle”):

    * Stores arrays of `FileSystemHandle`s (files and/or directories) in IDB.
    * On access: permission checks (`queryPermission` → optional `requestPermission`).
    * Traversal via `directoryHandle.entries()` recursion.
    * De-dupe with `isSameEntry` when users add overlapping folders.
    * Failure semantics: if a handle no longer resolves, skip and mark `partial:true`.
  * `TransientSessionBackend` (“transient-session”):

    * Keeps the selection **only in memory** (e.g., a `Map<key, SessionSelection>`).
    * Writes a lightweight tombstone to IDB (`{ key, storageType:"transient-session", status:"expired" }`) when the page unloads so `listKeys()` can explain why a key disappeared and `exists` can return `false` with `reason:"transient-expired"`.
    * On page `beforeunload`, it removes the in-memory entry and records the tombstone.

**Why not separate packages per backend?**
You could, but for your scope (two strategies, no migrations), keeping them in one package keeps things **simpler, testable, and easier to version**. If you later add more storage modes, you can split.

---

## Behavior details aligned to your use case

### Large trees (100k+ photos) & performance

* Traversal can be expensive. Provide `TraversalOptions` (shared between `getFileCount` and future enumeration APIs):

  * `signal?: AbortSignal` to cancel scans (user navigated).
  * `onProgress?: (filesScanned) => void` to keep the UI responsive.
  * `maxDepth?: number` (usually unlimited for you).
* **Counting**: always perform a fresh recount. No caching layer exists, so `getFileCount` recomputes every time while still honoring any provided `TraversalOptions`.

### Huge files (100GB video)

* Your module won’t touch data bytes—only **handles**—so storage is negligible.
* When you add reading later, prefer **streaming** APIs and chunked reads (e.g., `File.stream()`), with **backpressure** surfaced to your WebRTC sender.

### Permissions & resilience (Chromium)

* First add: request permissions (the host should call `requestPermissions(key)` from a user gesture).
* On later visits: `getFileCount` should **only query**, not request. If `prompt`/`denied`, return a “needs permission” status so the UI can show a “Grant access” button.

### Drift (move/rename/delete)

* Expect it. Counts and enumeration should **gracefully skip** vanished entries and report `partial:true`.
* Consider an optional **“heal”** operation later (user repicks a folder to reconstitute the selection). This is tracked as a backlog item so you can decide post-MVP.

### Multi-directory selections

* The module accepts **arrays** of mixed handles and stores them as one selection under a single key.
* Internally, normalize to a flat set of roots (files or directories) and always de-duplicate via `isSameEntry` so repeated folder selections don’t inflate counts.

### Safari/Firefox (transient)

* You’re right: there’s real value in allowing a **single huge file** transfer as **transient** on Safari.
* The module should surface:

  * `storageType="transient-session"` on `add`.
  * `getFileCount` works **only** while the page is alive; after refresh/unload, `exists` returns `false` with `{ reason:"transient-expired" }` so the UI can warn the user.
  * A **clear warning** (the host app’s job): “Don’t close or refresh this tab.”

### No DOM dependency

* The module should be **UI-free**. No required HTML structure.
* Offer optional **callbacks** for progress; **never** touch the DOM or rely on it.

### Secure context & serving

* Native handles require **secure context**. Document that consumers should host over **https** or `localhost`. `file://` is unreliable.

---

## What the module deliberately does **not** do

* **No snapshot fallback** or background caching of file bytes. This avoids both storage quotas and privacy concerns.
* **No re-permission prompting automatically.** The caller **must** invoke `requestPermissions(key)` in response to a click/tap.
* **No long-term schema migrations/versioning** (you don’t need them for week-scale jobs). Keep a single IDB version with two simple stores: `registry` and `nativeHandles`.

---

## Operational extras for a WebRTC sender (you’ll add outside this module)

* **Resumable transfers:** store **transfer metadata** (not bytes) separately (e.g., what has been sent, per-file byte offset). That can live in IDB and is safe cross-browser.
* **Connection churn:** use `BroadcastChannel` or `storage` events if you need to coordinate multiple tabs (Chromium side), and **tab-uniqueness tokens** to avoid duplicate senders.
* **Backpressure:** wire your WebRTC DataChannel’s bufferedAmount to chunk pacing; chunk sizes for very large files often work best around 64–512 KB, but your network will dictate tuning.

---

## Edge cases to decide now

* **Mixed input (some native handles + some legacy):**

  * **Option A (simple):** if any non-native is present, register the entire set as **transient-session**.
  * **Option B (max strength):** split into **two keys**, one native and one transient, and return both.
    I’d pick **A** to keep the API single-key and predictable, unless you really want to micromanage.

* **External drives:** if the drive unmounts/remounts, native handles may fail until re-selected. The module should report this as `partial:true` or “missing handle”.

* **Counting policy:** your previous requirement was “recount on load.” Keep that as default; permit an opt-in `useCache:true` if you ever need faster UI.

---

## Bottom line

* Your **module boundary is right**: it **only** manages selections and their persistence level, with a **tiny API** and **no UI**.
* Implement **two backends** (native & transient), with a small container that chooses and routes.
* Offer clean, actionable error/permission states and **never** store bytes.
* This will be **simple, robust, and reusable** for your WebRTC flow—and honest about Safari/Firefox limits while still enabling their one-off, keep-the-tab-open use case.

## Testing approach

* **Node-based harness** — Use Vitest with `happy-dom` and `fake-indexeddb/auto` so every deterministic piece (registry utilities, backend routing, permission fallbacks) can be exercised quickly via `npm test`. Keep shared stubs for `FileSystemFileHandle` / `FileSystemDirectoryHandle` inside `tests/file_storage_module/` to simulate permission outcomes without relying on the browser.
* **Browser smoke** — `npm run test:smoke` drives Chromium through `@web/test-runner/chrome`, loading `public/tests/file_storage_smoke.test.js`. The spec imports the production module, initializes the registry, and exercises an IndexedDB write/read so we know Chromium can run the shipped bundle headlessly. Point `web-test-runner.config.js` at your Chrome/Chromium binary (executable path + `--no-sandbox` flags when needed).
  * The legacy `public/tests/file_storage_smoke.html` page still exists as a manual debug surface (buttons/logs) but is not part of the automated smoke command.
* **Workflow expectations** — Run `npm test` after each ticket-level change; run `npm run test:smoke` whenever native-handle persistence or permission handling changes, and before tagging builds intended for actual transfers.

If this plan looks good, I can sketch the exact TypeScript types and the IDB store layout next, then fill in implementations.
