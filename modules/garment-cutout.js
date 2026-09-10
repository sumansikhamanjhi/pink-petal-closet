/* =========================================================================
   MODULE 1: garment-cutout.js
   -------------------------------------------------------------------------
   One job: turn a photo of a garment into a clean RGBA cutout of just that
   garment, cropped to its own bounds, with soft edges and no halo — and
   nothing else. No mannequin, no wardrobe, no layout.

   It does NOT decide WHAT to cut out. The caller passes a region (from the
   vision model, or a hand-measured box, or the whole frame). This module only
   answers "given that the subject is roughly here, exactly which pixels are
   it, and what do they look like with the backdrop taken away".

   PIPELINE
     1. rasterise the source at a working size
     2. seg-watershed -> a hard mask (see that module for why watershed)
     3. tidy: fill enclosed gaps, drop specks
     4. matte: a soft alpha band across the silhouette instead of a stair edge
     5. decontaminate: repaint the band from fabric colour, not backdrop colour,
        so a white sweep does not leave a white rim on a navy jacket
     6. crop to the garment's own bounds

   PUBLIC API
     GarmentCutout.extract(image, opts) -> Promise<Cutout>
     GarmentCutout.toRecord(cutout, meta) -> a plain, storable object
     GarmentCutout.fromRecord(record) -> Promise<{canvas, ...}>

   Cutout = {
     canvas,           HTMLCanvasElement, RGBA, cropped to the garment
     width, height,    of that canvas
     alpha,            Float32Array, width*height, 0..1
     bounds,           {x,y,w,h} in 0..1 of the ORIGINAL image
     tau, plateau,     what the segmentation chose (diagnostics)
     metrics,          {solidity, edgeSoftness, coverage, quality, ms}
     debug             only when opts.debug
   }
   ========================================================================= */

