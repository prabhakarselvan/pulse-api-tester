import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { RequestPanel } from "./components/RequestPanel";
import { ResponsePanel } from "./components/ResponsePanel";
import { TabBar } from "./components/TabBar";
import { cx } from "./components/ui";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function lsNum(key: string, fallback: number): number {
  try {
    const v = parseFloat(localStorage.getItem(key) ?? "");
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const layout = useStore((s) => s.layout);
  const init = useStore((s) => s.init);

  const [sidebarW, setSidebarW] = useState(() => lsNum("pulse.sidebarW", 256));
  const [split, setSplit] = useState(() => lsNum("pulse.split", 44));
  const rowRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | "sidebar" | "split">(null);
  const vertical = layout === "vertical";

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const s = useStore.getState();
      if (e.key === "Enter") {
        e.preventDefault();
        s.send();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "t") {
        e.preventDefault();
        s.newTab();
        return;
      }
      if (k === "w") {
        e.preventDefault();
        s.closeTab(s.activeTabId);
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (s.tabs[idx]) {
          e.preventDefault();
          s.switchTab(s.tabs[idx].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    localStorage.setItem("pulse.sidebarW", String(Math.round(sidebarW)));
  }, [sidebarW]);
  useEffect(() => {
    localStorage.setItem("pulse.split", String(Math.round(split)));
  }, [split]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (drag.current === "sidebar" && rowRef.current) {
        const rect = rowRef.current.getBoundingClientRect();
        setSidebarW(clamp(e.clientX - rect.left, 190, 520));
      } else if (drag.current === "split" && mainRef.current) {
        const rect = mainRef.current.getBoundingClientRect();
        const pct = vertical
          ? ((e.clientY - rect.top) / rect.height) * 100
          : ((e.clientX - rect.left) / rect.width) * 100;
        setSplit(clamp(pct, 20, 80));
      }
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [vertical]);

  const startDrag = (which: "sidebar" | "split") => (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = which;
    document.body.style.cursor =
      which === "sidebar" ? "col-resize" : vertical ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0b0e14] dark:text-slate-100">
      <TitleBar />
      <div ref={rowRef} className="flex min-h-0 flex-1">
        {/* Resizable sidebar */}
        <div style={{ width: sidebarW }} className="h-full shrink-0">
          <Sidebar />
        </div>
        <div
          onMouseDown={startDrag("sidebar")}
          className="w-1 shrink-0 cursor-col-resize bg-transparent transition hover:bg-indigo-400/40"
        />

        {/* Main column: tab bar + request/response */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabBar />
          <div
            ref={mainRef}
            className={cx("flex min-h-0 min-w-0 flex-1", vertical ? "flex-col" : "flex-row")}
          >
          <div
            style={{ flexBasis: `${split}%` }}
            className={cx(
              "min-h-0 min-w-0 shrink-0 grow-0 overflow-hidden border-slate-200 dark:border-white/[0.08]",
              vertical ? "border-b" : "border-r",
            )}
          >
            <RequestPanel />
          </div>
          <div
            onMouseDown={startDrag("split")}
            className={cx(
              "shrink-0 bg-transparent transition hover:bg-indigo-400/40",
              vertical ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize",
            )}
          />
          <div className="min-h-0 min-w-0 flex-1">
            <ResponsePanel />
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
