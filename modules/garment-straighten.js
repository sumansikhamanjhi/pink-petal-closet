/* =========================================================================
   MODULE: garment-straighten.js
   -------------------------------------------------------------------------
   One job: take a garment that was photographed on a posed body and stand it
   upright, so it hangs on the mannequin instead of leaning.

   THE PROBLEM

   A garment cut from a photograph keeps the pose it was worn in. A model with
   her weight on one hip, an arm across the body, a runway stride — all of it is
   baked into the cutout, and the mannequin stands perfectly straight. Measured
   over the test photographs, a posed garment's own centre line wanders 0.79 to
   1.19 of its half-width off vertical; a flat studio shot manages 0.42. That
   difference is what reads as "not laying straight".

   WHY ROW-WISE CENTRING IS NOT ENOUGH

   garment-fit.js already samples each destination row around that row's own
   midpoint, which straightens the SILHOUETTE. It cannot straighten the
   garment, because it only ever slides a row sideways: the seams, the hem, the
   print and the shading stay at the angle they were photographed at, and the
   result reads as bunched fabric rather than a garment hanging. Standing a
   leaning garment up is a rotation, and nothing built out of horizontal
   translations can express one.

   HOW THE LEAN IS MEASURED

   By fitting a line through the garment's own centre line — the midpoint of
   every row — weighted by how much fabric that row holds. Not by principal
   axes: a crop top is three times wider than it is tall, so its principal axis
   is horizontal and says nothing about which way it leans. The centre line
   works whatever the garment's proportions, and weighting by fabric keeps a
   wispy hem or a dangling tie from out-voting the body of the garment.

   WHAT KEEPS IT FROM MAKING THINGS WORSE

   It declines more often than it acts. Too few rows, a poor fit, an angle small
   enough not to matter, or an angle too large to be believable, and it returns
   the garment untouched. A garment photographed flat therefore passes straight
   through, which is what the control case in lab/posed-fit-probe.html checks.

   PUBLIC API
     GarmentStraighten.measure(alpha, w, h, opts) -> {angle, rows, fit, ...}
     GarmentStraighten.rotate(cutout, radians)    -> {canvas, width, height, alpha}
     GarmentStraighten.straighten(cutout, opts)   -> cutout + {angle, applied, why}
   ========================================================================= */

