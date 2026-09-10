/* =========================================================================
   PINK PETAL CLOSET — GARMENT ISOLATION ENGINE  (garment-engine.js)   v2
   -------------------------------------------------------------------------
   One job, done properly: given a photo of a person (or mannequin) wearing
   clothes, cut a single garment out of the picture — the way long-press
   "select object" works in the Samsung gallery — and hand back a clean
   cutout with a transparent background.

   Standalone service, no dependency on app.js:

     GarmentEngine.warmup()             -> Promise<{backend}>
     GarmentEngine.extract(src, opts)   -> Promise<Result>
     GarmentEngine.describeColor(r,g,b) -> {hex, name}
     GarmentEngine.status()             -> {backend, ready, error}

   opts = {
     mode: 'auto'|'top'|'bottom'|'dress'|'jacket'|'bag'|'accessory'|'footwear'|'full',
     hintPoint: {x,y}   // normalised 0..1 — "the thing I tapped on"
     cropBox:   {x,y,width,height}   // in source pixels, restricts the search
     background:'transparent'|'white', padding:int, inpaintHoles:bool, debug:bool,
     fillOccluded:bool  // put back fabric hidden by hair or a limb (default on)
   }

   PIPELINE
     1. decode + downscale to a processing canvas
     2. SEMANTIC PASS   per-pixel probabilities for
                        background / hair / skin / face / clothes / accessory
                        (MediaPipe selfie-multiclass; colour heuristic fallback)
     3. ANATOMY         head, shoulder, hip and knee lines from those masks
     4. PIECES          the clothing blob is sliced into stacked garments
                        (top vs skirt vs shoes) using row-wise colour clusters,
                        so each piece stays SOLID — no fragmentation
     5. SELECTION       pick the piece matching the mode, or the tapped one
     6. CLEANUP         accessories/skin removed, holes closed, specks dropped
     6b. OCCLUSION      fabric hidden behind hair or a limb is put back. Two
                        passes, because a bite arrives two different ways: one
                        works from pixels the parser called clothing and the
                        cleanup then deleted, the other from pixels it called
                        hair or skin in the first place and that sit inside the
                        garment's own closed outline. Necklines are left alone
                        on purpose — see repairOccluderBites
     7. MATTING         trimap + local linear alpha + colour decontamination,
                        then every reconstructed area is inpainted from the
                        surrounding fabric
     8. RENDER          tight crop -> transparent PNG (+ white-matted JPEG)
     9. METRICS         self-scores the cutout so callers can flag failures
   ========================================================================= */

