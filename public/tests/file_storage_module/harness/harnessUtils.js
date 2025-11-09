export const setupHarness = ({
  statusId = 'status',
  logId = 'log',
  summaryId = 'summary'
} = {}) => {
  const statusEl = document.getElementById(statusId);
  const logEl = document.getElementById(logId);
  const summaryEl = document.getElementById(summaryId);

  const entries = [];

  const setStatus = (text, tone = 'info') => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
  };

  const renderLog = () => {
    if (!logEl) return;
    logEl.textContent = entries
      .map((entry) => JSON.stringify(entry, null, 2))
      .reverse()
      .join('\n\n');
  };

  const log = (label, payload = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      label,
      ...payload
    };
    entries.push(entry);
    console.log('[harness]', entry);
    renderLog();
    return entry;
  };

  const summaryRows = [];
  const renderSummary = () => {
    if (!summaryEl) return;
    if (!summaryRows.length) {
      summaryEl.innerHTML = '<p>No results yet.</p>';
      return;
    }
    summaryEl.innerHTML = summaryRows
      .map(
        ({ label, ok, details }) => `
          <div class="summary-row ${ok ? 'pass' : 'fail'}">
            <span class="summary-label">${label}</span>
            <span class="summary-status">${ok ? 'PASS' : 'FAIL'}</span>
            ${
              details
                ? `<code class="summary-details">${details}</code>`
                : ''
            }
          </div>`
      )
      .join('');
  };

  const report = (label, ok, details = '') => {
    summaryRows.push({ label, ok, details });
    renderSummary();
    log(label, { ok, details });
    return ok;
  };

  const resetSummary = () => {
    summaryRows.length = 0;
    renderSummary();
  };

  renderSummary();

  return {
    log,
    report,
    resetSummary,
    setStatus
  };
};

export const formatCounts = (counts) => {
  const normalized = counts ?? {};
  return `${normalized.files ?? 0} files / ${normalized.directories ?? 0} directories`;
};

export const compareCounts = ({
  label,
  counts,
  expected,
  report,
  includeHandles = false
}) => {
  const filesMatch = (counts?.files ?? 0) === expected.files;
  const directoriesMatch = (counts?.directories ?? 0) === expected.directories;
  const handlesMatch = !includeHandles
    ? true
    : (counts?.handles ?? 0) === (expected.handles ?? 0);
  const ok = filesMatch && directoriesMatch && handlesMatch;
  const handleText = includeHandles
    ? ` / ${counts?.handles ?? 0} handles (expected ${expected.handles ?? 0})`
    : '';
  const details = `${formatCounts(counts)} (expected ${formatCounts(expected)})${handleText}`;
  return report(label, ok, details);
};

export const clearRegistry = async (fileStorageModule) => {
  await fileStorageModule.init();
  const keys = await fileStorageModule.listKeys({ includeTransient: false });
  for (const key of keys) {
    await fileStorageModule.remove(key);
  }
  return keys;
};

export const getNativeCounts = async (fileStorageModule, key) => {
  const result = await fileStorageModule.getFileCount(key);
  if (!result.ok) {
    return null;
  }
  return result.counts ?? null;
};

export const createTransientPicker = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.webkitdirectory = true;
  input.directory = true;
  input.style.display = 'none';
  document.body.appendChild(input);

  return () =>
    new Promise((resolve, reject) => {
      input.value = '';
      input.onchange = () => {
        const files = Array.from(input.files ?? []);
        if (!files.length) {
          reject(new Error('No files selected for transient flow.'));
          return;
        }
        resolve(files);
      };
      input.click();
    });
};

export const assertTransientState = async ({
  fileStorageModule,
  expectEmpty,
  report,
  label = expectEmpty ? 'transient.expect-empty' : 'transient.expect-present'
}) => {
  const keys = await fileStorageModule.listKeys();
  const transientKeys = [];
  for (const key of keys) {
    const info = await fileStorageModule.getStorageType(key);
    if (info.ok && info.storageType === 'transient-session') {
      transientKeys.push(key);
    }
  }

  const ok = expectEmpty ? transientKeys.length === 0 : transientKeys.length > 0;
  const details = expectEmpty
    ? transientKeys.length === 0
      ? 'No transient sessions (expected)'
      : `Unexpected keys: ${transientKeys.join(', ')}`
    : transientKeys.length > 0
      ? `Active keys: ${transientKeys.join(', ')}`
      : 'No transient sessions when some were expected';
  return report(label, ok, details);
};
