// Request-scoped tenant context backed by AsyncLocalStorage.
//
// The tenantScope Mongoose plugin reads this store to automatically constrain
// queries to the current tenant. Background jobs / WhatsApp flows run without a
// store, so they are unaffected and must scope explicitly (as Phase 0 fixed).
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function runWithTenant(store, fn) {
  return als.run(store, fn);
}

function getTenantContext() {
  return als.getStore() || null;
}

// Mutate the current store (used by `protect` once the token is decoded).
function setTenant(patch) {
  const store = als.getStore();
  if (store) Object.assign(store, patch);
}

module.exports = { runWithTenant, getTenantContext, setTenant };
