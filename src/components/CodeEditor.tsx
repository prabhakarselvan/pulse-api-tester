import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { javascript } from "@codemirror/lang-javascript";
import type { Extension } from "@codemirror/state";
import { useStore } from "../store";
import type { BodyLang } from "../lib/format";

function langExtensions(lang: BodyLang): Extension[] {
  switch (lang) {
    case "json":
      return [json()];
    case "html":
      return [html()];
    case "xml":
      return [xml()];
    case "javascript":
      return [javascript()];
    default:
      return [];
  }
}

export function CodeEditor({
  value,
  onChange,
  lang = "text",
  readOnly = false,
  placeholder,
  wrap = true,
}: {
  value: string;
  onChange?: (v: string) => void;
  lang?: BodyLang;
  readOnly?: boolean;
  placeholder?: string;
  wrap?: boolean;
}) {
  const theme = useStore((s) => s.theme);
  const extensions = useMemo(() => {
    const ext = langExtensions(lang);
    if (wrap) ext.push(EditorView.lineWrapping);
    return ext;
  }, [lang, wrap]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={theme}
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      extensions={extensions}
      height="100%"
      style={{ height: "100%" }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        autocompletion: false,
        bracketMatching: true,
      }}
      className="h-full"
    />
  );
}
