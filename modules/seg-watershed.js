/* =========================================================================
   MODULE: seg-watershed.js
   -------------------------------------------------------------------------
   Marker-based watershed segmentation. One job: given an image, some pixels
   known to be the subject, and some known to be background, decide every other
   pixel.

   WHY THIS AND NOT A THRESHOLD

   Thresholding "is this pixel closer to the subject's colours or the
   background's" fails whenever the two are the same colour — a white top on a
   white sweep, the white panels of a sneaker on a white backdrop. Adding an
   edge barrier does not save it either: the barrier fires on the garment's own
   texture (a floral print, a seam) instead of on its silhouette, and the fill
   escapes around the outside, so the mask comes back inverted.

   Watershed is relative rather than absolute. Both markers grow at once,
   flooding from low gradient to high, and they meet on the strongest ridge
   BETWEEN them. A soft drop shadow is a weak ridge, but if it is the only
   thing separating the two markers, that is where the boundary lands. Texture
   inside the subject is never between the markers, so it is simply grown over.

   PUBLIC API
     Watershed.gradient(px, w, h, blurRadius) -> Uint8Array   0-255 per pixel
     Watershed.segment(px, w, h, fgSeed, bgSeed, opts) -> {
       mask:  Uint8Array,   1 where the subject is
       grad:  Uint8Array,   the gradient it flooded (for debugging)
       stats: { fg, bg, undecided }
     }

   px is a canvas RGBA Uint8ClampedArray. fgSeed/bgSeed are Uint8Array masks.
   Nothing here touches the DOM, so it can be unit-tested on raw arrays.
   ========================================================================= */

