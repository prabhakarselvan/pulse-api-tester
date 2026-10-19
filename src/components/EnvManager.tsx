import { useState } from "react";
import { Check, Layers, Plus, Trash2 } from "lucide-react";
import { useStore } from "../store";
import * as api from "../lib/api";
import type { SavedEnvironment } from "../lib/types";
import {
  Button,
  EmptyState,
  IconButton,
  KeyValueEditor,
  Panel,
  TextInput,
  cx,
} from "./ui";

const blankEnv = (): SavedEnvironment => ({
  id: "",
  name: "New environment",
  variables: [],
  createdAt: 0,
  updatedAt: 0,
});

/** Title-bar control: pick the active environment or open the manager. */
export function EnvControl() {
  const envs = useStore((s) => s.envs);
  const activeEnvId = useStore((s) => s.activeEnvId);
  const setActiveEnvId = useStore((s) => s.setActiveEnvId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const active = envs.find((e) => e.id === activeEnvId);

  return (
    <div className="relative no-drag">
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.07]"
        title="Environment"
      >
        <Layers size={13} className={active ? "text-indigo-400" : "text-slate-400"} />
        {active ? active.name : "No environment"}
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#141925]">
            <MenuItem
              active={!activeEnvId}
              label="No environment"
              onClick={() => {
                setActiveEnvId(null);
                setMenuOpen(false);
              }}
            />
            {envs.map((e) => (
              <MenuItem
                key={e.id}
                active={e.id === activeEnvId}
                label={e.name}
                onClick={() => {
                  setActiveEnvId(e.id);
                  setMenuOpen(false);
                }}
              />
            ))}
            <div className="my-1 border-t border-slate-100 dark:border-white/[0.06]" />
            <button
              onClick={() => {
                setManagerOpen(true);
                setMenuOpen(false);
              }}
              className="w-full rounded-md px-3 py-1.5 text-left text-xs text-indigo-500 transition hover:bg-slate-100 dark:hover:bg-white/[0.06]"
            >
              Manage environments…
            </button>
          </div>
        </>
      )}
      {managerOpen && <EnvManagerModal onClose={() => setManagerOpen(false)} />}
    </div>
  );
}

function MenuItem({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.06]"
    >
      {label}
      {active && <Check size={13} className="text-indigo-500" />}
    </button>
  );
}

function EnvManagerModal({ onClose }: { onClose: () => void }) {
  const envs = useStore((s) => s.envs);
  const removeEnv = useStore((s) => s.removeEnv);
  const refreshEnvs = useStore((s) => s.refreshEnvs);
  const [editing, setEditing] = useState<SavedEnvironment | null>(envs[0] ?? null);

  const save = async () => {
    if (!editing) return;
    const saved = await api.saveEnv(editing);
    await refreshEnvs();
    setEditing(saved);
  };

  const del = async () => {
    if (!editing?.id) {
      setEditing(null);
      return;
    }
    await removeEnv(editing.id);
    setEditing(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <Panel className="flex h-[28rem] w-[44rem] max-w-[92vw] overflow-hidden p-0 shadow-2xl">
        <div onClick={(e) => e.stopPropagation()} className="flex w-full">
          {/* list */}
          <aside className="flex w-48 shrink-0 flex-col border-r border-slate-200 dark:border-white/[0.08]">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Environments
              </span>
              <IconButton onClick={() => setEditing(blankEnv())} title="New environment">
                <Plus size={15} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {envs.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEditing(structuredClone(e))}
                  className={cx(
                    "block w-full truncate px-3 py-2 text-left text-xs transition",
                    editing?.id === e.id
                      ? "bg-indigo-500/10 text-indigo-500"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.04]",
                  )}
                >
                  {e.name}
                </button>
              ))}
              {envs.length === 0 && (
                <div className="px-3 py-4 text-[11px] text-slate-400">No environments yet.</div>
              )}
            </div>
          </aside>

          {/* editor */}
          <main className="flex min-w-0 flex-1 flex-col p-4">
            {editing ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {editing.id ? "Edit environment" : "New environment"}
                  </span>
                  <IconButton onClick={del} title="Delete environment">
                    <Trash2 size={14} />
                  </IconButton>
                </div>
                <TextInput
                  value={editing.name}
                  placeholder="Environment name"
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Variables — reference as{" "}
                  <code className="rounded bg-slate-100 px-1 dark:bg-white/[0.06]">{"{{key}}"}</code>{" "}
                  in URL, headers, body or auth.
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <KeyValueEditor
                    items={editing.variables}
                    onChange={(variables) => setEditing({ ...editing, variables })}
                    keyPlaceholder="base_url"
                    valuePlaceholder="https://api.example.com"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={onClose}>
                    Close
                  </Button>
                  <Button variant="primary" onClick={save}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Layers size={32} strokeWidth={1.3} />}
                title="No environment selected"
                subtitle="Create one, or pick an environment from the left."
              >
                <Button variant="primary" onClick={() => setEditing(blankEnv())}>
                  <Plus size={14} /> New environment
                </Button>
              </EmptyState>
            )}
          </main>
        </div>
      </Panel>
    </div>
  );
}
