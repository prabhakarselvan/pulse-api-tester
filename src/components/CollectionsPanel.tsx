import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Play,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore, type ImportSummary } from "../store";
import { readTextFile, fetchText } from "../lib/api";
import type { Collection, CollectionItem } from "../lib/types";
import { methodColor } from "../lib/format";
import { Button, EmptyState, IconButton, Panel, Segmented, Spinner, cx } from "./ui";

function itemMatches(item: CollectionItem, q: string): boolean {
  if (item.kind === "request") {
    return (
      item.name.toLowerCase().includes(q) ||
      (item.request?.url ?? "").toLowerCase().includes(q) ||
      (item.request?.method ?? "").toLowerCase().includes(q)
    );
  }
  return item.name.toLowerCase().includes(q) || filterItems(item.children ?? [], q).length > 0;
}

function filterItems(items: CollectionItem[], q: string): CollectionItem[] {
  if (!q) return items;
  const out: CollectionItem[] = [];
  for (const it of items) {
    if (it.kind === "request") {
      if (itemMatches(it, q)) out.push(it);
    } else {
      const kids = filterItems(it.children ?? [], q);
      if (kids.length) out.push({ ...it, children: kids });
      else if (it.name.toLowerCase().includes(q)) out.push(it); // folder name hit → keep subtree
    }
  }
  return out;
}

