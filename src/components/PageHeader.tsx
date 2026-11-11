import type { ReactNode } from "react";

/**
 * Title row shared by every page: what you're looking at on the left, the
 * controls that change it on the right. Stacks on narrow screens.
 */
export function PageHeader({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-zinc-100 sm:text-2xl">{title}</h1>
        {meta ? <p className="mt-1 text-sm text-zinc-500">{meta}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** A row of mutually exclusive choices (time range, filter). Scrolls on phones. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="scroll-x flex max-w-full rounded-lg border border-white/[0.08] bg-zinc-900/70 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === o.value ? "bg-white/[0.1] text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Secondary action or on/off toggle, same height as Segmented. */
export function ToolButton({
  onClick,
  children,
  active,
  disabled,
  title,
}: {
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-[7px] text-xs font-medium transition-colors disabled:opacity-50 ${
        active
          ? "border-white/20 bg-white/[0.1] text-zinc-100"
          : "border-white/[0.08] bg-zinc-900/70 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

/** One headline number with its label and a line of context. */
export function StatTile({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "good" | "bad" | "neutral";
  title?: string;
}) {
  const color = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-zinc-100";
  return (
    <div title={title} className="rounded-xl border border-white/[0.07] bg-zinc-900/50 px-4 py-3.5">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold leading-tight ${color}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}
