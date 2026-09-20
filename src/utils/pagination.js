// Cursor (keyset) pagination helpers (Phase 4).
//
// Keyset pagination by `_id` (ObjectId, which correlates with creation time)
// avoids the offset-drift and deep-skip costs of page/offset pagination.
//
// Backward compatibility: callers only paginate when the client sends a
// `limit`/`cursor`; otherwise they keep their existing (full-list) behavior.

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

function parsePagination(query = {}, { defaultLimit = 100, maxLimit = 500 } = {}) {
  const rawLimit = query.limit;
  const hasLimit = rawLimit !== undefined && rawLimit !== '';
  const parsed = parseInt(rawLimit, 10);
  const limit = hasLimit ? Math.min(Math.max(Number.isNaN(parsed) ? defaultLimit : parsed, 1), maxLimit) : null;
  const cursor = query.cursor && OBJECT_ID_RE.test(String(query.cursor)) ? String(query.cursor) : null;
  return { limit, cursor, hasLimit };
}

/**
 * @param {import('mongoose').Model<any>} Model
 * @param {object} filter
 * @param {{ limit?: number, cursor?: string|null, sort?: object, select?: string }} options
 */
async function paginate(Model, filter = {}, { limit = 100, cursor = null, sort = { _id: -1 }, select } = {}) {
  const q = { ...filter };
  if (cursor) {
    q._id = Object.assign({}, q._id, { $lt: cursor });
  }
  let query = Model.find(q).sort(sort).limit(limit + 1);
  if (select) query = query.select(select);
  const docs = await query.lean();
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore && items.length ? String(items[items.length - 1]._id) : null;
  return { items, nextCursor, hasMore };
}

module.exports = { parsePagination, paginate, OBJECT_ID_RE };