(function (global) {
  "use strict";

  /** Box blur one channel in place-ish, separable, radius r. */
  function blurChannel(src, w, h, r) {
    if (r <= 0) return src;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (2 * r + 1);
        const add = src[y * w + Math.min(w - 1, x + r + 1)];
        const sub = src[y * w + Math.max(0, x - r)];
        sum += add - sub;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / (2 * r + 1);
        const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
        const sub = tmp[Math.max(0, y - r) * w + x];
        sum += add - sub;
      }
    }
    return out;
  }

  /**
   * Gradient magnitude, 0-255. Taken over all three channels so a colour edge
   * with no brightness change (sage green against grey) still registers, and
   * computed on a blurred copy so fabric grain does not drown the silhouette.
   */
  function gradient(px, w, h, blurRadius) {
    const n = w * h;
    const chans = [];
    for (let c = 0; c < 3; c++) {
      const ch = new Float32Array(n);
      for (let p = 0; p < n; p++) ch[p] = px[p * 4 + c];
      chans.push(blurChannel(ch, w, h, blurRadius === undefined ? 1 : blurRadius));
    }
    const g = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const xm = x > 0 ? p - 1 : p, xp = x < w - 1 ? p + 1 : p;
        const ym = y > 0 ? p - w : p, yp = y < h - 1 ? p + w : p;
        let best = 0;
        for (let c = 0; c < 3; c++) {
          const ch = chans[c];
          const gx = ch[xp] - ch[xm];
          const gy = ch[yp] - ch[ym];
          const m = Math.sqrt(gx * gx + gy * gy);
          if (m > best) best = m;
        }
        g[p] = best > 255 ? 255 : (best | 0);
      }
    }
    return g;
  }

  const FG = 1, BG = 2;

  /**
   * Meyer's flooding watershed over 256 gradient levels.
   *
   * The queue is bucketed by gradient value and drained from the lowest level
   * up, and a pixel is never inserted below the level currently being drained
   * (`max(grad, level)`), which is what keeps the flood monotonic and makes the
   * meeting point a genuine ridge rather than an artefact of visiting order.
   */
  function segment(px, w, h, fgSeed, bgSeed, opts) {
    const options = opts || {};
    const n = w * h;
    const grad = options.grad || gradient(px, w, h, options.blur === undefined ? 1 : options.blur);

    const label = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (fgSeed && fgSeed[p]) label[p] = FG;
      else if (bgSeed && bgSeed[p]) label[p] = BG;
    }

    const buckets = new Array(256);
    for (let i = 0; i < 256; i++) buckets[i] = [];
    const queued = new Uint8Array(n);
    let lowest = 255;

    const enqueue = (q, level) => {
      if (label[q] || queued[q]) return;
      queued[q] = 1;
      const g = grad[q] < level ? level : grad[q];
      buckets[g].push(q);
      if (g < lowest) lowest = g;
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!label[p]) continue;
        if (x > 0) enqueue(p - 1, 0);
        if (x < w - 1) enqueue(p + 1, 0);
        if (y > 0) enqueue(p - w, 0);
        if (y < h - 1) enqueue(p + w, 0);
      }
    }

    for (let level = lowest; level < 256; level++) {
      const bucket = buckets[level];
      while (bucket.length) {
        const p = bucket.pop();
        if (label[p]) continue;
        const x = p % w, y = (p - x) / w;

        // adopt the label of the neighbours already decided; where the two
        // sides meet, the first one to arrive wins and the ridge is drawn here
        let decided = 0;
        if (x > 0 && label[p - 1]) decided = label[p - 1];
        if (!decided && x < w - 1 && label[p + 1]) decided = label[p + 1];
        if (!decided && y > 0 && label[p - w]) decided = label[p - w];
        if (!decided && y < h - 1 && label[p + w]) decided = label[p + w];
        if (!decided) continue;
        label[p] = decided;

        if (x > 0) enqueue(p - 1, level);
        if (x < w - 1) enqueue(p + 1, level);
        if (y > 0) enqueue(p - w, level);
        if (y < h - 1) enqueue(p + w, level);
      }
    }

    const mask = new Uint8Array(n);
    let fg = 0, bg = 0, undecided = 0;
    for (let p = 0; p < n; p++) {
      if (label[p] === FG) { mask[p] = 1; fg++; }
      else if (label[p] === BG) bg++;
      else undecided++;
    }
    return { mask, grad, stats: { fg, bg, undecided } };
  }

  /* ------------------------------------------------------------- morphology */

  /**
   * Dilate with a square kernel, done as a horizontal pass then a vertical one.
   * A square is separable under max, so the result is identical to the naive
   * double loop at a fraction of the cost — which matters because the threshold
   * sweep calls this a dozen times per image.
   */
  function dilate(mask, w, h, r) {
    if (r <= 0) return mask.slice();
    const tmp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let count = 0;
      for (let x = 0; x <= r && x < w; x++) count += mask[row + x] ? 1 : 0;
      for (let x = 0; x < w; x++) {
        tmp[row + x] = count > 0 ? 1 : 0;
        const add = x + r + 1;
        const sub = x - r;
        if (add < w && mask[row + add]) count++;
        if (sub >= 0 && mask[row + sub]) count--;
      }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = 0; y <= r && y < h; y++) count += tmp[y * w + x] ? 1 : 0;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = count > 0 ? 1 : 0;
        const add = y + r + 1;
        const sub = y - r;
        if (add < h && tmp[add * w + x]) count++;
        if (sub >= 0 && tmp[sub * w + x]) count--;
      }
    }
    return out;
  }

  function erode(mask, w, h, r) {
    if (r <= 0) return mask.slice();
    const inv = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) inv[p] = mask[p] ? 0 : 1;
    const grown = dilate(inv, w, h, r);
    const out = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) out[p] = grown[p] ? 0 : 1;
    return out;
  }

  /** Fills anything enclosed by the mask (a garment's own gaps stay filled). */
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
    for (let p = 0; p < w * h; p++) out[p] = (mask[p] || !outside[p]) ? 1 : 0;
    return out;
  }

  /** Largest connected blob, plus any blob at least `keepRatio` of its size. */
  function keepMainBlobs(mask, w, h, keepRatio) {
    const label = new Int32Array(w * h);
    const sizes = [0];
    const stack = new Int32Array(w * h);
    let next = 1;
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || label[start]) continue;
      const id = next++;
      let sp = 0, size = 0;
      stack[sp++] = start;
      label[start] = id;
      while (sp) {
        const p = stack[--sp];
        size++;
        const x = p % w, y = (p - x) / w;
        if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack[sp++] = p + w; }
      }
      sizes.push(size);
    }
    let biggest = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > biggest) biggest = sizes[i];
    const out = new Uint8Array(w * h);
    const floor = biggest * (keepRatio === undefined ? 0.08 : keepRatio);
    for (let p = 0; p < w * h; p++) if (label[p] && sizes[label[p]] >= floor) out[p] = 1;
    return out;
  }

  /**
   * Morphological opening of the backdrop, re-anchored to the image border.
   *
   * A leak is a thin tendril: the flood squeezes through one soft spot in the
   * silhouette — a lace hem, the shadow between two ribs — and then spreads
   * out inside the garment. Eroding the backdrop by r severs every channel
   * narrower than 2r+1, so after keeping only what is still reachable from the
   * border the tendril, and the whole pocket it fed, is gone. Dilating back and
   * intersecting with the original restores the true backdrop's edge exactly,
   * without letting the dilation grow into the subject.
   */
  function openBackdrop(flat, w, h, r) {
    if (r <= 0) return flat;
    const core = erode(flat, w, h, r);
    const anchored = new Uint8Array(w * h);
    const stack = [];
    const visit = p => { if (core[p] && !anchored[p]) { anchored[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    const grown = dilate(anchored, w, h, r);
    const out = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) out[p] = (grown[p] && flat[p]) ? 1 : 0;
    return out;
  }

  /**
   * Markers derived from the BACKDROP being flat, which is the one thing that
   * is reliably true of a product photo even when the garment is the same
   * colour as the sweep behind it.
   *
   * Flood inwards from the image border through pixels whose gradient is below
   * `tau`. Flat backdrop is traversable; the garment's silhouette — however
   * faint — is a ridge, so the flood stops there. Whatever is left inside the
   * box is the subject, INCLUDING its flat white areas, because they are
   * enclosed by that silhouette rather than connected to the border.
   *
   * Seeding the subject this way instead of with a small central core is what
   * stops a floral print or a pleat from trapping the marker: the marker now
   * covers the whole garment to begin with, so internal ridges never decide
   * anything.
   */
  function markersFromBackdrop(px, w, h, region, opts) {
    const options = opts || {};
    const grad = options.grad || gradient(px, w, h, options.blur === undefined ? 1 : options.blur);

    const bx0 = Math.max(0, Math.round(region.x * w));
    const by0 = Math.max(0, Math.round(region.y * h));
    const bx1 = Math.min(w - 1, Math.round((region.x + region.w) * w));
    const by1 = Math.min(h - 1, Math.round((region.y + region.h) * h));

    /** Flood inwards from the border through everything flatter than `tau`. */
    const floodBackdrop = (tau) => {
      const flat = new Uint8Array(w * h);
      const stack = [];
      const visit = p => {
        if (flat[p] || grad[p] >= tau) return;
        flat[p] = 1;
        stack.push(p);
      };
      for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
      while (stack.length) {
        const p = stack.pop();
        const x = p % w, y = (p - x) / w;
        if (x > 0) visit(p - 1);
        if (x < w - 1) visit(p + 1);
        if (y > 0) visit(p - w);
        if (y < h - 1) visit(p + w);
      }
      return flat;
    };

    const boxArea = Math.max(1, (bx1 - bx0 + 1) * (by1 - by0 + 1));
    const outsideArea = Math.max(1, w * h - boxArea);
    /** How much of the backdrop flood lands inside the box, and how much outside. */
    const measure = (flat) => {
      let inBox = 0, outside = 0;
      for (let y = 0; y < h; y++) {
        const rowInBox = y >= by0 && y <= by1;
        for (let x = 0; x < w; x++) {
          if (!flat[y * w + x]) continue;
          if (rowInBox && x >= bx0 && x <= bx1) inBox++; else outside++;
        }
      }
      return { inBox, outside };
    };

    /* -- choosing tau: take the threshold that is STABLE, not the one that is
       merely legal ------------------------------------------------------------

       No single threshold works for every photo. Too low and the flood cannot
       cross the backdrop's own vignette, so the "background" never surrounds
       the garment; too high and it steps over a faint silhouette and eats the
       garment from the inside — on the eyelet dress it floods the flat fabric
       between the flowers and leaves the mask as confetti.

       Sweep the threshold instead and watch how much backdrop lands inside the
       box. While tau is only cutting into the real backdrop, that number barely
       moves — a plateau. The step where the flood breaches the silhouette is a
       jump. So take the widest plateau and use its highest rung: the tightest
       threshold that is still on the safe side of the break. (Same reasoning as
       maximally-stable extremal regions, applied to one flood instead of all.)

       A rung only counts if the flood actually reached most of the area outside
       the box; otherwise a threshold too low to connect the backdrop at all
       looks perfectly "stable" at nearly zero. */
    const ladder = options.tauLadder || [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24];
    const minOutside = options.minOutsideCoverage === undefined ? 0.70 : options.minOutsideCoverage;
    const maxStep = (options.maxBoxGrowthPerStep === undefined ? 0.02 : options.maxBoxGrowthPerStep) * boxArea;

    const flats = [];
    const rungs = [];
    let baseIndex = -1;
    for (let i = 0; i < ladder.length; i++) {
      const flat = floodBackdrop(ladder[i]);
      const m = measure(flat);
      const connected = m.outside / outsideArea >= minOutside;
      flats.push(flat);
      rungs.push({ tau: ladder[i], inBox: m.inBox, connected, usable: false });
      // the gentlest flood that got all the way round the subject is the one
      // least likely to have cut into it, so it is what the core is measured from
      if (connected && baseIndex < 0) baseIndex = i;
    }

    /* The subject's core, measured rather than assumed.
       A fixed rectangle in the middle of the box is wrong for anything with a
       gap down the centre — the middle of a pair of jeans is the space between
       the legs, and the middle of a pair of boots is the floor between them, so
       every threshold looks like it has breached the core and the whole sweep
       gets thrown away. Deriving the core from the gentlest connected flood
       gives a shape that follows the actual garment instead. */
    const subjectFrom = (flat) => {
      const s = new Uint8Array(w * h);
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) { const p = y * w + x; if (!flat[p]) s[p] = 1; }
      }
      return keepMainBlobs(fillHoles(s, w, h), w, h, 0.05);
    };
    const coreErode = Math.max(2, Math.round(Math.min(bx1 - bx0, by1 - by0) * 0.06));
    const core = baseIndex >= 0 ? erode(subjectFrom(flats[baseIndex]), w, h, coreErode) : null;
    const breaches = (flat) => {
      if (!core) return false;
      for (let p = 0; p < w * h; p++) if (core[p] && flat[p]) return true;
      return false;
    };
    for (let i = 0; i < rungs.length; i++) {
      rungs[i].usable = rungs[i].connected && !breaches(flats[i]);
    }

    // Among the thresholds that leave the core alone, prefer the top of the
    // widest plateau. Where a photo has no plateau at all — the backdrop shades
    // off so gently that every step eats a little more — this falls back to the
    // gentlest usable threshold, which is the safe direction to be wrong in.
    let run = null, best = null;
    for (let i = 0; i < rungs.length; i++) {
      if (!rungs[i].usable) { run = null; continue; }
      if (run && run.end === i - 1 && rungs[i].inBox - rungs[i - 1].inBox <= maxStep) run.end = i;
      else run = { start: i, end: i };
      if (!best || run.end - run.start > best.end - best.start) best = { start: run.start, end: run.end };
    }

    let index = best ? best.end : (baseIndex >= 0 ? baseIndex : 0);
    const tau = ladder[index];
    // even at a good tau the flood can push one thin tendril through a soft
    // spot; opening it severs anything narrower than 2*leakRadius+1, and since
    // opening only ever shrinks the backdrop it cannot undo the core check
    const leakRadius = options.leakRadius === undefined ? 2 : options.leakRadius;
    const flat = openBackdrop(flats[index], w, h, leakRadius);

    // subject candidate: inside the box and not reachable from the border
    let fg = new Uint8Array(w * h);
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const p = y * w + x;
        if (!flat[p]) fg[p] = 1;
      }
    }
    fg = fillHoles(fg, w, h);
    fg = keepMainBlobs(fg, w, h, options.keepRatio === undefined ? 0.05 : options.keepRatio);
    // pull the marker in from its own boundary so the watershed decides the edge
    const fgMarker = erode(fg, w, h, options.fgErode === undefined ? 3 : options.fgErode);

    // background marker: flat backdrop, kept clear of the silhouette
    const bgMarker = erode(flat, w, h, options.bgErode === undefined ? 2 : options.bgErode);

    let fgCount = 0, bgCount = 0;
    for (let p = 0; p < w * h; p++) { fgCount += fgMarker[p]; bgCount += bgMarker[p]; }

    const sweep = rungs.map(r => r.tau + ":" + (r.usable ? "" : "x") + Math.round(r.inBox / boxArea * 100));
    return {
      fg: fgMarker, bg: bgMarker, grad, flat, coarse: fg, tau,
      stats: { fgCount, bgCount, tau, plateau: best ? ladder[best.start] + "-" + ladder[best.end] : "none", sweep }
    };
  }

  global.Watershed = {
    gradient, segment, markersFromBackdrop,
    dilate, erode, fillHoles, keepMainBlobs, openBackdrop, FG, BG
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.Watershed;

})(typeof window !== "undefined" ? window : this);
