import { History, Search, Star, Trash2, X } from "lucide-react";
import { useStore, type SidebarTab } from "../store";
import { methodColor, statusColor, timeAgo } from "../lib/format";
import { SAMPLES } from "../lib/samples";
import { CollectionsPanel } from "./CollectionsPanel";
import { MonitorsPanel } from "./MonitorsPanel";
import { IconButton, Segmented, cx, type SegOption } from "./ui";

export function Sidebar() {
  const sidebarTab = useStore((s) => s.sidebarTab);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const query = useStore((s) => s.sidebarQuery);
  const setQuery = useStore((s) => s.setSidebarQuery);

  const tabs: SegOption<SidebarTab>[] = [
    { value: "history", label: "History" },
    { value: "saved", label: "Saved" },
    { value: "collections", label: "Collections" },
    { value: "monitors", label: "Monitors" },
  ];

  return (
    <aside className="flex h-full w-full flex-col border-r border-slate-200 bg-slate-50 dark:border-white/[0.08] dark:bg-[#0b0e14]">
      <div className="p-2 pb-1">
        <Segmented
          options={tabs}
          value={sidebarTab}
          onChange={setSidebarTab}
          className="w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:px-2"
        />
      </div>
      <div className={cx("px-2 pb-2", sidebarTab === "monitors" && "hidden")}>
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requests…"
            className="no-drag w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-7 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:placeholder:text-slate-500"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="no-drag absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {sidebarTab === "history" && <HistoryList />}
        {sidebarTab === "saved" && <SavedList />}
        {sidebarTab === "collections" && <CollectionsPanel />}
        {sidebarTab === "monitors" && <MonitorsPanel />}
      </div>
    </aside>
  );
}

function NoMatches() {
  const query = useStore((s) => s.sidebarQuery);
  return (
    <div className="px-3 py-6 text-center text-[11px] text-slate-400">
      No matches for “{query}”.
    </div>
  );
}

function HistoryList() {
  const history = useStore((s) => s.history);
  const loadHistory = useStore((s) => s.loadHistory);
  const clearHistory = useStore((s) => s.clearHistory);
  const setRequest = useStore((s) => s.setRequest);
  const query = useStore((s) => s.sidebarQuery).trim().toLowerCase();
  const filtered = query
    ? history.filter(
        (e) =>
          (e.request.url || "").toLowerCase().includes(query) ||
          e.request.method.toLowerCase().includes(query),
      )
    : history;

  if (!history.length) {
    return (
      <div className="p-4">
        <div className="flex flex-col items-center py-6 text-center">
          <History size={28} strokeWidth={1.3} className="mb-2 text-slate-300 dark:text-slate-600" />
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
            No history yet
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            Try a sample to get started:
          </div>
        </div>
        <div className="space-y-1.5">
          {SAMPLES.map((s) => (
            <button
              key={s.name}
              onClick={() => setRequest(structuredClone(s.request))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-indigo-300 hover:shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:border-indigo-500/40"
            >
              <div className="flex items-center gap-2">
                <span className={cx("font-mono text-[11px] font-bold", methodColor(s.request.method))}>
                  {s.request.method}
                </span>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {s.name}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                {s.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Recent
        </span>
        <button
          onClick={clearHistory}
          className="no-drag text-[11px] text-slate-400 transition hover:text-rose-500"
        >
          Clear
        </button>
      </div>
      {filtered.length === 0 && <NoMatches />}
      {filtered.map((entry) => (
        <button
          key={entry.id}
          onClick={() => loadHistory(entry)}
          className="block w-full border-b border-slate-100 px-3 py-2 text-left transition hover:bg-slate-100 dark:border-white/[0.04] dark:hover:bg-white/[0.03]"
        >
          <div className="flex items-center gap-2">
            <span className={cx("w-9 shrink-0 font-mono text-[11px] font-bold", methodColor(entry.request.method))}>
              {entry.request.method}
            </span>
            <span
              className={cx(
                "font-mono text-[11px] font-semibold",
                entry.status ? statusColor(entry.status) : "text-rose-500",
              )}
            >
              {entry.status ?? "ERR"}
            </span>
            <span className="ml-auto text-[10px] text-slate-400">
              {timeAgo(entry.createdAt)}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {entry.request.url || "(no url)"}
          </div>
        </button>
      ))}
    </div>
  );
}

function SavedList() {
  const saved = useStore((s) => s.saved);
  const loadSaved = useStore((s) => s.loadSaved);
  const removeSaved = useStore((s) => s.removeSaved);
  const query = useStore((s) => s.sidebarQuery).trim().toLowerCase();
  const filtered = query
    ? saved.filter(
        (i) =>
          i.name.toLowerCase().includes(query) ||
          i.request.url.toLowerCase().includes(query) ||
          i.request.method.toLowerCase().includes(query),
      )
    : saved;

  if (!saved.length) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <Star size={28} strokeWidth={1.3} className="mb-2 text-slate-300 dark:text-slate-600" />
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
          No saved requests
        </div>
        <div className="mt-1 max-w-[12rem] text-[11px] text-slate-400 dark:text-slate-500">
          Build a request and hit the save icon to keep it here.
        </div>
      </div>
    );
  }

  return (
    <div>
      {filtered.length === 0 && <NoMatches />}
      {filtered.map((item) => (
        <div
          key={item.id}
          className="group flex items-center border-b border-slate-100 dark:border-white/[0.04]"
        >
          <button
            onClick={() => loadSaved(item)}
            className="min-w-0 flex-1 px-3 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-white/[0.03]"
          >
            <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
              {item.name}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className={cx("font-mono text-[10px] font-bold", methodColor(item.request.method))}>
                {item.request.method}
              </span>
              <span className="truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">
                {item.request.url}
              </span>
            </div>
          </button>
          <IconButton
            onClick={() => removeSaved(item.id)}
            aria-label="Delete"
            className="mr-1 opacity-0 transition group-hover:opacity-100"
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
