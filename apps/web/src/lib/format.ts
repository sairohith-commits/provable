// Pure display formatters (Phase U4 humanization). Node-testable; no React, no data logic.

/** A relative, human time ("2 days ago"). The absolute ISO belongs in a title attr. */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diff = nowMs - then;
  if (diff < 0) return 'just now'; // never render a future time as "in N days"
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const yr = Math.floor(mo / 12);
  return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

/**
 * A safe display for a provider subject. A raw Clerk `user_XXX` id is NEVER user-facing: if the
 * resolver has a name/email use it, otherwise shorten to a non-raw tail (no `user_…` prefix).
 * Non-Clerk subjects (emails, `local:<email>`) display as-is.
 */
export function shortSubject(id: string): string {
  if (id.startsWith('user_')) return `…${id.slice(-6)}`;
  return id;
}

export function displaySubject(id: string | undefined, names: ReadonlyMap<string, string>): string | undefined {
  if (id === undefined) return undefined;
  return names.get(id) ?? shortSubject(id);
}
