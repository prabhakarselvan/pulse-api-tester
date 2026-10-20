// SOAP helpers: envelope templates, WSDL import/scaffolding, and Fault parsing.
// Parsing uses the webview's built-in DOMParser (no dependency).

export type SoapVersion = "1.1" | "1.2";

const ENV_NS: Record<SoapVersion, string> = {
  "1.1": "http://schemas.xmlsoap.org/soap/envelope/",
  "1.2": "http://www.w3.org/2003/05/soap-envelope",
};
const WSDL_NS = "http://schemas.xmlsoap.org/wsdl/";
const SOAP11_NS = "http://schemas.xmlsoap.org/wsdl/soap/";
const SOAP12_NS = "http://schemas.xmlsoap.org/wsdl/soap12/";
const XSD_NS = "http://www.w3.org/2001/XMLSchema";

const PAYLOAD_PLACEHOLDER = "<!-- operation payload -->";

/** A blank SOAP envelope for the given version. */
export function emptyEnvelope(version: SoapVersion, bodyInner?: string): string {
  const inner = bodyInner ?? `    ${PAYLOAD_PLACEHOLDER}`;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="${ENV_NS[version]}">
  <soap:Header/>
  <soap:Body>
${inner}
  </soap:Body>
</soap:Envelope>`;
}

/** True if the body is still an untouched template (empty or the placeholder). */
export function isTemplateEnvelope(raw: string): boolean {
  const t = raw.trim();
  return t === "" || t.includes(PAYLOAD_PLACEHOLDER);
}

/** Swap the SOAP envelope namespace in-place to the target version. */
export function switchEnvelopeVersion(raw: string, version: SoapVersion): string {
  if (!raw.trim()) return emptyEnvelope(version);
  const other: SoapVersion = version === "1.1" ? "1.2" : "1.1";
  return raw.split(ENV_NS[other]).join(ENV_NS[version]);
}

// --- WSDL import -----------------------------------------------------------

export interface WsdlOperation {
  name: string;
  soapAction: string;
  version: SoapVersion;
  endpoint: string;
  envelope: string;
}

export interface WsdlParseResult {
  operations: WsdlOperation[];
  error?: string;
}

function directChildren(el: Element, ns: string, local: string): Element[] {
  return Array.from(el.children).filter(
    (c) => c.localName === local && c.namespaceURI === ns,
  );
}

function firstByLocal(root: Element, local: string): Element | null {
  if (root.localName === local) return root;
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === local) return all[i];
  }
  return null;
}

function textOrEmpty(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

/** Render an XSD element declaration into a sample XML node (bounded depth). */
function buildNode(el: Element, indent: string, depth: number): string {
  const name = el.getAttribute("name");
  if (!name) return "";
  if (depth < 4) {
    const ct = directChildren(el, XSD_NS, "complexType")[0];
    const container = ct
      ? directChildren(ct, XSD_NS, "sequence")[0] || directChildren(ct, XSD_NS, "all")[0]
      : undefined;
    const kids = container ? directChildren(container, XSD_NS, "element") : [];
    if (kids.length) {
      const inner = kids
        .map((k) => buildNode(k, indent + "  ", depth + 1))
        .filter(Boolean)
        .join("\n");
      return `${indent}<${name}>\n${inner}\n${indent}</${name}>`;
    }
  }
  return `${indent}<${name}>?</${name}>`;
}

function closestSchemaTns(el: Element): string {
  let node: Element | null = el;
  while (node) {
    if (node.localName === "schema" && node.namespaceURI === XSD_NS) {
      return node.getAttribute("targetNamespace") || "";
    }
    node = node.parentElement;
  }
  return "";
}

/** Resolve a (possibly prefixed) QName against the scope of `el`. */
function resolveQName(el: Element, qname: string): { ns: string; local: string } {
  if (!qname) return { ns: "", local: "" };
  const idx = qname.indexOf(":");
  const prefix = idx >= 0 ? qname.slice(0, idx) : "";
  const local = idx >= 0 ? qname.slice(idx + 1) : qname;
  const ns = (prefix ? el.lookupNamespaceURI(prefix) : el.lookupNamespaceURI(null)) || "";
  return { ns, local };
}

/** Follow binding → portType → operation input → message → part/@element to the
 * request element's QName (document/literal). Null for RPC or if unresolved. */
function inputElementQName(
  doc: Document,
  binding: Element,
  opName: string,
): { ns: string; local: string } | null {
  const typeQ = binding.getAttribute("type");
  if (!typeQ) return null;
  const { local: ptLocal } = resolveQName(binding, typeQ);
  const portType = Array.from(doc.getElementsByTagNameNS(WSDL_NS, "portType")).find(
    (pt) => pt.getAttribute("name") === ptLocal,
  );
  if (!portType) return null;
  const op = directChildren(portType, WSDL_NS, "operation").find(
    (o) => o.getAttribute("name") === opName,
  );
  if (!op) return null;
  const input = directChildren(op, WSDL_NS, "input")[0];
  const msgQ = input?.getAttribute("message");
  if (!msgQ) return null;
  const { local: msgLocal } = resolveQName(input, msgQ);
  const message = Array.from(doc.getElementsByTagNameNS(WSDL_NS, "message")).find(
    (m) => m.getAttribute("name") === msgLocal,
  );
  if (!message) return null;
  for (const part of directChildren(message, WSDL_NS, "part")) {
    const elQ = part.getAttribute("element");
    if (elQ) return resolveQName(part, elQ);
  }
  return null;
}

/** Find a global `<xsd:element name=local>` declaration, preferring a schema
 * whose targetNamespace matches `ns`. */
function findElementDecl(doc: Document, ns: string, local: string): Element | null {
  const schemas = Array.from(doc.getElementsByTagNameNS(XSD_NS, "schema"));
  let loose: Element | null = null;
  for (const schema of schemas) {
    const match = directChildren(schema, XSD_NS, "element").find(
      (e) => e.getAttribute("name") === local,
    );
    if (!match) continue;
    const stns = schema.getAttribute("targetNamespace") || "";
    if (!ns || stns === ns) return match;
    loose = loose || match;
  }
  return loose;
}

/** Scaffold the <soap:Body> inner payload for an operation from the WSDL schema. */
function scaffoldOperation(
  doc: Document,
  binding: Element,
  opName: string,
  fallbackTns: string,
): string {
  // Prefer the real request element (doc/literal); fall back to an element
  // named after the operation; finally a bare wrapper.
  const qn = inputElementQName(doc, binding, opName);
  let decl: Element | null = null;
  let wrapper = opName;
  let wrapperNs = fallbackTns;
  if (qn && qn.local) {
    decl = findElementDecl(doc, qn.ns, qn.local);
    wrapper = qn.local;
    wrapperNs = qn.ns || fallbackTns;
  }
  if (!decl) {
    const byName = findElementDecl(doc, "", opName);
    if (byName) {
      decl = byName;
      wrapper = opName;
    }
  }
  if (!decl) {
    return `    <tns:${wrapper} xmlns:tns="${wrapperNs}">\n      <!-- fill request parameters -->\n    </tns:${wrapper}>`;
  }
  const tns = closestSchemaTns(decl) || wrapperNs;
  const ct = directChildren(decl, XSD_NS, "complexType")[0];
  const container = ct
    ? directChildren(ct, XSD_NS, "sequence")[0] || directChildren(ct, XSD_NS, "all")[0]
    : undefined;
  const kids = container ? directChildren(container, XSD_NS, "element") : [];
  const inner = kids.length
    ? "\n" + kids.map((k) => buildNode(k, "      ", 1)).filter(Boolean).join("\n") + "\n    "
    : "\n      <!-- no parameters -->\n    ";
  return `    <tns:${wrapper} xmlns:tns="${tns}">${inner}</tns:${wrapper}>`;
}

/** Parse a WSDL document into a list of callable SOAP operations. */
export function parseWsdl(xml: string): WsdlParseResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return { operations: [], error: "Could not parse the WSDL document." };
  }
  if (doc.getElementsByTagName("parsererror").length) {
    return { operations: [], error: "The WSDL is not valid XML." };
  }

  const root = doc.documentElement;
  const targetNamespace = root.getAttribute("targetNamespace") || "";

  // Map binding local-name -> endpoint URL (from service ports).
  const bindingEndpoint: Record<string, string> = {};
  for (const port of Array.from(doc.getElementsByTagNameNS(WSDL_NS, "port"))) {
    const bindingAttr = port.getAttribute("binding") || "";
    const bindingLocal = bindingAttr.split(":").pop() || bindingAttr;
    const addr =
      port.getElementsByTagNameNS(SOAP11_NS, "address")[0] ||
      port.getElementsByTagNameNS(SOAP12_NS, "address")[0];
    const loc = addr?.getAttribute("location") || "";
    if (bindingLocal && loc) bindingEndpoint[bindingLocal] = loc;
  }

  const operations: WsdlOperation[] = [];
  for (const binding of Array.from(doc.getElementsByTagNameNS(WSDL_NS, "binding"))) {
    const isSoap12 = binding.getElementsByTagNameNS(SOAP12_NS, "binding").length > 0;
    const isSoap11 = binding.getElementsByTagNameNS(SOAP11_NS, "binding").length > 0;
    if (!isSoap11 && !isSoap12) continue; // not a SOAP binding (e.g. HTTP/MIME)
    const version: SoapVersion = isSoap12 ? "1.2" : "1.1";
    const soapNs = isSoap12 ? SOAP12_NS : SOAP11_NS;
    const endpoint = bindingEndpoint[binding.getAttribute("name") || ""] || "";

    for (const op of directChildren(binding, WSDL_NS, "operation")) {
      const name = op.getAttribute("name") || "";
      if (!name) continue;
      const soapOp = op.getElementsByTagNameNS(soapNs, "operation")[0];
      const soapAction = soapOp?.getAttribute("soapAction") || "";
      const inner = scaffoldOperation(doc, binding, name, targetNamespace);
      operations.push({
        name,
        soapAction,
        version,
        endpoint,
        envelope: emptyEnvelope(version, inner),
      });
    }
  }

  if (!operations.length) {
    return { operations: [], error: "No SOAP operations found in this WSDL." };
  }
  // De-dupe by name (a WSDL may expose the same op across multiple bindings).
  const seen = new Set<string>();
  const unique = operations.filter((o) => {
    const k = `${o.name}|${o.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { operations: unique };
}

// --- SOAP Fault detection --------------------------------------------------

export interface SoapFault {
  version: SoapVersion;
  code: string;
  message: string;
  detail?: string;
}

/** Detect and extract a SOAP Fault from a response body, if present.
 * Strict: the Fault must be a `soap:Body` child in a real SOAP-envelope
 * namespace — so a business payload that merely contains a `<Fault>` field
 * never trips the banner. */
export function parseSoapFault(xml: string): SoapFault | null {
  if (!xml || !xml.includes("Fault")) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
  if (doc.getElementsByTagName("parsererror").length) return null;

  const root = doc.documentElement;
  const envNs = root.namespaceURI ?? "";
  const version: SoapVersion | null =
    envNs === ENV_NS["1.2"] ? "1.2" : envNs === ENV_NS["1.1"] ? "1.1" : null;
  if (!version || root.localName !== "Envelope") return null;

  const body = Array.from(root.children).find(
    (c) => c.localName === "Body" && c.namespaceURI === envNs,
  );
  if (!body) return null;
  const fault = Array.from(body.children).find(
    (c) => c.localName === "Fault" && c.namespaceURI === envNs,
  );
  if (!fault) return null;

  if (version === "1.2") {
    const code = textOrEmpty(firstByLocal(fault, "Value"));
    const message = textOrEmpty(firstByLocal(fault, "Text") || firstByLocal(fault, "Reason"));
    const detail = textOrEmpty(firstByLocal(fault, "Detail"));
    return { version, code, message, detail: detail || undefined };
  }
  const code = textOrEmpty(firstByLocal(fault, "faultcode"));
  const message = textOrEmpty(firstByLocal(fault, "faultstring"));
  const detail = textOrEmpty(firstByLocal(fault, "detail"));
  return { version, code, message, detail: detail || undefined };
}
