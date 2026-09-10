/*
  The server's decisions, with no server in them.

  WHY THIS IS A SEPARATE FILE. Nothing on this machine can run Node — no node,
  no npm, no Docker — so `server.js` cannot be executed here before it is
  deployed. What CAN be run is a browser, through the same headless-Chrome
  harness the rest of the suite uses. So everything that could actually be got
  wrong in the port from server.ps1 lives here as pure functions and is tested
  in lab/apicore-probe.html:

    - which URL each of the three upstreams is at
    - the exact request body each one wants
    - which of `inlineData` and `inline_data` the answer arrives in
    - which failures are worth a retry, and which model to move to
    - which paths a public server is allowed to serve off disk

  What is left in server.js is socket plumbing and file reads: the part least
  likely to be wrong, and the only part that has to wait for a deploy to be
  proven. The split is not architecture for its own sake — it is the largest
  share of the port that can be tested before it ships.

  Ported from server.ps1, which stays as the local dev server.
*/
(function (global) {
  "use strict";

  const DEFAULTS = {
    tryOnModel:   "gemini-2.5-flash-image",
    vertexModel:  "gemini-2.5-flash-image",
    // us-central1, not global: the global endpoint 404s for this model
    vertexRegion: "us-central1",
    // left alone the model returns a 1024x1024 square whatever it was given,
    // which letterboxes badly in a portrait frame
    vertexAspect: "9:16",
    // the free tier caps requests PER DAY PER MODEL, so a handful of uploads
    // can exhaust one model while the next still has room
    vlmModels: ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash",
                "gemini-3.5-flash-lite", "gemini-3.1-flash-lite",
                "gemini-3-flash-preview"]
  };

  /* server.ps1 used [bool] on the raw string, which makes "0" true. Read the
     way a person would instead — an env var set to 0 means off. */
  function isOn(v) {
    if (v === undefined || v === null) return false;
    const s = String(v).trim().toLowerCase();
    return s !== "" && s !== "0" && s !== "false" && s !== "no";
  }

  function readEnv(env) {
    env = env || {};
    const apiKey        = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
    const vertexProject = env.PP_VERTEX_PROJECT || "";
    const vertexToken   = env.PP_VERTEX_TOKEN || "";
    /* Cloud Run sets K_SERVICE, and there the metadata server mints a token for
       the service account on demand — so on Cloud Run a project id alone is
       enough, with no key and nothing to rotate. */
    const onCloudRun = !!env.K_SERVICE;
    return {
      apiKey,
      mock:         isOn(env.PP_TRYON_MOCK),
      tryOnModel:   env.PP_TRYON_MODEL || DEFAULTS.tryOnModel,
      vlmModels:    env.PP_VLM_MODEL ? [env.PP_VLM_MODEL] : DEFAULTS.vlmModels.slice(),
      vertexProject, vertexToken, onCloudRun,
      vertexRegion: env.PP_VERTEX_REGION || DEFAULTS.vertexRegion,
      vertexModel:  env.PP_VERTEX_MODEL  || DEFAULTS.vertexModel,
      vertexAspect: env.PP_VERTEX_ASPECT === "" ? ""
                    : (env.PP_VERTEX_ASPECT || DEFAULTS.vertexAspect),
      useVertex:    !!vertexProject && (!!vertexToken || onCloudRun)
    };
  }

  /* What the two front ends read to decide whether the render button works.
     `ready` gates try-on; `vlm` gates identification on upload. */
  function statusPayload(cfg, currentVlmModel) {
    return {
      ready:    !!(cfg.mock || cfg.useVertex || cfg.apiKey),
      mock:     !!cfg.mock,
      model:    cfg.useVertex ? cfg.vertexModel : cfg.tryOnModel,
      via:      cfg.mock ? "mock" : cfg.useVertex ? "vertex"
                : cfg.apiKey ? "apikey" : "none",
      billing:  cfg.useVertex ? "cloud credits"
                : cfg.apiKey ? "gemini api prepaid" : "",
      vlm:      !!cfg.apiKey,
      vlmModel: currentVlmModel || cfg.vlmModels[0]
    };
  }

  /* ---- upstream addresses ---------------------------------------------- */

  const GL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

  function generativeUri(model, key) {
    return GL_BASE + encodeURIComponent(model) +
           ":generateContent?key=" + encodeURIComponent(key);
  }

  /* The Vertex host is regional except for `global`, which has no prefix. */
  function vertexUri(cfg) {
    const host = cfg.vertexRegion === "global"
      ? "https://aiplatform.googleapis.com"
      : "https://" + cfg.vertexRegion + "-aiplatform.googleapis.com";
    return host + "/v1/projects/" + cfg.vertexProject +
           "/locations/" + cfg.vertexRegion +
           "/publishers/google/models/" + cfg.vertexModel + ":generateContent";
  }

  const METADATA_TOKEN = {
    host: "metadata.google.internal",
    path: "/computeMetadata/v1/instance/service-accounts/default/token",
    headers: { "Metadata-Flavor": "Google" }
  };

  /* ---- request bodies -------------------------------------------------- */

  function partsOf(payload) {
    const parts = [{ text: (payload && payload.prompt) || "" }];
    for (const img of ((payload && payload.images) || [])) {
      parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
    }
    return parts;
  }

  function vlmBody(payload) {
    return {
      contents: [{ parts: partsOf(payload) }],
      // temperature 0 and a JSON mime type: this is a reader, not a writer
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
    };
  }

  function tryOnBody(payload, attempt) {
    const body = { contents: [{ parts: partsOf(payload) }] };
    /* some model revisions reject responseModalities outright, so the second
       attempt asks plainly rather than failing the render */
    if (attempt === 1) body.generationConfig = { responseModalities: ["IMAGE"] };
    return body;
  }

  function vertexBody(payload, cfg) {
    const gen = { responseModalities: ["IMAGE"] };
    if (cfg.vertexAspect) gen.imageConfig = { aspectRatio: cfg.vertexAspect };
    return {
      contents: [{ role: "user", parts: partsOf(payload) }],
      generationConfig: gen
    };
  }

  /* ---- reading the answer ---------------------------------------------- */

  /* The REST API answers in camelCase and the docs show snake_case; both have
     been seen in the wild, so accept either rather than betting on one. */
  function inlineOf(part) {
    if (!part) return null;
    return part.inlineData || part.inline_data || null;
  }

  function firstText(resp) {
    try {
      for (const p of resp.candidates[0].content.parts) {
        if (p && p.text) return p.text;
      }
    } catch (e) { /* a shape we did not expect is simply no text */ }
    return "";
  }

  function extractImage(resp) {
    const candidates = (resp && resp.candidates) || [];
    for (const cand of candidates) {
      const parts = (cand && cand.content && cand.content.parts) || [];
      for (const part of parts) {
        const inline = inlineOf(part);
        if (inline && inline.data) {
          const mime = inline.mimeType || inline.mime_type || "image/png";
          return { ok: true, image: "data:" + mime + ";base64," + inline.data };
        }
      }
    }
    /* the model refusing in prose is the common failure, and the prose is the
       only useful thing to show — so it becomes the detail */
    return { ok: false, error: "the model returned no image", detail: firstText(resp) };
  }

  function extractText(resp) {
    let text = "";
    try {
      for (const p of resp.candidates[0].content.parts) {
        if (p && p.text) text += p.text;
      }
    } catch (e) { /* leave text empty */ }
    if (!text) return { ok: false, error: "the model returned no text" };
    return { ok: true, text: text };
  }

  /* ---- what is worth another go ---------------------------------------- */

  /* A per-DAY cap is spent for this model, so move to the next one. A
     per-MINUTE cap will clear on its own, so wait it out — but only twice,
     because someone is watching a spinner. */
  function vlmRetry(detail, minuteRetries) {
    const d = String(detail || "");
    if (/PerDay/.test(d)) return { action: "next-model" };
    if (/RESOURCE_EXHAUSTED|rate limit/i.test(d) && minuteRetries < 2) {
      const m = d.match(/"retryDelay"\s*:\s*"(\d+)s"/);
      return { action: "wait", seconds: m ? Number(m[1]) + 2 : 12 };
    }
    return { action: "next-model" };
  }

  /* Start from whichever model last worked, so an exhausted one is not retried
     — and paid for with a wasted round trip — on every single request. */
  function vlmModelOrder(payload, cfg, lastGood) {
    if (payload && payload.model) return [payload.model];
    const first = lastGood || cfg.vlmModels[0];
    return [first].concat(cfg.vlmModels.filter(m => m !== first));
  }

  function friendlyVlmError(detail) {
    return /PerDay/.test(String(detail || ""))
      ? "every model's free daily quota is spent - try again tomorrow or enable billing"
      : "vlm request failed";
  }

  /* An expired token is worth one more go. So is a bare send failure with no
     response body at all: an image POST is a few megabytes and the connection
     does occasionally drop mid-upload, which is not a reason to fail a garment
     the user is waiting on. */
  function vertexRetry(attempt, hasBody, detail, canRemint) {
    if (attempt >= 3) return { action: "fail" };
    if (!hasBody) return { action: "retry", waitMs: 2000, remint: false };
    if (canRemint && /UNAUTHENTICATED|invalid authentication|expired/i.test(String(detail || ""))) {
      return { action: "retry", waitMs: 0, remint: true };
    }
    return { action: "fail" };
  }

  /* ---- serving files to strangers -------------------------------------- */

  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif":  "image/gif",
    ".ico":  "image/x-icon",
    ".woff": "font/woff",
    ".woff2":"font/woff2",
    ".txt":  "text/plain; charset=utf-8",
    ".wasm": "application/wasm"
  };

  function contentTypeFor(rel) {
    const dot = rel.lastIndexOf(".");
    const ext = dot < 0 ? "" : rel.slice(dot).toLowerCase();
    return MIME[ext] || "application/octet-stream";
  }

  /* Nothing here is served by mistake. The local dev server could be relaxed
     about this because it answered only to one machine; a deployed one answers
     to anyone, so the server's own source, the test harness, the docs and the
     PowerShell scripts are all off the menu — and a path that tries to climb
     out of the root is refused outright rather than quietly clamped, because a
     request containing ".." is not a request worth guessing at. */
  const BLOCKED = /^(server|lab)\//i;

  function safePath(urlPath) {
    let p = String(urlPath || "");
    try { p = decodeURIComponent(p); } catch (e) { return null; }
    // A NUL in a path is an attack, not a typo. Spelled out with fromCharCode
    // because the byte itself, written literally, is invisible in the source.
    if (p.indexOf(String.fromCharCode(0)) >= 0) return null;
    if (p === "" || p === "/") return "index.html";
    const out = [];
    for (const seg of p.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") return null;
      if (seg.charAt(0) === ".") return null;   // no dotfiles
      out.push(seg);
    }
    const rel = out.join("/");
    if (!rel) return null;
    if (BLOCKED.test(rel)) return null;
    const dot = rel.lastIndexOf(".");
    const ext = dot < 0 ? "" : rel.slice(dot).toLowerCase();
    if (!MIME[ext]) return null;   // an allow-list, so .ps1/.md/.json cannot leak
    return rel;
  }

  global.PPApiCore = {
    DEFAULTS, METADATA_TOKEN, MIME,
    isOn, readEnv, statusPayload,
    generativeUri, vertexUri,
    partsOf, vlmBody, tryOnBody, vertexBody,
    inlineOf, firstText, extractImage, extractText,
    vlmRetry, vlmModelOrder, friendlyVlmError, vertexRetry,
    contentTypeFor, safePath
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.PPApiCore;

})(typeof window !== "undefined" ? window : this);
