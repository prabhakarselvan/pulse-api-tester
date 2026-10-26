/* eslint-disable */
// @ts-nocheck
// Script sandbox worker — bundled as a SAME-ORIGIN file (not a blob:), because a
// blob worker created from the tauri:// custom scheme gets an opaque origin that
// WebKit blocks under CSP. Runs user pre/post scripts with a pm-style API.

// Postman exposes CryptoJS as a built-in; many auth/signature scripts rely on it
// (SHA256, HMAC, Base64, AES, …). Bundle the real library and hand it to scripts.
import CryptoJS from "crypto-js";

// SECURITY: neutralize the worker's ambient network globals BEFORE any user code
// runs. The sandbox must have no network — otherwise a malicious imported
// collection's script could fetch()/WebSocket()/importScripts() out the user's
// secrets (env vars, auth tokens, mTLS keys). CSP is defense-in-depth on top;
// this makes exfiltration fail even if CSP is relaxed or absent.
(function () {
  // Only the direct network-egress globals — the CSP (connect-src 'self') is the
  // real backstop, so we keep this list minimal to avoid shadowing anything the
  // pm/expect API might legitimately use.
  var blocked = ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts'];
  for (var i = 0; i < blocked.length; i++) {
    try {
      Object.defineProperty(self, blocked[i], {
        value: undefined, writable: false, configurable: false,
      });
    } catch (_) { /* some engines disallow redefining — best effort */ }
  }
})();

