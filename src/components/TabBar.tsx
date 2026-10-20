import { Plus, X } from "lucide-react";
import { useStore } from "../store";
import type { HttpRequest } from "../lib/types";
import { methodColor } from "../lib/format";
import { Spinner, cx } from "./ui";

function tabLabel(req: HttpRequest): string {
  const url = req.url.trim();
  if (!url) return "New Request";
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    const path = u.pathname === "/" ? "" : u.pathname;
    return u.host + path;
  } catch {
    return url;
  }
}

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const activeRequest = useStore((s) => s.request); // live state of the active tab
  const activeLoading = useStore((s) => s.loading);
  const activeName = useStore((s) => s.requestName);
  const switchTab = useStore((s) => s.switchTab);
  const closeTab = useStore((s) => s.closeTab);
  const newTab = useStore((s) => s.newTab);

  return (
    <div className="flex items-stretch gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-1.5 dark:border-white/[0.08] dark:bg-[#0b0e14]">
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        const req = active ? activeRequest : t.request;
        const loading = active ? activeLoading : t.loading;
        const name = active ? activeName : t.name;
        const label = name && name.trim() ? name : tabLabel(req);
        return (
          <div
            key={t.id}
            onClick={() => switchTab(t.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(t.id);
              }
            }}
            title={req.url || "New request"}
            className={cx(
              "group flex min-w-[8rem] max-w-[14rem] shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border-b-2 px-3 py-1.5 text-xs transition",
              active
                ? "border-indigo-500 bg-white text-slate-800 dark:bg-[#0f131c] dark:text-slate-100"
                : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.03]",
            )}
          >
            <span className={cx("shrink-0 font-mono text-[10px] font-bold", methodColor(req.method))}>
              {req.method}
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {loading ? (
              <Spinner className="h-3 w-3 shrink-0 text-indigo-500" />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                aria-label="Close tab"
                className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-slate-200"
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={newTab}
        title="New tab"
        aria-label="New tab"
        className="shrink-0 self-center rounded-md px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.04] dark:hover:text-slate-200"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
