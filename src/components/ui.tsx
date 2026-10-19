import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import type { KeyValue } from "../lib/types";
import { emptyKV } from "../lib/samples";

export const cx = clsx;

// --- Panel -----------------------------------------------------------------
export function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border border-slate-200 bg-white dark:border-white/[0.08] dark:bg-[#0f131c]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// --- Button ----------------------------------------------------------------
type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";

export function Button({
  variant = "subtle",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      "bg-indigo-500 text-white hover:bg-indigo-600 active:bg-indigo-700 shadow-sm",
    ghost:
      "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06]",
    subtle:
      "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.07]",
    danger:
      "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10",
  };
  return (
    <button
      className={cx(
        "no-drag inline-flex select-none items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// --- Segmented control / tabs ---------------------------------------------
export interface SegOption<T extends string> {
  value: T;
  label: string;
  badge?: number | string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "no-drag inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.04]",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition",
            value === o.value
              ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
          )}
        >
          {o.label}
          {o.badge != null && o.badge !== 0 && o.badge !== "" && (
            <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {o.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// --- Inputs ----------------------------------------------------------------
export function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "no-drag w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:placeholder:text-slate-500",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "no-drag cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 dark:border-white/10 dark:bg-[#141925] dark:text-slate-100",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

// --- Educational info tooltip ---------------------------------------------
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="no-drag group relative inline-flex">
      <span
        tabIndex={0}
        className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-slate-300 text-[9px] font-bold leading-none text-slate-400 transition hover:border-indigo-400 hover:text-indigo-500 dark:border-white/20 dark:text-slate-500"
        aria-label={text}
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 top-5 z-50 w-60 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-normal leading-snug text-slate-600 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-white/10 dark:bg-[#1a1f2b] dark:text-slate-300">
        {text}
      </span>
    </span>
  );
}

// --- Spinner ---------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

// --- Empty state -----------------------------------------------------------
export function EmptyState({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      {icon && <div className="mb-3 text-slate-300 dark:text-slate-600">{icon}</div>}
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {title}
      </div>
      {subtitle && (
        <div className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
          {subtitle}
        </div>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

// --- Key/Value editor ------------------------------------------------------
export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  // Render all items plus a trailing blank row for quick entry.
  const rows = [...items, emptyKV()];

  const update = (index: number, partial: Partial<KeyValue>) => {
    // Editing the trailing blank row promotes it to a real row (a fresh blank
    // then appears). Existing rows are updated in place and never pruned
    // mid-edit, so row positions — and input focus — stay stable.
    if (index === items.length) {
      onChange([...items, { ...emptyKV(), ...partial }]);
    } else {
      onChange(items.map((r, i) => (i === index ? { ...r, ...partial } : r)));
    }
  };

  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-white/[0.07]">
      {rows.map((row, i) => {
        const isBlank = i === items.length;
        return (
          <div
            key={i}
            className="flex items-center gap-2 border-b border-slate-100 px-2 py-1 last:border-0 dark:border-white/[0.05]"
          >
            <input
              type="checkbox"
              checked={row.enabled}
              disabled={isBlank}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              className="no-drag h-3.5 w-3.5 shrink-0 cursor-pointer accent-indigo-500 disabled:opacity-30"
            />
            <input
              value={row.key}
              placeholder={keyPlaceholder}
              onChange={(e) => update(i, { key: e.target.value })}
              className="no-drag min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-xs text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-600"
            />
            <span className="text-slate-300 dark:text-slate-700">:</span>
            <input
              value={row.value}
              placeholder={valuePlaceholder}
              onChange={(e) => update(i, { value: e.target.value })}
              className="no-drag min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-xs text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-600"
            />
            {!isBlank ? (
              <IconButton onClick={() => remove(i)} aria-label="Remove">
                <Trash2 size={13} />
              </IconButton>
            ) : (
              <span className="inline-flex h-7 w-7 items-center justify-center text-slate-300 dark:text-slate-700">
                <Plus size={13} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
