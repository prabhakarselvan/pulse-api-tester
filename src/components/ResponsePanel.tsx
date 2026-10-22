import { useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Radio } from "lucide-react";
import { useStore, type ResponseTab, type BodyView } from "../store";
import type { HttpResponse, KeyValue } from "../lib/types";
import { parseSoapFault, type SoapFault } from "../lib/soap";
import {
  detectLang,
  formatBytes,
  formatMs,
  isImageType,
  maybePretty,
  statusColor,
} from "../lib/format";
import { CodeEditor } from "./CodeEditor";
import { NetworkPanel } from "./NetworkPanel";
import { FlowPanel } from "./FlowPanel";
import { WirePanel } from "./WirePanel";
import { DiffPanel } from "./DiffPanel";
import { JsonTree } from "./JsonTree";
import { SecurityPanel } from "./SecurityPanel";
import { ProfilePanel } from "./ProfilePanel";
import { TestsPanel } from "./TestsPanel";
import {
  EmptyState,
  IconButton,
  Panel,
  Segmented,
  type SegOption,
} from "./ui";

export function ResponsePanel() {
  const response = useStore((s) => s.response);
  const error = useStore((s) => s.error);
  const loading = useStore((s) => s.loading);
  const responseTab = useStore((s) => s.responseTab);
  const setResponseTab = useStore((s) => s.setResponseTab);
  const testResults = useStore((s) => s.testResults);
  const diffArmed = useStore((s) => s.diffBaseline != null);

  const cookieCount = response
    ? response.headers.filter((h) => h.key.toLowerCase() === "set-cookie").length
    : 0;

  const tabs: SegOption<ResponseTab>[] = [
    { value: "body", label: "Body" },
    { value: "headers", label: "Headers", badge: response?.headers.length || undefined },
    { value: "cookies", label: "Cookies", badge: cookieCount || undefined },
    { value: "network", label: "Network" },
    { value: "flow", label: "Flow" },
    { value: "wire", label: "Wire" },
    { value: "diff", label: "Diff", badge: diffArmed ? "A" : undefined },
    { value: "security", label: "Security" },
    { value: "profile", label: "Profile" },
    {
      value: "tests",
      label: "Tests",
      badge: testResults.length
        ? `${testResults.filter((t) => t.passed).length}/${testResults.length}`
        : undefined,
    },
  ];

  const content = () => {
    // Profiler + tests work even before/without a response (e.g. show logs).
    if (responseTab === "profile") return <ProfilePanel />;
    if (responseTab === "tests") return <TestsPanel />;
    if (responseTab === "diff") return <DiffPanel />;
    if (loading) return <LoadingState />;
    if (error) return <ErrorState error={error} />;
    if (!response)
      return (
        <EmptyState
          icon={<Radio size={40} strokeWidth={1.3} />}
          title="No response yet"
          subtitle="Enter a URL and hit Send (⌘↵) to see the response and the full network timeline."
        />
      );
    switch (responseTab) {
      case "body":
        return <ResponseBody res={response} />;
      case "headers":
        return <HeaderTable items={response.headers} />;
      case "cookies":
        return <CookieTable headers={response.headers} />;
      case "network":
        return <NetworkPanel res={response} />;
      case "flow":
        return <FlowPanel res={response} />;
      case "wire":
        return <WirePanel res={response} />;
      case "security":
        return <SecurityPanel res={response} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {response && <StatusBar res={response} />}
      <div className="overflow-x-auto px-3 py-2">
        <Segmented options={tabs} value={responseTab} onChange={setResponseTab} />
      </div>
      <div className="min-h-0 flex-1 fade-in">{content()}</div>
    </div>
  );
}

function StatusBar({ res }: { res: HttpResponse }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(res.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be unavailable */
    }
  };
  return (
    <div className="flex items-center gap-4 border-b border-slate-200 px-4 py-2 dark:border-white/[0.08]">
      <span className={`font-mono text-sm font-bold ${statusColor(res.status)}`}>
        {res.status} {res.statusText}
      </span>
      <Metric label="time" value={formatMs(res.timings.totalMs)} />
      <Metric label="size" value={formatBytes(res.bodySizeBytes)} />
      {res.contentType && (
        <span className="truncate text-xs text-slate-400 dark:text-slate-500">
          {res.contentType.split(";")[0]}
        </span>
      )}
      <div className="ml-auto">
        <IconButton onClick={copy} aria-label="Copy body">
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </IconButton>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-slate-500 dark:text-slate-400">
      {label} <span className="font-mono text-slate-700 dark:text-slate-200">{value}</span>
    </span>
  );
}

