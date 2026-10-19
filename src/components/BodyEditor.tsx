import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { Body, BodyMode, MultipartField } from "../lib/types";
import { emptyMultipart } from "../lib/samples";
import { beautifyJson } from "../lib/format";
import { CodeEditor } from "./CodeEditor";
import {
  Button,
  EmptyState,
  IconButton,
  KeyValueEditor,
  Panel,
  Segmented,
  Select,
  TextInput,
  cx,
  type SegOption,
} from "./ui";

const MODE_OPTIONS: SegOption<BodyMode>[] = [
  { value: "none", label: "None" },
  { value: "json", label: "JSON" },
  { value: "text", label: "Text" },
  { value: "form", label: "Form" },
  { value: "multipart", label: "Multipart" },
  { value: "binary", label: "Binary" },
  { value: "graphql", label: "GraphQL" },
];

export function BodyEditor() {
  const body = useStore((s) => s.request.body);
  const patch = useStore((s) => s.patch);
  const [beautifyMsg, setBeautifyMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const setBody = (partial: Partial<Body>) =>
    patch({ body: { ...body, ...partial } });

  const beautify = () => {
    if (body.mode === "graphql") {
      const r = beautifyJson(body.graphqlVariables);
      if (r.ok) setBody({ graphqlVariables: r.text });
      setBeautifyMsg(
        r.ok
          ? { text: "Variables formatted", ok: true }
          : { text: "Variables aren't valid JSON", ok: false },
      );
    } else {
      const r = beautifyJson(body.raw);
      if (r.ok) setBody({ raw: r.text });
      setBeautifyMsg(r.ok ? { text: "Formatted", ok: true } : { text: "Invalid JSON", ok: false });
    }
    setTimeout(() => setBeautifyMsg(null), 1600);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <Segmented
          options={MODE_OPTIONS}
          value={body.mode}
          onChange={(m) => setBody({ mode: m })}
        />
        {(body.mode === "json" || body.mode === "graphql") && (
          <div className="flex items-center gap-2">
            {beautifyMsg && (
              <span
                className={cx(
                  "text-[11px]",
                  beautifyMsg.ok ? "text-emerald-500" : "text-rose-500",
                )}
              >
                {beautifyMsg.text}
              </span>
            )}
            <Button variant="ghost" className="text-xs" onClick={beautify}>
              Beautify
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {body.mode === "none" && (
          <EmptyState
            title="No body"
            subtitle="This request will be sent without a body."
          />
        )}

        {(body.mode === "json" || body.mode === "text") && (
          <Panel className="h-full overflow-hidden">
            <CodeEditor
              value={body.raw}
              onChange={(v) => setBody({ raw: v })}
              lang={body.mode === "json" ? "json" : "text"}
              placeholder={
                body.mode === "json" ? '{\n  "key": "value"\n}' : "Raw body…"
              }
            />
          </Panel>
        )}

        {body.mode === "form" && (
          <KeyValueEditor
            items={body.form}
            onChange={(form) => setBody({ form })}
            keyPlaceholder="field"
            valuePlaceholder="value"
          />
        )}

        {body.mode === "multipart" && (
          <MultipartEditor
            items={body.multipart}
            onChange={(multipart) => setBody({ multipart })}
          />
        )}

        {body.mode === "binary" && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Absolute file path
            </label>
            <TextInput
              value={body.binaryPath}
              placeholder="/Users/you/path/to/file.bin"
              onChange={(e) => setBody({ binaryPath: e.target.value })}
            />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              The file is read and sent as the raw request body.
            </p>
          </div>
        )}

        {body.mode === "graphql" && (
          <div className="flex h-full flex-col gap-3">
            <div className="min-h-0 flex-1">
              <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                Query
              </div>
              <Panel className="h-[calc(100%-1.5rem)] overflow-hidden">
                <CodeEditor
                  value={body.raw}
                  onChange={(v) => setBody({ raw: v })}
                  lang="javascript"
                  placeholder={"query {\n  viewer { login }\n}"}
                />
              </Panel>
            </div>
            <div className="h-40 shrink-0">
              <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                Variables (JSON)
              </div>
              <Panel className="h-[calc(100%-1.5rem)] overflow-hidden">
                <CodeEditor
                  value={body.graphqlVariables}
                  onChange={(v) => setBody({ graphqlVariables: v })}
                  lang="json"
                  placeholder={"{}"}
                />
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MultipartEditor({
  items,
  onChange,
}: {
  items: MultipartField[];
  onChange: (items: MultipartField[]) => void;
}) {
  const rows = [...items, emptyMultipart()];

  const update = (index: number, partial: Partial<MultipartField>) => {
    // Promote the trailing blank row on edit; update existing rows in place
    // (no mid-edit pruning) so positions and input focus stay stable.
    if (index === items.length) {
      onChange([...items, { ...emptyMultipart(), ...partial }]);
    } else {
      onChange(items.map((r, i) => (i === index ? { ...r, ...partial } : r)));
    }
  };
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

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
              placeholder="field"
              onChange={(e) => update(i, { key: e.target.value })}
              className="no-drag min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-xs text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-600"
            />
            <Select
              value={row.kind}
              onChange={(e) =>
                update(i, { kind: e.target.value as "text" | "file" })
              }
              className="py-1 text-xs"
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </Select>
            <input
              value={row.value}
              placeholder={row.kind === "file" ? "/path/to/file" : "value"}
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