self.onmessage = function (e) {
  var data = e.data;
  var code = data.code, request = data.request, response = data.response;
  var env = Object.assign({}, data.vars);
  var logs = [];
  var tests = [];

  function fmt(x) {
    if (typeof x === 'string') return x;
    try { return JSON.stringify(x); } catch (_) { return String(x); }
  }
  function push(level) {
    return function () { logs.push({ level: level, text: Array.prototype.map.call(arguments, fmt).join(' ') }); };
  }
  var cons = { log: push('log'), info: push('log'), warn: push('warn'), error: push('error'), debug: push('log') };

  function j(x) {
    if (typeof x === 'string') return "'" + x + "'";
    try { return JSON.stringify(x); } catch (_) { return String(x); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (a !== a && b !== b) return true; // NaN === NaN (chai semantics)
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (a instanceof Date || b instanceof Date) return (a instanceof Date) && (b instanceof Date) && a.getTime() === b.getTime();
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
      if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }

  function makeAssertion(actual, negate) {
    function chk(cond, msg) { var ok = negate ? !cond : cond; if (!ok) throw new Error(msg); }
    var api = {
      equal: function (x) { chk(actual === x, 'expected ' + j(actual) + ' to equal ' + j(x)); return api; },
      eql: function (x) { chk(deepEqual(actual, x), 'expected ' + j(actual) + ' to deeply equal ' + j(x)); return api; },
      include: function (x) { chk(actual != null && actual.indexOf && actual.indexOf(x) !== -1, 'expected ' + j(actual) + ' to include ' + j(x)); return api; },
      match: function (re) { chk(re.test(actual), 'expected ' + j(actual) + ' to match ' + re); return api; },
      above: function (n) { chk(actual > n, 'expected ' + j(actual) + ' to be above ' + n); return api; },
      below: function (n) { chk(actual < n, 'expected ' + j(actual) + ' to be below ' + n); return api; },
      a: function (t) { chk(typeof actual === t, 'expected ' + j(actual) + ' to be a ' + t); return api; },
      property: function (k) { chk((typeof actual === 'object' || typeof actual === 'function') && actual != null && (k in actual), 'expected object to have property ' + k); return api; },
      ok: function () { chk(!!actual, 'expected ' + j(actual) + ' to be ok'); return api; },
      'true': function () { chk(actual === true, 'expected ' + j(actual) + ' to be true'); return api; },
      'false': function () { chk(actual === false, 'expected ' + j(actual) + ' to be false'); return api; },
      'null': function () { chk(actual === null, 'expected ' + j(actual) + ' to be null'); return api; },
      'undefined': function () { chk(actual === undefined, 'expected ' + j(actual) + ' to be undefined'); return api; },
      status: function (c) { chk(actual === c, 'expected status ' + c + ' but got ' + j(actual)); return api; }
    };
    return api;
  }
  function expect(actual) {
    var pos = makeAssertion(actual, false);
    var neg = makeAssertion(actual, true);
    return {
      to: {
        equal: pos.equal, eql: pos.eql, include: pos.include, match: pos.match, a: pos.a,
        be: { ok: pos.ok, a: pos.a, an: pos.a, above: pos.above, below: pos.below, 'true': pos['true'], 'false': pos['false'], 'null': pos['null'], 'undefined': pos['undefined'] },
        have: { property: pos.property, status: pos.status },
        not: {
          equal: neg.equal, eql: neg.eql, include: neg.include, match: neg.match, a: neg.a,
          be: { ok: neg.ok, a: neg.a, an: neg.a, above: neg.above, below: neg.below, 'true': neg['true'], 'false': neg['false'], 'null': neg['null'], 'undefined': neg['undefined'] },
          have: { property: neg.property, status: neg.status }
        }
      }
    };
  }

  var envApi = {
    get: function (k) { return env[k]; },
    set: function (k, v) { env[k] = String(v); },
    unset: function (k) { delete env[k]; },
    has: function (k) { return Object.prototype.hasOwnProperty.call(env, k); },
    toObject: function () { return Object.assign({}, env); }
  };

  var req = request || {};
  if (!Array.isArray(req.headers)) req.headers = [];
  var requestApi = {
    get url() { return req.url; }, set url(v) { req.url = String(v); },
    get method() { return req.method; }, set method(v) { req.method = String(v); },
    get headers() { return req.headers; },
    get body() { return req.body; },
    addHeader: function (k, v) { req.headers.push({ enabled: true, key: String(k), value: String(v) }); },
    setHeader: function (k, v) {
      for (var i = 0; i < req.headers.length; i++) { if (req.headers[i].key.toLowerCase() === String(k).toLowerCase()) { req.headers[i].value = String(v); return; } }
      req.headers.push({ enabled: true, key: String(k), value: String(v) });
    },
    removeHeader: function (k) { req.headers = req.headers.filter(function (x) { return x.key.toLowerCase() !== String(k).toLowerCase(); }); },
    setBody: function (s, mode) { req.body = Object.assign({}, req.body, { mode: mode || 'text', raw: String(s) }); }
  };

  var parsed;
  var responseApi = response ? {
    code: response.status,
    status: response.statusText,
    responseTime: response.timings ? response.timings.totalMs : 0,
    text: function () { return response.body || ''; },
    json: function () { if (parsed === undefined) { parsed = JSON.parse(response.body || 'null'); } return parsed; },
    headers: {
      get: function (k) { var hs = response.headers || []; for (var i = 0; i < hs.length; i++) { if (hs[i].key.toLowerCase() === String(k).toLowerCase()) return hs[i].value; } return undefined; },
      all: function () { return response.headers || []; }
    },
    to: { have: { status: function (c) { assert(response.status === c, 'expected status ' + c + ' but got ' + response.status); } } }
  } : undefined;

  var pm = {
    environment: envApi,
    globals: envApi,
    variables: { get: function (k) { return env[k]; }, set: function (k, v) { env[k] = String(v); }, has: function (k) { return Object.prototype.hasOwnProperty.call(env, k); } },
    request: requestApi,
    response: responseApi,
    expect: expect,
    test: function (name, fn) {
      try {
        var r = fn();
        if (r && typeof r.then === 'function') {
          if (typeof r.catch === 'function') r.catch(function () {}); // avoid unhandled rejection
          tests.push({ name: String(name), passed: false, error: 'async test functions are not supported' });
        } else {
          tests.push({ name: String(name), passed: true });
        }
      } catch (err) {
        tests.push({ name: String(name), passed: false, error: (err && err.message) ? err.message : String(err) });
      }
    }
  };

  var error = null;
  try {
    var f = new Function('pm', 'console', 'expect', 'request', 'response', 'CryptoJS', code);
    f(pm, cons, expect, req, responseApi, CryptoJS);
  } catch (err) {
    error = (err && err.message) ? err.message : String(err);
  }

  self.postMessage({ request: req, vars: env, tests: tests, logs: logs, error: error });
};