(function (global) {
  "use strict";

  /* ----------------------------------------------------------------- config */

  const CONFIG = {
    visionBundle: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
    wasmBase:     "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    modelUrl:     "https://storage.googleapis.com/mediapipe-models/image_segmenter/" +
                  "selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
    cacheName:    "pp-garment-engine-v1",
    procMaxDim:   768,
    outMaxDim:    1024,
    padding:      18
  };

  const C = { BG: 0, HAIR: 1, SKIN: 2, FACE: 3, CLOTHES: 4, OTHER: 5 };

  const state = { backend: null, ready: false, error: null, segmenter: null, loading: null };

  /* ============================================================ tiny helpers */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /** Small xorshift PRNG, so clustering is reproducible run to run. */
  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (src && (src.nodeName === "CANVAS" || (src.nodeName === "IMG" && src.complete && src.naturalWidth))) return resolve(src);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = src;
    });
  }

  function toCanvas(img, maxDim) {
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const s = Math.min(1, maxDim / Math.max(w0, h0));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w0 * s));
    cv.height = Math.max(1, Math.round(h0 * s));
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  }

  /* ---------- colour spaces ---------- */

  function rgb2lab(r, g, b) {
    let R = r / 255, G = g / 255, B = b / 255;
    R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
    G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
    B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
    let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116);
    X = f(X); Y = f(Y); Z = f(Z);
    return [(116 * Y) - 16, 500 * (X - Y), 200 * (Y - Z)];
  }

  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2, d = max - min;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s * 100, l * 100];
  }

  /** Perceptual distance that treats hue as identity and lightness as shading. */
  function labDist(a, b) {
    const dl = a[0] - b[0];
    const dc = Math.sqrt((a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
    return { dl: Math.abs(dl), dc, total: Math.sqrt(0.45 * dl * dl + dc * dc) };
  }

  /* ---------- morphology (integral images, O(n) per op) ---------- */

  function boxSum(mask, w, h, r) {
    const iw = w + 1;
    const ii = new Int32Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      const o = y * w, oi = (y + 1) * iw, pi = y * iw;
      for (let x = 0; x < w; x++) { row += mask[o + x]; ii[oi + x + 1] = ii[pi + x + 1] + row; }
    }
    const out = new Int32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      const a = (y1 + 1) * iw, bq = y0 * iw;
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        out[y * w + x] = ii[a + x1 + 1] - ii[bq + x1 + 1] - ii[a + x0] + ii[bq + x0];
      }
    }
    return out;
  }

  function dilate(mask, w, h, r) {
    if (r <= 0) return mask.slice();
    const c = boxSum(mask, w, h, r), o = new Uint8Array(w * h);
    for (let i = 0; i < o.length; i++) o[i] = c[i] > 0 ? 1 : 0;
    return o;
  }

  function erode(mask, w, h, r) {
    if (r <= 0) return mask.slice();
    const c = boxSum(mask, w, h, r), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        o[y * w + x] = c[y * w + x] >= (y1 - y0 + 1) * (x1 - x0 + 1) ? 1 : 0;
      }
    }
    return o;
  }

  const closeOp = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);
  const openOp  = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r);

  function blurFloat(src, w, h, r) {
    if (r <= 0) return src.slice();
    const iw = w + 1;
    const ii = new Float64Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      const o = y * w, oi = (y + 1) * iw, pi = y * iw;
      for (let x = 0; x < w; x++) { row += src[o + x]; ii[oi + x + 1] = ii[pi + x + 1] + row; }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      const a = (y1 + 1) * iw, bq = y0 * iw;
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        out[y * w + x] = (ii[a + x1 + 1] - ii[bq + x1 + 1] - ii[a + x0] + ii[bq + x0]) /
                         ((y1 - y0 + 1) * (x1 - x0 + 1));
      }
    }
    return out;
  }

  /** Fill enclosed holes. Returns the new mask plus the pixels that were filled. */
  function fillHoles(mask, w, h) {
    const outside = new Uint8Array(w * h);
    const stack = [];
    const seed = p => { if (!mask[p] && !outside[p]) { outside[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (y > 0) seed(p - w);
      if (y < h - 1) seed(p + w);
    }
    const out = new Uint8Array(w * h);
    const filled = new Uint8Array(w * h);
    let n = 0;
    for (let i = 0; i < out.length; i++) {
      if (mask[i]) out[i] = 1;
      else if (!outside[i]) { out[i] = 1; filled[i] = 1; n++; }
    }
    return { mask: out, filled, filledCount: n };
  }

  /** 8-connected labelling. */
  function components(mask, w, h) {
    const labels = new Int32Array(w * h);
    const comps = [];
    const stack = new Int32Array(w * h);
    let next = 1;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      const id = next++;
      let sp = 0;
      stack[sp++] = start;
      labels[start] = id;
      let size = 0, minx = w, miny = h, maxx = 0, maxy = 0, sx = 0, sy = 0;
      while (sp) {
        const p = stack[--sp];
        const x = p % w, y = (p - x) / w;
        size++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx; if (nx < 0 || nx >= w) continue;
            const np = ny * w + nx;
            if (mask[np] && !labels[np]) { labels[np] = id; stack[sp++] = np; }
          }
        }
      }
      comps.push({ id, size, minx, miny, maxx, maxy, cx: sx / size, cy: sy / size });
    }
    return { labels, comps };
  }

  /* ================================================== 2a. semantic — MediaPipe */

  async function fetchModel() {
    try {
      if (global.caches) {
        const cache = await caches.open(CONFIG.cacheName);
        let res = await cache.match(CONFIG.modelUrl);
        if (!res) { await cache.add(CONFIG.modelUrl); res = await cache.match(CONFIG.modelUrl); }
        if (res) return new Uint8Array(await res.arrayBuffer());
      }
    } catch (e) { /* fall through */ }
    const res = await fetch(CONFIG.modelUrl);
    if (!res.ok) throw new Error("model fetch " + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  function loadSegmenter() {
    if (state.loading) return state.loading;
    state.loading = (async () => {
      const mod = await import(/* webpackIgnore: true */ CONFIG.visionBundle);
      const { ImageSegmenter, FilesetResolver } = mod;
      const vision = await FilesetResolver.forVisionTasks(CONFIG.wasmBase);
      const buffer = await fetchModel();
      const make = delegate => ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: buffer, delegate },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: true
      });
      let seg;
      try { seg = await make("GPU"); } catch (e) { seg = await make("CPU"); }
      state.segmenter = seg;
      state.backend = "mediapipe";
      state.ready = true;
      return seg;
    })().catch(err => {
      state.error = err && err.message ? err.message : String(err);
      state.backend = "heuristic";
      state.ready = true;
      state.segmenter = null;
      return null;
    });
    return state.loading;
  }

  function runSegmenter(seg, canvas) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const grab = (result) => {
        if (settled) return;
        settled = true;
        try {
          const conf = result.confidenceMasks;
          const cat = result.categoryMask;
          const mw = (conf && conf[0] ? conf[0].width : cat.width);
          const mh = (conf && conf[0] ? conf[0].height : cat.height);
          const planes = [];
          if (conf && conf.length >= 6) {
            for (let i = 0; i < 6; i++) planes.push(Float32Array.from(conf[i].getAsFloat32Array()));
          } else {
            const idx = cat.getAsUint8Array();
            for (let i = 0; i < 6; i++) planes.push(new Float32Array(mw * mh));
            for (let p = 0; p < idx.length; p++) planes[idx[p]][p] = 1;
          }
          result.close();
          resolve({ w: mw, h: mh, planes });
        } catch (e) { reject(e); }
      };
      try {
        const r = seg.segment(canvas, res => grab(res));
        if (r && (r.confidenceMasks || r.categoryMask)) grab(r);
      } catch (e) { reject(e); }
    });
  }

  function bilinearUp(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    const fx = sw / dw, fy = sh / dh;
    for (let y = 0; y < dh; y++) {
      const sy = clamp((y + 0.5) * fy - 0.5, 0, sh - 1);
      const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), wy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = clamp((x + 0.5) * fx - 0.5, 0, sw - 1);
        const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), wx = sx - x0;
        const a = src[y0 * sw + x0], b = src[y0 * sw + x1];
        const c = src[y1 * sw + x0], d = src[y1 * sw + x1];
        out[y * dw + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
      }
    }
    return out;
  }

  async function semanticMediaPipe(canvas) {
    const seg = state.segmenter || await loadSegmenter();
    if (!seg) return null;
    const w = canvas.width, h = canvas.height;
    const raw = await runSegmenter(seg, canvas);
    const planes = raw.planes.map(p => bilinearUp(p, raw.w, raw.h, w, h));
    let clothes = 0, person = 0;
    for (let i = 0; i < w * h; i++) {
      if (planes[C.CLOTHES][i] > 0.5) clothes++;
      if (planes[C.BG][i] < 0.5) person++;
    }
    if (clothes / (w * h) < 0.012) return null;   // no wearer found here
    return {
      w, h, source: "mediapipe",
      bg: planes[C.BG], hair: planes[C.HAIR], skin: planes[C.SKIN],
      face: planes[C.FACE], clothes: planes[C.CLOTHES], other: planes[C.OTHER],
      personFrac: person / (w * h)
    };
  }

  /* ============================================== 2b. semantic — heuristic path
     For mannequins, flat-lays and product shots the parsing model may see no
     person at all, and it is also the offline fallback. Background comes from
     a colour-guided flood fill off the border; skin from a multi-space rule. */

  function isSkinRGB(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const y  =  0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const ycc = (y > 40 && cb >= 77 && cb <= 133 && cr >= 133 && cr <= 175);
    const [hh, ss, ll] = rgb2hsl(r, g, b);
    const hsl = ((hh <= 50) || (hh >= 335)) && ss >= 12 && ss <= 78 && ll >= 20 && ll <= 92;
    const rgbRule = r > 70 && g > 40 && b > 20 && d >= 14 && (r - g) >= 10 && r > b;
    return (ycc && hsl) || (rgbRule && hsl);
  }

  function semanticHeuristic(canvas) {
    const w = canvas.width, h = canvas.height, n = w * h;
    const px = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;

    const samples = [];
    const push = (x, y) => { const i = (y * w + x) * 4; samples.push([px[i], px[i + 1], px[i + 2]]); };
    const sx = Math.max(1, (w / 40) | 0), sy = Math.max(1, (h / 40) | 0);
    for (let x = 0; x < w; x += sx) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y += sy) { push(0, y); push(w - 1, y); }
    const bgDist = (r, g, b) => {
      let m = Infinity;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const d = (r - s[0]) ** 2 + (g - s[1]) ** 2 + (b - s[2]) ** 2;
        if (d < m) m = d;
      }
      return Math.sqrt(m);
    };

    const bg = new Float32Array(n), skin = new Float32Array(n), clothes = new Float32Array(n);
    const hair = new Float32Array(n), face = new Float32Array(n), other = new Float32Array(n);

    /* Background = pixels that both look like the border colours AND can be
       reached from the border through such pixels. Chaining on small
       colour STEPS instead would creep up a gradient and eat the garment,
       so the only test is distance to the border palette. */
    const flood = (thresh) => {
      const isBg = new Uint8Array(n);
      const q = new Int32Array(n);
      let qt = 0;
      const seed = p => { isBg[p] = 1; q[qt++] = p; };
      for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (let y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }
      let qh = 0;
      while (qh < qt) {
        const p = q[qh++];
        const x = p % w, y = (p - x) / w;
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const np = ny * w + nx;
          if (isBg[np]) continue;
          const j = np * 4;
          if (bgDist(px[j], px[j + 1], px[j + 2]) < thresh) { isBg[np] = 1; q[qt++] = np; }
        }
      }
      let fg = 0;
      for (let p = 0; p < n; p++) if (!isBg[p]) fg++;
      return { isBg, fgFrac: fg / n };
    };

    // Start tight and loosen only as needed: the tightest threshold that
    // still clears the background is the one that keeps a white shirt on a
    // white wall. Busy backgrounds fall through to the looser passes.
    let isBg = null, best = null;
    for (const thresh of [11, 15, 20, 26, 34, 44]) {
      const r = flood(thresh);
      if (r.fgFrac >= 0.06 && r.fgFrac <= 0.8) { isBg = r.isBg; break; }
      if (!best || Math.abs(r.fgFrac - 0.35) < Math.abs(best.fgFrac - 0.35)) best = r;
    }
    if (!isBg) isBg = best.isBg;

    for (let p = 0; p < n; p++) {
      const i = p * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      if (isBg[p]) { bg[p] = 1; continue; }
      if (isSkinRGB(r, g, b)) { skin[p] = 1; continue; }
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const [hh, ss, ll] = rgb2hsl(r, g, b);
      const y = (p / w) | 0;
      if ((y < h * 0.42) && (lum < 55 || (hh >= 8 && hh <= 45 && ss > 18 && ll < 42))) { hair[p] = 1; continue; }
      clothes[p] = 1;
    }
    let cl = 0;
    for (let p = 0; p < n; p++) cl += clothes[p];
    if (cl / n < 0.01) return null;
    return { w, h, source: "heuristic", bg, hair, skin, face, clothes, other, personFrac: 1 - cl / n };
  }

  /* ==================================================== 3. anatomy estimation */

  function estimateAnatomy(sem) {
    const { w, h } = sem;
    const bodyRow = new Float32Array(h), headRow = new Float32Array(h), clothRow = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let body = 0, head = 0, cloth = 0;
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (sem.bg[p] < 0.5) body++;
        if (sem.face[p] > 0.4 || sem.hair[p] > 0.4) head++;
        if (sem.clothes[p] > 0.5) cloth++;
      }
      bodyRow[y] = body / w; headRow[y] = head / w; clothRow[y] = cloth / w;
    }

    let personTop = h, personBottom = 0, personLeft = w, personRight = 0;
    for (let y = 0; y < h; y++) if (bodyRow[y] > 0.01) { if (y < personTop) personTop = y; personBottom = y; }
    for (let x = 0; x < w; x++) {
      let any = false;
      for (let y = 0; y < h; y += 2) if (sem.bg[y * w + x] < 0.5) { any = true; break; }
      if (any) { if (x < personLeft) personLeft = x; personRight = x; }
    }
    if (personTop >= personBottom) { personTop = 0; personBottom = h - 1; personLeft = 0; personRight = w - 1; }

    // The head has to come from the FACE, not from hair: long hair reaches the
    // waist and would inflate the head height, throwing every landmark off.
    let faceTop = -1, faceBottom = -1;
    for (let y = 0; y < h; y++) {
      let face = 0;
      for (let x = 0; x < w; x++) if (sem.face[y * w + x] > 0.5) face++;
      if (face > Math.max(2, w * 0.004)) { if (faceTop < 0) faceTop = y; faceBottom = y; }
    }
    let headTop = -1, headBottom = -1;
    for (let y = 0; y < h; y++) if (headRow[y] > 0.008) { if (headTop < 0) headTop = y; headBottom = y; }

    const bodyH = personBottom - personTop;
    let shoulderY, hipY, kneeY;
    if (faceTop >= 0 && faceBottom > faceTop + 3) {
      // face-skin spans roughly brow-to-chin, about 0.62 of a full head
      const headH = clamp((faceBottom - faceTop) / 0.62, 8, bodyH * 0.32);
      shoulderY = faceBottom + headH * 0.30;
      hipY      = faceBottom + headH * 2.95;
      kneeY     = faceBottom + headH * 5.30;
    } else if (headTop >= 0 && headBottom > headTop + 4) {
      const headH = clamp(headBottom - headTop, 6, bodyH * 0.3);
      shoulderY = headTop + headH * 1.15;
      hipY      = headTop + headH * 4.0;
      kneeY     = headTop + headH * 6.4;
    } else {
      shoulderY = personTop + bodyH * 0.16;
      hipY      = personTop + bodyH * 0.52;
      kneeY     = personTop + bodyH * 0.76;
    }
    shoulderY = clamp(shoulderY, personTop, personBottom);
    hipY      = clamp(hipY, shoulderY + 4, personBottom);
    kneeY     = clamp(kneeY, hipY + 4, personBottom);

    // Cropped shot: if the clothing ends well above the modelled hip, rescale
    // the landmarks onto the garment extent instead of the body proportions.
    let clothTop = -1, clothBottom = -1;
    for (let y = 0; y < h; y++) if (clothRow[y] > 0.02) { if (clothTop < 0) clothTop = y; clothBottom = y; }
    if (clothTop >= 0 && clothBottom > clothTop && clothBottom < hipY) {
      const span = clothBottom - clothTop;
      shoulderY = clothTop + span * 0.05;
      hipY      = clothTop + span * 0.62;
      kneeY     = clothTop + span * 0.9;
    }

    return { personTop, personBottom, personLeft, personRight, headTop, headBottom,
             faceTop, faceBottom, shoulderY, hipY, kneeY, clothTop, clothBottom, bodyH };
  }

  /* ================================================ 4. stacked-piece analysis */

  function kmeansLab(px, w, h, mask, k) {
    const pts = [];
    const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 7000)));
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const p = y * w + x;
        if (!mask[p]) continue;
        const i = p * 4;
        pts.push(rgb2lab(px[i], px[i + 1], px[i + 2]));
      }
    }
    if (pts.length < k * 6) return null;
    // Seeded, not random: the same photo must always produce the same cutout,
    // otherwise a metric moving between runs tells you nothing about a change.
    const rng = makeRng((w * 73856093) ^ (h * 19349663) ^ pts.length);
    const pick = () => pts[(rng() * pts.length) | 0];
    const cent = [pick().slice()];
    while (cent.length < k) {
      let best = null, bestD = -1;
      for (let t = 0; t < Math.min(pts.length, 500); t++) {
        const c = pick();
        let d = Infinity;
        for (const q of cent) {
          const dd = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2;
          if (dd < d) d = dd;
        }
        if (d > bestD) { bestD = d; best = c; }
      }
      cent.push(best.slice());
    }
    for (let it = 0; it < 14; it++) {
      const sum = cent.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        for (let c = 0; c < cent.length; c++) {
          const q = cent[c];
          const d = 0.45 * (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          if (d < bd) { bd = d; bi = c; }
        }
        sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++;
      }
      for (let c = 0; c < cent.length; c++) {
        if (!sum[c][3]) continue;
        cent[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
      }
    }
    return cent;
  }

  function assignClusters(px, w, h, mask, cent) {
    const assign = new Uint8Array(w * h);
    if (!cent) { for (let p = 0; p < w * h; p++) if (mask[p]) assign[p] = 1; return assign; }
    for (let p = 0; p < w * h; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      const lab = rgb2lab(px[i], px[i + 1], px[i + 2]);
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cent.length; c++) {
        const q = cent[c];
        const d = 0.45 * (lab[0] - q[0]) ** 2 + (lab[1] - q[1]) ** 2 + (lab[2] - q[2]) ** 2;
        if (d < bd) { bd = d; bi = c; }
      }
      assign[p] = bi + 1;
    }
    return assign;
  }

  /**
   * A worn outfit is a vertical stack: top over skirt over shoes. So instead of
   * carving the clothing blob into colour blobs (which shatters a single dress
   * across its own folds), decide per ROW which garment owns it, then keep
   * every clothing pixel in that row band. Pieces stay solid by construction.
   */
  function decomposePieces(px, w, h, base, cent, assign) {
    const k = cent ? cent.length : 1;
    const rowTotal = new Int32Array(h);
    const rowHist = [];
    for (let y = 0; y < h; y++) {
      const hist = new Int32Array(k + 1);
      let tot = 0;
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!base[p]) continue;
        hist[assign[p]]++; tot++;
      }
      rowHist.push(hist);
      rowTotal[y] = tot;
    }
    const minRow = Math.max(2, w * 0.012);
    const dom = new Int32Array(h).fill(0);
    for (let y = 0; y < h; y++) {
      if (rowTotal[y] < minRow) continue;
      let bi = 0, bv = -1;
      for (let c = 1; c <= k; c++) if (rowHist[y][c] > bv) { bv = rowHist[y][c]; bi = c; }
      dom[y] = bi;
    }
    // median-smooth the dominant label so speckled rows don't create pieces
    const sm = new Int32Array(h);
    const R = Math.max(2, Math.round(h * 0.012));
    for (let y = 0; y < h; y++) {
      if (!dom[y]) { sm[y] = 0; continue; }
      const cnt = new Int32Array(k + 1);
      for (let d = -R; d <= R; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h || !dom[yy]) continue;
        cnt[dom[yy]]++;
      }
      let bi = dom[y], bv = -1;
      for (let c = 1; c <= k; c++) if (cnt[c] > bv) { bv = cnt[c]; bi = c; }
      sm[y] = bi;
    }

    // Runs of identical dominant label. A stretch of rows with no clothing at
    // all (bare midriff, gap between hem and shoes) is a hard separator: two
    // garments of the same colour must not be glued together across it.
    const gapLimit = Math.max(3, h * 0.02);
    let runs = [];
    let cur = null;
    let lastContentRow = -1;
    for (let y = 0; y < h; y++) {
      if (!sm[y]) continue;
      const gap = lastContentRow < 0 ? 0 : y - lastContentRow - 1;
      if (cur && cur.label === sm[y] && gap <= gapLimit) { cur.bot = y; cur.rows++; }
      else {
        if (cur) runs.push(cur);
        cur = { label: sm[y], top: y, bot: y, rows: 1, gapBefore: gap > gapLimit };
      }
      lastContentRow = y;
    }
    if (cur) runs.push(cur);
    if (!runs.length) return [{ label: 1, top: 0, bot: h - 1, size: 0, lab: [50, 0, 0] }];

    const centroidOf = run => {
      let L = 0, A = 0, B = 0, n = 0;
      for (let y = run.top; y <= run.bot; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (!base[p]) continue;
          const i = p * 4;
          const lab = rgb2lab(px[i], px[i + 1], px[i + 2]);
          L += lab[0]; A += lab[1]; B += lab[2]; n++;
        }
      }
      run.size = n;
      run.lab = n ? [L / n, A / n, B / n] : [50, 0, 0];
      return run;
    };
    runs.forEach(centroidOf);

    // absorb thin runs (belts, waistbands, trim) into the closer neighbour
    const minRun = Math.max(8, h * 0.05);
    let changed = true;
    while (changed && runs.length > 1) {
      changed = false;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if ((r.bot - r.top) >= minRun && r.size > w * h * 0.004) continue;
        // only absorb into a neighbour it is physically continuous with
        const prev = (!r.gapBefore && runs[i - 1]) ? runs[i - 1] : null;
        const nextRun = runs[i + 1];
        const nxt = (nextRun && !nextRun.gapBefore) ? nextRun : null;
        let target = null;
        if (prev && nxt) target = labDist(r.lab, prev.lab).total <= labDist(r.lab, nxt.lab).total ? prev : nxt;
        else target = prev || nxt;
        if (!target) continue;
        if (target === nxt) target.gapBefore = r.gapBefore;
        target.top = Math.min(target.top, r.top);
        target.bot = Math.max(target.bot, r.bot);
        runs.splice(i, 1);
        centroidOf(target);
        changed = true;
        break;
      }
    }
    // merge neighbours that are really the same fabric
    changed = true;
    while (changed && runs.length > 1) {
      changed = false;
      for (let i = 0; i < runs.length - 1; i++) {
        const a = runs[i], b = runs[i + 1];
        if (b.gapBefore) continue;               // physically separate garments
        const d = labDist(a.lab, b.lab);
        // Same hue but darker is shading, a belt or a waistband — one garment.
        // A different hue is a different garment however similar the tone.
        if (a.label === b.label || (d.dc < 8 && d.dl < 45) || (d.dc < 12 && d.dl < 26) || d.total < 14) {
          a.bot = Math.max(a.bot, b.bot);
          a.top = Math.min(a.top, b.top);
          runs.splice(i + 1, 1);
          centroidOf(a);
          changed = true;
          break;
        }
      }
    }
    runs.sort((a, b) => a.top - b.top);
    return runs;
  }

  /**
   * Materialise one piece: every clothing pixel inside its row band, with the
   * band shared with a neighbouring piece resolved by colour so the waistline
   * lands where the fabrics actually change (and can be diagonal).
   */
  function buildPieceMask(px, w, h, base, pieces, index) {
    const piece = pieces[index];
    // Neighbours only share a boundary band when they actually touch; across a
    // bare gap the piece simply ends.
    const prev = (!piece.gapBefore && pieces[index - 1]) ? pieces[index - 1] : null;
    const nextRun = pieces[index + 1];
    const next = (nextRun && !nextRun.gapBefore) ? nextRun : null;
    const band = Math.max(4, Math.round(h * 0.035));
    const mask = new Uint8Array(w * h);
    const near = (lab, a, b) => labDist(lab, a).total <= labDist(lab, b).total;

    const top = prev ? piece.top - band : piece.top;
    const bot = next ? piece.bot + band : piece.bot;
    for (let y = Math.max(0, top); y <= Math.min(h - 1, bot); y++) {
      const inPrevBand = prev && y < piece.top + band;
      const inNextBand = next && y > piece.bot - band;
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!base[p]) continue;
        if (inPrevBand || inNextBand) {
          const i = p * 4;
          const lab = rgb2lab(px[i], px[i + 1], px[i + 2]);
          const other = inPrevBand ? prev.lab : next.lab;
          if (!near(lab, piece.lab, other)) continue;
        }
        mask[p] = 1;
      }
    }
    return mask;
  }

  /**
   * Things lying ON the garment — a crossbody bag, its strap, a belt bag, a
   * necklace — are colour islands that the fabric wraps around. Drop any
   * minority colour cluster inside the piece that is mostly surrounded by the
   * garment and far from its colour. A two-tone print fails the "surrounded"
   * test (it spreads to the silhouette edge), so patterns survive.
   */
  function rejectOccluders(px, w, h, mask, assign, cent, pieceLab) {
    if (!cent) return { removed: new Uint8Array(w * h), count: 0 };
    let pieceArea = 0;
    for (let p = 0; p < w * h; p++) pieceArea += mask[p];
    const removed = new Uint8Array(w * h);
    if (pieceArea < 400) return { removed, count: 0 };

    let count = 0;
    for (let c = 1; c <= cent.length; c++) {
      const d = labDist(cent[c - 1], pieceLab);
      if (d.total < 24) continue;                       // same fabric family
      const sub = new Uint8Array(w * h);
      let area = 0;
      for (let p = 0; p < w * h; p++) if (mask[p] && assign[p] === c) { sub[p] = 1; area++; }
      if (!area || area > pieceArea * 0.22) continue;   // too big to be an add-on
      const { labels, comps } = components(sub, w, h);
      for (const comp of comps) {
        if (comp.size < pieceArea * 0.002) continue;

        // How much of the garment's width does it take over on its own rows?
        // A colour-blocked panel or a hem band spans the garment; a bag,
        // a strap or a necklace only covers part of it.
        let compRow = 0, maskRow = 0;
        for (let y = comp.miny; y <= comp.maxy; y++) {
          for (let x = 0; x < w; x++) {
            const p = y * w + x;
            if (labels[p] === comp.id) compRow++;
            if (mask[p] || labels[p] === comp.id) maskRow++;
          }
        }
        const widthRatio = maskRow ? compRow / maskRow : 1;

        // Fabric shading fades; an object laid on top has a hard edge.
        let border = 0, enclosed = 0, gradSum = 0, gradN = 0;
        for (let y = comp.miny; y <= comp.maxy; y++) {
          for (let x = comp.minx; x <= comp.maxx; x++) {
            const p = y * w + x;
            if (labels[p] !== comp.id) continue;
            const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1,
                        y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
            for (const q of nb) {
              if (q < 0) { border++; continue; }
              if (labels[q] === comp.id) continue;
              border++;
              if (mask[q] && assign[q] !== c) {
                enclosed++;
                const i = p * 4, j = q * 4;
                const a = rgb2lab(px[i], px[i + 1], px[i + 2]);
                const b = rgb2lab(px[j], px[j + 1], px[j + 2]);
                gradSum += labDist(a, b).total; gradN++;
              }
            }
          }
        }
        const enclosure = border ? enclosed / border : 0;
        const sharp = gradN ? gradSum / gradN : 0;
        const isAddOn = (enclosure > 0.4 || widthRatio < 0.6) &&
                        enclosure > 0.15 && sharp > 16 && comp.size < pieceArea * 0.18;
        if (isAddOn) {
          for (let p = 0; p < w * h; p++) if (labels[p] === comp.id) { removed[p] = 1; mask[p] = 0; count++; }
        }
      }
    }
    return { removed, count };
  }

  /**
   * Straps and chains cross a garment as long, thin, high-contrast lines. They
   * survive the cluster test because they are only a few pixels wide, so catch
   * them by shape: a structure that vanishes under a small erosion AND runs a
   * long way is a strap. Lace holes and prints are short and stubby, so they
   * fail the elongation test and stay.
   */
  function removeThinOccluders(px, w, h, mask, removed, diag) {
    let n = 0, gh = 0, top = h, bot = 0;
    for (let y = 0; y < h; y++) {
      let any = false;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) { any = true; n++; }
      if (any) { if (y < top) top = y; bot = y; }
    }
    gh = bot - top;
    if (n < 900 || gh < 40) return 0;

    // local fabric colour, then the deviation from it
    const chan = [0, 1, 2].map(c => {
      const src = new Float32Array(w * h), wt = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) if (mask[p]) { src[p] = px[p * 4 + c]; wt[p] = 1; }
      return { v: blurFloat(src, w, h, Math.max(4, Math.round(w * 0.05))), wt };
    });
    const wsum = blurFloat(chan[0].wt, w, h, Math.max(4, Math.round(w * 0.05)));
    const dev = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (!mask[p] || wsum[p] < 0.05) continue;
      const i = p * 4;
      const local = rgb2lab(chan[0].v[p] / wsum[p], chan[1].v[p] / wsum[p], chan[2].v[p] / wsum[p]);
      const here = rgb2lab(px[i], px[i + 1], px[i + 2]);
      if (labDist(here, local).total > 13) dev[p] = 1;
    }
    if (diag) diag.dev = dev;
    // a thin line breaks into dashes once it is only a couple of pixels wide,
    // so bridge collinear fragments before measuring
    const linked = closeOp(dev, w, h, 3);
    const { labels, comps } = components(linked, w, h);
    const maxWidth = Math.max(3, w * 0.025);

    const candidates = [];
    for (const comp of comps) {
      const bw = comp.maxx - comp.minx + 1, bh = comp.maxy - comp.miny + 1;
      const maxDim = Math.max(bw, bh);
      const meanWidth = comp.size / maxDim;         // area over length
      const elong = maxDim / Math.max(1, meanWidth);
      const slant = bw / Math.max(1, bh);
      const info = { size: comp.size, bw, bh, meanWidth: +meanWidth.toFixed(1),
                     elong: +elong.toFixed(1), slant: +slant.toFixed(2) };
      if (diag && comp.size > 30) diag.thin.push(info);
      if (meanWidth > maxWidth) continue;           // a patch of fabric, not a line
      if (elong < 8) continue;                      // stubby: texture, not a strap
      if (maxDim < gh * 0.18) continue;             // too short to be a strap
      if (slant < 0.2) continue;                    // near-vertical: a pleat, a seam, a zip
      candidates.push(comp);
    }
    // Several parallel lines are a woven texture (pleats, stripes, ribbing),
    // not something lying on the garment. Only pull off a couple of them.
    if (!candidates.length || candidates.length > 3) {
      if (diag) diag.thinSkipped = candidates.length;
      return 0;
    }

    let removedCount = 0;
    for (const comp of candidates) {
      const line = new Uint8Array(w * h);
      for (let p = 0; p < w * h; p++) if (labels[p] === comp.id) line[p] = 1;
      const grown = dilate(line, w, h, 1);          // take the soft edge with it
      for (let p = 0; p < w * h; p++) {
        if (grown[p] && mask[p]) { mask[p] = 0; removed[p] = 1; removedCount++; }
      }
    }
    return removedCount;
  }

  /**
   * An occluder (bag, hand, strap) leaves a bite in the silhouette. Where the
   * removed pixels are boxed in by garment on most sides they were clearly
   * *on top of* the fabric, so put the silhouette back and let the inpainter
   * paint fabric over them.
   */
  function repairOccluded(mask, removed, w, h) {
    const R = Math.max(6, Math.round(w * 0.12));
    const patch = new Uint8Array(w * h);
    let n = 0;
    const hit = (x, y, dx, dy) => {
      for (let s = 1; s <= R; s++) {
        const nx = x + dx * s, ny = y + dy * s;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return 0;
        if (mask[ny * w + nx]) return 1;
      }
      return 0;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!removed[p] || mask[p]) continue;
        const hits = hit(x, y, -1, 0) + hit(x, y, 1, 0) + hit(x, y, 0, -1) + hit(x, y, 0, 1);
        if (hits >= 3) { patch[p] = 1; n++; }
      }
    }
    for (let p = 0; p < w * h; p++) if (patch[p]) mask[p] = 1;
    return { patch, count: n };
  }

  /**
   * Put back the fabric that hair and limbs were standing in front of.
   *
   * WHY repairOccluded ABOVE IS NOT ENOUGH. That one works from `removed` —
   * pixels the parser called clothing and the cleanup then took away. It
   * therefore cannot see the commonest bite of all, because when hair falls
   * over a shoulder or a forearm crosses the waist the parser labels those
   * pixels hair and skin from the very start. They are never in the mask, so
   * they are never in `removed`, and nothing downstream has any reason to look
   * at them. fillHoles does not help either: a bite is an INDENTATION open to
   * the outside, not an enclosed hole, so the flood reaches it from the border
   * and it stays empty. The result is a cutout with a wedge missing, which is
   * exactly what was being reported.
   *
   * WHAT MARKS A BITE. Closing the garment mask with a kernel a tenth of its
   * width fills every concavity narrower than the kernel and leaves the
   * garment's real outline alone. So `closed AND NOT mask` is the set of
   * narrow indentations — and intersecting that with "the parser saw hair or
   * skin here" keeps only the ones something was standing in. That second
   * condition is the discipline of the whole function: a sleeve gap or the
   * split of a wrap skirt is also an indentation, and painting fabric into one
   * would be inventing a garment nobody photographed. Fabric is only put back
   * where an occluder explains its absence.
   *
   * HOW A NECKLINE IS TOLD APART. A neckline is an indentation too, with the
   * wearer's own skin showing through it, and it satisfies every test above.
   * Filling one turns a V-neck into a boat neck, which is a change to the
   * garment's design and far worse than leaving a bite.
   *
   * The first attempt refused to fill anything above the estimated bust line.
   * It did protect necklines, and it also refused every bite hair leaves on a
   * shoulder or a chest — the commonest case there is — so the repair went on
   * leaving precisely the holes it exists to close.
   *
   * What separates them is what lies ABOVE. A neckline is the garment's own top
   * edge: look up from it and there is neck, then chin, and no fabric. A bite
   * is fabric interrupted: look up from it and the garment carries on, because
   * whatever crossed it was in front of a piece of clothing that continues
   * above. Counted column by column that is not a close call — a scoop neck
   * scores near zero, a lock of hair over a chest near one — and it asks
   * nothing of an anatomy estimate.
   */
  function repairOccluderBites(mask, sem, w, h, diag) {
    const patch = new Uint8Array(w * h);
    let minx = w, maxx = -1, miny = h, maxy = -1, area = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        area++;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    }
    if (area < 400 || maxx < minx) return { patch, count: 0, why: "garment too small" };

    const gw = maxx - minx + 1, gh = maxy - miny + 1;
    const radius = clamp(Math.round(gw * 0.10), 4, 40);

    /* The unit of judgement is the NOTCH, not the occluder pixels in it.
       Judging pixel by pixel was the first attempt and it was wrong twice
       over. The parser only marks the solidly-lit part of a lock of hair, so
       the marked pixels are a sliver adrift in a much larger notch: filling
       just those leaves the bite half-repaired and speckled, and asking how
       much fabric surrounds the sliver answers a question about the sliver
       rather than about the bite. Taking whole notches instead asks the
       question that matters — "is this dent in the outline explained by
       something standing in it?" — and fills the dent completely, so the
       repaired edge is the garment's own line. */
    const closed = closeOp(mask, w, h, radius);
    const notch = new Uint8Array(w * h);
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const p = y * w + x;
        if (!mask[p] && closed[p]) notch[p] = 1;
      }
    }

    /* Too small to be worth painting.
       A notch of a few dozen pixels on the processing canvas is invisible in
       the cutout, but a repair that comes out the wrong colour is not: the
       fewer clean pixels there are around a bite, the more the diffusion has
       to work with whatever it can reach, and a speck at a hem — where a
       t-shirt meets jeans and skin — was being painted pink. Nothing is lost
       by leaving those alone, and a visible speck is avoided. */
    const floor = Math.max(120, Math.round(area * 0.0015));

    const { labels, comps } = components(notch, w, h);
    const accepted = [], rejected = [];
    for (const comp of comps) {
      if (comp.size < floor) continue;
      const share = comp.size / area;
      // Too big to be an occlusion. Half a garment missing is a failed parse,
      // and painting over it would hand back a large area of invented fabric.
      if (share > 0.22) { rejected.push({ size: comp.size, why: "too large: " + share.toFixed(3) }); continue; }

      let occ = 0, faces = 0, bg = 0;
      for (let y = comp.miny; y <= comp.maxy; y++) {
        for (let x = comp.minx; x <= comp.maxx; x++) {
          const p = y * w + x;
          if (labels[p] !== comp.id) continue;
          if (sem.face[p] > 0.5) faces++;
          else if (sem.hair[p] > 0.5 || sem.skin[p] > 0.5) occ++;
          else if (sem.bg[p] > 0.5) bg++;
        }
      }
      const occShare = occ / comp.size;
      // A face is not something a garment hides behind.
      if (faces / comp.size > 0.05) { rejected.push({ size: comp.size, why: "face in it" }); continue; }
      // Mostly open sky is a gap in the outfit, not a bite: the space between
      // two trouser legs, or the split of a wrap skirt.
      if (bg / comp.size > 0.45) { rejected.push({ size: comp.size, why: "mostly background" }); continue; }
      if (occShare < 0.4) {
        rejected.push({ size: comp.size, why: "no occluder explains it: " + occShare.toFixed(2) });
        continue;
      }

      /* IS THERE GARMENT ABOVE IT? — the neckline test.
         This is the one question that separates a bite from a neckline, and it
         replaced a blunt rule that refused to fill anything above the bust.
         That rule did keep V-necks intact, and it also refused every bite hair
         leaves on a shoulder or a chest, which is the commonest of all — so
         the repair kept leaving exactly the holes it was built to close.
         A neckline is the garment's own top edge: look up from it and there is
         neck, then chin, and no fabric anywhere. A bite is fabric interrupted:
         look up from it and the garment continues, because the hair or the
         forearm crossed a piece of clothing that carries on above. Measured
         column by column, that difference is stark — a scoop neck scores near
         zero and a lock of hair over a chest scores near one — and it needs no
         guess about where a body's bust is. */
      let withFabricAbove = 0, columns = 0;
      const reach = Math.max(radius, Math.round(gh * 0.06));
      for (let x = comp.minx; x <= comp.maxx; x++) {
        let topOfNotch = -1;
        for (let y = comp.miny; y <= comp.maxy; y++) {
          if (labels[y * w + x] === comp.id) { topOfNotch = y; break; }
        }
        if (topOfNotch < 0) continue;
        columns++;
        for (let y = topOfNotch - 1; y >= Math.max(0, topOfNotch - reach); y--) {
          if (mask[y * w + x]) { withFabricAbove++; break; }
        }
      }
      const roofed = withFabricAbove / Math.max(1, columns);
      if (roofed < 0.55) {
        rejected.push({ size: comp.size,
                        why: "open to the top, so it is the garment's own neckline: " + roofed.toFixed(2) });
        continue;
      }

      accepted.push({ size: comp.size, occluder: +occShare.toFixed(2),
                      roofed: +roofed.toFixed(2), share: +share.toFixed(4) });
      for (let y = comp.miny; y <= comp.maxy; y++) {
        for (let x = comp.minx; x <= comp.maxx; x++) {
          const p = y * w + x;
          if (labels[p] === comp.id) { patch[p] = 1; mask[p] = 1; }
        }
      }
    }
    let count = 0;
    for (let p = 0; p < w * h; p++) if (patch[p]) count++;
    if (diag) { diag.radius = radius; diag.floor = floor;
                diag.accepted = accepted; diag.rejected = rejected; }
    return { patch, count, accepted, rejected };
  }

  /**
   * Bare limbs are routinely parsed as clothing on mannequins (pale plastic
   * legs read as trousers). A garment that suddenly narrows to limb width at
   * the bottom *and* turns the colour of the wearer's own skin is wearing the
   * body, not fabric — trim it.
   */
  function trimBareLimbs(px, w, h, mask, sem) {
    let sl = 0, sa = 0, sb = 0, n = 0;
    for (let p = 0; p < w * h; p++) {
      if (sem.skin[p] < 0.7 && sem.face[p] < 0.7) continue;
      const i = p * 4;
      const lab = rgb2lab(px[i], px[i + 1], px[i + 2]);
      sl += lab[0]; sa += lab[1]; sb += lab[2]; n++;
      if (n > 4000) break;
    }
    if (n < 200) return 0;
    const skinLab = [sl / n, sa / n, sb / n];

    const rowW = new Int32Array(h);
    let top = -1, bot = -1;
    for (let y = 0; y < h; y++) {
      let c = 0;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) c++;
      rowW[y] = c;
      if (c) { if (top < 0) top = y; bot = y; }
    }
    if (top < 0 || bot - top < 20) return 0;
    const widths = [];
    for (let y = top; y <= top + (bot - top) * 0.6; y++) if (rowW[y]) widths.push(rowW[y]);
    if (!widths.length) return 0;
    widths.sort((a, b) => a - b);
    const median = widths[widths.length >> 1];

    let cut = bot + 1;
    for (let y = bot; y > top; y--) {
      if (rowW[y] > median * 0.45) break;
      cut = y;
    }
    const stretch = bot - cut + 1;
    if (stretch < (bot - top) * 0.05 || cut <= top) return 0;

    let cl = 0, ca = 0, cb = 0, cn = 0;
    for (let y = cut; y <= bot; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!mask[p]) continue;
        const i = p * 4;
        const lab = rgb2lab(px[i], px[i + 1], px[i + 2]);
        cl += lab[0]; ca += lab[1]; cb += lab[2]; cn++;
      }
    }
    if (!cn) return 0;
    const d = labDist([cl / cn, ca / cn, cb / cn], skinLab);
    if (d.dc > 9 || d.dl > 22) return 0;      // real fabric, just a narrow hem

    let trimmed = 0;
    for (let y = cut; y <= bot; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (mask[p]) { mask[p] = 0; trimmed++; }
      }
    }
    return trimmed;
  }

  /* ================================================== 5. piece selection */

  const MODE_ALIASES = {
    top: "top", tops: "top", shirt: "top", tshirt: "top", "t-shirt": "top", kurti: "top", blouse: "top",
    bottom: "bottom", bottoms: "bottom", pants: "bottom", trousers: "bottom", jeans: "bottom", skirt: "bottom",
    dress: "dress", dresses: "dress", gown: "dress",
    jacket: "outer", jackets: "outer", coat: "outer", outer: "outer",
    bag: "bag", bags: "bag", purse: "bag", handbag: "bag",
    accessory: "accessory", accessories: "accessory", jewellery: "accessory", jewelry: "accessory",
    footwear: "footwear", shoes: "footwear", boots: "footwear", heels: "footwear",
    full: "full", all: "full", outfit: "full", "full garment": "full",
    auto: "auto", "": "auto"
  };

  function overlap(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }

  /**
   * Which of the stacked pieces did the caller ask for? Position *within the
   * outfit* is the reliable signal — a top is the piece above the bottom, no
   * matter how the body proportions come out — so the pieces are scored on
   * their relative place in the clothing stack, with landmarks only nudging.
   */
  function selectPiece(pieces, anat, mode, hintRow) {
    const geo = pieces.map(p => p);
    const cTop = Math.min.apply(null, geo.map(p => p.top));
    const cBot = Math.max.apply(null, geo.map(p => p.bot));
    const S = Math.max(1, cBot - cTop);
    const totalSize = Math.max(1, geo.reduce((a, p) => a + (p.size || 0), 0));

    const info = pieces.map((p, i) => {
      const span = Math.max(1, p.bot - p.top);
      return {
        i,
        center: ((p.top + p.bot) / 2 - cTop) / S,
        relTop: (p.top - cTop) / S,
        relBot: (p.bot - cTop) / S,
        spanFrac: span / S,
        sizeFrac: (p.size || 0) / totalSize,
        atFloor: (cBot - p.bot) / S < 0.06
      };
    });

    const name = i => {
      const it = info[i];
      if (it.spanFrac > 0.5 && it.relTop < 0.35 && it.relBot > 0.55) return "dress";
      return it.center < 0.45 ? "top" : "bottom";
    };
    const resolve = i => (mode === "auto" ? name(i) : mode);

    /**
     * A dress is one garment even when its belt or its bodice shading split it
     * into stacked pieces, so it claims every piece it is physically joined to
     * in the same colour family. A gap in the clothing, or a different hue,
     * ends the claim.
     */
    const claim = (i, asMode) => {
      if (asMode === "full") return pieces.map((_, k) => k);
      if (asMode !== "dress") return [i];
      const out = [i];
      const walk = (step) => {
        let pending = [];
        for (let k = i + step; k >= 0 && k < pieces.length; k += step) {
          const boundary = step < 0 ? pieces[k + 1] : pieces[k];
          if (boundary.gapBefore) break;                       // separate garment
          const span = pieces[k].bot - pieces[k].top;
          const sameFabric = labDist(pieces[k].lab, pieces[i].lab).dc <= 16;
          if (sameFabric) { pending.push(k); out.push.apply(out, pending); pending = []; }
          else if (span < S * 0.16) pending.push(k);            // a belt or a waistband
          else break;                                          // a different garment
        }
      };
      walk(-1);
      walk(1);
      out.sort((a, b) => a - b);
      return out;
    };

    if (pieces.length === 1) {
      const r0 = resolve(0);
      return { index: 0, indices: claim(0, r0), resolved: r0, info };
    }

    if (hintRow != null) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < pieces.length; i++) {
        if (hintRow >= pieces[i].top && hintRow <= pieces[i].bot) { best = i; bestD = -1; break; }
        const d = Math.min(Math.abs(hintRow - pieces[i].top), Math.abs(hintRow - pieces[i].bot));
        if (d < bestD) { bestD = d; best = i; }
      }
      // A tap outranks the requested mode: the user pointed at the garment
      // they mean, so name it for what it actually is.
      const garmentModes = { auto: 1, top: 1, bottom: 1, dress: 1, outer: 1 };
      const hinted = garmentModes[mode] ? name(best) : mode;
      return { index: best, indices: claim(best, hinted), resolved: hinted, info, hinted: true };
    }

    const scores = info.map(it => {
      // shoes: a small piece sitting on the floor line
      const shoeish = (it.atFloor && it.sizeFrac < 0.14 && it.center > 0.7) ? 1 : 0;
      let s;
      switch (mode) {
        case "top": case "outer":
          s = (1 - it.center) * 2 + it.sizeFrac * 1.2 - shoeish * 2;
          break;
        case "bottom":
          s = it.center * 1.6 + it.sizeFrac * 2.5 - shoeish * 1.8;
          break;
        case "dress":
          s = it.spanFrac * 1.6 + it.sizeFrac * 2 - Math.abs(it.center - 0.45) - shoeish * 2.5;
          break;
        case "footwear":
          s = shoeish * 3 + it.center * 1.5 - it.sizeFrac;
          break;
        case "bag": case "accessory":
          s = it.sizeFrac + (1 - Math.abs(it.center - 0.45)) * 0.6;
          break;
        default:   // auto — the biggest garment, nudged towards the upper body
          s = it.sizeFrac * 2 + it.spanFrac + (1 - it.center) * 0.5 - shoeish * 2;
          break;
      }
      return Object.assign({ s, shoeish }, it);
    });
    scores.sort((a, b) => b.s - a.s);
    const pickIdx = scores[0].i;
    const resolved = resolve(pickIdx);
    return { index: pickIdx, indices: claim(pickIdx, resolved), resolved, info, scores };
  }

  /* ======================================================== 6/7. matte + fix */

  function matte(px, w, h, hard, soft, radius) {
    const rIn = Math.max(2, radius), rOut = Math.max(3, radius + 1), rBox = Math.max(6, radius * 3);
    const inner = erode(hard, w, h, rIn);
    const outer = dilate(hard, w, h, rOut);
    const fgW = new Float32Array(w * h), bgW = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) { if (inner[p]) fgW[p] = 1; if (!outer[p]) bgW[p] = 1; }

    const chan = [0, 1, 2].map(c => {
      const f = new Float32Array(w * h), b = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) {
        const v = px[p * 4 + c];
        if (fgW[p]) f[p] = v;
        if (bgW[p]) b[p] = v;
      }
      return { f: blurFloat(f, w, h, rBox), b: blurFloat(b, w, h, rBox) };
    });
    const fCount = blurFloat(fgW, w, h, rBox), bCount = blurFloat(bgW, w, h, rBox);

    const alpha = new Float32Array(w * h);
    const rgb = new Float32Array(w * h * 3);
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      rgb[p * 3] = r; rgb[p * 3 + 1] = g; rgb[p * 3 + 2] = b;
      if (inner[p]) { alpha[p] = 1; continue; }
      if (!outer[p]) { alpha[p] = 0; continue; }

      const fc = fCount[p], bc = bCount[p];
      let a = hard[p] ? 1 : 0;
      if (fc > 0.02 && bc > 0.02) {
        const F = [chan[0].f[p] / fc, chan[1].f[p] / fc, chan[2].f[p] / fc];
        const B = [chan[0].b[p] / bc, chan[1].b[p] / bc, chan[2].b[p] / bc];
        const d = [F[0] - B[0], F[1] - B[1], F[2] - B[2]];
        const den = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        if (den > 50) {
          a = clamp(((r - B[0]) * d[0] + (g - B[1]) * d[1] + (b - B[2]) * d[2]) / den, 0, 1);
          if (a > 0.1) {   // colour decontamination: strip the background bleed
            rgb[p * 3]     = clamp((r - (1 - a) * B[0]) / a, 0, 255);
            rgb[p * 3 + 1] = clamp((g - (1 - a) * B[1]) / a, 0, 255);
            rgb[p * 3 + 2] = clamp((b - (1 - a) * B[2]) / a, 0, 255);
          }
        }
      }
      if (soft) a = clamp(a * 0.75 + clamp(soft[p], 0, 1) * 0.25, 0, 1);
      alpha[p] = a;
    }

    const sm = blurFloat(alpha, w, h, 1);
    for (let p = 0; p < w * h; p++) {
      if (inner[p] || !outer[p]) continue;
      alpha[p] = clamp(alpha[p] * 0.5 + sm[p] * 0.5, 0, 1);
    }
    return { alpha, rgb };
  }

  /**
   * Paints over holes left where a strap, a hand or a necklace crossed the
   * garment, by diffusing the surrounding fabric colour inwards. Without this
   * a cutout comes back with a bite taken out of it.
   */
  function inpaint(rgb, w, h, holes, known) {
    const todo = [];
    for (let p = 0; p < w * h; p++) if (holes[p]) todo.push(p);
    if (!todo.length) return { count: 0, unreached: null, unreachedCount: 0 };
    const filled = new Uint8Array(known);
    let remaining = todo.slice();
    /* One pass grows the filled region by one pixel, so a region wider than
       twice the pass count keeps its original colour in the middle — which is
       the colour of the hair or the arm that was in the way. The cap therefore
       has to scale with the region being painted; it is still a cap, so a
       pathological input cannot spin here. The caller is told what was never
       reached, and makes it transparent rather than showing the occluder. */
    const passes = clamp(Math.ceil(Math.sqrt(todo.length)) * 2 + 16, 64, 600);
    for (let pass = 0; pass < passes && remaining.length; pass++) {
      const next = [];
      const writes = [];
      for (const p of remaining) {
        const x = p % w, y = (p - x) / w;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!filled[q]) continue;
            r += rgb[q * 3]; g += rgb[q * 3 + 1]; b += rgb[q * 3 + 2]; n++;
          }
        }
        if (n) writes.push([p, r / n, g / n, b / n]);
        else next.push(p);
      }
      for (const [p, r, g, b] of writes) {
        rgb[p * 3] = r; rgb[p * 3 + 1] = g; rgb[p * 3 + 2] = b;
        filled[p] = 1;
      }
      if (!writes.length) break;
      remaining = next;
    }
    /* Soften the paint so it reads as fabric rather than a smear.
       The blur has to be confined to what is INSIDE the cutout. A plain blur
       of the frame reaches across the silhouette and pulls in whatever the
       photograph has just outside it, and since two thirds of the final value
       comes from the blur, a bite that borders bare skin came out lighter and
       warmer than the garment it was continuing — measurably so: a black dress
       was being repaired in dull mauve. So the weights are blurred alongside
       the colour and divided out, which is a blur that simply does not see
       past the edge. */
    const inside = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) inside[p] = filled[p] ? 1 : 0;
    const wsum = blurFloat(inside, w, h, 2);
    const tmp = [0, 1, 2].map(c => {
      const src = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) src[p] = inside[p] ? rgb[p * 3 + c] : 0;
      return blurFloat(src, w, h, 2);
    });
    for (let p = 0; p < w * h; p++) {
      if (!holes[p] || wsum[p] < 1e-4) continue;
      for (let c = 0; c < 3; c++) {
        rgb[p * 3 + c] = rgb[p * 3 + c] * 0.35 + (tmp[c][p] / wsum[p]) * 0.65;
      }
    }
    let unreachedCount = 0;
    const unreached = new Uint8Array(w * h);
    for (const p of todo) if (!filled[p]) { unreached[p] = 1; unreachedCount++; }
    return { count: todo.length, unreached, unreachedCount };
  }

  /* ============================================================ colour naming */

  function describeColor(r, g, b) {
    const [h, s, l] = rgb2hsl(r, g, b);
    const hex = "#" + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
    let name;
    if (l > 92 && s < 12) name = "White";
    else if (l > 82 && s < 18) name = "Ivory";
    else if (l < 12) name = "Black";
    else if (l < 26 && s < 22) name = "Charcoal";
    else if (s < 12) name = l > 55 ? "Light Grey" : "Grey";
    else if (h < 12 || h >= 345) name = l < 38 ? "Wine" : (s > 60 ? "Red" : "Rosewood");
    else if (h < 25) name = l > 65 ? "Peach" : "Terracotta";
    else if (h < 45) name = l < 40 ? "Brown" : (s > 55 ? "Amber" : "Camel");
    else if (h < 65) name = l > 70 ? "Butter" : "Mustard";
    else if (h < 95) name = "Lime";
    else if (h < 150) name = l < 35 ? "Forest" : (s < 30 ? "Sage" : "Green");
    else if (h < 190) name = "Teal";
    else if (h < 225) name = l < 32 ? "Navy" : (s < 35 ? "Denim Blue" : "Sky Blue");
    else if (h < 260) name = l < 40 ? "Indigo" : "Periwinkle";
    else if (h < 290) name = l > 62 ? "Lavender" : "Purple";
    else if (h < 330) name = l > 60 ? "Pink" : "Magenta";
    else name = l > 60 ? "Blush" : "Berry";
    return { hex, name };
  }

  const CATEGORY_FOR = { top: "tops", bottom: "bottoms", dress: "dresses", outer: "jackets",
                         bag: "bags", accessory: "accessories_necklace", footwear: "footwear", full: "dresses" };

  /* -------------------------------------------------------------- encoding
     Cutouts need their alpha channel, and they get parked in localStorage, so
     prefer WebP (alpha + a fraction of the bytes) and fall back to PNG. */

  let webpOk = null;
  function supportsWebpAlpha() {
    if (webpOk !== null) return webpOk;
    try {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 2;
      webpOk = cv.toDataURL("image/webp").indexOf("data:image/webp") === 0;
    } catch (e) { webpOk = false; }
    return webpOk;
  }

  function fitCanvas(canvas, maxDim) {
    const m = Math.max(canvas.width, canvas.height);
    if (!maxDim || m <= maxDim) return canvas;
    const s = maxDim / m;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(canvas.width * s));
    cv.height = Math.max(1, Math.round(canvas.height * s));
    const c = cv.getContext("2d");
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(canvas, 0, 0, cv.width, cv.height);
    return cv;
  }

  function encodeCutout(canvas, maxDim, quality) {
    const cv = fitCanvas(canvas, maxDim);
    if (supportsWebpAlpha()) {
      const url = cv.toDataURL("image/webp", quality);
      if (url && url.indexOf("data:image/webp") === 0) return url;
    }
    return cv.toDataURL("image/png");
  }

  /* ================================================================== extract */

  /**
   * Is there a PERSON in this photograph?
   *
   * Exists because that question decides which isolation path a photo should
   * take, and until now nothing asked it. The caller's only signal was whether
   * a box had been drawn — and a box says where the garment is, nothing about
   * what else is in frame. A box drawn round a garment someone is WEARING
   * therefore sent the photo down the backdrop-flood path, which has no notion
   * of hair or skin and so no way to put back the fabric a hand or a fringe was
   * standing in front of. The holes the wearer saw were not a failure of the
   * repair; the repair was never in the code that ran.
   *
   * Only the semantic pass runs here, on the same downscaled canvas the full
   * extraction would use, so this costs one model call and no pipeline. The
   * answer leans on the FACE rather than on skin: bare arms in a flat-lay and a
   * beige backdrop both read as skin to a colour heuristic, whereas a face does
   * not appear unless somebody is there.
   */
  async function detectPerson(src, options) {
    const opts = options || {};
    const img = await loadImage(src);
    const canvas = toCanvas(img, CONFIG.procMaxDim);
    let sem = null;
    if (opts.backend !== "heuristic") {
      try { sem = await semanticMediaPipe(canvas); } catch (e) { /* fall through */ }
    }
    if (!sem) {
      // The colour fallback cannot tell a person from a beige wall, and
      // guessing "person" here would divert every product shot away from the
      // path that gets white-on-white right. Say no, and say why.
      return { person: false, confident: false, backend: "unavailable",
               faceFrac: 0, hairFrac: 0, personFrac: 0 };
    }
    const n = sem.w * sem.h;
    let face = 0, hair = 0, body = 0;
    for (let p = 0; p < n; p++) {
      if (sem.face[p] > 0.5) face++;
      if (sem.hair[p] > 0.5) hair++;
      if (sem.bg[p] < 0.5) body++;
    }
    const faceFrac = face / n, hairFrac = hair / n, personFrac = body / n;
    return {
      person: faceFrac > 0.0015 || (hairFrac > 0.02 && personFrac > 0.25),
      confident: true,
      backend: sem.source || "mediapipe",
      faceFrac: +faceFrac.toFixed(5),
      hairFrac: +hairFrac.toFixed(4),
      personFrac: +personFrac.toFixed(4)
    };
  }

  async function extract(src, options) {
    const opts = Object.assign({
      mode: "auto", hintPoint: null, cropBox: null, padding: CONFIG.padding,
      background: "transparent", inpaintHoles: true, fillOccluded: true, fileName: "", debug: false,
      outputMaxDim: 720, quality: 0.9, backend: "auto"
    }, options || {});

    const warnings = [];
    const mode = MODE_ALIASES[String(opts.mode || "auto").toLowerCase()] || "auto";

    const img = await loadImage(src);
    let canvas = toCanvas(img, CONFIG.procMaxDim);
    let cropOffset = null;

    if (opts.cropBox && opts.cropBox.width > 8 && opts.cropBox.height > 8) {
      const srcW = img.naturalWidth || img.width;
      const full = toCanvas(img, Math.max(CONFIG.procMaxDim, CONFIG.outMaxDim));
      const s = full.width / srcW;
      const box = {
        x: clamp(Math.round(opts.cropBox.x * s), 0, full.width - 2),
        y: clamp(Math.round(opts.cropBox.y * s), 0, full.height - 2),
        w: Math.round(opts.cropBox.width * s),
        h: Math.round(opts.cropBox.height * s)
      };
      box.w = Math.min(box.w, full.width - box.x);
      box.h = Math.min(box.h, full.height - box.y);
      const cv = document.createElement("canvas");
      cv.width = box.w; cv.height = box.h;
      cv.getContext("2d", { willReadFrequently: true })
        .drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      canvas = toCanvas(cv, CONFIG.procMaxDim);
      cropOffset = box;
    }

    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;

    /* --- 2. semantic pass --- */
    let sem = null;
    if (opts.backend !== "heuristic") {
      try { sem = await semanticMediaPipe(canvas); }
      catch (e) { warnings.push("parsing model failed: " + (e.message || e)); }
    }
    if (!sem) {
      sem = semanticHeuristic(canvas);
      if (sem) warnings.push("no person detected — used colour segmentation");
    }
    if (!sem) throw new Error("nothing to isolate in this image");

    /* --- 3. anatomy --- */
    const anat = estimateAnatomy(sem);

    /* --- base mask: what class of thing are we cutting out? --- */
    let wantAccessory = (mode === "bag" || mode === "accessory");
    const buildBase = (useAccessoryClass) => {
      const mask = new Uint8Array(w * h);
      let area = 0;
      for (let p = 0; p < w * h; p++) {
        const cl = sem.clothes[p], ot = sem.other[p];
        const target = useAccessoryClass ? Math.max(ot, cl * 0.35) : cl;
        if (target < 0.5) continue;
        if (sem.bg[p] > target) continue;
        if (!useAccessoryClass && (sem.skin[p] > cl || sem.face[p] > cl || sem.hair[p] > cl)) continue;
        mask[p] = 1;
        area++;
      }
      return { mask, area };
    };

    let baseRes = buildBase(wantAccessory);
    // A bag or a necklace photographed on its own has no wearer, so there is no
    // "accessory worn over clothing" to look for — the object in frame is the
    // item. Without this a product shot of a handbag isolates nothing at all.
    if (wantAccessory && baseRes.area < w * h * 0.002) {
      const fallback = buildBase(false);
      if (fallback.area > baseRes.area) {
        baseRes = fallback;
        wantAccessory = false;
        warnings.push("no worn accessory found — treated the object in frame as the item");
      }
    }
    const base = baseRes.mask;
    let cleaned = openOp(base, w, h, 1);
    cleaned = closeOp(cleaned, w, h, 2);
    { // keep only meaningful blobs, but keep every blob of the outfit
      const { labels, comps } = components(cleaned, w, h);
      if (!comps.length) throw new Error("no garment found in this image");
      const biggest = comps.reduce((a, b) => (b.size > a.size ? b : a));
      const keep = new Set(comps.filter(c => c.size >= Math.max(w * h * 0.0015, biggest.size * 0.05)).map(c => c.id));
      for (let p = 0; p < w * h; p++) if (labels[p] && !keep.has(labels[p])) cleaned[p] = 0;
    }

    /* --- 4. stacked pieces --- */
    const cent = kmeansLab(px, w, h, cleaned, 4);
    const assign = assignClusters(px, w, h, cleaned, cent);
    const pieces = decomposePieces(px, w, h, cleaned, cent, assign);

    /* --- 5. selection --- */
    let hintRow = null, hintPiece = null;
    if (opts.hintPoint) {
      const hx = clamp(Math.round(opts.hintPoint.x * w), 0, w - 1);
      const hy = clamp(Math.round(opts.hintPoint.y * h), 0, h - 1);
      hintRow = hy;
      hintPiece = { x: hx, y: hy };
    }
    const sel = selectPiece(pieces, anat, mode, hintRow);
    const claimed = (sel.indices && sel.indices.length) ? sel.indices : [sel.index];
    let hard = new Uint8Array(w * h);
    for (const idx of claimed) {
      const m = buildPieceMask(px, w, h, cleaned, pieces, idx);
      for (let p = 0; p < w * h; p++) if (m[p]) hard[p] = 1;
    }
    const pieceLab = pieces[sel.index].lab;

    // An explicit top/bottom request on a single un-splittable piece (an
    // all-one-colour outfit) still gets cut at the waist.
    // A flat-lay or product shot has no wearer, so there is no waist to cut at
    // and the single garment in frame IS the answer, whatever mode was asked
    // for. Without this check the rule slices a hanging skirt in half.
    const hasWearer = anat.faceTop >= 0 || anat.headTop >= 0;
    if ((mode === "top" || mode === "bottom") && pieces.length === 1 && hasWearer) {
      const piece = pieces[0];
      const span = piece.bot - piece.top;
      const belowFrac = overlap(piece.top, piece.bot, anat.hipY, 1e9) / Math.max(1, span);
      // only trust the landmark if it actually falls inside the garment
      const sane = anat.hipY > piece.top + span * 0.25 && anat.hipY < piece.bot - span * 0.1;
      if (sane && belowFrac > 0.3 && belowFrac < 0.95) {
        const cut = Math.round(anat.hipY);
        for (let y = 0; y < h; y++) {
          const drop = mode === "top" ? y > cut : y < cut;
          if (!drop) continue;
          for (let x = 0; x < w; x++) hard[y * w + x] = 0;
        }
        warnings.push("one-piece outfit — cut at the estimated waist");
      }
    }

    /* --- 6. cleanup --- */
    hard = closeOp(hard, w, h, 3);
    hard = fillHoles(hard, w, h).mask;
    hard = openOp(hard, w, h, 2);
    {
      const { labels, comps } = components(hard, w, h);
      if (comps.length > 1) {
        const max = comps.reduce((a, b) => (b.size > a.size ? b : a));
        const keep = new Set(comps.filter(c => c.size >= max.size * 0.1).map(c => c.id));
        for (let p = 0; p < w * h; p++) if (labels[p] && !keep.has(labels[p])) hard[p] = 0;
      }
    }

    // everything sitting on the garment rather than being the garment
    const removed = new Uint8Array(w * h);
    let thinDiag = null;
    if (!wantAccessory) {
      const occ = rejectOccluders(px, w, h, hard, assign, cent, pieceLab);
      for (let p = 0; p < w * h; p++) if (occ.removed[p]) removed[p] = 1;
      thinDiag = { thin: [] };
      removeThinOccluders(px, w, h, hard, removed, thinDiag);
    }
    for (let p = 0; p < w * h; p++) {
      if (!hard[p]) continue;
      const skinish = sem.skin[p] > 0.7 || sem.face[p] > 0.7 || sem.hair[p] > 0.7;
      const accessory = !wantAccessory && sem.other[p] > 0.55 && sem.other[p] > sem.clothes[p];
      if (skinish || accessory) { hard[p] = 0; removed[p] = 1; }
    }
    hard = openOp(hard, w, h, 1);
    hard = closeOp(hard, w, h, 2);

    let limbTrim = 0;
    if (!wantAccessory && mode !== "footwear") {
      limbTrim = trimBareLimbs(px, w, h, hard, sem);
      if (limbTrim) warnings.push("trimmed bare limbs read as fabric");
    }

    // put the silhouette back where something was lying on top of the fabric,
    // and remember those pixels so the weave can be painted back in
    const patch = new Uint8Array(w * h);
    let patchCount = 0;
    const repair = repairOccluded(hard, removed, w, h);
    for (let p = 0; p < w * h; p++) if (repair.patch[p]) { patch[p] = 1; patchCount++; }

    // and back where hair or a limb was in front of it, which the pass above
    // cannot see because those pixels were never called clothing at all
    let biteDiag = null;
    let bitePatch = null;
    if (!wantAccessory && opts.fillOccluded !== false) {
      biteDiag = {};
      const bites = repairOccluderBites(hard, sem, w, h, biteDiag);
      for (let p = 0; p < w * h; p++) if (bites.patch[p] && !patch[p]) { patch[p] = 1; patchCount++; }
      biteDiag.count = bites.count;
      bitePatch = bites.patch;
    }

    const holePass = fillHoles(hard, w, h);
    hard = holePass.mask;
    for (let p = 0; p < w * h; p++) if (holePass.filled[p] && !patch[p]) { patch[p] = 1; patchCount++; }

    let area = 0;
    for (let p = 0; p < w * h; p++) area += hard[p];
    if (area < w * h * 0.0018) throw new Error("the garment is too small to isolate");

    /* --- 7. matting --- */
    const soft = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      soft[p] = clamp(wantAccessory ? Math.max(sem.other[p], sem.clothes[p]) : sem.clothes[p], 0, 1);
    }
    const radius = Math.max(2, Math.round(Math.max(w, h) / 320));
    const { alpha, rgb } = matte(px, w, h, hard, soft, radius);
    for (let p = 0; p < w * h; p++) if (patch[p]) alpha[p] = 1;
    if (opts.inpaintHoles && patchCount) {
      /* Repaint the rim as well, and never paint FROM it.
         The two-pixel band just outside a repaired area is where matting had
         to guess: those pixels are part fabric and part whatever was lying on
         it, so their colour is a blend of the two. They were the only donors
         the diffusion had, which meant every repair started from a colour that
         already had the occluder mixed into it, and inherited it. Painting the
         band too — and seeding only from fabric further in — costs two pixels
         of real photograph and removes the contamination at its source. */
      const rim = dilate(patch, w, h, 2);
      const paintSet = new Uint8Array(w * h);
      for (let p = 0; p < w * h; p++) {
        paintSet[p] = (patch[p] || (rim[p] && alpha[p] > 0.9)) ? 1 : 0;
      }
      const known = new Uint8Array(w * h);
      for (let p = 0; p < w * h; p++) known[p] = (alpha[p] > 0.9 && !paintSet[p]) ? 1 : 0;
      const painted = inpaint(rgb, w, h, paintSet, known);
      // A pixel the diffusion never reached still holds the colour of whatever
      // was in the way. Opaque, that is a smear of hair or forearm presented as
      // fabric; transparent, it is the bite it always was. Prefer the honest
      // hole, and stop counting it as repaired.
      if (painted.unreachedCount) {
        let lost = 0;
        for (let p = 0; p < w * h; p++) {
          // only a reconstructed pixel is dropped; a rim pixel is real
          // photograph and keeps whatever the matting gave it
          if (!painted.unreached[p] || !patch[p]) continue;
          alpha[p] = 0; patch[p] = 0; patchCount--; lost++;
        }
        if (lost) warnings.push("part of a hidden area could not be painted back");
      }
    }

    /* --- 8. render --- */
    let minx = w, miny = h, maxx = 0, maxy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 0.35) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    }
    if (maxx <= minx || maxy <= miny) throw new Error("empty cutout");

    const pad = opts.padding | 0;
    const cw = maxx - minx + 1, ch = maxy - miny + 1;
    const out = document.createElement("canvas");
    out.width = cw + pad * 2; out.height = ch + pad * 2;
    const octx = out.getContext("2d");
    const oimg = octx.createImageData(cw, ch);
    const od = oimg.data;

    let sumR = 0, sumG = 0, sumB = 0, cnt = 0, lumPrev = null, varSum = 0;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const p = (miny + y) * w + (minx + x);
        const a = clamp(alpha[p], 0, 1);
        const o = (y * cw + x) * 4;
        const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
        od[o] = r; od[o + 1] = g; od[o + 2] = b; od[o + 3] = Math.round(a * 255);
        if (a > 0.92 && !patch[p]) {
          sumR += r; sumG += g; sumB += b; cnt++;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lumPrev !== null) varSum += Math.abs(lum - lumPrev);
          lumPrev = lum;
        }
      }
    }
    octx.putImageData(oimg, pad, pad);

    let finalCanvas = out;
    const scaleUp = Math.min(2.2, CONFIG.outMaxDim / Math.max(out.width, out.height));
    if (scaleUp > 1.25) {
      const up = document.createElement("canvas");
      up.width = Math.round(out.width * scaleUp);
      up.height = Math.round(out.height * scaleUp);
      const uctx = up.getContext("2d");
      uctx.imageSmoothingEnabled = true;
      uctx.imageSmoothingQuality = "high";
      uctx.drawImage(out, 0, 0, up.width, up.height);
      finalCanvas = up;
    }

    const white = document.createElement("canvas");
    white.width = finalCanvas.width; white.height = finalCanvas.height;
    const wctx = white.getContext("2d");
    wctx.fillStyle = "#ffffff";
    wctx.fillRect(0, 0, white.width, white.height);
    wctx.drawImage(finalCanvas, 0, 0);

    /* --- 9. metrics --- */
    let skinLeak = 0, bgLeak = 0, edge = 0, aSum = 0;
    for (let p = 0; p < w * h; p++) {
      const a = alpha[p];
      if (a <= 0.02) continue;
      aSum += a;
      // A repaired pixel was skin in the photograph and is fabric now: the
      // colour there was painted from the surrounding weave. Counting it as
      // leaked skin double-punishes the repair — the cutout scored worse the
      // more of the hidden garment it put back, which is backwards.
      if (!patch[p] && (sem.skin[p] > 0.5 || sem.face[p] > 0.5)) skinLeak += a;
      if (sem.bg[p] > 0.5) bgLeak += a;
      if (a > 0.05 && a < 0.95) edge++;
    }
    const coverage = aSum / (w * h);
    const metrics = {
      coverage: +coverage.toFixed(4),
      skinLeak: +(skinLeak / Math.max(1, aSum)).toFixed(4),
      bgLeak: +(bgLeak / Math.max(1, aSum)).toFixed(4),
      patched: +(patchCount / Math.max(1, area)).toFixed(4),
      // how much of the garment was hidden behind hair or a limb and had to be
      // reconstructed — reported separately from `patched`, which also counts
      // ordinary straps and holes, because this is the number that says how
      // much of what the wearer is looking at was painted rather than
      // photographed
      occluded: +((biteDiag && biteDiag.count || 0) / Math.max(1, area)).toFixed(4),
      edgeRatio: +(edge / Math.max(1, aSum)).toFixed(4),
      fill: +(aSum / Math.max(1, cw * ch)).toFixed(3)
    };
    metrics.quality = Math.round(100 * clamp(
      1 - metrics.skinLeak * 2.4 - metrics.bgLeak * 2.0
        - Math.max(0, 0.22 - metrics.fill) * 1.5
        - Math.max(0, metrics.patched - 0.06) * 1.5, 0, 1));

    if (metrics.occluded > 0.05) {
      warnings.push("hair or a limb hid " + Math.round(metrics.occluded * 100) +
                    "% of this garment — that part was painted back in");
    }
    if (metrics.skinLeak > 0.06) warnings.push("some skin may remain in the cutout");
    if (metrics.bgLeak > 0.08) warnings.push("some background may remain in the cutout");
    if (coverage < 0.015) warnings.push("the isolated garment is unusually small");

    const mr = cnt ? Math.round(sumR / cnt) : 128;
    const mg = cnt ? Math.round(sumG / cnt) : 128;
    const mb = cnt ? Math.round(sumB / cnt) : 128;
    const color = describeColor(mr, mg, mb);
    const texture = cnt ? varSum / cnt : 8;
    const fabric = texture > 16 ? "Ribbed Knit / Textured"
                 : texture > 9  ? "Soft Cotton Knit"
                 : (color.name === "Black" || color.name === "Charcoal") ? "Smooth Twill"
                 : "Fine Woven Fabric";

    const resolvedMode = sel.resolved === "auto" ? "top" : sel.resolved;

    return {
      image: opts.background === "white"
        ? fitCanvas(white, opts.outputMaxDim).toDataURL("image/jpeg", 0.94)
        : encodeCutout(finalCanvas, opts.outputMaxDim, opts.quality),
      thumb: encodeCutout(finalCanvas, 320, 0.85),
      imagePng: finalCanvas.toDataURL("image/png"),
      imageOnWhite: fitCanvas(white, opts.outputMaxDim).toDataURL("image/jpeg", 0.94),
      maskCanvas: finalCanvas,
      bbox: { x: minx, y: miny, w: cw, h: ch, procW: w, procH: h, cropOffset },
      mode: resolvedMode,
      category: CATEGORY_FOR[resolvedMode] || "tops",
      color, fabric, texture: +texture.toFixed(2),
      metrics, anatomy: anat,
      pieces: pieces.map(p => ({ top: p.top, bot: p.bot, size: p.size })),
      chosenPiece: sel.index,
      backend: sem.source,
      warnings,
      thinDiag: thinDiag ? thinDiag.thin : null,
      _debug: opts.debug ? { alpha, hard, sem, cleaned, pieces, assign, sel, w, h, patch, removed, dev: thinDiag && thinDiag.dev, bites: biteDiag, bitePatch, rgb } : null
    };
  }

  /* ============================================ box-guided object isolation
     For a product shot or flat-lay there is no wearer, so the human-parsing
     model has nothing to say and the border flood fill has no reliable
     background — white shoes on a white sweep defeat it completely.

     Given a box around the subject (from a vision model, or a drag), this
     builds colour models from what is definitely inside and definitely
     outside, classifies the rest against them, and stops the region growing
     at strong edges where the two models cannot be told apart. That is what
     lifts a white garment off a white background. */

  function labModel(px, w, h, mask, k) {
    const cent = kmeansLab(px, w, h, mask, k);
    if (cent) return cent;
    // fall back to a single average
    let L = 0, A = 0, B = 0, n = 0;
    for (let p = 0; p < w * h; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      const lab = rgb2lab(px[i], px[i + 1], px[i + 2]);
      L += lab[0]; A += lab[1]; B += lab[2]; n++;
    }
    return n ? [[L / n, A / n, B / n]] : [[50, 0, 0]];
  }

  const nearestLab = (lab, model) => {
    let best = Infinity;
    for (let i = 0; i < model.length; i++) {
      const d = labDist(lab, model[i]).total;
      if (d < best) best = d;
    }
    return best;
  };

  /** Gradient magnitude on luminance, used as a barrier for the region grow. */
  function edgeMap(px, w, h) {
    const lum = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      lum[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    const g = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const gx = lum[p + 1] - lum[p - 1];
        const gy = lum[p + w] - lum[p - w];
        g[p] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return g;
  }

  /**
   * Isolates the object inside `region` (fractions of the image).
   * Returns the same shape of result as extract().
   */
  async function extractObject(src, options) {
    const opts = Object.assign({
      region: null, padding: CONFIG.padding, background: "transparent",
      outputMaxDim: 720, quality: 0.9, category: null, debug: false
    }, options || {});

    const warnings = [];
    const img = await loadImage(src);
    const canvas = toCanvas(img, CONFIG.procMaxDim);
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;

    // the box, clamped, with a margin that is treated as background
    const r = opts.region || { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
    const bx0 = clamp(Math.round(r.x * w), 0, w - 2);
    const by0 = clamp(Math.round(r.y * h), 0, h - 2);
    const bx1 = clamp(Math.round((r.x + r.w) * w), bx0 + 2, w - 1);
    const by1 = clamp(Math.round((r.y + r.h) * h), by0 + 2, h - 1);
    const bw = bx1 - bx0, bh = by1 - by0;

    const inBox = new Uint8Array(w * h);
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) inBox[y * w + x] = 1;

    // Background first: the ring outside the box is reliably background, and a
    // product shot's background usually continues *inside* the box too — the
    // white gap between two boots, the sweep behind a hanging blouse.
    const bgSeed = new Uint8Array(w * h);
    const outset = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (inBox[y * w + x]) continue;
        const dx = Math.max(bx0 - x, x - bx1, 0);
        const dy = Math.max(by0 - y, y - by1, 0);
        if (dx >= outset || dy >= outset || x < 2 || y < 2 || x > w - 3 || y > h - 3) bgSeed[y * w + x] = 1;
      }
    }
    let bgCount = 0;
    for (let p = 0; p < w * h; p++) bgCount += bgSeed[p];
    if (bgCount < 50) throw new Error("no background visible around the selection");
    const bgModel = labModel(px, w, h, bgSeed, 4);

    // Now seed the subject from the parts of the box that are *not* background
    // coloured. That is what stops the white sweep between two boots being
    // taken for the boots. When nothing in the box differs from the background
    // — a white top on a white wall — fall back to the whole inset box and let
    // edges do the work instead of colour.
    const lab = new Float32Array(w * h * 3);
    const bgDistance = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      const l = rgb2lab(px[i], px[i + 1], px[i + 2]);
      lab[p * 3] = l[0]; lab[p * 3 + 1] = l[1]; lab[p * 3 + 2] = l[2];
      bgDistance[p] = nearestLab(l, bgModel);
    }

    const insetX = Math.round(bw * 0.14), insetY = Math.round(bh * 0.14);
    const insetBox = new Uint8Array(w * h);
    let insetCount = 0;
    for (let y = by0 + insetY; y <= by1 - insetY; y++) {
      for (let x = bx0 + insetX; x <= bx1 - insetX; x++) { insetBox[y * w + x] = 1; insetCount++; }
    }
    if (insetCount < 50) throw new Error("the selected area is too small to isolate");

    // The corners of a tight box around a garment are nearly always background
    // showing through — seeding them stops the fill escaping into the sweep.
    const cornerSize = Math.max(3, Math.round(Math.min(bw, bh) * 0.09));
    const corners = [[bx0, by0], [bx1 - cornerSize, by0], [bx0, by1 - cornerSize], [bx1 - cornerSize, by1 - cornerSize]];
    for (const [cx0, cy0] of corners) {
      for (let y = cy0; y < cy0 + cornerSize && y < h; y++) {
        for (let x = cx0; x < cx0 + cornerSize && x < w; x++) {
          const p = y * w + x;
          if (p >= 0 && bgDistance[p] < 7) bgSeed[p] = 1;
        }
      }
    }

    const fgSeed = new Uint8Array(w * h);
    let fgCount = 0;
    for (let p = 0; p < w * h; p++) {
      if (insetBox[p] && bgDistance[p] > 12) { fgSeed[p] = 1; fgCount++; }
    }
    const lowContrast = fgCount < insetCount * 0.08;
    if (lowContrast) {
      // Colour cannot separate a white top from a white sweep, so seed only the
      // middle of the box — where the garment certainly is — and let the edge
      // barrier decide where it ends. Seeding the whole box would start the
      // fill inside the background it is supposed to reject.
      fgCount = 0;
      const coreX = Math.round(bw * 0.35), coreY = Math.round(bh * 0.35);
      for (let y = by0 + coreY; y <= by1 - coreY; y++) {
        for (let x = bx0 + coreX; x <= bx1 - coreX; x++) { fgSeed[y * w + x] = 1; fgCount++; }
      }
      warnings.push("subject and background are nearly the same colour — used edges");
    }

    const fgModel = labModel(px, w, h, fgSeed, 4);
    const edges = edgeMap(px, w, h);

    // an adaptive edge threshold: the boundary of a white garment on a white
    // sweep is a soft shadow, so a fixed number would either miss it or cut
    // the garment's own seams apart
    const edgeSample = [];
    for (let y = by0; y <= by1; y += 2) for (let x = bx0; x <= bx1; x += 2) edgeSample.push(edges[y * w + x]);
    edgeSample.sort((a, b) => a - b);
    const edgeAt = q => edgeSample[Math.min(edgeSample.length - 1, Math.floor(edgeSample.length * q))] || 10;

    // grow from the seed, refusing to enter background-looking pixels and, when
    // colour cannot tell them apart, refusing to cross an edge
    const margin = Math.max(2, Math.round(Math.min(w, h) * 0.03));
    const reach = new Uint8Array(w * h);
    for (let y = Math.max(0, by0 - margin); y <= Math.min(h - 1, by1 + margin); y++) {
      for (let x = Math.max(0, bx0 - margin); x <= Math.min(w - 1, bx1 + margin); x++) reach[y * w + x] = 1;
    }

    const attempt = (edgeThresh, colourMargin) => {
      const looksFg = new Uint8Array(w * h);
      let ambiguous = 0;
      for (let p = 0; p < w * h; p++) {
        if (!reach[p] || bgSeed[p]) continue;
        const l = [lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]];
        const df = nearestLab(l, fgModel);
        const db = bgDistance[p];
        const diff = db - df;
        if (diff > colourMargin) looksFg[p] = 1;
        else if (diff > -colourMargin) { ambiguous++; looksFg[p] = edges[p] > edgeThresh ? 0 : 1; }
      }
      const grow = new Uint8Array(w * h);
      const stack = [];
      for (let p = 0; p < w * h; p++) if (fgSeed[p] && looksFg[p]) { grow[p] = 1; stack.push(p); }
      if (!stack.length) for (let p = 0; p < w * h; p++) if (fgSeed[p]) { grow[p] = 1; stack.push(p); }
      while (stack.length) {
        const p = stack.pop();
        const x = p % w, y = (p - x) / w;
        const step = q => {
          if (grow[q] || !looksFg[q] || bgSeed[q] || !reach[q]) return;
          if (edges[q] > edgeThresh && bgDistance[q] < 12) return;   // stop at the silhouette
          grow[q] = 1;
          stack.push(q);
        };
        if (x > 0) step(p - 1);
        if (x < w - 1) step(p + 1);
        if (y > 0) step(p - w);
        if (y < h - 1) step(p + w);
      }
      let inside = 0;
      for (let p = 0; p < w * h; p++) if (grow[p] && inBox[p]) inside++;
      return { grow, ambiguous, boxFill: inside / Math.max(1, bw * bh) };
    };

    // Try progressively stricter passes and keep the first that leaves a
    // plausible subject: filling the whole box means the background came too.
    let best = null;
    const passes = lowContrast
      ? [[edgeAt(0.55), 1.5], [edgeAt(0.45), 1.5], [edgeAt(0.70), 2], [edgeAt(0.85), 3]]
      : [[edgeAt(0.90), 1.5], [edgeAt(0.80), 2.5], [edgeAt(0.70), 4], [edgeAt(0.60), 6]];
    for (const [et, cm] of passes) {
      const res = attempt(et, cm);
      if (!best || Math.abs(res.boxFill - 0.55) < Math.abs(best.boxFill - 0.55)) best = res;
      if (res.boxFill >= 0.2 && res.boxFill <= 0.88) { best = res; break; }
    }
    const ambiguous = best.ambiguous;
    const grow = best.grow;

    let hard = closeOp(grow, w, h, 3);
    hard = fillHoles(hard, w, h).mask;
    hard = openOp(hard, w, h, 2);
    {
      const { labels, comps } = components(hard, w, h);
      if (!comps.length) throw new Error("nothing to isolate in the selected area");
      // keep every blob of a decent size: a pair of shoes is two blobs
      const max = comps.reduce((a, b) => (b.size > a.size ? b : a));
      const keep = new Set(comps.filter(c => c.size >= Math.max(80, max.size * 0.06)).map(c => c.id));
      for (let p = 0; p < w * h; p++) if (labels[p] && !keep.has(labels[p])) hard[p] = 0;
    }
    hard = fillHoles(hard, w, h).mask;

    let area = 0;
    for (let p = 0; p < w * h; p++) area += hard[p];
    if (area < w * h * 0.0015) throw new Error("the isolated object is too small");

    const radius = Math.max(2, Math.round(Math.max(w, h) / 320));
    const { alpha, rgb } = matte(px, w, h, hard, null, radius);

    let minx = w, miny = h, maxx = 0, maxy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 0.35) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    }
    if (maxx <= minx || maxy <= miny) throw new Error("empty cutout");

    const pad = opts.padding | 0;
    const cw = maxx - minx + 1, ch = maxy - miny + 1;
    const out = document.createElement("canvas");
    out.width = cw + pad * 2;
    out.height = ch + pad * 2;
    const octx = out.getContext("2d");
    const oimg = octx.createImageData(cw, ch);
    const od = oimg.data;

    let sumR = 0, sumG = 0, sumB = 0, cnt = 0, lumPrev = null, varSum = 0;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const p = (miny + y) * w + (minx + x);
        const a = clamp(alpha[p], 0, 1);
        const o = (y * cw + x) * 4;
        const rr = rgb[p * 3], gg = rgb[p * 3 + 1], bb = rgb[p * 3 + 2];
        od[o] = rr; od[o + 1] = gg; od[o + 2] = bb;
        od[o + 3] = Math.round(a * 255);
        if (a > 0.92) {
          sumR += rr; sumG += gg; sumB += bb; cnt++;
          const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
          if (lumPrev !== null) varSum += Math.abs(lum - lumPrev);
          lumPrev = lum;
        }
      }
    }
    octx.putImageData(oimg, pad, pad);

    const white = document.createElement("canvas");
    white.width = out.width; white.height = out.height;
    const wctx = white.getContext("2d");
    wctx.fillStyle = "#ffffff";
    wctx.fillRect(0, 0, white.width, white.height);
    wctx.drawImage(out, 0, 0);

    const mr = cnt ? Math.round(sumR / cnt) : 128;
    const mg = cnt ? Math.round(sumG / cnt) : 128;
    const mb = cnt ? Math.round(sumB / cnt) : 128;
    const color = describeColor(mr, mg, mb);
    const texture = cnt ? varSum / cnt : 8;
    const fabric = texture > 16 ? "Ribbed Knit / Textured"
                 : texture > 9  ? "Soft Cotton Knit"
                 : (color.name === "Black" || color.name === "Charcoal") ? "Smooth Twill"
                 : "Fine Woven Fabric";

    const coverage = area / (w * h);
    const fill = area / Math.max(1, cw * ch);
    const metrics = {
      coverage: +coverage.toFixed(4),
      fill: +fill.toFixed(3),
      boxFill: +(area / Math.max(1, bw * bh)).toFixed(3),
      ambiguous: +(ambiguous / (w * h)).toFixed(3),
      quality: Math.round(100 * clamp(1 - Math.max(0, 0.25 - fill) * 2 -
                                      Math.max(0, (ambiguous / (w * h)) - 0.3), 0, 1))
    };
    if (metrics.boxFill < 0.15) warnings.push("only a small part of the selected area was kept");

    return {
      image: encodeCutout(out, opts.outputMaxDim, opts.quality),
      thumb: encodeCutout(out, 320, 0.85),
      imagePng: out.toDataURL("image/png"),
      imageOnWhite: fitCanvas(white, opts.outputMaxDim).toDataURL("image/jpeg", 0.94),
      maskCanvas: out,
      bbox: { x: minx, y: miny, w: cw, h: ch, procW: w, procH: h },
      mode: "object",
      category: opts.category || "tops",
      color, fabric, texture: +texture.toFixed(2),
      metrics,
      backend: "box-guided",
      warnings,
      _debug: opts.debug ? { alpha, hard, grow, fgSeed, bgSeed, edges, bgDistance, lowContrast, w, h } : null
    };
  }

  /* ==================================================================== API */

  const GarmentEngine = {
    CONFIG,
    warmup() { return loadSegmenter().then(s => ({ backend: s ? "mediapipe" : "heuristic", error: state.error })); },
    status() { return { backend: state.backend, ready: state.ready, error: state.error }; },
    extract, extractObject, detectPerson, describeColor,
    _internals: { components, fillHoles, dilate, erode, openOp, closeOp, matte, inpaint,
                  repairOccluded, repairOccluderBites,
                  decomposePieces, buildPieceMask, estimateAnatomy, semanticHeuristic,
                  kmeansLab, assignClusters, rgb2lab, rgb2hsl, blurFloat, toCanvas, loadImage }
  };

  global.GarmentEngine = GarmentEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = GarmentEngine;

})(typeof window !== "undefined" ? window : this);
