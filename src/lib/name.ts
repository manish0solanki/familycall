const KEY = 'familycall:name';

export function loadName(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    // Private browsing: not remembering the name is fine.
  }
}
