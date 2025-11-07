// getBrowserTabID.js
// ES module exporting a single function: getBrowserTabID()

export async function getBrowserTabID(options = {}) {
  const {
    // how long to wait/listen for a duplicate "HELLO" after announce
    collisionWindowMs = 120,
    // channel names (change if you embed multiple apps on same origin)
    channelName = "tab-id-v1",
    lsBusKey = "tab-id-v1:bus",
    // storage keys
    browserKey = "ft.browserId",
    tabKey = "ft.tabId",
  } = options;

  const rng = () => (crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

  // --- helpers: storage with fallbacks ---
  const storage = {
    getLocal(k) { try { return localStorage.getItem(k); } catch { return null; } },
    setLocal(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    getSession(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    setSession(k, v) { try { sessionStorage.setItem(k, v); return true; } catch { return false; } },
  };

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, value, days = 3650) { // ~10 years
    try {
      const d = new Date(); d.setTime(d.getTime() + days*24*60*60*1000);
      document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
      return true;
    } catch { return false; }
  }

  // --- browserId: shared across tabs (best-effort persistence) ---
  let browserId = storage.getLocal(browserKey) || getCookie(browserKey);
  if (!browserId) {
    browserId = rng();
    // try LS, else cookie
    if (!storage.setLocal(browserKey, browserId)) {
      setCookie(browserKey, browserId);
    }
  }

  // --- tabId: per-tab, stable across reloads of this tab ---
  let tabId = storage.getSession(tabKey);
  if (!tabId) {
    // window.name fallback (per-tab) helps if sessionStorage is blocked
    if (window.name) {
      tabId = window.name;
    } else {
      tabId = rng();
      // set both; window.name aids weird sessionStorage cloning cases
      storage.setSession(tabKey, tabId);
      try { if (!window.name) window.name = tabId; } catch {}
    }
  }

  // --- duplicate-tab collision handling ---
  // Some browsers clone sessionStorage on "Duplicate tab". We resolve by
  // announcing our tabId; if we hear the same tabId from someone else,
  // we deterministically pick a winner and the loser regenerates.

  const nonce = rng(); // per-tab temporary nonce for this run
  const HELLO = "HELLO";
  const RENAMED = "RENAMED";

  let bc = null;
  try { bc = new BroadcastChannel(channelName); } catch { /* unsupported or blocked */ }

  const listeners = [];
  const on = (fn) => listeners.push(fn);
  const emit = (msg) => listeners.forEach(fn => fn(msg));

  // Fallback announce bus via localStorage "storage" event
  function postLS(msg) {
    try {
      // bump a counter to force a storage event even if value string matches
      const payload = JSON.stringify({ msg, t: Date.now(), r: Math.random() });
      localStorage.setItem(lsBusKey, payload);
    } catch { /* ignore */ }
  }
  function startLSBus() {
    const handler = (ev) => {
      if (ev.key !== lsBusKey || !ev.newValue) return;
      try {
        const { msg } = JSON.parse(ev.newValue);
        if (msg) emit(msg);
      } catch {/* ignore */}
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }

  // Wire up whichever bus we have
  let stopLS = null;
  if (bc) {
    bc.onmessage = (e) => emit(e.data);
  } else {
    stopLS = startLSBus();
  }
  const post = (msg) => bc ? bc.postMessage(msg) : postLS(msg);

  // Announce and listen briefly for collisions
  const announce = () => post({ type: HELLO, tabId, nonce });
  announce();

  // If we hear our same tabId with different nonce, decide a winner.
  // Use lexical compare of (tabId + ":" + nonce) so decision is deterministic.
  const meKey = `${tabId}:${nonce}`;
  let changed = false;

  const onMsg = (m) => {
    if (!m || !m.type) return;

    if (m.type === HELLO && m.tabId === tabId && m.nonce !== nonce) {
      // Collision detected: determine winner
      const otherKey = `${m.tabId}:${m.nonce}`;
      const iWin = meKey > otherKey; // deterministic tie-break
      if (!iWin && !changed) {
        changed = true;
        // regenerate a new tabId and re-announce
        tabId = rng();
        storage.setSession(tabKey, tabId);
        try { window.name = tabId; } catch {}
        post({ type: RENAMED, tabId, nonce });
      }
    }
    // If someone else says they RENAMED (after losing), no action needed.
  };
  on(onMsg);

  // Wait a short window to reduce race risk, then stop listening (optional)
  await new Promise((resolve) => setTimeout(resolve, collisionWindowMs));

  // Cleanup fallback listener (BroadcastChannel can keep running; it’s cheap)
  if (stopLS) stopLS();

  return { browserId, tabId };
}
