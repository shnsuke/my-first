const STORAGE_KEY = "deadlift-tracker-v1";

export function defaultState() {
  return { goal: null, oneRMRecords: [], trainingLogs: [] };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
