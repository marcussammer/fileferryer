# Browser ID Module Overview

## Summary

The Browser ID module issues two opaque identifiers entirely on the client:

1. **Browser ID (`browserId`)** – A long-lived token shared across every tab on the same origin. It prefers `localStorage`, falls back to cookies when persistence APIs are blocked, and survives reloads or duplicate tabs.
2. **Tab ID (`tabId`)** – A per-tab token stored in `sessionStorage` with a `window.name` fallback so that a single tab can keep its identity across reloads but never leaks to other tabs unless the browser clones session state.

Consumers (e.g., the file storage module and WebRTC coordination layer) use these IDs to label transient file selections, deduplicate peer connections, and explain to users which tab currently “owns” a transfer. The module is browser-only, has zero DOM dependencies, and can be instantiated multiple times via `createBrowserIdModule(options)` for testing or embedded environments.

## Use cases

- **Tab-scoped file handles** – Safari/Firefox only expose handles in the original tab. Tagging transient selections with `tabId` lets the UI warn users when they try to resume a transfer from the wrong tab.
- **WebRTC peer bookkeeping** – Long-lived peer connections are tab-specific even when handles are shared. Using `{ browserId, tabId }` lets the signaling layer detect stale or duplicate peers before renegotiation.
- **Operator visibility** – Manual ground-truth harnesses display both IDs so testers can prove whether duplicate tabs reconcile correctly on each browser.

## Identity lifecycle

1. On first call, the module tries `localStorage.getItem(browserKey)` and falls back to a cookie (`SameSite=Lax`, 10-year expiration). Failure to write either still returns a deterministic ID, but persistence is best-effort.
2. For `tabId`, the module reads `sessionStorage` and mirrors the value into `window.name`. When neither is available, it generates a random string via `crypto.randomUUID()` (where available) or a timestamp/random fallback.
3. Duplicate-tab handling:
   - Each tab announces `{ type:'HELLO', tabId, nonce }` via BroadcastChannel when available, or a `localStorage` bus when BroadcastChannel fails.
   - During a short collision window (default 120 ms), every tab listens for HELLO messages matching its `tabId`. If the payload has the same `tabId` but a different `nonce`, the loser deterministically regenerates its `tabId` and broadcasts `{ type:'RENAMED', tabId, nonce }`.
   - Determinism comes from lexicographically comparing `tabId:nonce` pairs so duplicated tabs settle without randomness.

## Public API

All exports live in `public/js/browserIdModule.mjs`.

| Method | Description |
| --- | --- |
| `await browserIdModule.getTabIdentity(options?)` | Resolves `{ browserId, tabId, didRegenerateTabId }`. Pass `fresh:true` to bypass the memoized value, `collisionWindowMs` to control the listening window, or inject custom storage/bus implementations for tests. |
| `await browserIdModule.getBrowserId(options?)` | Convenience wrapper that returns `browserId` only. |
| `await browserIdModule.getTabId(options?)` | Convenience wrapper that returns `tabId` only. |
| `await browserIdModule.refreshTabId(options?)` | Forces a new tab ID (ignores session/window state) and returns the updated identity object. Useful when a user wants to reset a transient selection without closing the tab. |
| `browserIdModule.resetCache()` | Clears the memoized identity so the next `getTabIdentity()` performs a fresh handshake. Does not delete persisted storage keys. |
| `browserIdModule.describe()` | Returns the current config (`channelName`, storage keys, collision window) so other modules can log or document the wiring. |
| `createBrowserIdModule(options?)` | Factory for advanced scenarios (custom storage adapters, fake timers, mocked BroadcastChannels, etc.). The default export is an instance created with default options. |

### Configuration hooks

- `channelName`, `lsBusKey`, `browserKey`, `tabKey` let embedded apps avoid collisions when multiple widgets run on the same origin.
- `storage` accepts a `{ getLocal, setLocal, getSession, setSession }` adapter for headless tests or custom persistence layers.
- `broadcastChannelFactory`, `windowRef`, `documentRef`, `rng`, and `wait` can all be injected to reproduce timing edge cases or satisfy sandbox constraints.

## Testing strategy

| Surface | Location | Purpose |
| --- | --- | --- |
| **Vitest unit suite** | `tests/browser_id_module/browserIdModule.test.js` | Covers caching, explicit refresh, duplicate-tab settlement, cookie fallback, and metadata exposure. Runs under `happy-dom` via `npm test`. |
| **Smoke automation** | `public/tests/browser_id_module/browser_id_smoke.test.js` | Headless Chrome import that ensures the module loads, resolves IDs, and emits no console errors (`npm run test:smoke`). |
| **Manual baseline harness** | `public/tests/browser_id_module/tab_identity_baseline.html` | Single-tab workflow to verify persistence, manual refresh, and reset behavior. Keeps lightweight logs for bug reports. |
| **Manual multi-tab harness** | `public/tests/browser_id_module/tab_identity_multitab.html` | Duplicate-tab repro. Displays current IDs, logs whether a collision was resolved, and links back to the file storage multitab harness. |
| **File storage multitab page** | `public/tests/file_storage_module/ground_truth_multitab.html` | Uses the module in its real context so you can see IDs alongside persistent/transient selections. |

Run `npm test` on every change. `npm run test:smoke` requires a Chromium binary and an available port; when it fails inside CI/WSL (permission errors), run it manually on a host machine before shipping. Manual harness pages should be opened in the browser you care about (Chrome, Edge, Firefox) to observe storage/fallback behavior.

## Integration guidance

- Import via `<script type="module">` using `public/js/browserIdModule.mjs`, then call `await browserIdModule.getTabIdentity()` during startup to label the session immediately.
- Attach `{ browserId, tabId }` to every transient selection record and WebRTC offer. When a user resumes an upload in a different tab, compare IDs and prompt them to switch back.
- When an operator duplicates a tab mid-transfer, expect one tab’s `didRegenerateTabId` flag to flip `true` after the probe window. Use that signal to show “This duplicate tab is read-only” messaging or disable potentially destructive actions.
- If `browserIdModule.refreshTabId()` is triggered intentionally (e.g., “reset this tab”), immediately invalidate transient selections tied to the old tab ID so state doesn’t drift.

## Non-goals / future work

- **Cross-device reconciliation** – The module does not attempt to sync IDs between devices or browser profiles. Use signaling-layer tokens for that scope.
- **Persistence guarantees** – When every storage surface is blocked, IDs stay in-memory only. Future work could integrate IndexedDB or Service Worker storage if browsers relax structured-clone restrictions for `FileSystemHandle`.
- **Long-lived monitoring** – The module intentionally stops listening after the collision window. Apps needing continuous monitoring should wrap the factory and keep their own BroadcastChannel subscriptions alive.
