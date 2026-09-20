import db from './index';
import { getAccessToken } from '../utils/tokenStore';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const MAX_RETRIES = 8;

let isSyncing = false;

async function getToken() {
  return getAccessToken();
}

async function getAuthHeaders() {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function enqueue(action, entity, entityId, data) {
  await db.syncQueue.add({
    action,
    entity,
    entityId,
    data,
    timestamp: Date.now(),
    retries: 0,
    status: 'pending', // pending | conflict | failed
  });

  if (navigator.onLine) {
    processQueue();
  }
}

// 4xx responses (except transient 408/429) are permanent — retrying will never
// succeed, so the item is parked as a "conflict" instead of being silently
// dropped. Closes the offline-sync silent-data-loss finding (V24).
function isPermanentFailure(status) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export async function processQueue() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const pending = await db.syncQueue.orderBy('timestamp').toArray();

    for (const item of pending) {
      if (item.status === 'conflict' || item.status === 'failed') continue;
      if (item.nextRetry && Date.now() < item.nextRetry) continue;

      try {
        const headers = await getAuthHeaders();
        const url = `${API_URL}/${item.entity}${item.entityId && item.action !== 'create' ? '/' + item.entityId : ''}`;

        const method = item.action === 'create' ? 'POST'
          : item.action === 'update' ? (item.entity === 'purchases' ? 'PATCH' : 'PUT')
          : 'DELETE';

        let body;
        let reqHeaders = headers;
        const blobField = item.data && (item.data.imageBlob instanceof Blob ? 'imageBlob' : (item.data.receiptBlob instanceof Blob ? 'receiptBlob' : null));
        if (blobField) {
          const fd = new FormData();
          for (const [k, v] of Object.entries(item.data)) {
            if (k === blobField) {
              if (v) fd.append(blobField === 'imageBlob' ? 'image' : 'receipt', v);
            } else if (v !== undefined && v !== null) {
              fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
            }
          }
          body = fd;
          reqHeaders = { ...headers };
          delete reqHeaders['Content-Type'];
        } else {
          body = item.action !== 'delete' ? JSON.stringify(item.data) : undefined;
        }

        const res = await fetch(url, { method, headers: reqHeaders, body });

        if (res.ok) {
          const table = db[item.entity];
          if (table && item.entityId) {
            try {
              const json = await res.json().catch(() => ({}));
              const patch = { syncStatus: 'synced' };
              if (item.entity === 'products') {
                const prod = json.product || json;
                if (prod && prod.imagePath) patch.imagePath = prod.imagePath;
              } else if (item.entity === 'purchases') {
                const purch = json.purchase || json;
                if (purch && purch.receiptPath) patch.receiptPath = purch.receiptPath;
              }
              await table.update(item.entityId, patch);
            } catch { /* entity may not exist locally */ }
          }
          await db.syncQueue.delete(item.id);
        } else if (isPermanentFailure(res.status)) {
          // Park the item so it is visible and not lost.
          const text = await res.text().catch(() => '');
          await db.syncQueue.update(item.id, {
            status: 'conflict',
            lastError: `${res.status}: ${text.slice(0, 300)}`,
            failedAt: Date.now(),
          });
        } else {
          await handleRetry(item);
        }
      } catch {
        await handleRetry(item);
      }
    }
  } finally {
    isSyncing = false;
  }
}

async function handleRetry(item) {
  const retries = (item.retries || 0) + 1;
  if (retries > MAX_RETRIES) {
    // Keep the item (do not delete) and surface it as failed.
    await db.syncQueue.update(item.id, {
      retries,
      status: 'failed',
      lastError: item.lastError || 'Exceeded maximum retries',
      failedAt: Date.now(),
    });
  } else {
    const delay = Math.min(Math.pow(2, retries) * 1000 + Math.random() * 1000, 5 * 60 * 1000);
    await db.syncQueue.update(item.id, {
      retries,
      nextRetry: Date.now() + delay,
    });
  }
}

export async function getPendingCount() {
  const all = await db.syncQueue.toArray();
  return all.filter((i) => i.status !== 'conflict' && i.status !== 'failed').length;
}

export async function getFailedCount() {
  const all = await db.syncQueue.toArray();
  return all.filter((i) => i.status === 'conflict' || i.status === 'failed').length;
}

export async function getFailedItems() {
  const all = await db.syncQueue.toArray();
  return all.filter((i) => i.status === 'conflict' || i.status === 'failed');
}

export async function retryFailed() {
  const all = await db.syncQueue.toArray();
  for (const item of all) {
    if (item.status === 'conflict' || item.status === 'failed') {
      await db.syncQueue.update(item.id, { status: 'pending', retries: 0, nextRetry: 0 });
    }
  }
  return processQueue();
}

export function startSyncListener() {
  window.addEventListener('online', () => {
    setTimeout(processQueue, 1000);
  });

  if (navigator.onLine) {
    setTimeout(processQueue, 2000);
  }
}
