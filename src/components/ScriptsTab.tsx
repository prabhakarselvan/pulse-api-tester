import { useState } from "react";
import { useStore } from "../store";
import { CodeEditor } from "./CodeEditor";
import { Button, Panel, Segmented, type SegOption } from "./ui";

type Which = "pre" | "post";

const SNIPPETS_PRE = [
  { label: "Set variable", code: `pm.environment.set("token", "abc123");` },
  { label: "Add header", code: `pm.request.setHeader("X-Request-Time", String(Date.now()));` },
  { label: "Timestamp var", code: `pm.environment.set("now", String(Date.now()));` },
];

const SNIPPETS_POST = [
  {
    label: "Status is 200",
    code: `pm.test("Status is 200", function () {\n  pm.expect(pm.response.code).to.equal(200);\n});`,
  },
  {
    label: "Has field",
    code: `pm.test("Body has id", function () {\n  var json = pm.response.json();\n  pm.expect(json).to.have.property("id");\n});`,
  },
  {
    label: "Save token",
    code: `var json = pm.response.json();\npm.environment.set("token", json.token);`,
  },
  {
    label: "Fast response",
    code: `pm.test("Under 500ms", function () {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});`,
  },
];

export function ScriptsTab() {
  const [which, setWhich] = useState<Which>("pre");
  const request = useStore((s) => s.request);
  const patch = useStore((s) => s.patch);

  const value = which === "pre" ? request.preRequestScript : request.postResponseScript;
  const setValue = (v: string) =>
    patch(which === "pre" ? { preRequestScript: v } : { postResponseScript: v });

  const snippets = which === "pre" ? SNIPPETS_PRE : SNIPPETS_POST;
  const insert = (code: string) => setValue((value ? value + "\n\n" : "") + code);

  const opts: SegOption<Which>[] = [
    { value: "pre", label: "Pre-request", badge: request.preRequestScript.trim() ? "•" : undefined },
    { value: "post", label: "Post-response", badge: request.postResponseScript.trim() ? "•" : undefined },
  ];

  return (
    <div className="flex h-full flex-col gap-3">
      <Segmented options={opts} value={which} onChange={setWhich} />
      <div className="flex flex-wrap gap-1.5">
        {snippets.map((s) => (
          <Button
            key={s.label}
            variant="subtle"
            className="px-2 py-1 text-[11px]"
            onClick={() => insert(s.code)}
          >
            + {s.label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Panel className="h-full overflow-hidden">
          <CodeEditor
            value={value}
            onChange={setValue}
            lang="javascript"
            placeholder={
              which === "pre"
                ? "// Runs before the request is sent.\n// pm.environment.set('token', '...');\n// pm.request.setHeader('X-Key', 'value');"
                : "// Runs after the response arrives.\n// pm.test('Status is 200', function () {\n//   pm.expect(pm.response.code).to.equal(200);\n// });\n// pm.environment.set('id', pm.response.json().id);"
            }
          />
        </Panel>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        Sandboxed JS with{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-white/[0.06]">pm</code>,{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-white/[0.06]">expect</code>,{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-white/[0.06]">console</code>. Supports{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-white/[0.06]">pm.environment</code>,{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-white/[0.06]">pm.request</code>,{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-white/[0.06]">pm.response</code>,{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-white/[0.06]">pm.test</code>. Results show
        in the response <span className="font-medium">Tests</span> tab.
      </p>
    </div>
  );
}
