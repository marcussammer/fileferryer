# Browser ID Module Tickets

Work tickets from top to bottom unless a task explicitly depends on another. Update the checklist whenever an item ships, stalls, or needs follow-up.

## Active Tickets

1. [x] **Module foundation + caching**
   - Promote the legacy `getBrowserTabID` helper into `public/js/browserIdModule.mjs` with a factory, memoization, and dependency injection points for storage, timers, and messaging.
   - Keep a backward-compatible shim (`public/js/getBrowserTabID.js`) so existing harnesses keep working while consumers migrate.
   - Acceptance: `browserIdModule.getTabIdentity()` returns deterministic IDs, exposes `refreshTabId`, and default options match the File Storage module’s expectations.

2. [x] **Collision handling + automated tests**
   - Model duplicate-tab resolution via BroadcastChannel + `localStorage` fallback, ensuring deterministic tie-breaks using `(tabId:nonce)` ordering.
   - Add Vitest coverage for caching, refresh flows, cookie fallback, and duplicate-tab settlement using mocked storage/broadcast adapters.
   - Update `vitest.config.mjs` to include the new suite and shared setup so `npm test` exercises both modules.

3. [x] **Smoke + manual harnesses**
   - Create `public/tests/browser_id_module/browser_id_smoke.test.js` for automated sanity checks under Web Test Runner.
   - Add `tab_identity_baseline.html` (single-tab workflow) and `tab_identity_multitab.html` (duplicate-tab repro) with logging and operator instructions.
   - Wire `ground_truth_multitab.html` to import the new module so the File Storage harness displays the canonical IDs.

## Next Steps

- [ ] **Telemetry hooks**
  - Expose optional callbacks (e.g., `onCollisionResolved`) so the host app can emit telemetry whenever duplicate tabs are detected or a forced refresh occurs.
  - Document privacy considerations—IDs should remain opaque, but signal metadata (timestamps, reasons) can help support incidents.

- [ ] **Service Worker awareness**
  - Investigate whether extending the module to a Service Worker context can reduce race windows for cross-tab messaging, or at least centralize ID allocation.
  - Prototype a worker-backed bus that stays alive longer than individual tabs for browsers that throttle background tabs aggressively.

- [ ] **Diagnostics UI**
  - Add a lightweight component (badge/toast) that surfaces the current tab state (“original tab” vs. “duplicate tab”) so end users immediately know whether they can interact with transient selections.
  - Reuse the manual harness styles so engineers can embed the badge in other operator tools without extra CSS.
