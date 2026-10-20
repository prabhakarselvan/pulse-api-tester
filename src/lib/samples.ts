// Default request factory + onboarding sample requests.

import type { Auth, Body, HttpRequest, KeyValue, MultipartField } from "./types";

export const emptyKV = (): KeyValue => ({ enabled: true, key: "", value: "" });

export const emptyMultipart = (): MultipartField => ({
  enabled: true,
  key: "",
  kind: "text",
  value: "",
});

export const defaultBody = (): Body => ({
  mode: "none",
  raw: "",
  form: [],
  multipart: [],
  graphqlVariables: "",
  binaryPath: "",
  soapVersion: "1.1",
  soapAction: "",
  soapEnvelope: "",
});

export const defaultAuth = (): Auth => ({
  kind: "none",
  token: "",
  username: "",
  password: "",
  apiKeyName: "",
  apiKeyValue: "",
  apiKeyIn: "header",
});

export function defaultRequest(): HttpRequest {
  return {
    method: "GET",
    url: "",
    queryParams: [],
    headers: [],
    body: defaultBody(),
    auth: defaultAuth(),
    followRedirects: true,
    timeoutMs: 30000,
    verifyTls: true,
    preRequestScript: "",
    postResponseScript: "",
    reuseConnection: false,
    proxyUrl: "",
    clientCertPem: "",
    clientKeyPem: "",
  };
}

export interface Sample {
  name: string;
  description: string;
  request: HttpRequest;
}

export const SAMPLES: Sample[] = [
  {
    name: "Simple GET",
    description: "Fetch JSON and watch the full network timeline.",
    request: {
      ...defaultRequest(),
      method: "GET",
      url: "https://httpbin.org/get",
    },
  },
  {
    name: "POST JSON",
    description: "Send a JSON body and inspect the echo.",
    request: {
      ...defaultRequest(),
      method: "POST",
      url: "https://httpbin.org/post",
      body: {
        ...defaultBody(),
        mode: "json",
        raw: JSON.stringify({ name: "Pulse", awesome: true }, null, 2),
      },
    },
  },
  {
    name: "GitHub API",
    description: "A real-world HTTPS API over HTTP/2.",
    request: {
      ...defaultRequest(),
      method: "GET",
      url: "https://api.github.com/users/octocat",
      headers: [{ enabled: true, key: "User-Agent", value: "Pulse" }],
    },
  },
];
