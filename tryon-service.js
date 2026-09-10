/* =========================================================================
   PINK PETAL CLOSET — AI TRY-ON SERVICE  (tryon-service.js)
   -------------------------------------------------------------------------
   Sends the bare mannequin plus the outfit's garment cutouts to an image
   model and gets back one photograph of the mannequin actually wearing them —
   fabric following the body, shoes on the feet, bag on the arm.

   The model is reached through this app's own dev server (`/api/tryon` in
   server.ps1), so the API key stays on the machine and never reaches the page.

   Standalone service. Exposes:

     TryOnService.status()                  -> Promise<{ready, mock, model}>
     TryOnService.render(request)           -> Promise<{image, cached, mock}>
     TryOnService.cached(signature)         -> data URL | null
     TryOnService.lastError                 -> string | null

   request = {
     base:      HTMLImageElement | HTMLCanvasElement   the bare mannequin
     garments:  [{ category, name, image }]            cutouts, data URLs
     signature: string                                 identifies this outfit
   }

   Renders cost money per image, so results are cached by outfit signature and
   identical in-flight requests are shared rather than repeated.
   ========================================================================= */

(function (global) {
  "use strict";

  const CONFIG = {
    endpoint:    "/api/tryon",
    statusUrl:   "/api/tryon/status",
    baseMaxDim:  832,   // what the mannequin is sent at
    itemMaxDim:  512,   // what each garment is sent at
    timeoutMs:   180000
  };

  const WORN_AS = {
    tops: "top, worn on the torso",
    bottoms: "trousers or skirt, worn on the lower body",
    dresses: "dress, worn over the whole torso and legs",
    jackets: "jacket, worn open over the top",
    footwear: "shoes, worn on both feet",
    bags: "bag, hanging from the hand or shoulder",
    accessories_necklace: "necklace, around the neck",
    accessories_bracelet: "bracelet, on the wrist",
    accessories_headwear: "headwear, on the head"
  };

  const state = { statusPromise: null, cache: new Map(), inflight: new Map(), lastError: null };

  /* ------------------------------------------------------------- helpers */

  function toDataUrl(source, maxDim) {
    const w0 = source.naturalWidth || source.width;
    const h0 = source.naturalHeight || source.height;
    const s = Math.min(1, maxDim / Math.max(w0, h0));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w0 * s));
    cv.height = Math.max(1, Math.round(h0 * s));
    cv.getContext("2d").drawImage(source, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (src && (src.nodeName === "IMG" || src.nodeName === "CANVAS")) return resolve(src);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("could not load a garment image"));
      img.src = src;
    });
  }

  const splitDataUrl = (url) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(url || "");
    return m ? { mime: m[1], data: m[2] } : null;
  };

  /* ------------------------------------------------- what colour is it, really

     WHY THE STORED COLOUR NAME IS NOT USED FOR THIS.

     A previous version put the wardrobe's own `colorName` into the prompt, on
     the reasoning that naming a colour anchors a model better than asking it to
     preserve one. The reasoning is right and the source was wrong. That name
     comes from `GarmentEngine.describeColor`, a twenty-bucket table in which
     hue 25-45 with any real saturation is called "Amber" — so a golden-yellow
     dress is stored as an "Amber Dress", the prompt then asserted "its colour
     is amber", and the model dutifully returned an amber dress. Naming the
     colour did not cause the drift, but it certainly ratified it.

     So the colour is measured from the garment's own pixels at render time, and
     stated as an sRGB triplet next to a phrase derived from those same numbers.
     A measurement cannot contradict the image it was taken from. The prompt
     also says outright that the image wins over any words, because a
     description is a convenience and the pixels are the fact. */

  function meanGarmentColour(source) {
    const w0 = source.naturalWidth || source.width;
    const h0 = source.naturalHeight || source.height;
    if (!w0 || !h0) return null;
    const s = Math.min(1, 160 / Math.max(w0, h0));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w0 * s));
    cv.height = Math.max(1, Math.round(h0 * s));
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, cv.width, cv.height);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, r = 0, g = 0, b = 0;
    for (let p = 0; p < d.length; p += 4) {
      // solidly opaque only: an edge pixel is part background however well it
      // was matted, and there are a lot of edge pixels on a cutout
      if (d[p + 3] < 250) continue;
      r += d[p]; g += d[p + 1]; b += d[p + 2]; n++;
    }
    if (!n) return null;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  /**
   * A colour phrase with enough resolution to be worth saying.
   *
   * Deliberately finer than the wardrobe's own naming, whose whole
   * hue-25-to-45 band is one word. The bands here separate amber from golden
   * yellow from yellow, because that is exactly the distinction that was lost,
   * and every phrase is derived from the pixels handed in — so it describes the
   * garment rather than labelling it.
   */
  function colourPhrase(r, g, b) {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) {
      const R = r / 255, G = g / 255, B = b / 255;
      if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
      else if (max === G) h = ((B - R) / d + 2) / 6;
      else h = ((R - G) / d + 4) / 6;
    }
    h *= 360;
    const L = l * 100, S = s * 100;

    if (L > 93 && S < 12) return "white";
    if (L > 84 && S < 18) return "off-white ivory";
    if (L < 10) return "black";
    if (L < 24 && S < 25) return "near-black charcoal";
    if (S < 12) return L > 60 ? "light grey" : (L > 35 ? "mid grey" : "dark grey");

    const bands = [
      [12, "red"], [25, "orange-terracotta"], [40, "amber-tan"],
      [52, "golden yellow"], [68, "yellow"], [95, "yellow-green"],
      [150, "green"], [190, "teal"], [225, "blue"], [260, "indigo blue"],
      [290, "purple"], [330, "pink-magenta"], [345, "rose"], [361, "red"]
    ];
    let hue = "red";
    for (const [edge, name] of bands) { if (h < edge) { hue = name; break; } }

    const light = L > 72 ? "pale " : (L > 55 ? "light " : (L < 25 ? "very dark " : (L < 40 ? "deep " : "")));
    const sat = S > 65 ? "vivid " : (S < 28 ? "muted " : "");
    return (light + sat + hue).trim();
  }

  /** `{rgb, phrase}` for a garment image, or null if it cannot be measured. */
  function colourOf(source) {
    const rgb = meanGarmentColour(source);
    if (!rgb) return null;
    return { rgb, phrase: colourPhrase(rgb[0], rgb[1], rgb[2]) };
  }

  /**
   * The instruction the model works from.
   *
   * WHAT WENT WRONG WITH THE POLITE VERSION. The first draft asked the model to
   * "keep each garment's exact colour, pattern, texture and details" — one
   * clause, buried in the middle of a list, and it said nothing at all about
   * LENGTH. A floral dress came back a different colour and a different length.
   * That is not the model disobeying so much as it not being told: given a
   * garment and an instruction to make a shop-window photograph, restyling it
   * into something that photographs well is a perfectly reasonable reading.
   *
   * So the fidelity requirement is now the FIRST thing said and the last, it
   * names the two things that actually drifted, and it is phrased as
   * prohibitions. "Do not shorten the hem" constrains an image model in a way
   * that "keep the length" does not, because the negative names a specific act
   * it might otherwise perform. The garment images are also declared to be the
   * garments themselves rather than references or inspiration, which is the
   * distinction the failure turns on.
   *
   * Where the app knows a garment's colour by name it is stated outright. An
   * explicit "terracotta" is a far stronger anchor than any amount of "keep the
   * colour", because it gives the model a target to match instead of a rule to
   * remember.
   */
  function buildPrompt(garments) {
    const lines = garments.map((g, i) => {
      const c = g.colour;
      const measured = c
        ? ` Its colour, measured from image ${i + 2}, is sRGB(${c.rgb.join(", ")}) — ${c.phrase}; reproduce that colour.`
        : "";
      return `Image ${i + 2}: ${g.name} — ${WORN_AS[g.category] || "a garment"}.${measured}`;
    });
    return [
      "TASK: dress a mannequin in garments that already exist. You are NOT",
      "designing clothes. Every garment in images 2 onwards must appear in the",
      "result as the SAME garment it is in its image — same colour, same print,",
      "same length, same cut. Reproduce, do not reinterpret.",
      "",
      "Image 1 is a photograph of a bare white retail mannequin in a shop.",
      lines.join("\n"),
      "",
      "THE IMAGES ARE THE AUTHORITY. Where any word in this instruction seems to",
      "disagree with what an image shows, the image is correct and the word is",
      "not. Match the pixels, not the description.",
      "",
      "In particular, a garment's NAME above is only a label its owner typed. If",
      "a name mentions a colour, IGNORE that word completely and use the measured",
      "colour: a garment called \"Amber Dress\" whose measured colour is yellow is",
      "a YELLOW dress.",
      "",
      "Dress the mannequin in every garment shown in images 2 onwards, so it looks",
      "like a real shop window display photographed in that same shop:",
      "- the fabric follows the mannequin's body and drapes naturally, with correct",
      "  scale, folds, seams and contact shadows",
      "- shoulders, torso and legs are properly covered — never leave the mannequin",
      "  partly undressed, and never leave a garment floating away from the body",
      "- shoes are on the feet, a bag hangs from the hand or shoulder, jewellery sits",
      "  on the neck or wrist",
      "",
      "FIDELITY — these are the rules that matter most:",
      "- COLOUR: each garment keeps the exact colour it has in its own image, to the",
      "  sRGB values given above. Do not shift the hue — a yellow garment must not",
      "  come back amber, gold, mustard or orange, and the same applies to every",
      "  other colour. Do not deepen, lighten, saturate or desaturate it. Do not",
      "  shift a print's colours.",
      "- NO SCENE TINT: the shop in image 1 is warmly lit. Do NOT let that light, or",
      "  any colour grading, warm filter, or 'harmonising' with the background,",
      "  change what colour a garment is. Light it so each garment reads as its own",
      "  colour. If a faithful colour looks out of place in the room, keep the",
      "  colour and change the light.",
      "- PATTERN: a floral, striped or printed garment keeps that exact print, at the",
      "  same scale and density. Do not substitute a different floral or a plain fabric.",
      "- LENGTH: reproduce each garment's exact length. Do not shorten or lengthen a",
      "  hem, a sleeve or a strap. A midi dress stays midi; a maxi stays maxi; a",
      "  cropped top stays cropped. The hem must fall at the same point on the body",
      "  as the garment's own proportions imply.",
      "- CUT: keep the neckline, the sleeves, the waist, the buttons and every detail.",
      "  Do not add a belt, a collar, a slit or trim that is not in the image.",
      "- Do not redesign, restyle, modernise, tidy up or improve any garment, and do",
      "  not replace one with a similar-looking garment. If a garment looks unusual,",
      "  reproduce it as it is.",
      "",
      "Keep image 1's mannequin, its pose and proportions, the camera framing and the",
      "shop background exactly as they are. Do not add a person, a face, or any garment",
      "that was not supplied.",
      "",
      "Before you answer, check each garment against its own image: same colour,",
      "same print, same length. If one differs, correct it.",
      "",
      "Return one photorealistic image of THESE garments, unchanged in colour,",
      "print and length, worn on that mannequin."
    ].join("\n");
  }

  /* --------------------------------------------------------------- status */

  function status() {
    if (!state.statusPromise) {
      state.statusPromise = fetch(CONFIG.statusUrl)
        .then(r => (r.ok ? r.json() : { ready: false }))
        .catch(() => ({ ready: false, offline: true }));
    }
    return state.statusPromise;
  }

  /* --------------------------------------------------------------- render */

  async function render(request) {
    // `prompt` lets a caller ask for something other than a whole outfit — the
    // worn-render module sends one garment at a time with its own wording,
    // because "dress the mannequin in these five things" and "add exactly this
    // one garment and change nothing else" are different instructions.
    const { base, garments, signature, prompt, force } = request || {};
    // With a caller-supplied prompt the garment list may legitimately be empty:
    // a ghost render sends the garment as the only image and no mannequin at
    // all, because every image sent is input tokens that get paid for.
    if (!base) throw new Error("nothing to try on");
    if (!prompt && (!garments || !garments.length)) throw new Error("nothing to try on");

    /* `force` asks for a fresh render of a look already rendered.
       The cache is what makes browsing affordable, and it is also what leaves
       someone stuck: an image model can hand back a garment in the wrong
       colour, and pressing the button again returned the same wrong picture
       for as long as the session lasted. A retry has to be possible, and it
       has to cost a call — so it is never automatic. */
    if (signature && !force && state.cache.has(signature)) {
      return { image: state.cache.get(signature), cached: true };
    }
    if (signature && state.inflight.has(signature)) return state.inflight.get(signature);

    const job = (async () => {
      const st = await status();
      if (!st.ready) throw new Error(st.offline ? "the dev server is not reachable"
                                                : "no API key configured on the server");

      const images = [{ mime: "image/png", data: splitDataUrl(toDataUrl(base, CONFIG.baseMaxDim)).data }];
      const used = [];
      for (const g of (garments || [])) {
        if (!g.image) continue;                       // emoji-only items cannot be worn
        try {
          const img = await loadImage(g.image);
          const part = splitDataUrl(toDataUrl(img, CONFIG.itemMaxDim));
          // measured here, from the very pixels being sent, so the colour the
          // prompt states and the colour in the image cannot disagree
          if (part) { images.push(part); used.push(Object.assign({}, g, { colour: colourOf(img) })); }
        } catch (e) { /* skip an unreadable garment rather than fail the render */ }
      }
      if (used.length === 0 && !prompt) throw new Error("none of these items have a photo to try on");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
      let res;
      try {
        res = await fetch(CONFIG.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt || buildPrompt(used), images }),
          signal: controller.signal
        });
      } finally { clearTimeout(timer); }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.image) {
        const detail = payload.detail ? (" — " + String(payload.detail).slice(0, 300)) : "";
        throw new Error((payload.error || ("try-on failed: HTTP " + res.status)) + detail);
      }
      if (signature) state.cache.set(signature, payload.image);
      return { image: payload.image, cached: false, mock: !!payload.mock };
    })();

    const tracked = job.catch(err => {
      state.lastError = err && err.message ? err.message : String(err);
      throw err;
    }).finally(() => { if (signature) state.inflight.delete(signature); });

    if (signature) state.inflight.set(signature, tracked);
    return tracked;
  }

  global.TryOnService = {
    CONFIG,
    /* Bump when buildPrompt changes. Callers that keep renders past the life of
       the tab key them by this, so a reworded prompt stops serving pictures the
       old wording produced.
       1: original.  2: fidelity rules led and closed the prompt.  3: colours
       measured from the pixels being sent, images declared the authority, scene
       tint forbidden. */
    OUTFIT_PROMPT_VERSION: 3,
    status,
    render,
    cached: (signature) => state.cache.get(signature) || null,
    get lastError() { return state.lastError; },
    colourOf, colourPhrase,
    _buildPrompt: buildPrompt
  };

})(typeof window !== "undefined" ? window : this);
