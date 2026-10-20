import { useState } from "react";
import { FileCode2, Loader2, Plus, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { Body, BodyMode, MultipartField } from "../lib/types";
import { emptyMultipart } from "../lib/samples";
import { beautifyJson } from "../lib/format";
import { fetchWsdl } from "../lib/api";
import {
  emptyEnvelope,
  parseWsdl,
  switchEnvelopeVersion,
  type SoapVersion,
  type WsdlOperation,
} from "../lib/soap";
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
  { value: "soap", label: "SOAP" },
];

export function BodyEditor() {
  const body = useStore((s) => s.request.body);
  const method = useStore((s) => s.request.method);
  const patch = useStore((s) => s.patch);
  const [beautifyMsg, setBeautifyMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const setBody = (partial: Partial<Body>) =>
    patch({ body: { ...body, ...partial } });

  const selectMode = (m: BodyMode) => {
    if (m === "soap") {
      // Keep an existing envelope; otherwise scaffold a blank one (don't leave a
      // JSON/text body sitting in the XML editor). Nudge the verb to POST.
      const looksLikeEnvelope = /<[\w-]*:?Envelope[\s/>]/.test(body.raw);
      const raw = looksLikeEnvelope ? body.raw : emptyEnvelope(body.soapVersion);
      patch({
        body: { ...body, mode: m, raw },
        method: method === "GET" ? "POST" : method,
      });
    } else {
      setBody({ mode: m });
    }
  };

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
          onChange={selectMode}
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

        {body.mode === "soap" && <SoapEditor body={body} setBody={setBody} />}
      </div>
    </div>
  );
}

const SOAP_VERSIONS: SegOption<SoapVersion>[] = [
  { value: "1.1", label: "SOAP 1.1" },
  { value: "1.2", label: "SOAP 1.2" },
];

function SoapEditor({
  body,
  setBody,
}: {
  body: Body;
  setBody: (partial: Partial<Body>) => void;
}) {
  const patch = useStore((s) => s.patch);
  const [wsdlOpen, setWsdlOpen] = useState(false);

  const setVersion = (v: SoapVersion) =>
    setBody({ soapVersion: v, raw: switchEnvelopeVersion(body.raw, v) });

  const applyOperation = (op: WsdlOperation) => {
    setBody({
      soapVersion: op.version,
      soapAction: op.soapAction,
      raw: op.envelope,
    });
    if (op.endpoint) patch({ url: op.endpoint });
    setWsdlOpen(false);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented options={SOAP_VERSIONS} value={body.soapVersion} onChange={setVersion} />
        <Button
          variant="subtle"
          className="text-xs"
          onClick={() => setWsdlOpen(true)}
          title="Import a WSDL to scaffold the envelope"
        >
          <FileCode2 size={14} /> Import WSDL
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <label className="text-[11px] text-slate-500 dark:text-slate-400">SOAPAction</label>
          <TextInput
            value={body.soapAction}
            onChange={(e) => setBody({ soapAction: e.target.value })}
            placeholder="urn:action"
            className="w-56 py-1 font-mono text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Panel className="h-full overflow-hidden">
          <CodeEditor
            value={body.raw}
            onChange={(v) => setBody({ raw: v })}
            lang="xml"
            placeholder={emptyEnvelope(body.soapVersion)}
          />
        </Panel>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        {body.soapVersion === "1.1"
          ? "Sends Content-Type text/xml with a SOAPAction header."
          : "Sends Content-Type application/soap+xml with the action parameter."}{" "}
        Response faults are detected automatically.
      </p>

      {wsdlOpen && <WsdlImport onClose={() => setWsdlOpen(false)} onPick={applyOperation} />}
    </div>
  );
}

function WsdlImport({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (op: WsdlOperation) => void;
}) {
  const [tab, setTab] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ops, setOps] = useState<WsdlOperation[] | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setOps(null);
    try {
      const xml = tab === "url" ? await fetchWsdl(url.trim()) : text;
      const result = parseWsdl(xml);
      if (result.error) setError(result.error);
      else setOps(result.operations);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#0f131c]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-white/[0.08]">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Import WSDL
          </span>
          <IconButton onClick={onClose} aria-label="Close">
            <X size={15} />
          </IconButton>
        </div>

        <div className="space-y-3 p-4">
          <Segmented
            options={[
              { value: "url", label: "From URL" },
              { value: "paste", label: "Paste XML" },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "url" ? (
            <div className="flex gap-2">
              <TextInput
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load();
                }}
                placeholder="https://example.com/service?wsdl"
                className="flex-1 font-mono text-xs"
              />
              <Button variant="primary" onClick={load} disabled={loading || !url.trim()}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : "Fetch"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the full WSDL XML here…"
                spellCheck={false}
                rows={6}
                className="no-drag w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100"
              />
              <Button variant="primary" onClick={load} disabled={loading || !text.trim()}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : "Parse"}
              </Button>
            </div>
          )}

          {error && <div className="text-xs text-rose-500">{error}</div>}
        </div>

        {ops && (
          <div className="min-h-0 flex-1 overflow-auto border-t border-slate-200 dark:border-white/[0.08]">
            <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {ops.length} operation{ops.length === 1 ? "" : "s"}
            </div>
            {ops.map((op, i) => (
              <button
                key={`${op.name}-${i}`}
                onClick={() => onPick(op)}
                className="no-drag flex w-full items-center gap-3 border-t border-slate-100 px-4 py-2 text-left transition hover:bg-slate-50 dark:border-white/[0.05] dark:hover:bg-white/[0.03]"
              >
                <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {op.name}
                </span>
                <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-500 dark:bg-white/10 dark:text-slate-400">
                  {op.version}
                </span>
                {op.soapAction && (
                  <span className="truncate font-mono text-[10px] text-slate-400">
                    {op.soapAction}
                  </span>
                )}
              </button>
            ))}
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
