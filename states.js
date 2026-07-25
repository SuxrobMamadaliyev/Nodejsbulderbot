// Har bir foydalanuvchi uchun ko'p bosqichli suhbat holatini saqlovchi soddalashtirilgan state manager.
// Kalit: `${scope}:${userId}` -> { step, data }

const store = new Map();

function keyOf(scope, userId) {
  return `${scope}:${userId}`;
}

function setState(scope, userId, step, data = {}) {
  const key = keyOf(scope, userId);
  const existing = store.get(key) || { data: {} };
  store.set(key, { step, data: { ...existing.data, ...data }, updatedAt: Date.now() });
}

function getState(scope, userId) {
  return store.get(keyOf(scope, userId)) || null;
}

function updateStateData(scope, userId, patch) {
  const current = getState(scope, userId);
  if (!current) return;
  current.data = { ...current.data, ...patch };
  current.updatedAt = Date.now();
  store.set(keyOf(scope, userId), current);
}

function clearState(scope, userId) {
  store.delete(keyOf(scope, userId));
}

function hasState(scope, userId) {
  return store.has(keyOf(scope, userId));
}

// Eskirgan (30 daqiqadan ortiq) statelarni tozalash
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (now - value.updatedAt > 30 * 60 * 1000) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref?.();

module.exports = {
  setState,
  getState,
  updateStateData,
  clearState,
  hasState,
};