(function (global) {
  "use strict";

  const CONFIG = {
    workingMaxDim: 768,   // segmentation resolution; edges are refined here
    outputMaxDim: 512,    // stored cutout resolution
    padding: 3,           // px of transparent margin kept around the garment
    featherRadius: 1.4,   // how wide the soft alpha band is
    decontaminateRadius: 3
  };

  const W = () => global.Watershed;

  const HANGABLE = new Set(["tops", "dresses", "bottoms", "jackets"]);

  /* ------------------------------------------------------------- rasterising */

  function loadImage(src) {
    if (src && src.naturalWidth) return Promise.resolve(src);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("could not load image"));
      img.src = src;
    });
  }

  function rasterise(img, maxDim) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = Math.min(1, maxDim / Math.max(iw, ih));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(iw * s));
    cv.height = Math.max(1, Math.round(ih * s));
    cv.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  }

  /* ------------------------------------------------------------------ matting */

  /** Separable box blur of a 0/1 mask into 0..1 floats. */
  function softenMask(mask, w, h, radius) {
    const r = Math.max(1, Math.round(radius));
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const span = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += mask[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / span;
        sum += mask[y * w + Math.min(w - 1, x + r + 1)] - mask[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / span;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  /**
   * A soft edge, but only where the edge is.
   *
   * Blurring the whole mask would also blur away thin straps and shoelaces, so
   * the blurred value is used only in the one-pixel band either side of the
   * silhouette; the interior stays fully opaque and the exterior fully clear.
   * That is what keeps chiffon from reading as see-through later: opacity is
   * decided by the silhouette, never by how thin the fabric looks.
   */
  function matte(mask, w, h, opts) {
    const ws = W();
    const inner = ws.erode(mask, w, h, 1);
    const outer = ws.dilate(mask, w, h, 1);
    const soft = softenMask(mask, w, h, opts.featherRadius || CONFIG.featherRadius);
    const alpha = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (inner[p]) alpha[p] = 1;
      else if (!outer[p]) alpha[p] = 0;
      else {
        const v = soft[p];
        alpha[p] = v <= 0 ? 0 : (v >= 1 ? 1 : v * v * (3 - 2 * v));
      }
    }
    return alpha;
  }

  /**
   * Repaint the soft band with fabric colour.
   *
   * A pixel that is half garment and half backdrop was photographed as a blend
   * of the two. Left alone it keeps the backdrop in it, which is why cutouts
   * from a white sweep end up with a pale rim once they are composited onto
   * anything darker. Replacing the band's colour with the nearest fully-opaque
   * fabric colour removes the rim; the alpha still carries the softness, so the
   * edge stays smooth rather than becoming a hard stencil.
   */
  function decontaminate(px, alpha, w, h, radius) {
    const r = Math.max(1, radius | 0);
    const out = new Uint8ClampedArray(px.length);
    out.set(px);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (alpha[p] <= 0 || alpha[p] >= 0.995) continue;
        let rs = 0, gs = 0, bs = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (alpha[q] < 0.995) continue;
            rs += px[q * 4]; gs += px[q * 4 + 1]; bs += px[q * 4 + 2]; n++;
          }
        }
        if (!n) continue;
        out[p * 4] = rs / n; out[p * 4 + 1] = gs / n; out[p * 4 + 2] = bs / n;
      }
    }
    return out;
  }


  /**
   * Drop the hanger.
   *
   * Almost every product photo of a top, a dress or a skirt has it hanging, and
   * the hook is touching the garment, so the segmentation is right to keep it —
   * it genuinely is one connected object. Only a wardrobe knows it is not part
   * of the clothing.
   *
   * The rule is how far the row REACHES, not how much fabric is in it. A hook
   * is a wire twenty pixels across; a camisole's two straps hold about the same
   * amount of fabric but stand at opposite shoulders, so they reach most of the
   * way across the garment. Counting pixels confuses the two — measured, a hook
   * came to 5% of the widest row and a pair of straps to 7% — while measuring
   * reach separates them by an order of magnitude.
   */
  function trimHanger(mask, w, h, opts) {
    const options = opts || {};
    const extent = new Int32Array(h);
    let maxExtent = 0, first = -1, last = -1;
    for (let y = 0; y < h; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (l < 0) l = x;
        r = x;
      }
      extent[y] = l < 0 ? 0 : r - l + 1;
      if (extent[y] > maxExtent) maxExtent = extent[y];
      if (l >= 0) { if (first < 0) first = y; last = y; }
    }
    if (first < 0) return { mask, rows: 0 };

    const zoneEnd = first + Math.round((last - first + 1) * (options.hangerZone || 0.22));
    const limit = (options.hangerReach || 0.25) * maxExtent;
    let cut = first;
    while (cut <= zoneEnd && cut < h && extent[cut] < limit) cut++;
    if (cut === first) return { mask, rows: 0 };

    const out = mask.slice();
    for (let y = first; y < cut; y++) for (let x = 0; x < w; x++) out[y * w + x] = 0;
    return { mask: W().keepMainBlobs(out, w, h, 0.05), rows: cut - first };
  }

  /**
   * Drop the hanger itself.
   *
   * Removing the hook by reach gets the wire but leaves the wooden hanger,
   * which is as wide as the shoulders it holds and so survives every test based
   * on shape. What gives it away is colour: it is made of something the garment
   * is not.
   *
   * Compared by CHROMA, not by brightness. A pale wooden bar and a sage skirt
   * are almost exactly as light as each other, so a straight RGB distance puts
   * them 48 apart — inside the skirt's own variation from its pleats — and the
   * bar survives. What separates them is that one is warm and the other cool.
   * Differencing the channels first throws brightness away and leaves that: 42
   * apart on hue alone, while a denim waistband against a denim jacket stays at
   * nearly zero, so a garment's own contrast panel is never mistaken for a
   * hanger. Brightness is still checked, on its own and loosely.
   *
   * And it FLOODS rather than dropping whole rows. A hanger is not a rectangle:
   * its shoulders slope away under the garment's own, so row removal either
   * leaves a wooden arc across the neckline or takes the garment's shoulders
   * with it. Flooding from the top through everything that is not the garment's
   * colour follows the hanger's actual shape and stops where fabric starts.
   */
  function trimHangerBar(px, mask, w, h, opts) {
    const options = opts || {};
    let first = -1, last = -1, maskArea = 0;
    for (let y = 0; y < h; y++) {
      let any = false;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) { any = true; maskArea++; }
      if (any) { if (first < 0) first = y; last = y; }
    }
    if (first < 0) return { mask, rows: 0 };
    const height = last - first + 1;

    // the garment's colour, taken from its middle where no hanger reaches
    const midFrom = first + Math.round(height * 0.35), midTo = first + Math.round(height * 0.85);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = midFrom; y <= midTo; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!mask[p]) continue;
        r += px[p * 4]; g += px[p * 4 + 1]; b += px[p * 4 + 2]; n++;
      }
    }
    if (n < 200) return { mask, rows: 0 };
    r /= n; g /= n; b /= n;

    const baseChroma = [r - g, g - b];
    const baseLuma = (r + g + b) / 3;
    const chromaFar = options.barChroma === undefined ? 20 : options.barChroma;
    const lumaFar = options.barLuma === undefined ? 55 : options.barLuma;
    const zoneEnd = first + Math.round(height * (options.barZone || 0.24));

    const notFabric = p => {
      const dc = Math.hypot((px[p * 4] - px[p * 4 + 1]) - baseChroma[0],
                            (px[p * 4 + 1] - px[p * 4 + 2]) - baseChroma[1]);
      if (dc > chromaFar) return true;
      return Math.abs((px[p * 4] + px[p * 4 + 1] + px[p * 4 + 2]) / 3 - baseLuma) > lumaFar;
    };

    const doomed = new Uint8Array(w * h);
    const stack = [];
    const visit = p => {
      if (!mask[p] || doomed[p]) return;
      const y = (p - (p % w)) / w;
      if (y > zoneEnd) return;
      if (!notFabric(p)) return;
      doomed[p] = 1;
      stack.push(p);
    };
    // seed from the topmost rows of what is left, which after the hook has gone
    // is the hanger's bar if there is one, and the garment's shoulders if not
    // seed from the top few percent rather than a fixed three pixel rows: a
    // hanger bar is thicker than that in a big photo and thinner in a small one
    const seedRows = Math.min(h - first,
      Math.max(3, Math.round(height * (options.barSeedShare === undefined ? 0.05 : options.barSeedShare))));
    for (let y = first; y < first + seedRows; y++) {
      for (let x = 0; x < w; x++) visit(y * w + x);
    }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }

    let removed = 0;
    for (let p = 0; p < w * h; p++) if (doomed[p]) removed++;
    if (!removed) return { mask, rows: 0 };
    // a safety valve: if this wants to take a large share of the garment then
    // the colour reading is wrong, and doing nothing is much the better failure
    if (removed > (options.barMaxShare || 0.14) * maskArea) return { mask, rows: 0 };

    const out = mask.slice();
    for (let p = 0; p < w * h; p++) if (doomed[p]) out[p] = 0;
    return { mask: W().keepMainBlobs(out, w, h, 0.05), rows: removed };
  }

  /** Mean colour and spread of the backdrop, sampled from the flood's own region. */
  function backdropColour(px, flat, w, h) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let p = 0; p < w * h; p++) {
      if (!flat[p]) continue;
      r += px[p * 4]; g += px[p * 4 + 1]; b += px[p * 4 + 2]; n++;
    }
    if (n < 500) return null;
    r /= n; g /= n; b /= n;
    let variance = 0, m = 0;
    for (let p = 0; p < w * h; p += 3) {
      if (!flat[p]) continue;
      const dr = px[p * 4] - r, dg = px[p * 4 + 1] - g, db = px[p * 4 + 2] - b;
      variance += dr * dr + dg * dg + db * db;
      m++;
    }
    return { r, g, b, spread: Math.sqrt(variance / Math.max(1, m)) };
  }

  /**
   * Open up the neckline.
   *
   * Seeding the subject as "everything the backdrop flood could not reach" is
   * what makes the segmentation solid, but it also means anything the garment
   * encloses comes along: the studio white showing through a neckline, the gap
   * inside a bag's strap. Filled in and made opaque, a dress arrives at the
   * mannequin with a white slab where its neckline should be.
   *
   * So enclosed regions that look like backdrop — backdrop colour, backdrop
   * flatness, and not touching the silhouette anywhere — are cut back out, and
   * the mannequin's own neck shows through as it should.
   *
   * This is the same colour comparison that was tried and abandoned for
   * trimming the outer rim, and it is safe here for one reason: it can only
   * act on regions completely surrounded by fabric. On a white top against a
   * white sweep there are no such regions, so it does nothing at all, where the
   * rim version walked inwards from the edge and destroyed the garment.
   */
  function openEnclosedBackdrop(px, grad, mask, flat, tau, w, h, opts) {
    const options = opts || {};
    const model = backdropColour(px, flat, w, h);
    if (!model) return { mask, removed: 0, regions: 0 };
    const tol = Math.max(options.holeTolerance || 10, 2 * model.spread);
    const flatEnough = Math.max(tau, 8);

    let maskArea = 0;
    for (let p = 0; p < w * h; p++) if (mask[p]) maskArea++;
    const minArea = Math.max(400, (options.minHoleShare || 0.02) * maskArea);
    // a neckline is one big roughly round gap; the pale streaks that shading
    // leaves down the front of a white dress are long, thin and ragged, and
    // knocking those out is how the first attempt at this put holes in a bodice
    const minCompactness = options.minHoleCompactness === undefined ? 0.34 : options.minHoleCompactness;
    const minSide = Math.max(8, Math.round(Math.min(w, h) * 0.02));

    // mask pixels that touch the outside: a backdrop-looking region reaching
    // these is a rim, which is explicitly not this function's business
    const ring = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!mask[p]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
            !mask[p - 1] || !mask[p + 1] || !mask[p - w] || !mask[p + w]) ring[p] = 1;
      }
    }

    const raw = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (!mask[p] || grad[p] >= flatEnough) continue;
      const dr = px[p * 4] - model.r, dg = px[p * 4 + 1] - model.g, db = px[p * 4 + 2] - model.b;
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= tol) raw[p] = 1;
    }

    // Open the candidate set first. A pale fold running down the front of a
    // white dress is backdrop-coloured and backdrop-flat, and it joins the
    // neckline, so without this the two are one blob and the whole streak gets
    // knocked out with the gap. Opening severs anything narrower than a few
    // pixels, which no real opening in a garment ever is.
    const openRadius = options.holeOpenRadius === undefined ? 3 : options.holeOpenRadius;
    const shrunk = W().erode(raw, w, h, openRadius);
    const grown = W().dilate(shrunk, w, h, openRadius);
    const candidate = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) candidate[p] = (grown[p] && raw[p]) ? 1 : 0;

    const out = mask.slice();
    const seen = new Uint8Array(w * h);
    const stack = [];
    let removed = 0, regions = 0;
    for (let start = 0; start < w * h; start++) {
      if (!candidate[start] || seen[start]) continue;
      const blob = [];
      let touchesRing = false;
      let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
      seen[start] = 1;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop();
        blob.push(p);
        if (ring[p]) touchesRing = true;
        const x = p % w, y = (p - x) / w;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
        const visit = q => { if (candidate[q] && !seen[q]) { seen[q] = 1; stack.push(q); } };
        if (x > 0) visit(p - 1);
        if (x < w - 1) visit(p + 1);
        if (y > 0) visit(p - w);
        if (y < h - 1) visit(p + w);
      }
      if (touchesRing || blob.length < minArea) continue;
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
      if (bw < minSide || bh < minSide) continue;
      if (blob.length / (bw * bh) < minCompactness) continue;
      for (const p of blob) out[p] = 0;
      removed += blob.length;
      regions++;
    }
    return { mask: out, removed, regions };
  }

  /**
   * Repaint whatever was showing through a gap in the garment.
   *
   * Filling enclosed gaps is what stops chiffon reading as see-through, but it
   * fills them with the pixels that were actually there — the studio floor
   * through a V-neck, or the wooden hanger behind it. Made opaque, those
   * pixels become part of the garment, and a wooden bar appears across the
   * neckline once it is on the mannequin.
   *
   * So the gaps are repainted from the fabric around them: fabric colour
   * spread inwards from the edge of each gap, then smoothed. It is not a
   * reconstruction of what the garment looks like there — nothing could be —
   * but it is the right colour, which is all that reads at this size.
   */
  function inpaintHoles(px, raw, filled, w, h, passes) {
    const hole = new Uint8Array(w * h);
    let count = 0;
    for (let p = 0; p < w * h; p++) if (filled[p] && !raw[p]) { hole[p] = 1; count++; }
    if (!count) return { px, filled: 0 };

    const out = new Uint8ClampedArray(px.length);
    out.set(px);
    const known = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) known[p] = hole[p] ? 0 : 1;

    /* Spread inwards, one ring at a time, so the middle of a big gap ends up
       the average of everything around it rather than of one nearby seam.

       The queued flag is load-bearing, not tidiness. A pixel is reachable from
       up to four neighbours, so without it each one joins the next ring once per
       settled neighbour, every duplicate enqueues ITS neighbours again, and the
       queue grows about fourfold per ring — exponential, and invisible until a
       gap is large enough to matter. The same omission in the retouch brush's
       fill locked the tab up on a jacket-sized region. */
    const queued = new Uint8Array(w * h);
    let frontier = [];
    const enqueue = p => {
      if (!hole[p] || known[p] || queued[p]) return;
      queued[p] = 1;
      frontier.push(p);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!hole[p]) continue;
        if ((x > 0 && known[p - 1]) || (x < w - 1 && known[p + 1]) ||
            (y > 0 && known[p - w]) || (y < h - 1 && known[p + w])) enqueue(p);
      }
    }
    while (frontier.length) {
      const writes = [];
      for (const p of frontier) {
        queued[p] = 0;
        if (known[p]) continue;
        const x = p % w, y = (p - x) / w;
        let r = 0, g = 0, b = 0, n = 0;
        const take = q => { if (known[q]) { r += out[q * 4]; g += out[q * 4 + 1]; b += out[q * 4 + 2]; n++; } };
        if (x > 0) take(p - 1);
        if (x < w - 1) take(p + 1);
        if (y > 0) take(p - w);
        if (y < h - 1) take(p + w);
        if (n) writes.push([p, r / n, g / n, b / n]);
      }
      if (!writes.length) break;
      for (const [p, r, g, b] of writes) {
        out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b;
        known[p] = 1;
      }
      frontier = [];
      for (const [p] of writes) {
        const x = p % w, y = (p - x) / w;
        if (x > 0) enqueue(p - 1);
        if (x < w - 1) enqueue(p + 1);
        if (y > 0) enqueue(p - w);
        if (y < h - 1) enqueue(p + w);
      }
    }

    for (let it = 0; it < (passes === undefined ? 4 : passes); it++) {
      const copy = new Uint8ClampedArray(out);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (!hole[p]) continue;
          for (let c = 0; c < 3; c++) {
            out[p * 4 + c] = (copy[(p - 1) * 4 + c] + copy[(p + 1) * 4 + c] +
                              copy[(p - w) * 4 + c] + copy[(p + w) * 4 + c]) / 4;
          }
        }
      }
    }
    return { px: out, filled: count };
  }

  /* ------------------------------------------------------------------ metrics */

  function boundsOf(alpha, w, h, threshold) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const t = threshold === undefined ? 0.12 : threshold;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (alpha[y * w + x] < t) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    return { x0, y0, x1, y1 };
  }

  /**
   * A confidence number the caller can actually act on.
   *
   * It has to be measured on the RAW watershed mask, before holes are filled
   * and specks dropped — measuring the tidied mask only ever says "perfect",
   * which is worse than no score at all because it hides the one failure that
   * matters. The three things worth knowing:
   *
   *   solidity  did the flood chew the interior out? (white-on-white leaking)
   *   edge      is the silhouette sitting on a real gradient ridge, or did the
   *             boundary settle somewhere arbitrary out in the backdrop?
   *   shape     does the result fill a believable share of its own bounds —
   *             not a sliver, not the entire box
   */
  function score(rawMask, mask, grad, w, h, box) {
    const ws = W();
    const filled = ws.fillHoles(rawMask, w, h);
    let raw = 0, filledArea = 0, area = 0;
    for (let p = 0; p < w * h; p++) {
      if (rawMask[p]) raw++;
      if (filled[p]) filledArea++;
      if (mask[p]) area++;
    }
    const solidity = filledArea ? raw / filledArea : 0;

    let edgeSum = 0, edgeN = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (!mask[p]) continue;
        if (mask[p - 1] && mask[p + 1] && mask[p - w] && mask[p + w]) continue;
        edgeSum += grad[p];
        edgeN++;
      }
    }
    const edge = edgeN ? edgeSum / edgeN : 0;
    const edgeScore = Math.min(1, edge / 30);

    const boxArea = box ? (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1) : 1;
    const coverage = area / Math.max(1, boxArea);
    const shape = coverage > 0.15 && coverage < 0.96 ? 1 : 0;

    const quality = Math.round(100 * (0.5 * solidity + 0.3 * edgeScore + 0.2 * shape));
    return { solidity: +solidity.toFixed(3), coverage: +coverage.toFixed(3),
             edgeContrast: Math.round(edge), quality, pixels: area };
  }

  /* ------------------------------------------------------------------ extract */

  /**
   * @param image  HTMLImageElement or a URL/data URL
   * @param opts   { region:{x,y,w,h} normalised, workingMaxDim, outputMaxDim,
   *                 padding, featherRadius, debug, watershed:{...} }
   */
  async function extract(image, opts) {
    if (!W()) throw new Error("seg-watershed.js must be loaded first");
    const options = opts || {};
    const t0 = (global.performance || Date).now();

    const img = await loadImage(image);
    const work = rasterise(img, options.workingMaxDim || CONFIG.workingMaxDim);
    const w = work.width, h = work.height;
    const ctx = work.getContext("2d", { willReadFrequently: true });
    const px = ctx.getImageData(0, 0, w, h).data;

    // no region given: assume the subject is centred and fills most of the frame
    const region = options.region || { x: 0.06, y: 0.06, w: 0.88, h: 0.88 };

    const markers = W().markersFromBackdrop(px, w, h, region, options.watershed || {});
    const seg = W().segment(px, w, h, markers.fg, markers.bg, { grad: markers.grad });

    let mask = W().fillHoles(seg.mask, w, h);
    mask = W().keepMainBlobs(mask, w, h, 0.05);

    // Only clothing hangs from a hanger. A handbag's strap loop is narrow at
    // its top and neutral in colour, so both hanger tests would happily eat it;
    // the caller knows the category, so it decides.
    let hangerRows = 0;
    const hangable = options.category === undefined
      ? options.trimHanger !== false
      : HANGABLE.has(options.category) && options.trimHanger !== false;
    if (hangable) {
      // the wire hook first, then the bar it hangs from: taking the hook away
      // is what puts the bar at the very top where the colour test can see it
      const hook = trimHanger(mask, w, h, options);
      const bar = trimHangerBar(px, hook.mask, w, h, options);
      mask = bar.mask;
      hangerRows = hook.rows + bar.rows;
    }

    const opened = options.openHoles === false
      ? { mask, removed: 0, regions: 0 }
      : openEnclosedBackdrop(px, markers.grad, mask, markers.flat, markers.tau, w, h, options);
    mask = opened.mask;

    // Deliberately NOT trimmed by colour. Eating inwards from the mask edge
    // while pixels match the backdrop looks like the obvious way to shave off a
    // leftover rim, and it does — on a navy jacket. On a white top against a
    // white sweep the same rule walks straight through the garment and shreds
    // it (measured: two thirds of the top gone). Any rim is left for the fit
    // stage, where it costs a pixel of silhouette instead of the whole item.

    const patched = options.inpaintHoles === false
      ? { px, filled: 0 }
      : inpaintHoles(px, seg.mask, mask, w, h, options.inpaintPasses);

    const alpha = matte(mask, w, h, options);
    const clean = decontaminate(patched.px, alpha, w, h,
      options.decontaminateRadius || CONFIG.decontaminateRadius);

    const box = boundsOf(alpha, w, h);
    if (!box) throw new Error("nothing found inside the region");

    const metrics = score(seg.mask, mask, markers.grad, w, h, box);

    // crop, with a little transparent margin so later feathering has room
    const pad = options.padding === undefined ? CONFIG.padding : options.padding;
    const cx0 = Math.max(0, box.x0 - pad), cy0 = Math.max(0, box.y0 - pad);
    const cx1 = Math.min(w - 1, box.x1 + pad), cy1 = Math.min(h - 1, box.y1 + pad);
    const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;

    const cut = document.createElement("canvas");
    cut.width = cw; cut.height = ch;
    const cc = cut.getContext("2d", { willReadFrequently: true });
    const outImg = cc.createImageData(cw, ch);
    const outAlpha = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const src = (cy0 + y) * w + (cx0 + x);
        const dst = y * cw + x;
        const a = alpha[src];
        outAlpha[dst] = a;
        outImg.data[dst * 4] = clean[src * 4];
        outImg.data[dst * 4 + 1] = clean[src * 4 + 1];
        outImg.data[dst * 4 + 2] = clean[src * 4 + 2];
        outImg.data[dst * 4 + 3] = Math.round(a * 255);
      }
    }
    cc.putImageData(outImg, 0, 0);

    const scaled = downscale(cut, outAlpha, options.outputMaxDim || CONFIG.outputMaxDim);

    const result = {
      canvas: scaled.canvas,
      width: scaled.canvas.width,
      height: scaled.canvas.height,
      alpha: scaled.alpha,
      bounds: { x: cx0 / w, y: cy0 / h, w: cw / w, h: ch / h },
      tau: markers.tau,
      plateau: markers.stats.plateau,
      cleanup: { hangerRows, openedRegions: opened.regions, openedPixels: opened.removed, repainted: patched.filled },
      metrics: Object.assign(metrics, { ms: Math.round((global.performance || Date).now() - t0) })
    };
    /* The uncropped working frame, for anything that needs to edit this cutout
       afterwards rather than just display it.

       A retouch brush has to be able to paint fabric BACK, which means reaching
       pixels the crop threw away, and it has to source colour from what the
       engine decided the garment looks like — not from the raw photograph. The
       difference matters exactly where this module repaired something: a
       neckline whose backdrop was cut out and a gap that was inpainted both
       come back as studio white if the brush reads the original file instead.

       Off by default because it is a 2.4MB pair of buffers at the working size
       and nothing that merely imports a garment needs them. */
    if (options.keepWorking) {
      result.working = { w, h, rgba: clean, alpha, mask };
    }
    if (options.debug) {
      result.debug = { w, h, mask, alpha, flat: markers.flat, grad: markers.grad,
                       fgSeed: markers.fg, bgSeed: markers.bg, sweep: markers.stats.sweep };
    }
    return result;
  }

  /** Resize the cutout down for storage, keeping a matching alpha array. */
  function downscale(cv, alpha, maxDim) {
    const s = Math.min(1, maxDim / Math.max(cv.width, cv.height));
    if (s >= 1) return { canvas: cv, alpha };
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cv.width * s));
    out.height = Math.max(1, Math.round(cv.height * s));
    const c = out.getContext("2d", { willReadFrequently: true });
    c.imageSmoothingQuality = "high";
    c.drawImage(cv, 0, 0, out.width, out.height);
    const d = c.getImageData(0, 0, out.width, out.height).data;
    const a = new Float32Array(out.width * out.height);
    for (let p = 0; p < a.length; p++) a[p] = d[p * 4 + 3] / 255;
    return { canvas: out, alpha: a };
  }

  /* ------------------------------------------------------------------ storage */

  /**
   * A cutout is stored as its pixels plus the few numbers needed to place it.
   * WebP keeps alpha and is roughly a third the size of PNG, which matters when
   * a whole wardrobe has to fit in localStorage.
   */
  function toRecord(cutout, meta) {
    const type = supportsWebp() ? "image/webp" : "image/png";
    return Object.assign({
      version: 1,
      image: cutout.canvas.toDataURL(type, 0.92),
      width: cutout.width,
      height: cutout.height,
      bounds: cutout.bounds,
      metrics: cutout.metrics
    }, meta || {});
  }

  let webpOk = null;
  function supportsWebp() {
    if (webpOk === null) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      webpOk = c.toDataURL("image/webp").indexOf("image/webp") === 5;
    }
    return webpOk;
  }

  async function fromRecord(record) {
    const img = await loadImage(record.image);
    const cv = document.createElement("canvas");
    cv.width = record.width || img.naturalWidth;
    cv.height = record.height || img.naturalHeight;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.drawImage(img, 0, 0, cv.width, cv.height);
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const alpha = new Float32Array(cv.width * cv.height);
    for (let p = 0; p < alpha.length; p++) alpha[p] = d[p * 4 + 3] / 255;
    return { canvas: cv, width: cv.width, height: cv.height, alpha,
             bounds: record.bounds, metrics: record.metrics };
  }

  global.GarmentCutout = {
    CONFIG, extract, toRecord, fromRecord,
    _internals: { matte, decontaminate, softenMask, boundsOf, score, rasterise, downscale }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.GarmentCutout;

})(typeof window !== "undefined" ? window : this);
