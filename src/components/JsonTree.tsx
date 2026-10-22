import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Table2 } from "lucide-react";
import { EmptyState, cx } from "./ui";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export function JsonTree({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as Json };
    } catch {
      return { ok: false as const };
    }
  }, [text]);

  if (!parsed.ok) {
    return (
      <EmptyState
        title="Not JSON"
        subtitle="The tree view is available for JSON responses. Use Pretty or Raw for this body."
      />
    );
  }

  return (
    <div className="h-full overflow-auto rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs dark:border-white/[0.08] dark:bg-[#0f131c]">
      <Node name={null} value={parsed.value} depth={0} defaultOpen />
    </div>
  );
}

function isArrayOfObjects(v: Json): v is Record<string, Json>[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => x && typeof x === "object" && !Array.isArray(x))
  );
}

function Primitive({ value }: { value: Json }) {
  if (value === null) return <span className="text-slate-400">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="break-all text-emerald-600 dark:text-emerald-400">"{value}"</span>;
    case "number":
      return <span className="text-indigo-500 dark:text-indigo-400">{String(value)}</span>;
    case "boolean":
      return <span className="text-amber-600 dark:text-amber-400">{String(value)}</span>;
    default:
      return <span className="text-slate-500">{String(value)}</span>;
  }
}

function Node({
  name,
  value,
  depth,
  defaultOpen = false,
}: {
  name: string | number | null;
  value: Json;
  depth: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || depth < 1);
  const [asTable, setAsTable] = useState(false);
  const isObj = value && typeof value === "object";
  const label =
    name === null ? null : (
      <span className="text-slate-500 dark:text-slate-400">
        {typeof name === "number" ? `[${name}]` : name}
        <span className="text-slate-300 dark:text-slate-600">: </span>
      </span>
    );

  if (!isObj) {
    return (
      <div className="py-0.5 pl-[1.1rem]">
        {label}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [i, v] as const)
    : Object.entries(value);
  const count = entries.length;
  const bracket = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  const tableable = isArrayOfObjects(value);

  return (
    <div className="py-0.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setOpen((o) => !o)}
          className="no-drag inline-flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {label}
        <span className="text-slate-400">
          {bracket[0]}
          {!open && <span className="text-slate-300 dark:text-slate-600"> {count} </span>}
          {!open && bracket[1]}
        </span>
        {!open && (
          <span className="text-[10px] text-slate-300 dark:text-slate-600">
            {Array.isArray(value) ? "items" : "keys"}
          </span>
        )}
        {open && tableable && (
          <button
            onClick={() => setAsTable((t) => !t)}
            title="Toggle table view"
            className={cx(
              "no-drag ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] transition",
              asTable
                ? "bg-indigo-500/15 text-indigo-500"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]",
            )}
          >
            <Table2 size={11} /> table
          </button>
        )}
      </div>

      {open && (
        <div className="border-l border-slate-100 pl-3 dark:border-white/[0.06]">
          {asTable && tableable ? (
            <ObjectTable rows={value as Record<string, Json>[]} />
          ) : (
            entries.map(([k, v]) => (
              <Node key={String(k)} name={k} value={v} depth={depth + 1} />
            ))
          )}
          <div className="pl-[1.1rem] text-slate-400">{bracket[1]}</div>
        </div>
      )}
    </div>
  );
}

function ObjectTable({ rows }: { rows: Record<string, Json>[] }) {
  // Column union, capped for width.
  const cols: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  }
  const cell = (v: Json) =>
    v && typeof v === "object" ? JSON.stringify(v) : v === undefined ? "" : String(v);

  return (
    <div className="my-1 overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="border border-slate-200 px-2 py-1 text-left text-slate-400 dark:border-white/[0.08]">
              #
            </th>
            {cols.map((c) => (
              <th
                key={c}
                className="border border-slate-200 px-2 py-1 text-left font-semibold text-slate-600 dark:border-white/[0.08] dark:text-slate-300"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
              <td className="border border-slate-200 px-2 py-1 text-slate-400 dark:border-white/[0.08]">
                {i}
              </td>
              {cols.map((c) => (
                <td
                  key={c}
                  className="max-w-[16rem] truncate border border-slate-200 px-2 py-1 text-slate-700 dark:border-white/[0.08] dark:text-slate-200"
                  title={cell(r[c])}
                >
                  {cell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
