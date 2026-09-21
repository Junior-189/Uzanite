import db from './index';
import { enqueue } from './sync';
import { getAccessToken } from '../utils/tokenStore';
import { resolveApiUrl } from '../utils/apiRouting';

async function getAuthHeaders() {
  // Single source of truth for credentials (see utils/tokenStore.js). Reading
  // tokens out of IndexedDB here was part of what made them a durable target.
  const token = getAccessToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchFromCacheOrApi(entity, options = {}) {
  const table = db[entity];
  if (!table) throw new Error(`Unknown entity: ${entity}`);

  const cached = await table.toArray();
  if (cached.length > 0 && !options.forceRefresh) {
    fetchAndCache(entity, options).catch(() => {});
    return cached;
  }

  try {
    const headers = await getAuthHeaders();
    const params = options.params ? '?' + new URLSearchParams(options.params).toString() : '';
    const res = await fetch(resolveApiUrl(`/${entity}${params}`), { headers });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const json = await res.json();
    const items = json[entity] || json.data || [];
    await table.clear();
    if (items.length > 0) await table.bulkAdd(items.map(i => ({ ...i, syncStatus: 'synced' })));
    return items;
  } catch {
    return cached;
  }
}

async function fetchAndCache(entity, options = {}) {
  try {
    const headers = await getAuthHeaders();
    const params = options.params ? '?' + new URLSearchParams(options.params).toString() : '';
    const res = await fetch(resolveApiUrl(`/${entity}${params}`), { headers });
    if (!res.ok) return;
    const json = await res.json();
    const items = json[entity] || json.data || [];
    const table = db[entity];
    await table.clear();
    if (items.length > 0) await table.bulkAdd(items.map(i => ({ ...i, syncStatus: 'synced' })));
  } catch { /* silent */ }
}

export async function createOffline(entity, data) {
  const table = db[entity];
  if (!table) throw new Error(`Unknown entity: ${entity}`);

  const id = data._id || data.id || crypto.randomUUID();
  const record = { ...data, _id: id, id, clientRef: id, syncStatus: 'pending', createdAt: data.createdAt || new Date().toISOString() };

  await table.put(record);

  let createdOnline = false;
  if (navigator.onLine) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(resolveApiUrl(`/${entity}`), {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...data, clientRef: id }),
      });
      if (res.ok) {
        const json = await res.json();
        const serverId = json._id || json.id || json[entity]?._id;
        if (serverId && serverId !== id) {
          await table.delete(id);
          await table.put({ ...record, _id: serverId, id: serverId, syncStatus: 'synced' });
        } else {
          await table.update(id, { syncStatus: 'synced' });
        }
        createdOnline = true;
        return json;
      }
    } catch {
      // Online POST failed — fall through to queue for later sync
    }
  }

  // Only queue when we did NOT already create it online (avoid double-create)
  if (!createdOnline) {
    await enqueue('create', entity, id, { ...data, clientRef: id });
  }
  return record;
}

export async function updateOffline(entity, id, data) {
  const table = db[entity];
  if (!table) throw new Error(`Unknown entity: ${entity}`);

  await table.update(id, { ...data, syncStatus: 'pending' });

  if (navigator.onLine) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(resolveApiUrl(`/${entity}/${id}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await table.update(id, { syncStatus: 'synced' });
        return await res.json();
      }
    } catch { /* will sync later */ }
  }

  await enqueue('update', entity, id, { ...data, _id: id });
}

export async function deleteOffline(entity, id) {
  const table = db[entity];
  if (!table) throw new Error(`Unknown entity: ${entity}`);

  await table.delete(id);

  if (navigator.onLine) {
    try {
      const headers = await getAuthHeaders();
      await fetch(resolveApiUrl(`/${entity}/${id}`), { method: 'DELETE', headers });
      return;
    } catch { /* will sync later */ }
  }

  await enqueue('delete', entity, id, { _id: id });
}

/**
 * Wipes cached tenant data and the offline queue. MUST be called whenever the
 * authenticated principal changes (login/logout/impersonation) so a shared
 * device never serves one tenant's cached rows to another.
 */
export async function clearTenantData() {
  const keep = new Set(['settings']);
  await Promise.all(
    db.tables
      .filter((t) => !keep.has(t.name))
      .map((t) => t.clear().catch(() => { /* best-effort */ }))
  );
}

export async function apiAction(path, method = 'POST', body = null) {
  const headers = await getAuthHeaders();
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(resolveApiUrl(path), opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}
