const HELLO = 'HELLO';
const RENAMED = 'RENAMED';
const DEFAULT_COOKIE_DAYS = 3650; // ~10 years

const defaultWait = (ms = 0) =>
  new Promise((resolve) => {
    const scheduler = typeof setTimeout === 'function' ? setTimeout : null;
    if (!scheduler || ms <= 0) {
      resolve();
      return;
    }
    scheduler(resolve, ms);
  });

const defaultRng = () => {
  if (globalThis?.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2);
  return `${timestamp}-${random}`;
};

const defaultBroadcastChannelFactory = (name) => {
  if (typeof BroadcastChannel === 'function') {
    try {
      return new BroadcastChannel(name);
    } catch {
      return null;
    }
  }
  return null;
};

const createDefaultStorage = () => {
  const safeGet = (target, key, fallback = null) => {
    try {
      return target ? target[key] : fallback;
    } catch {
      return fallback;
    }
  };

  const getLocalStore = () =>
    safeGet(globalThis, 'localStorage', null);
  const getSessionStore = () =>
    safeGet(globalThis, 'sessionStorage', null);

  return {
    getLocal(key) {
      const store = getLocalStore();
      if (!store || typeof store.getItem !== 'function') {
        return null;
      }
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    setLocal(key, value) {
      const store = getLocalStore();
      if (!store || typeof store.setItem !== 'function') {
        return false;
      }
      try {
        store.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    removeLocal(key) {
      const store = getLocalStore();
      if (!store || typeof store.removeItem !== 'function') {
        return false;
      }
      try {
        store.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
    getSession(key) {
      const store = getSessionStore();
      if (!store || typeof store.getItem !== 'function') {
        return null;
      }
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    setSession(key, value) {
      const store = getSessionStore();
      if (!store || typeof store.setItem !== 'function') {
        return false;
      }
      try {
        store.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    removeSession(key) {
      const store = getSessionStore();
      if (!store || typeof store.removeItem !== 'function') {
        return false;
      }
      try {
        store.removeItem(key);
        return true;
      } catch {
        return false;
      }
    }
  };
};

const getDefaultWindow = () => {
  if (typeof window !== 'undefined') {
    return window;
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
    return globalThis;
  }
  return null;
};

const getDefaultDocument = () => {
  if (typeof document !== 'undefined') {
    return document;
  }
  return null;
};

const DEFAULT_OPTIONS = {
  collisionWindowMs: 120,
  channelName: 'tab-id-v1',
  lsBusKey: 'tab-id-v1:bus',
  browserKey: 'ft.browserId',
  tabKey: 'ft.tabId',
  cookieDays: DEFAULT_COOKIE_DAYS,
  rng: defaultRng,
  wait: defaultWait,
  broadcastChannelFactory: defaultBroadcastChannelFactory,
  windowRef: () => getDefaultWindow(),
  documentRef: () => getDefaultDocument()
};

const escapeCookieName = (name) =>
  name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');

const readCookie = (doc, name) => {
  if (!doc || typeof doc.cookie !== 'string' || !name) {
    return null;
  }
  const matcher = new RegExp(`(?:^|; )${escapeCookieName(name)}=([^;]*)`);
  const match = doc.cookie.match(matcher);
  return match ? decodeURIComponent(match[1]) : null;
};

const writeCookie = (doc, name, value, days = DEFAULT_COOKIE_DAYS) => {
  if (!doc || typeof doc.cookie === 'undefined') {
    return false;
  }
  try {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    doc.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
    return true;
  } catch {
    return false;
  }
};

const persistTabId = ({ storage, windowRef, tabKey, tabId }) => {
  if (storage?.setSession) {
    storage.setSession(tabKey, tabId);
  }
  if (windowRef && typeof windowRef === 'object') {
    try {
      windowRef.name = tabId;
    } catch {
      // Ignore window.name assignment failures.
    }
  }
};

const readWindowName = (windowRef) => {
  if (!windowRef || typeof windowRef !== 'object') {
    return null;
  }
  try {
    if (typeof windowRef.name === 'string' && windowRef.name.length > 0) {
      return windowRef.name;
    }
  } catch {
    return null;
  }
  return null;
};

const createMessagingChannel = ({
  channelName,
  lsBusKey,
  storage,
  windowRef,
  broadcastChannelFactory
}) => {
  const listeners = new Set();
  const pending = [];
  const MAX_PENDING = 8;
  let channel = null;
  let channelCleanup = null;
  let storageCleanup = null;

  const dispatch = (payload) => {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Ignore listener failures so other observers still fire.
      }
    }
  };

  const flushPending = () => {
    if (!pending.length || !listeners.size) {
      return;
    }
    const drained = pending.splice(0);
    for (const payload of drained) {
      dispatch(payload);
    }
  };

  const emit = (payload) => {
    if (!listeners.size) {
      if (pending.length >= MAX_PENDING) {
        pending.shift();
      }
      pending.push(payload);
      return;
    }
    dispatch(payload);
  };

  if (typeof broadcastChannelFactory === 'function') {
    try {
      channel = broadcastChannelFactory(channelName) ?? null;
    } catch {
      channel = null;
    }
  }

  if (channel) {
    const handler = (event) => emit(event?.data);
    if (typeof channel.addEventListener === 'function') {
      channel.addEventListener('message', handler);
      channelCleanup = () => channel.removeEventListener('message', handler);
    } else {
      channel.onmessage = handler;
      channelCleanup = () => {
        channel.onmessage = null;
      };
    }
  } else if (windowRef && typeof windowRef.addEventListener === 'function') {
    const handler = (event) => {
      if (!event || event.key !== lsBusKey || !event.newValue) {
        return;
      }
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed?.msg) {
          emit(parsed.msg);
        }
      } catch {
        // Ignore malformed payloads.
      }
    };
    windowRef.addEventListener('storage', handler);
    storageCleanup = () => windowRef.removeEventListener('storage', handler);
  }

  const postMessage = (msg) => {
    if (channel && typeof channel.postMessage === 'function') {
      channel.postMessage(msg);
      return;
    }
    if (!storage?.setLocal) {
      return;
    }
    try {
      const payload = JSON.stringify({
        msg,
        t: Date.now(),
        r: Math.random()
      });
      storage.setLocal(lsBusKey, payload);
    } catch {
      // Ignore post failures; messaging is best-effort.
    }
  };

  const onMessage = (fn) => {
    if (typeof fn !== 'function') {
      return () => {};
    }
    listeners.add(fn);
    flushPending();
    return () => listeners.delete(fn);
  };

  const dispose = () => {
    if (channelCleanup) {
      channelCleanup();
    }
    if (channel && typeof channel.close === 'function') {
      try {
        channel.close();
      } catch {
        // Ignore close failures.
      }
    }
    if (storageCleanup) {
      storageCleanup();
    }
    listeners.clear();
  };

  return { onMessage, postMessage, dispose };
};

const resolveTabIdentity = async (options) => {
  const {
    storage,
    rng,
    wait,
    collisionWindowMs,
    browserKey,
    tabKey,
    cookieDays,
    windowRef,
    documentRef,
    channelName,
    lsBusKey,
    broadcastChannelFactory,
    forceRegenerate = false
  } = options;

  const browserStorage = storage ?? createDefaultStorage();
  const doc = documentRef ?? getDefaultDocument();

  let browserId =
    browserStorage.getLocal?.(browserKey) ?? readCookie(doc, browserKey);

  if (!browserId) {
    browserId = rng();
    if (!browserStorage.setLocal?.(browserKey, browserId)) {
      writeCookie(doc, browserKey, browserId, cookieDays);
    }
  }

  let tabId = null;

  if (!forceRegenerate) {
    tabId = browserStorage.getSession?.(tabKey) ?? null;
    if (!tabId) {
      tabId = readWindowName(windowRef);
      if (tabId) {
        browserStorage.setSession?.(tabKey, tabId);
      }
    }
  }

  if (!tabId) {
    tabId = rng();
    persistTabId({ storage: browserStorage, windowRef, tabKey, tabId });
  } else if (windowRef && typeof windowRef === 'object') {
    try {
      if (!windowRef.name) {
        windowRef.name = tabId;
      }
    } catch {
      // Ignore inability to mirror sessionStorage into window.name
    }
  }

  const nonce = rng();
  let currentTabId = tabId;
  let didRegenerateTabId = Boolean(forceRegenerate);
  let meKey = `${currentTabId}:${nonce}`;

  const messaging = createMessagingChannel({
    channelName,
    lsBusKey,
    storage: browserStorage,
    windowRef,
    broadcastChannelFactory
  });

  const unsubscribe = messaging.onMessage((message) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === HELLO && message.tabId === currentTabId && message.nonce !== nonce) {
      const otherKey = `${message.tabId}:${message.nonce}`;
      const iWin = meKey > otherKey;
      if (!iWin && !didRegenerateTabId) {
        currentTabId = rng();
        meKey = `${currentTabId}:${nonce}`;
        didRegenerateTabId = true;
        persistTabId({
          storage: browserStorage,
          windowRef,
          tabKey,
          tabId: currentTabId
        });
        messaging.postMessage({ type: RENAMED, tabId: currentTabId, nonce });
      }
    }
  });

  messaging.postMessage({ type: HELLO, tabId: currentTabId, nonce });

  if (collisionWindowMs > 0) {
    await wait(collisionWindowMs);
  } else {
    await wait(0);
  }

  unsubscribe();
  messaging.dispose();

  return {
    browserId,
    tabId: currentTabId,
    didRegenerateTabId
  };
};

export const createBrowserIdModule = (moduleOptions = {}) => {
  const baseStorage = moduleOptions.storage ?? createDefaultStorage();
  const baseOptions = {
    ...DEFAULT_OPTIONS,
    ...moduleOptions,
    storage: baseStorage,
    rng: moduleOptions.rng ?? DEFAULT_OPTIONS.rng,
    wait: moduleOptions.wait ?? DEFAULT_OPTIONS.wait,
    broadcastChannelFactory:
      moduleOptions.broadcastChannelFactory ?? DEFAULT_OPTIONS.broadcastChannelFactory,
    windowRef: moduleOptions.windowRef ?? moduleOptions.window ?? DEFAULT_OPTIONS.windowRef,
    documentRef:
      moduleOptions.documentRef ?? moduleOptions.document ?? DEFAULT_OPTIONS.documentRef
  };

  let cachedIds = null;
  let inflight = null;

  const resolveRefs = (candidate) =>
    typeof candidate === 'function' ? candidate() : candidate;

  const prepareOptions = (overrides = {}) => {
    const resolvedWindow = resolveRefs(
      overrides.windowRef ?? overrides.window ?? baseOptions.windowRef
    );
    const resolvedDocument = resolveRefs(
      overrides.documentRef ?? overrides.document ?? baseOptions.documentRef
    );

    return {
      collisionWindowMs:
        typeof overrides.collisionWindowMs === 'number'
          ? overrides.collisionWindowMs
          : baseOptions.collisionWindowMs,
      channelName: overrides.channelName ?? baseOptions.channelName,
      lsBusKey: overrides.lsBusKey ?? baseOptions.lsBusKey,
      browserKey: overrides.browserKey ?? baseOptions.browserKey,
      tabKey: overrides.tabKey ?? baseOptions.tabKey,
      cookieDays: overrides.cookieDays ?? baseOptions.cookieDays,
      storage: overrides.storage ?? baseStorage,
      rng: overrides.rng ?? baseOptions.rng,
      wait: overrides.wait ?? baseOptions.wait,
      broadcastChannelFactory:
        overrides.broadcastChannelFactory ?? baseOptions.broadcastChannelFactory,
      windowRef: resolvedWindow,
      documentRef: resolvedDocument,
      forceRegenerate: Boolean(overrides.forceRegenerate)
    };
  };

  const resolveAndCache = async (overrides = {}) => {
    const prepared = prepareOptions(overrides);
    const result = await resolveTabIdentity(prepared);
    cachedIds = { ...result };
    return { ...result };
  };

  const getTabIdentity = async (overrides = {}) => {
    const wantsForce = overrides?.forceRegenerate === true;
    const wantsFresh = overrides?.fresh === true || wantsForce;

    if (!wantsFresh && cachedIds && !wantsForce) {
      return { ...cachedIds };
    }

    if (!wantsFresh && !wantsForce) {
      if (!inflight) {
        inflight = resolveAndCache(overrides);
      }
      try {
        const result = await inflight;
        return { ...result };
      } finally {
        inflight = null;
      }
    }

    return resolveAndCache(overrides);
  };

  const refreshTabId = async (overrides = {}) =>
    getTabIdentity({ ...overrides, forceRegenerate: true });

  const getBrowserId = async (overrides = {}) => {
    const result = await getTabIdentity(overrides);
    return result.browserId;
  };

  const getTabId = async (overrides = {}) => {
    const result = await getTabIdentity(overrides);
    return result.tabId;
  };

  const resetCache = () => {
    cachedIds = null;
    inflight = null;
  };

  const describe = () => ({
    channelName: baseOptions.channelName,
    lsBusKey: baseOptions.lsBusKey,
    browserKey: baseOptions.browserKey,
    tabKey: baseOptions.tabKey,
    collisionWindowMs: baseOptions.collisionWindowMs
  });

  return {
    getTabIdentity,
    getBrowserId,
    getTabId,
    refreshTabId,
    resetCache,
    describe
  };
};

const browserIdModule = createBrowserIdModule();

export default browserIdModule;