function ResponseBody({ res }: { res: HttpResponse }) {
  const bodyView = useStore((s) => s.bodyView);
  const setBodyView = useStore((s) => s.setBodyView);
  const lang = detectLang(res.contentType);
  const isImage = isImageType(res.contentType);

  const views: SegOption<BodyView>[] = [
    { value: "pretty", label: "Pretty" },
    { value: "raw", label: "Raw" },
    { value: "preview", label: "Preview" },
  ];
  if (lang === "json") views.splice(1, 0, { value: "tree", label: "Tree" });

  const empty = !res.body && !res.bodyBase64;
  const fault = useMemo(() => parseSoapFault(res.body), [res.body]);
  // If "tree" was selected on a prior JSON response but this one isn't JSON, fall back.
  const effectiveView: BodyView = bodyView === "tree" && lang !== "json" ? "pretty" : bodyView;

  return (
    <div className="flex h-full flex-col gap-2 px-3 pb-3">
      {fault && <SoapFaultBanner fault={fault} />}
      <Segmented options={views} value={effectiveView} onChange={setBodyView} />
      <div className="min-h-0 flex-1">
        {empty ? (
          <EmptyState title="Empty body" subtitle="The response had no body." />
        ) : effectiveView === "tree" ? (
          <JsonTree text={res.body} />
        ) : effectiveView === "preview" ? (
          <Preview res={res} isImage={isImage} lang={lang} />
        ) : (
          <Panel className="h-full overflow-hidden">
            <CodeEditor
              readOnly
              value={effectiveView === "pretty" ? maybePretty(res.body, lang) : res.body}
              lang={effectiveView === "pretty" ? lang : "text"}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}

function SoapFaultBanner({ fault }: { fault: SoapFault }) {
  return (
    <div className="rounded-lg border border-rose-300/60 bg-rose-50 px-3 py-2 dark:border-rose-500/30 dark:bg-rose-500/10">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="shrink-0 text-rose-500" />
        <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">
          SOAP {fault.version} Fault
        </span>
        {fault.code && (
          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-600 dark:text-rose-300">
            {fault.code}
          </span>
        )}
      </div>
      {fault.message && (
        <p className="mt-1 break-words font-mono text-[11px] text-rose-700/90 dark:text-rose-200/90">
          {fault.message}
        </p>
      )}
      {fault.detail && (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-rose-600/70 dark:text-rose-300/60">
          {fault.detail.slice(0, 600)}
        </pre>
      )}
    </div>
  );
}

function Preview({
  res,
  isImage,
  lang,
}: {
  res: HttpResponse;
  isImage: boolean;
  lang: ReturnType<typeof detectLang>;
}) {
  if (isImage && res.bodyBase64) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto rounded-xl border border-slate-200 bg-[repeating-conic-gradient(#0000_0_25%,#8882_0_50%)] bg-[length:16px_16px] p-4 dark:border-white/[0.08]">
        <img
          src={`data:${res.contentType ?? "image/png"};base64,${res.bodyBase64}`}
          alt="response preview"
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  if (lang === "html") {
    return (
      <iframe
        title="HTML preview"
        sandbox=""
        srcDoc={res.body}
        className="h-full w-full rounded-xl border border-slate-200 bg-white dark:border-white/[0.08]"
      />
    );
  }
  return (
    <Panel className="h-full overflow-hidden">
      <CodeEditor readOnly value={maybePretty(res.body, lang)} lang={lang} />
    </Panel>
  );
}

function HeaderTable({ items }: { items: KeyValue[] }) {
  if (!items.length)
    return <EmptyState title="No headers" subtitle="The response had no headers." />;
  return (
    <div className="h-full overflow-auto px-3 pb-3">
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-white/[0.07]">
        {items.map((h, i) => (
          <div
            key={i}
            className="flex gap-3 border-b border-slate-100 px-3 py-1.5 text-xs last:border-0 dark:border-white/[0.05]"
          >
            <span className="w-56 shrink-0 break-all font-mono font-medium text-slate-600 dark:text-slate-300">
              {h.key}
            </span>
            <span className="flex-1 break-all font-mono text-slate-700 dark:text-slate-200">
              {h.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ParsedCookie {
  name: string;
  value: string;
  attrs: string;
}

function parseCookies(headers: KeyValue[]): ParsedCookie[] {
  return headers
    .filter((h) => h.key.toLowerCase() === "set-cookie")
    .map((h) => {
      const parts = h.value.split(";");
      const [name, ...rest] = parts[0].split("=");
      return {
        name: name.trim(),
        value: rest.join("=").trim(),
        attrs: parts.slice(1).map((p) => p.trim()).join(" · "),
      };
    });
}

function CookieTable({ headers }: { headers: KeyValue[] }) {
  const cookies = parseCookies(headers);
  if (!cookies.length)
    return (
      <EmptyState title="No cookies" subtitle="No Set-Cookie headers in the response." />
    );
  return (
    <div className="h-full overflow-auto px-3 pb-3">
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-white/[0.07]">
        {cookies.map((c, i) => (
          <div
            key={i}
            className="border-b border-slate-100 px-3 py-2 text-xs last:border-0 dark:border-white/[0.05]"
          >
            <div className="flex gap-2">
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                {c.name}
              </span>
              <span className="break-all font-mono text-slate-500 dark:text-slate-400">
                = {c.value}
              </span>
            </div>
            {c.attrs && (
              <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                {c.attrs}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full flex-col">
      <div className="h-0.5 w-full overflow-hidden bg-slate-100 dark:bg-white/[0.06]">
        <div className="sweep h-full w-1/4 bg-indigo-500" />
      </div>
      <EmptyState
        icon={<Radio size={40} strokeWidth={1.3} className="animate-pulse" />}
        title="Sending request…"
        subtitle="Resolving DNS, connecting, and measuring every phase."
      />
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <EmptyState
      icon={<AlertTriangle size={40} strokeWidth={1.3} className="text-rose-400" />}
      title="Request failed"
      subtitle={error}
    />
  );
}
