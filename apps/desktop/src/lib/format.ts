/** "~/Desktop/reports" style parent folder for display. */
export function parentFolder(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  const dir = parts.join("/");
  const home = dir.match(/^\/Users\/[^/]+/)?.[0] ?? dir.match(/^\/home\/[^/]+/)?.[0];
  return home ? "~" + dir.slice(home.length) : dir;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function relativeTime(ms: number): string {
  const diff = (ms - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.35],
    ["month", 12],
    ["year", Infinity],
  ];
  let value = diff;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) {
      return unit === "second" ? "just now" : rtf.format(Math.round(value), unit);
    }
    value /= size;
  }
  return "";
}
