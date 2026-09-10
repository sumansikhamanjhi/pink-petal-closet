/* =========================================================================
   PINK PETAL CLOSET — VLM SERVICE  (vlm-service.js)
   -------------------------------------------------------------------------
   Asks a vision-language model to *look* at a photo and answer in JSON. Two
   questions, both of which the pixel engine cannot answer on its own:

     analyzeGarment(image)   which item in this photo is the one to keep, and
                             where exactly is it?  (label, category, box)
     analyzeCutout(cutout)   where does this garment meet the body, and how
                             wide is it there?  (anchor line + extent + sheer)

   Vision-with-text is a different API quota from image generation, so this
   works on a free-tier key where a generated try-on render does not.

   Requests go through this app's own dev server (`/api/vlm` in server.ps1) so
   the API key never reaches the browser.
   ========================================================================= */

(function (global) {
  "use strict";

  const CONFIG = {
    endpoint:  "/api/vlm",
    statusUrl: "/api/tryon/status",
    maxDim:    512,      // what the model is shown; boxes come back normalised
    timeoutMs: 180000
  };

  const state = { statusPromise: null, cache: new Map(), lastError: null };


  /* Words that describe every garment and therefore none. Kept in one place
     because both the prompt and the parser need them, and because the list is
     the record of what went wrong: these are the tags the old mechanical
     tagger produced on almost everything. */
  const BANNED_TAGS = new Set([
    "chic", "boutique", "stylish", "trendy", "fashionable", "versatile",
    "beautiful", "pretty", "nice", "modern", "sleek", "garment", "clothing",
    "outfit", "item", "fashion", "wardrobe"
  ]);
  const CATEGORIES = ["tops", "bottoms", "dresses", "jackets", "footwear", "bags",
                      "accessories_necklace", "accessories_bracelet", "accessories_headwear"];

  /* --------------------------------------------------------------- plumbing */

  function toPart(source, maxDim) {
    const w0 = source.naturalWidth || source.width;
    const h0 = source.naturalHeight || source.height;
    const s = Math.min(1, maxDim / Math.max(w0, h0));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w0 * s));
    cv.height = Math.max(1, Math.round(h0 * s));
    cv.getContext("2d").drawImage(source, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL("image/png");
    return { mime: "image/png", data: url.slice(url.indexOf(",") + 1) };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (src && (src.nodeName === "IMG" || src.nodeName === "CANVAS")) return resolve(src);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("could not load the image"));
      img.src = src;
    });
  }

  function status() {
    if (!state.statusPromise) {
      state.statusPromise = fetch(CONFIG.statusUrl)
        .then(r => (r.ok ? r.json() : { vlm: false }))
        .catch(() => ({ vlm: false, offline: true }));
    }
    return state.statusPromise;
  }

  async function ask(prompt, images) {
    const st = await status();
    if (!st.vlm) throw new Error("no vision model configured on the server");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    let res;
    try {
      res = await fetch(CONFIG.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, images }),
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.text) {
      throw new Error(payload.error || ("vlm failed: HTTP " + res.status));
    }
    // the model is asked for JSON, but strip a code fence just in case
    const text = String(payload.text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(text); }
    catch (e) { throw new Error("the model did not return JSON: " + text.slice(0, 160)); }
  }

  /* ------------------------------------------------- 1. what is in the photo */

  const GARMENT_PROMPT = [
    "You are looking at a photo a shopper wants to add to a digital wardrobe.",
    "",
    "Identify the ONE main clothing item or accessory that the photo is about.",
    "If several pieces are visible (a person wearing a whole outfit, a flat-lay",
    "with props), choose the single piece that is the subject of the photo.",
    "A pair of shoes counts as one item; include both shoes in the box.",
    "",
    "Answer with JSON only, no prose:",
    "{",
    '  "label": short human name for the item, e.g. "tan block-heel sandals",',
    '  "category": one of "tops","bottoms","dresses","jackets","footwear","bags",',
    '              "accessories_necklace","accessories_bracelet","accessories_headwear",',
    '  "box_2d": [ymin, xmin, ymax, xmax]  tight around the item only, each 0-1000.',
    "             Exclude hangers, hooks, boxes, stands, props and any other item.",
    '  "colorName": the dominant colour in plain words, e.g. "Tan", "Off White",',
    '  "material": e.g. "Leather", "Ribbed Knit", "Chiffon",',
    /* The tags the stylist scores against.
       A vocabulary is supplied rather than asking for "style tags", because the
       stylist matches a tag by comparing it against the words the wearer typed
       and against its own occasion lists — so a tag is only worth having if it
       is a word someone would type. Left to invent its own, a model reaches
       for boutique-copy adjectives: the version of this app that generated
       tags mechanically put "chic" on 100% of garments and "boutique" on 61%,
       and neither word appears in any occasion list or any real search. They
       are named here as forbidden for exactly that reason. */
    '  "styleTags": 3 to 5 lowercase SINGLE words for the occasion, season and',
    '               style. Use words from this list where they genuinely apply:',
    '               casual, everyday, comfy, lounge, work, office, smart, classic,',
    '               tailored, elegant, party, evening, night, formal, romantic,',
    '               date, cute, flirty, edgy, bold, dark, sporty, summer, beach,',
    '               airy, breezy, spring, pastel, autumn, warm, layering, cozy,',
    '               winter, minimal, clean, printed, floral, striped, structured.',
    '               Only what is true of THIS item. Never "chic", "boutique",',
    '               "stylish", "trendy", "fashionable" or "versatile" — they say',
    '               nothing and match nothing.',
    '  "sheer": true only if the fabric is see-through,',
    '  "onBody": true if a person or mannequin is wearing it,',
    '  "clutter": what else is in the frame that must NOT be kept, in a few words',
    "}"
  ].join("\n");

  /**
   * Looks at the photo and reports which item to keep and where it is.
   * The box comes back as fractions of the image, ready to crop with.
   */
  async function analyzeGarment(src) {
    const img = await loadImage(src);
    const part = toPart(img, CONFIG.maxDim);
    const raw = await ask(GARMENT_PROMPT, [part]);

    const box = Array.isArray(raw.box_2d) ? raw.box_2d : (Array.isArray(raw.box) ? raw.box : null);
    let region = null;
    if (box && box.length === 4) {
      const [ymin, xmin, ymax, xmax] = box.map(Number);
      const x0 = Math.min(xmin, xmax) / 1000, x1 = Math.max(xmin, xmax) / 1000;
      const y0 = Math.min(ymin, ymax) / 1000, y1 = Math.max(ymin, ymax) / 1000;
      if (isFinite(x0) && isFinite(y1) && (x1 - x0) > 0.02 && (y1 - y0) > 0.02) {
        region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    }
    const category = CATEGORIES.indexOf(raw.category) >= 0 ? raw.category : null;
    return {
      label: typeof raw.label === "string" ? raw.label : null,
      category,
      region,
      colorName: typeof raw.colorName === "string" ? raw.colorName : null,
      material: typeof raw.material === "string" ? raw.material : null,
      /* Sanitised here rather than trusted: a model asked for single words
         will sometimes return "smart casual" or an empty string, and the
         forbidden words are dropped on the way in as well as forbidden in the
         prompt — an instruction is a request, and this one costs nothing to
         enforce. */
      styleTags: Array.isArray(raw.styleTags)
        ? raw.styleTags
            .filter(t => typeof t === "string")
            .map(t => t.trim().toLowerCase().replace(/[^a-z-]/g, ""))
            .filter(t => t.length >= 3 && !BANNED_TAGS.has(t))
            .slice(0, 5)
        : [],
      sheer: raw.sheer === true,
      onBody: raw.onBody === true,
      clutter: typeof raw.clutter === "string" ? raw.clutter : "",
      raw
    };
  }

  /* --------------------------------------- 2. how this cutout meets the body */

  const CUTOUT_PROMPT = [
    "This image is a single garment cut out on a transparent (or plain) background,",
    "photographed flat. It is about to be drawn onto a mannequin, so I need to know",
    "where it meets the body and how wide it is there.",
    "",
    "Answer with JSON only, all values as FRACTIONS of this image (0.0 - 1.0):",
    "{",
    '  "kind": "top" | "bottom" | "dress" | "jacket" | "shoes" | "bag" | "accessory",',
    '  "anchorY": the line where the garment hangs from the body —',
    "             the shoulder seam for a top, jacket or dress,",
    "             the top of the waistband for trousers or a skirt,",
    "             the top opening for shoes, the top of the strap for a bag,",
    '  "anchorLeft": left edge of the garment AT that line,',
    '  "anchorRight": right edge of the garment AT that line,',
    '  "hemY": the lowest point of the garment,',
    '  "widestY": the height at which the garment is widest,',
    '  "sheer": true only if you can see through the fabric,',
    '  "sleeves": "none" | "short" | "long"',
    "}"
  ].join("\n");

  /** Measures a cutout the way a dresser would, so it can be scaled to a body. */
  async function analyzeCutout(src, cacheKey) {
    if (cacheKey && state.cache.has(cacheKey)) return state.cache.get(cacheKey);
    const img = await loadImage(src);
    const part = toPart(img, 384);
    const raw = await ask(CUTOUT_PROMPT, [part]);

    const num = (v, lo, hi, dflt) => {
      const n = Number(v);
      return isFinite(n) && n >= lo && n <= hi ? n : dflt;
    };
    const left = num(raw.anchorLeft, 0, 1, 0.1);
    const right = num(raw.anchorRight, 0, 1, 0.9);
    const out = {
      kind: typeof raw.kind === "string" ? raw.kind : null,
      anchorY: num(raw.anchorY, 0, 0.9, 0.05),
      anchorLeft: Math.min(left, right),
      anchorRight: Math.max(left, right),
      hemY: num(raw.hemY, 0.1, 1, 1),
      widestY: num(raw.widestY, 0, 1, 0.5),
      sheer: raw.sheer === true,
      sleeves: typeof raw.sleeves === "string" ? raw.sleeves : "unknown",
      raw
    };
    if (out.anchorRight - out.anchorLeft < 0.05) { out.anchorLeft = 0.1; out.anchorRight = 0.9; }
    if (cacheKey) state.cache.set(cacheKey, out);
    return out;
  }

  global.VlmService = {
    CONFIG,
    status,
    available: () => status().then(s => !!s.vlm),
    analyzeGarment,
    analyzeCutout,
    get lastError() { return state.lastError; },
    _prompts: { GARMENT_PROMPT, CUTOUT_PROMPT }
  };

})(typeof window !== "undefined" ? window : this);
