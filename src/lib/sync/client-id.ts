/** A stable id for this browser tab. It survives reloads of the tab, not closing it. */
export function tabClientId(): string {
  const key = "desk:tab";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function safeLocalStorage(): Storage | null {
  try {
    const k = "desk:probe";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}
