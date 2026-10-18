/** Lowercase q from Bricolage Grotesque Bold (OFL), as outlines so the mark never depends on font loading. */
const Q = "M359 685L359 556Q359 528 361.5 497.5Q364 467 368 434.5Q372 402 377 369L368 369Q359 431 336 471.5Q313 512 277.5 532.5Q242 553 195 553Q140 553 95.5 523Q51 493 25.5 431.5Q0 370 0 274Q0 184 23.5 123Q47 62 91 31Q135 0 197 0Q245 0 279.5 19Q314 38 337 78Q360 118 371 179L377 179L375 14L503 14L503 209L503 685ZM247 433Q266 433 283 426Q300 419 314 406Q328 393 338 374.5Q348 356 354 333Q360 310 360 282L360 276Q360 240 351.5 212Q343 184 328 164.5Q313 145 292.5 134.5Q272 124 248 124Q215 124 192 144.5Q169 165 157.5 200Q146 235 146 279Q146 321 157 356.5Q168 392 190.5 412.5Q213 433 247 433Z";

/**
 * Quire mark: the app icon in miniature. A grey-stock q printed slightly off
 * register over a sunflower pass, on a federal-blue tile. Brand colours are
 * fixed (the mark looks the same in light and dark), so they come from the
 * --brand-* tokens rather than the themed ones.
 */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" aria-hidden>
      <rect width="1000" height="1000" rx="225" fill="var(--brand-blue)" />
      <path d={Q} fill="var(--brand-sun)" transform="translate(278 211) scale(0.92)" />
      <path d={Q} fill="var(--brand-paper)" transform="translate(259 196) scale(0.92)" />
    </svg>
  );
}

/** The mark with the name set in the display face. */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-[0.35em] font-display font-bold tracking-[-0.03em] text-ink" style={{ fontSize: size }}>
      <Logo size={Math.round(size * 1.05)} />
      Quire
    </span>
  );
}
