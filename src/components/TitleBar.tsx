import { Activity, Moon, PanelBottom, PanelRight, Sun } from "lucide-react";
import { useStore } from "../store";
import { IconButton } from "./ui";
import { EnvControl } from "./EnvManager";

export function TitleBar() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const layout = useStore((s) => s.layout);
  const toggleLayout = useStore((s) => s.toggleLayout);

  return (
    <header
      data-tauri-drag-region
      className="drag-region flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/80 pl-20 pr-3 backdrop-blur dark:border-white/[0.08] dark:bg-[#0b0e14]/80"
    >
      <Activity size={16} className="text-indigo-500" />
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        Pulse
      </span>
      <span className="text-xs text-slate-400 dark:text-slate-500">API Tester</span>

      <div className="no-drag ml-auto flex items-center gap-2">
        <EnvControl />
        <IconButton
          onClick={toggleLayout}
          title={layout === "horizontal" ? "Move response to the bottom" : "Move response to the right"}
          aria-label="Toggle layout"
        >
          {layout === "horizontal" ? <PanelBottom size={15} /> : <PanelRight size={15} />}
        </IconButton>
        <IconButton onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
      </div>
    </header>
  );
}
