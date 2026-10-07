/** Quire mark: a gathered stack of pages, the front one with a folded corner. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="7" y="1" width="11" height="14" rx="2" fill="currentColor" opacity="0.2" />
      <rect x="5" y="2.5" width="11" height="14" rx="2" fill="currentColor" opacity="0.38" />
      <path d="M5 4h5.5L14 7.5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="var(--accent)" />
      <path d="M10.5 4v2.5a1 1 0 0 0 1 1H14" stroke="var(--bg)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
