import { describe, expect, it } from 'vitest';
import browserIdModule, {
  createBrowserIdModule
} from '../../public/js/browserIdModule.mjs';

const createDeterministicRng = (prefix = 'rng') => {
  let counter = 0;
  return () => `${prefix}-${counter++}`;
};

const createMockWindow = () => ({
  name: '',
  addEventListener: () => {},
  removeEventListener: () => {}
});

const createMemoryStorage = ({ sharedLocal, sessionSeed } = {}) => {
  const local = sharedLocal ?? new Map();
  const session = new Map(sessionSeed ? Array.from(sessionSeed.entries()) : []);
  return {
    getLocal: (key) => (local.has(key) ? local.get(key) : null),
    setLocal: (key, value) => {
      local.set(key, value);
      return true;
    },
    removeLocal: (key) => {
      local.delete(key);
      return true;
    },
    getSession: (key) => (session.has(key) ? session.get(key) : null),
    setSession: (key, value) => {
      session.set(key, value);
      return true;
    },
    removeSession: (key) => {
      session.delete(key);
      return true;
    }
  };
};

class MockBroadcastChannel {
  constructor(name, hub) {
    this.name = name;
    this.hub = hub;
    this.listeners = new Set();
    this.onmessage = null;
    this.hub.add(this);
  }

  postMessage(data) {
    this.hub.broadcast(this, data);
  }

  addEventListener(type, handler) {
    if (type === 'message' && typeof handler === 'function') {
      this.listeners.add(handler);
    }
  }

  removeEventListener(type, handler) {
    if (type === 'message' && handler) {
      this.listeners.delete(handler);
    }
  }

  close() {
    this.listeners.clear();
    this.onmessage = null;
    this.hub.remove(this);
  }

  dispatch(data) {
    for (const handler of this.listeners) {
      handler({ data });
    }
    if (typeof this.onmessage === 'function') {
      this.onmessage({ data });
    }
  }
}

class BroadcastHub {
  constructor(name) {
    this.name = name;
    this.channels = new Set();
  }

  createChannel() {
    return new MockBroadcastChannel(this.name, this);
  }

  add(channel) {
    this.channels.add(channel);
  }

  remove(channel) {
    this.channels.delete(channel);
  }

  broadcast(sender, data) {
    for (const channel of this.channels) {
      if (channel === sender) {
        continue;
      }
      channel.dispatch(data);
    }
  }
}

const createCookieDocument = () => {
  let store = '';
  return {
    get cookie() {
      return store;
    },
    set cookie(value) {
      store = store ? `${store}; ${value}` : value;
    }
  };
};

describe('browserIdModule', () => {
  it('returns stable identities and caches results', async () => {
    const module = createBrowserIdModule({
      storage: createMemoryStorage(),
      windowRef: createMockWindow(),
      documentRef: createCookieDocument(),
      rng: createDeterministicRng(),
      wait: () => Promise.resolve(),
      collisionWindowMs: 0
    });

    const first = await module.getTabIdentity();
    const second = await module.getTabIdentity();

    expect(first.browserId).toEqual('rng-0');
    expect(first.tabId).toEqual('rng-1');
    expect(second.browserId).toEqual(first.browserId);
    expect(second.tabId).toEqual(first.tabId);
  });

  it('refreshes the tab id and reports regeneration', async () => {
    const module = createBrowserIdModule({
      storage: createMemoryStorage(),
      windowRef: createMockWindow(),
      documentRef: createCookieDocument(),
      rng: createDeterministicRng(),
      wait: () => Promise.resolve(),
      collisionWindowMs: 0
    });

    const baseline = await module.getTabIdentity();
    const refreshed = await module.refreshTabId();

    expect(refreshed.tabId).not.toEqual(baseline.tabId);
    expect(refreshed.browserId).toEqual(baseline.browserId);
    expect(refreshed.didRegenerateTabId).toBe(true);
  });

  it('resolves duplicated sessionStorage clones via the messaging bus', async () => {
    const sharedLocal = new Map([['ft.browserId', 'seed-browser']]);
    const sessionSeed = new Map([['ft.tabId', 'dupe-tab']]);
    const hub = new BroadcastHub('tab-id-v1');

    const makeModule = (label) =>
      createBrowserIdModule({
        storage: createMemoryStorage({ sharedLocal, sessionSeed }),
        windowRef: { ...createMockWindow(), name: 'dupe-tab' },
        documentRef: createCookieDocument(),
        rng: createDeterministicRng(label),
        wait: () => Promise.resolve(),
        collisionWindowMs: 0,
        broadcastChannelFactory: () => hub.createChannel()
      });

    const moduleA = makeModule('tab-a');
    const moduleB = makeModule('tab-b');

    const [idsA, idsB] = await Promise.all([
      moduleA.getTabIdentity(),
      moduleB.getTabIdentity()
    ]);

    expect(idsA.browserId).toEqual('seed-browser');
    expect(idsB.browserId).toEqual('seed-browser');
    expect(idsA.tabId).not.toEqual(idsB.tabId);
    const tabIds = [idsA.tabId, idsB.tabId];
    expect(tabIds).toContain('dupe-tab');
    expect(tabIds.some((id) => id.startsWith('tab-'))).toBe(true);
    expect(idsA.didRegenerateTabId || idsB.didRegenerateTabId).toBe(true);
  });

  it('falls back to cookies when localStorage writes are blocked', async () => {
    let sessionValue = null;
    const storage = {
      getLocal: () => null,
      setLocal: () => false,
      removeLocal: () => true,
      getSession: () => sessionValue,
      setSession: (_, value) => {
        sessionValue = value;
        return true;
      },
      removeSession: () => {
        sessionValue = null;
        return true;
      }
    };

    const doc = createCookieDocument();
    const module = createBrowserIdModule({
      storage,
      windowRef: createMockWindow(),
      documentRef: doc,
      rng: createDeterministicRng(),
      wait: () => Promise.resolve(),
      collisionWindowMs: 0,
      broadcastChannelFactory: () => null
    });

    const first = await module.getTabIdentity();
    expect(doc.cookie).toContain('ft.browserId=rng-0');

    const again = await module.getTabIdentity({ fresh: true });
    expect(again.browserId).toEqual(first.browserId);
    expect(sessionValue).toEqual(again.tabId);
  });

  it('exposes describe() metadata for consumers', () => {
    const descriptor = browserIdModule.describe();
    expect(descriptor).toMatchObject({
      channelName: 'tab-id-v1',
      lsBusKey: 'tab-id-v1:bus',
      browserKey: 'ft.browserId',
      tabKey: 'ft.tabId'
    });
  });
});