(function (global) {
  "use strict";

  const CONFIG = {
    alphaThreshold: 0.5,
    minRows: 24,          // below this the centre line is guesswork
    minRowShare: 0.35,    // ignore rows thinner than this much of the median
    minDegrees: 3,        // not worth a resample
    maxDegrees: 24,       // beyond this, trust the measurement less than the photo
    minFit: 0.25          // how much of the centre line's wander the line explains
  };

  /** Per-row midpoint and weight, from an alpha buffer. */
  function centreLine(alpha, w, h, threshold) {
    const t = threshold === undefined ? CONFIG.alphaThreshold : threshold;
    const rows = [];
    for (let y = 0; y < h; y++) {
      let l = -1, r = -1, n = 0;
      for (let x = 0; x < w; x++) {
        if (alpha[y * w + x] < t) continue;
        if (l < 0) l = x;
        r = x; n++;
      }
      if (l < 0) continue;
      rows.push({ y, mid: (l + r) / 2, half: (r - l + 1) / 2, n });
    }
    return rows;
  }

  /**
   * The tilt of the garment's own top edge — its shoulder line, or a skirt's
   * waistband.
   *
   * A second signal, because the centre line misses a whole class of tilt. A
   * crop top photographed with the arms raised comes out as a wide band whose
   * MIDLINE is vertical while both its edges slope: measured, that garment's
   * centre line leans 1.7 degrees and its shoulder line 19. Rotating on the
   * centre line alone leaves it looking draped at an angle.
   *
   * Taken from the outer thirds rather than the extreme corners, which are
   * single pixels and move with the matte.
   */
  function measureTopEdge(alpha, w, h, opts) {
    const options = opts || {};
    const t = options.alphaThreshold === undefined ? CONFIG.alphaThreshold : options.alphaThreshold;
    const top = new Int32Array(w).fill(-1);
    let minX = w, maxX = -1;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (alpha[y * w + x] < t) continue;
        top[x] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        break;
      }
    }
    if (maxX <= minX) return null;
    const span = maxX - minX + 1;
    const third = Math.max(2, Math.round(span * 0.28));

    const meanOf = (from, to) => {
      let s = 0, n = 0;
      for (let x = from; x <= to; x++) { if (top[x] >= 0) { s += top[x]; n++; } }
      return n ? { y: s / n, x: (from + to) / 2, n } : null;
    };
    const left = meanOf(minX, minX + third);
    const right = meanOf(maxX - third, maxX);
    if (!left || !right) return null;

    const dx = right.x - left.x;
    if (dx <= 1) return null;
    // positive angle means the right shoulder sits lower
    return { angle: Math.atan((right.y - left.y) / dx),
             degrees: +(Math.atan((right.y - left.y) / dx) * 180 / Math.PI).toFixed(2),
             samples: Math.min(left.n, right.n) };
  }

  /**
   * The angle the garment leans, in radians, positive clockwise.
   *
   * A weighted least squares of x against y over the centre line. The slope is
   * dx/dy, so the lean from vertical is atan(slope) — and rotating by minus
   * that stands the garment up.
   */
  function measure(alpha, w, h, opts) {
    const options = opts || {};
    const all = centreLine(alpha, w, h, options.alphaThreshold);
    if (all.length < (options.minRows || CONFIG.minRows)) {
      return { angle: 0, applied: false, why: "too few rows of fabric", rows: all.length };
    }

    const halves = all.map(r => r.half).sort((a, b) => a - b);
    const median = halves[Math.floor(halves.length / 2)];
    const floor = median * (options.minRowShare || CONFIG.minRowShare);
    const rows = all.filter(r => r.half >= floor);
    if (rows.length < (options.minRows || CONFIG.minRows)) {
      return { angle: 0, applied: false, why: "too little substantial fabric", rows: rows.length };
    }

    let sw = 0, sy = 0, sx = 0;
    for (const r of rows) { sw += r.n; sy += r.n * r.y; sx += r.n * r.mid; }
    const my = sy / sw, mx = sx / sw;
    let sxy = 0, syy = 0;
    for (const r of rows) {
      sxy += r.n * (r.y - my) * (r.mid - mx);
      syy += r.n * (r.y - my) * (r.y - my);
    }
    if (syy <= 0) return { angle: 0, applied: false, why: "no vertical extent", rows: rows.length };
    const slope = sxy / syy;

    // how much of the centre line's sideways wander the straight line explains;
    // a garment that zigzags is not leaning, it is draped, and rotating it
    // would only tilt the zigzag
    let ssTot = 0, ssRes = 0;
    for (const r of rows) {
      const pred = mx + slope * (r.y - my);
      ssTot += r.n * (r.mid - mx) * (r.mid - mx);
      ssRes += r.n * (r.mid - pred) * (r.mid - pred);
    }
    const fit = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const angle = Math.atan(slope);
    const deg = Math.abs(angle * 180 / Math.PI);
    const minDeg = options.minDegrees === undefined ? CONFIG.minDegrees : options.minDegrees;
    const maxDeg = options.maxDegrees === undefined ? CONFIG.maxDegrees : options.maxDegrees;
    const minFit = options.minFit === undefined ? CONFIG.minFit : options.minFit;

    const edge = measureTopEdge(alpha, w, h, options);
    const base = { angle, degrees: +(angle * 180 / Math.PI).toFixed(2), rows: rows.length,
                   fit: +fit.toFixed(3), medianHalf: Math.round(median),
                   topEdge: edge ? edge.degrees : null };
    if (deg < minDeg) return Object.assign(base, { applied: false, why: "already upright" });
    if (deg > maxDeg) return Object.assign(base, { applied: false, why: "lean too large to trust" });
    if (fit < minFit) return Object.assign(base, { applied: false, why: "centre line is not a lean" });
    return Object.assign(base, { applied: true, why: "leaning" });
  }

  /** Rotates a cutout about its own centre and re-crops to what is left. */
  function rotate(cutout, radians, padding) {
    const w = cutout.width, h = cutout.height;
    const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
    const rw = Math.ceil(w * cos + h * sin);
    const rh = Math.ceil(w * sin + h * cos);

    const spun = document.createElement("canvas");
    spun.width = rw; spun.height = rh;
    const sc = spun.getContext("2d", { willReadFrequently: true });
    sc.imageSmoothingQuality = "high";
    sc.translate(rw / 2, rh / 2);
    sc.rotate(radians);
    sc.drawImage(cutout.canvas, -w / 2, -h / 2);

    // re-crop: the rotated frame is larger than the garment by construction
    const d = sc.getImageData(0, 0, rw, rh).data;
    const pad = padding === undefined ? 2 : padding;
    let x0 = rw, y0 = rh, x1 = -1, y1 = -1;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        if (d[(y * rw + x) * 4 + 3] < 90) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(rw - 1, x1 + pad); y1 = Math.min(rh - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

    const out = document.createElement("canvas");
    out.width = cw; out.height = ch;
    const oc = out.getContext("2d", { willReadFrequently: true });
    oc.drawImage(spun, x0, y0, cw, ch, 0, 0, cw, ch);
    const od = oc.getImageData(0, 0, cw, ch).data;
    const alpha = new Float32Array(cw * ch);
    for (let p = 0; p < alpha.length; p++) alpha[p] = od[p * 4 + 3] / 255;

    return { canvas: out, width: cw, height: ch, alpha };
  }

  /**
   * @param cutout {canvas, width, height, alpha}
   * @returns the same shape, rotated upright if that was worth doing, with
   *          `applied` and `why` so a caller (or a probe) can see the decision
   */
  function straighten(cutout, opts) {
    const alpha = cutout.alpha || alphaOf(cutout);
    const m = measure(alpha, cutout.width, cutout.height, opts);
    if (!m.applied) {
      return Object.assign({}, cutout, { alpha, angle: 0, applied: false, why: m.why,
                                        lean: m.degrees, topEdge: m.topEdge });
    }
    const spun = rotate(cutout, -m.angle, (opts || {}).padding);
    if (!spun) {
      return Object.assign({}, cutout, { alpha, angle: 0, applied: false, why: "rotation emptied it" });
    }
    return Object.assign({}, cutout, spun, {
      angle: -m.angle, applied: true, why: m.why, lean: m.degrees, topEdge: m.topEdge, fit: m.fit
    });
  }

  function alphaOf(cutout) {
    const ctx = cutout.canvas.getContext("2d", { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, cutout.width, cutout.height).data;
    const a = new Float32Array(cutout.width * cutout.height);
    for (let p = 0; p < a.length; p++) a[p] = d[p * 4 + 3] / 255;
    return a;
  }

  global.GarmentStraighten = {
    CONFIG, measure, rotate, straighten, _internals: { centreLine, alphaOf }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.GarmentStraighten;

})(typeof window !== "undefined" ? window : this);
