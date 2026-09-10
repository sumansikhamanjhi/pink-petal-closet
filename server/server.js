/*
  Pink Petal Closet — the deployed server.

  Two jobs, and deliberately no others:

    1. serve the static app
    2. proxy the three /api routes to Google, holding the credential

  The credential never reaches the browser. That is the whole reason this
  process exists: the page could talk to Google directly, but then the key
  would be in a file anyone can View-Source.

  Every decision this file makes — which URL, which body, how to read the
  answer, what to retry, which paths may be served — is in ./api-core.js and is
  tested in lab/apicore-probe.html. What is here is sockets and file reads.

  Zero dependencies, on purpose: nothing to install means the container build is
  a COPY, there is no lockfile to drift, and there is no third-party code in the
  one process that holds the key.

  Environment:
    GEMINI_API_KEY       the key. Required for identification-on-upload, and
                         used for the render when Vertex is not configured.
    PP_VERTEX_PROJECT    if set, the render goes through Vertex AI instead, and
                         on Cloud Run authenticates as the service account with
                         no key at all.
    PORT                 set by Cloud Run. 8080 when run by hand.
    PP_TRYON_MOCK        echo the mannequin back, to test wiring for free.
*/
"use strict";

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const core  = require("./api-core.js");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8080;
const cfg  = core.readEnv(process.env);

/* the model that last answered, so an exhausted one is not retried every time */
let vlmModel = cfg.vlmModels[0];

/* a pasted token is used as given; a metadata one is re-minted before it dies */
let token = { value: cfg.vertexToken, expiresAt: cfg.vertexToken ? Infinity : 0 };

const MAX_BODY = 40 * 1024 * 1024;   // an outfit is a few MB of base64
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const short = s => { s = String(s == null ? "" : s); return s.length > 300 ? s.slice(0, 300) + "…" : s; };

/* ---- talking to Google ------------------------------------------------- */

function postJson(url, bodyObj, extraHeaders, timeoutMs) {
  return new Promise(resolve => {
    let data;
    try { data = Buffer.from(JSON.stringify(bodyObj), "utf8"); }
    catch (e) { return resolve({ status: 0, text: "could not encode the request", hasBody: false }); }

    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: Object.assign({
        "Content-Type": "application/json",
        "Content-Length": data.length
      }, extraHeaders || {})
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString("utf8"),
        hasBody: true
      }));
    });
    /* a bare send failure has no body, which is the signal api-core uses to
       decide the upload is worth retrying */
    req.on("error", e => resolve({ status: 0, text: String((e && e.message) || e), hasBody: false }));
    req.setTimeout(timeoutMs, () => req.destroy(new Error("upstream timed out")));
    req.write(data);
    req.end();
  });
}

/* Cloud Run's metadata server mints an access token for the service account.
   This is why a deployed render needs no key and nothing to rotate. */
