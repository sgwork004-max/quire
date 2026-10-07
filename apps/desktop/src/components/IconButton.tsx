import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  children: ReactNode;
}

export function IconButton({ label, shortcut, active, className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label}  ${shortcut}` : label}
      className={clsx(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors",
        "hover:bg-hover hover:text-ink active:bg-active disabled:pointer-events-none disabled:opacity-40",
        active && "bg-active text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
