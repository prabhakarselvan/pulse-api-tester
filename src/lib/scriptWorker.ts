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
  var pending = []; // promises from async pm.test(...) callbacks, awaited before we report

  function errMsg(err) { return (err && err.message) ? err.message : String(err); }

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

  // chai-faithful type name: 'array'/'null' aren't typeof results.
  function typeName(x) { return x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x; }
  // length of a string/array/arraylike, else key-count of a plain object.
  function lengthOf(x) {
    if (x == null) return undefined;
    if (typeof x.length === 'number') return x.length;
    if (typeof x === 'object') return Object.keys(x).length;
    return undefined;
  }
  // order-independent deep set equality (chai `.members`).
  function sameMembers(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    var used = [];
    for (var i = 0; i < a.length; i++) {
      var found = false;
      for (var k = 0; k < b.length; k++) {
        if (!used[k] && deepEqual(a[i], b[k])) { used[k] = true; found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  // A chai-like chainable assertion. Language words (`to`, `be`, `have`, `at`,
  // `deep`, …) are no-op getters that return the same chain; `not`/`deep` return
  // a new chain with the flag flipped/set. Boolean-ish terminals (`ok`, `true`,
  // `empty`, `exist`, …) fire on property access (chai style, no parens) but also
  // return a callable so an accidental `()` is harmless.
  function makeChain(actual, negate, deep) {
    function chk(cond, msg) {
      var ok = negate ? !cond : cond;
      if (ok) return;
      if (negate) { msg = msg.indexOf(' to ') !== -1 ? msg.replace(' to ', ' to not ') : 'not: ' + msg; }
      throw new Error(msg);
    }
    var self = {};

    // --- value matchers (called) ---
    self.equal = self.equals = self.eq = function (x) {
      var ok = deep ? deepEqual(actual, x) : actual === x;
      chk(ok, 'expected ' + j(actual) + (deep ? ' to deeply equal ' : ' to equal ') + j(x)); return self;
    };
    self.eql = self.eqls = function (x) { chk(deepEqual(actual, x), 'expected ' + j(actual) + ' to deeply equal ' + j(x)); return self; };
    self.include = self.includes = self.contain = self.contains = function (x) {
      var ok;
      if (actual == null) ok = false;
      else if (typeof actual === 'string') ok = actual.indexOf(x) !== -1;
      else if (Array.isArray(actual)) { ok = false; for (var i = 0; i < actual.length; i++) { if (deepEqual(actual[i], x)) { ok = true; break; } } }
      else if (typeof actual === 'object') {
        if (x !== null && typeof x === 'object') { ok = true; var ks = Object.keys(x); for (var m = 0; m < ks.length; m++) { if (!deepEqual(actual[ks[m]], x[ks[m]])) { ok = false; break; } } }
        else ok = Object.prototype.hasOwnProperty.call(actual, x);
      } else ok = false;
      chk(ok, 'expected ' + j(actual) + ' to include ' + j(x)); return self;
    };
    self.string = function (sub) { chk(typeof actual === 'string' && actual.indexOf(sub) !== -1, 'expected ' + j(actual) + ' to contain string ' + j(sub)); return self; };
    self.match = self.matches = function (re) { chk(re.test(actual), 'expected ' + j(actual) + ' to match ' + re); return self; };
    self.above = self.greaterThan = self.gt = function (n) { chk(actual > n, 'expected ' + j(actual) + ' to be above ' + n); return self; };
    self.below = self.lessThan = self.lt = function (n) { chk(actual < n, 'expected ' + j(actual) + ' to be below ' + n); return self; };
    self.least = self.gte = function (n) { chk(actual >= n, 'expected ' + j(actual) + ' to be at least ' + n); return self; };
    self.most = self.lte = function (n) { chk(actual <= n, 'expected ' + j(actual) + ' to be at most ' + n); return self; };
    self.within = function (lo, hi) { chk(actual >= lo && actual <= hi, 'expected ' + j(actual) + ' to be within ' + lo + '..' + hi); return self; };
    self.closeTo = self.approximately = function (n, d) { chk(typeof actual === 'number' && Math.abs(actual - n) <= d, 'expected ' + j(actual) + ' to be close to ' + n + ' +/- ' + d); return self; };
    self.a = self.an = function (t) {
      var got = typeName(actual);
      var article = /^[aeiou]/i.test(String(t)) ? 'an' : 'a';
      chk(got === t, 'expected ' + j(actual) + ' to be ' + article + ' ' + t); return self;
    };
    self.instanceOf = self.instanceof = function (ctor) { chk(actual instanceof ctor, 'expected ' + j(actual) + ' to be an instance of ' + (ctor && ctor.name ? ctor.name : String(ctor))); return self; };
    self.property = self.ownProperty = function (k, v) {
      var has = (typeof actual === 'object' || typeof actual === 'function') && actual != null && (k in Object(actual));
      if (arguments.length > 1) chk(has && deepEqual(actual[k], v), 'expected object to have property ' + j(k) + ' of ' + j(v));
      else chk(has, 'expected object to have property ' + j(k));
      return self;
    };
    self.lengthOf = self.length = function (n) { var L = lengthOf(actual); chk(L === n, 'expected ' + j(actual) + ' to have length ' + n + ' but got ' + L); return self; };
    self.members = function (arr) { chk(sameMembers(actual, arr), 'expected ' + j(actual) + ' to have the same members as ' + j(arr)); return self; };
    self.keys = self.key = function () {
      var want = (arguments.length === 1 && Array.isArray(arguments[0])) ? arguments[0] : Array.prototype.slice.call(arguments);
      var have = (actual && typeof actual === 'object') ? Object.keys(actual) : [];
      var ok = true; for (var i = 0; i < want.length; i++) { if (have.indexOf(String(want[i])) === -1) { ok = false; break; } }
      chk(ok, 'expected ' + j(actual) + ' to have keys ' + j(want)); return self;
    };
    self.oneOf = function (list) { var ok = false; if (Array.isArray(list)) { for (var i = 0; i < list.length; i++) { if (deepEqual(actual, list[i])) { ok = true; break; } } } chk(ok, 'expected ' + j(actual) + ' to be one of ' + j(list)); return self; };
    self.status = function (c) { chk(actual === c, 'expected status ' + c + ' but got ' + j(actual)); return self; };
    self.throw = self['throws'] = function () { var threw = false; try { if (typeof actual === 'function') actual(); } catch (_) { threw = true; } chk(threw, 'expected function to throw'); return self; };

    // --- language chain words (no-op getters → same chain) ---
    var words = ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'of', 'same', 'but', 'does', 'still', 'also', 'nested', 'own', 'ordered', 'any', 'all', 'at'];
    for (var w = 0; w < words.length; w++) {
      (function (name) { Object.defineProperty(self, name, { configurable: true, get: function () { return self; } }); })(words[w]);
    }
    Object.defineProperty(self, 'not', { configurable: true, get: function () { return makeChain(actual, !negate, deep); } });
    Object.defineProperty(self, 'deep', { configurable: true, get: function () { return makeChain(actual, negate, true); } });

    // --- terminal getter-assertions (fire on access; tolerate an optional call) ---
    function term(name, cond, msg) {
      Object.defineProperty(self, name, {
        configurable: true,
        get: function () { chk(cond(), msg()); return function () { return self; }; }
      });
    }
    term('ok', function () { return !!actual; }, function () { return 'expected ' + j(actual) + ' to be ok'; });
    term('true', function () { return actual === true; }, function () { return 'expected ' + j(actual) + ' to be true'; });
    term('false', function () { return actual === false; }, function () { return 'expected ' + j(actual) + ' to be false'; });
    term('null', function () { return actual === null; }, function () { return 'expected ' + j(actual) + ' to be null'; });
    term('undefined', function () { return actual === undefined; }, function () { return 'expected ' + j(actual) + ' to be undefined'; });
    term('exist', function () { return actual !== null && actual !== undefined; }, function () { return 'expected ' + j(actual) + ' to exist'; });
    term('empty', function () { return lengthOf(actual) === 0; }, function () { return 'expected ' + j(actual) + ' to be empty'; });
    term('NaN', function () { return actual !== actual; }, function () { return 'expected ' + j(actual) + ' to be NaN'; });

    return self;
  }
  function expect(actual) { return makeChain(actual, false, false); }

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
      // Reserve the slot now so results stay in declaration order even when async
      // tests resolve out of order. Optimistically pass; overwrite on failure.
      var idx = tests.length;
      tests.push({ name: String(name), passed: true });
      try {
        var r = fn();
        if (r && typeof r.then === 'function') {
          // Async test: await its promise before reporting. A rejection (thrown
          // error or failed pm.expect inside the async fn) marks the test failed.
          pending.push(Promise.resolve(r).then(
            function () { /* resolved → keep the optimistic pass */ },
            function (err) { tests[idx] = { name: String(name), passed: false, error: errMsg(err) }; }
          ));
        }
      } catch (err) {
        tests[idx] = { name: String(name), passed: false, error: errMsg(err) };
      }
    }
  };

  var error = null;
  var mainPromise;
  try {
    // Wrap the user script in an async IIFE so top-level `await` works and the
    // whole script yields a promise we can wait on before reporting results.
    // A syntax error is still caught here at construction time, as before.
    var f = new Function('pm', 'console', 'expect', 'request', 'response', 'CryptoJS',
      'return (async function(){\n' + code + '\n})();');
    mainPromise = f(pm, cons, expect, req, responseApi, CryptoJS);
  } catch (err) {
    error = errMsg(err);
  }

  // Wait for the script itself, then for every async pm.test(...) to settle,
  // then report. A test that never resolves is bounded by the host's 5s timeout
  // (it terminates this worker), so this can't hang the app.
  Promise.resolve(mainPromise)
    .catch(function (err) { if (!error) error = errMsg(err); })
    .then(function () { return Promise.all(pending.map(function (p) { return Promise.resolve(p).catch(function () {}); })); })
    .then(function () {
      self.postMessage({ request: req, vars: env, tests: tests, logs: logs, error: error });
    });
};