function metadataToken() {
  return new Promise(resolve => {
    const req = http.request({
      hostname: core.METADATA_TOKEN.host,
      path: core.METADATA_TOKEN.path,
      headers: core.METADATA_TOKEN.headers
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!j.access_token) return resolve(null);
          // a minute of headroom, so a token never expires mid-render
          resolve({ value: j.access_token, expiresAt: Date.now() + ((j.expires_in || 3600) - 60) * 1000 });
        } catch (e) { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function vertexToken(force) {
  if (cfg.vertexToken && !force) return cfg.vertexToken;
  if (!cfg.onCloudRun) return cfg.vertexToken || "";
  if (!force && token.value && Date.now() < token.expiresAt) return token.value;
  const got = await metadataToken();
  if (got) token = got;
  return token.value || "";
}

/* ---- the three upstream calls ------------------------------------------ */

async function callVlm(payload) {
  const order = core.vlmModelOrder(payload, cfg, vlmModel);
  let lastDetail = "";
  for (const model of order) {
    let minuteRetries = 0;
    for (;;) {
      const r = await postJson(core.generativeUri(model, cfg.apiKey),
                               core.vlmBody(payload), null, 120000);
      if (r.status === 200) {
        let parsed = null;
        try { parsed = JSON.parse(r.text); } catch (e) {}
        const got = core.extractText(parsed);
        if (got.ok) {
          if (model !== vlmModel) { log("vlm now using", model); vlmModel = model; }
          return got;
        }
        lastDetail = short(r.text);
        break;
      }
      lastDetail = r.text;
      const verdict = core.vlmRetry(lastDetail, minuteRetries);
      if (verdict.action === "wait") {
        minuteRetries++;
        log("vlm rate-limited on", model + ", waiting", verdict.seconds + "s");
        await new Promise(res => setTimeout(res, verdict.seconds * 1000));
        continue;
      }
      break;   // next model
    }
  }
  return { ok: false, error: core.friendlyVlmError(lastDetail), detail: short(lastDetail) };
}

async function callVertex(payload) {
  const body = core.vertexBody(payload, cfg);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tok = await vertexToken(attempt > 1);
    if (!tok) {
      return { ok: false, error: "no Vertex access token",
               detail: "set PP_VERTEX_TOKEN, or deploy with a service account that has Vertex AI User" };
    }
    const r = await postJson(core.vertexUri(cfg), body,
                             { Authorization: "Bearer " + tok }, 300000);
    if (r.status === 200) {
      let parsed = null;
      try { parsed = JSON.parse(r.text); } catch (e) {}
      return core.extractImage(parsed);
    }
    const verdict = core.vertexRetry(attempt, r.hasBody, r.text, cfg.onCloudRun);
    if (verdict.action === "retry") {
      if (verdict.waitMs) await new Promise(res => setTimeout(res, verdict.waitMs));
      continue;
    }
    return { ok: false, error: "vertex request failed", detail: short(r.text) };
  }
  return { ok: false, error: "vertex request failed", detail: "three attempts, no answer" };
}

async function callTryOn(payload) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await postJson(core.generativeUri(cfg.tryOnModel, cfg.apiKey),
                             core.tryOnBody(payload, attempt), null, 180000);
    if (r.status === 200) {
      let parsed = null;
      try { parsed = JSON.parse(r.text); } catch (e) {}
      return core.extractImage(parsed);
    }
    // some model revisions reject responseModalities — ask plainly once
    if (attempt === 1 && /responseModalities|modalit/i.test(r.text)) continue;
    return { ok: false, error: "gemini request failed", detail: short(r.text) };
  }
  return { ok: false, error: "gemini request failed", detail: "two attempts, no answer" };
}

/* ---- http ------------------------------------------------------------- */

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveFile(res, rel) {
  const full = path.join(ROOT, rel);
  /* belt and braces: api-core already refuses "..", but the served path is
     re-checked against the root after joining, in case of a platform quirk */
  if (!full.startsWith(ROOT + path.sep)) { res.writeHead(403).end("403"); return; }
  let data;
  try {
    const st = await fs.promises.stat(full);
    if (!st.isFile()) throw new Error("not a file");
    data = await fs.promises.readFile(full);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found: /" + rel);
    return;
  }
  const type = core.contentTypeFor(rel);
  /* code must not be cached, or a redeploy leaves stale JS against fresh HTML.
     Photographs never change once shipped, so they can be. */
  const cache = /^(text|application\/javascript)/.test(type)
    ? "no-cache" : "public, max-age=86400";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": data.length,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff"
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  let urlPath = "/";
  try { urlPath = new URL(req.url, "http://x").pathname; } catch (e) {}

  try {
    if (urlPath === "/api/tryon/status") {
      return sendJson(res, 200, core.statusPayload(cfg, vlmModel));
    }

    if (urlPath === "/api/vlm" || urlPath === "/api/tryon") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

      let raw;
      try { raw = await readBody(req); }
      catch (e) { return sendJson(res, 413, { error: "that request was too large" }); }

      let payload = null;
      try { payload = JSON.parse(raw); } catch (e) {}

      if (urlPath === "/api/vlm") {
        if (!payload || !payload.prompt) {
          return sendJson(res, 400, { error: "expected { prompt, images: [{mime, data}] }" });
        }
        if (!cfg.apiKey) return sendJson(res, 503, { error: "no GEMINI_API_KEY on the server" });
        const r = await callVlm(payload);
        if (r.ok) { log("vlm ok (" + r.text.length + " chars)"); return sendJson(res, 200, { text: r.text }); }
        log("vlm failed:", r.error, "::", short(r.detail));
        return sendJson(res, 502, { error: r.error, detail: r.detail });
      }

      if (!payload || !payload.images) {
        return sendJson(res, 400, { error: "expected { prompt, images: [{mime, data}] }" });
      }
      const n = (payload.images || []).length;

      if (cfg.mock) {
        log("try-on MOCK (" + n + " images)");
        const first = payload.images[0] || {};
        return sendJson(res, 200, {
          image: "data:" + first.mime + ";base64," + first.data, mock: true
        });
      }
      if (cfg.useVertex) {
        log("try-on -> VERTEX", cfg.vertexModel, "(" + n + " images)");
        const r = await callVertex(payload);
        if (r.ok) return sendJson(res, 200, { image: r.image, via: "vertex" });
        log("vertex failed:", r.error, "::", short(r.detail));
        return sendJson(res, 502, { error: r.error, detail: r.detail });
      }
      if (!cfg.apiKey) {
        return sendJson(res, 503, { error: "no GEMINI_API_KEY or Vertex project on the server" });
      }
      log("try-on ->", cfg.tryOnModel, "(" + n + " images)");
      const r = await callTryOn(payload);
      if (r.ok) return sendJson(res, 200, { image: r.image, via: "apikey" });
      log("try-on failed:", r.error, "::", short(r.detail));
      return sendJson(res, 502, { error: r.error, detail: r.detail });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "GET only" });
    }
    const rel = core.safePath(urlPath);
    if (!rel) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }
    return await serveFile(res, rel);

  } catch (e) {
    /* the message may quote an upstream error, so it is truncated and the
       stack is kept to the log — never sent to the browser */
    console.error("unhandled:", e && e.stack || e);
    if (!res.headersSent) sendJson(res, 500, { error: "the server hit an unexpected error" });
    else res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const st = core.statusPayload(cfg, vlmModel);
  log("Pink Petal Closet listening on " + PORT);
  log("  serving from " + ROOT);
  log("  try-on: " + st.via + (st.ready ? "" : "  (the render button will be disabled)") +
      (st.via === "vertex" ? "  project=" + cfg.vertexProject + " region=" + cfg.vertexRegion : ""));
  log("  identification on upload: " + (st.vlm ? "enabled" : "no GEMINI_API_KEY — pixel-only isolation"));
});
