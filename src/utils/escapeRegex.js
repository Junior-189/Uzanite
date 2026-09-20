// Escapes RegExp metacharacters so a user-supplied search string is matched as
// a literal. Prevents regex injection / catastrophic backtracking (ReDoS) when
// building `$regex` filters or `new RegExp(...)` from req.query. Also caps the
// length so an enormous pattern cannot be submitted.
const MAX_SEARCH_LENGTH = 120;

function escapeRegex(value) {
  if (value == null) return '';
  return String(value)
    .slice(0, MAX_SEARCH_LENGTH)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex, MAX_SEARCH_LENGTH };