export function CollectionsPanel() {
  const collections = useStore((s) => s.collections);
  const upsertCollection = useStore((s) => s.upsertCollection);
  const query = useStore((s) => s.sidebarQuery).trim().toLowerCase();
  const [importOpen, setImportOpen] = useState(false);

  const shown = query
    ? collections
        .map((c) => ({ ...c, items: filterItems(c.items, query) }))
        .filter((c) => c.items.length > 0 || c.name.toLowerCase().includes(query))
    : collections;

  const newCollection = () =>
    upsertCollection({ id: "", name: "New collection", items: [], createdAt: 0, updatedAt: 0 });

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Collections
        </span>
        <div className="flex items-center">
          <IconButton onClick={newCollection} title="New collection">
            <FolderPlus size={15} />
          </IconButton>
          <IconButton onClick={() => setImportOpen(true)} title="Import from Postman">
            <Upload size={15} />
          </IconButton>
        </div>
      </div>

      {collections.length === 0 ? (
        <div className="px-3">
          <EmptyState
            icon={<Folder size={28} strokeWidth={1.3} />}
            title="No collections"
            subtitle="Create one, or import your Postman collections."
          >
            <Button variant="primary" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import from Postman
            </Button>
          </EmptyState>
        </div>
      ) : shown.length === 0 ? (
        <div className="px-3 py-6 text-center text-[11px] text-slate-400">
          No matches for “{query}”.
        </div>
      ) : (
        shown.map((c) => <CollectionRow key={c.id} collection={c} forceOpen={!!query} />)
      )}

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function countRequests(items: CollectionItem[]): number {
  let n = 0;
  for (const it of items) n += it.kind === "request" ? 1 : countRequests(it.children ?? []);
  return n;
}

function CollectionRow({
  collection,
  forceOpen,
}: {
  collection: Collection;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
  const [adding, setAdding] = useState(false);
  const removeCollection = useStore((s) => s.removeCollection);
  const addToCollection = useStore((s) => s.addToCollection);
  const runCollection = useStore((s) => s.runCollection);

  // Guard against a double-click lost update (serialize read-modify-write).
  const add = async () => {
    setAdding(true);
    try {
      await addToCollection(collection.id, `${useStore.getState().request.method} request`);
      setOpen(true);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="border-b border-slate-100 dark:border-white/[0.04]">
      <div className="group flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-white/[0.03]"
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} className="shrink-0 text-indigo-400" />
          <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
            {collection.name}
          </span>
          <span className="ml-1 shrink-0 text-[10px] text-slate-400">
            {countRequests(collection.items)}
          </span>
        </button>
        <IconButton
          onClick={() => runCollection(collection.id)}
          title="Run collection (chained)"
          className="opacity-0 group-hover:opacity-100"
        >
          <Play size={13} />
        </IconButton>
        <IconButton
          onClick={add}
          disabled={adding}
          title="Add current request"
          className="opacity-0 group-hover:opacity-100"
        >
          <Plus size={13} />
        </IconButton>
        <IconButton
          onClick={() => removeCollection(collection.id)}
          title="Delete collection"
          className="mr-1 opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
      {isOpen && (
        <div className="pb-1">
          {collection.items.length === 0 ? (
            <div className="px-8 py-1.5 text-[11px] text-slate-400">Empty</div>
          ) : (
            collection.items.map((it) => (
              <ItemRow key={it.id} item={it} depth={1} forceOpen={forceOpen} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  depth,
  forceOpen,
}: {
  item: CollectionItem;
  depth: number;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
  const loadRequest = useStore((s) => s.loadRequest);
  const pad = { paddingLeft: `${depth * 14 + 12}px` };

  if (item.kind === "folder") {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="flex w-full items-center gap-1.5 py-1.5 pr-2 text-left transition hover:bg-slate-100 dark:hover:bg-white/[0.03]"
        >
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={13} className="shrink-0 text-slate-400" />
          <span className="truncate text-xs text-slate-600 dark:text-slate-300">{item.name}</span>
          <span className="ml-1 text-[10px] text-slate-400">{countRequests(item.children ?? [])}</span>
        </button>
        {isOpen &&
          (item.children ?? []).map((child) => (
            <ItemRow key={child.id} item={child} depth={depth + 1} forceOpen={forceOpen} />
          ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => item.request && loadRequest(item.request, item.name)}
      style={pad}
      className="flex w-full items-center gap-2 py-1.5 pr-2 text-left transition hover:bg-slate-100 dark:hover:bg-white/[0.03]"
      title={item.request?.url}
    >
      <span className={cx("w-9 shrink-0 font-mono text-[10px] font-bold", methodColor(item.request?.method ?? "GET"))}>
        {item.request?.method ?? "GET"}
      </span>
      <span className="truncate text-xs text-slate-600 dark:text-slate-300">{item.name}</span>
    </button>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const importPostman = useStore((s) => s.importPostman);
  const importOpenApi = useStore((s) => s.importOpenApi);
  const [source, setSource] = useState<"postman" | "openapi">("postman");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const runPostman = async (texts: string[]) => {
    setBusy(true);
    setErr(null);
    try {
      setSummary(await importPostman(texts));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runOpenApi = async (texts: string[], hint?: string) => {
    setBusy(true);
    setErr(null);
    try {
      setSummary(await importOpenApi(texts, hint));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseFiles = async () => {
    try {
      const filters =
        source === "postman"
          ? [{ name: "Postman JSON", extensions: ["json"] }]
          : [{ name: "OpenAPI / Swagger", extensions: ["json", "yaml", "yml"] }];
      const sel = await open({ multiple: true, filters });
      if (!sel) return;
      const paths = Array.isArray(sel) ? sel : [sel];
      const texts: string[] = [];
      for (const p of paths) texts.push(await readTextFile(p));
      if (source === "postman") await runPostman(texts);
      else await runOpenApi(texts);
    } catch (e) {
      setErr(String(e));
    }
  };

  const fetchSpec = async () => {
    setBusy(true);
    setErr(null);
    try {
      const spec = await fetchText(url.trim());
      setSummary(await importOpenApi([spec], url.trim()));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const isPostman = source === "postman";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <Panel className="w-[34rem] max-w-[90vw] p-4 shadow-2xl">
        <div onClick={(e) => e.stopPropagation()} className="space-y-3">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Import a collection
          </div>

          {summary ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
                Imported <b>{summary.collections}</b> collection(s), <b>{summary.requests}</b>{" "}
                request(s)
                {summary.environments > 0 && (
                  <>
                    {" "}
                    and <b>{summary.environments}</b> environment(s)
                  </>
                )}
                .
              </div>
              <div className="flex justify-end">
                <Button variant="primary" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Segmented
                options={[
                  { value: "postman", label: "Postman" },
                  { value: "openapi", label: "OpenAPI / Swagger" },
                ]}
                value={source}
                onChange={(s) => {
                  setSource(s);
                  setErr(null);
                }}
              />

              {!isPostman && (
                <div className="flex gap-2">
                  <input
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setErr(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && url.trim()) fetchSpec();
                    }}
                    placeholder="https://api.example.com/openapi.json"
                    spellCheck={false}
                    className="no-drag min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100"
                  />
                  <Button variant="primary" onClick={fetchSpec} disabled={busy || !url.trim()}>
                    {busy ? <Spinner className="h-4 w-4" /> : "Fetch"}
                  </Button>
                </div>
              )}

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isPostman
                  ? "Select your exported Postman collection / environment file(s) — v2.0 or v2.1. You can pick multiple."
                  : "Load an OpenAPI 3.x or Swagger 2.0 spec (JSON or YAML) — by URL above, a file, or pasted below."}
              </p>
              <Button variant="subtle" onClick={chooseFiles} disabled={busy} className="w-full">
                {busy ? <Spinner className="h-4 w-4" /> : <Upload size={15} />} Choose file(s)…
              </Button>

              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <div className="h-px flex-1 bg-slate-200 dark:bg-white/[0.08]" />
                or paste {isPostman ? "JSON" : "JSON / YAML"}
                <div className="h-px flex-1 bg-slate-200 dark:bg-white/[0.08]" />
              </div>

              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setErr(null);
                }}
                placeholder={
                  isPostman
                    ? '{ "info": { "name": "My API" }, "item": [ … ] }'
                    : 'openapi: "3.0.0"\ninfo:\n  title: My API\npaths: …'
                }
                className="no-drag h-32 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs text-slate-800 outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100"
                spellCheck={false}
              />
              {err && <div className="text-xs text-rose-500">{err}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => (isPostman ? runPostman([text]) : runOpenApi([text]))}
                  disabled={busy || !text.trim()}
                >
                  Import {isPostman ? "JSON" : "spec"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
