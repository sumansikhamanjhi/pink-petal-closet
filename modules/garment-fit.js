/* =========================================================================
   MODULE 2: garment-fit.js
   -------------------------------------------------------------------------
   One job: take a cutout of a garment photographed flat, and reshape it so it
   has the mannequin's shape — before anything is drawn, layered or mixed.

   WHY RESHAPE INSTEAD OF JUST SCALING

   Scaling a flat photo to fit and pasting it on the body is what makes an
   outfit look like stickers. A flat garment is cut wide and straight; a body
   goes in at the waist and out at the hip. Uniformly scaled, the top is either
   too wide at the waist or too narrow across the bust, and no amount of nudging
   the placement fixes it, because the mismatch is a difference in SHAPE.

   So each horizontal row of the garment is scaled by its own factor: rows that
   should cling are pulled towards the body's width at that height, rows that
   should hang are left at their own proportions. Ready-shaped, a garment can
   then be composited with any other without re-solving the fit — which is what
   makes mixing (module 3) a matter of drawing in the right order and nothing
   more.

   WHAT KEEPS IT FROM DESTROYING THE GARMENT

   Three limits, all in body-model.js:
     hug      how much a row is allowed to follow the body at all, from the top
              of the garment to the bottom. A dress hugs at the bodice and is
              left alone at the hem, so the skirt still flares.
     maxWarp  a hard ceiling on any single row's squeeze or stretch. Without it
              a jacket photographed with its sleeves spread gets its sleeves
              crushed into the torso, since the body is only shoulders wide up
              there.
     smoothing the per-row factors are smoothed down the garment, so the edge
              stays a curve instead of a set of steps.

   PUBLIC API
     GarmentFit.fit(cutout, category, opts) -> Fitted
     GarmentFit.measure(alpha, w, h)        -> per-row silhouette measurements

   Fitted = {
     canvas,          the garment redrawn at mannequin scale, RGBA
     width, height,   the mannequin frame it is drawn for
     placement,       {top, bottom, centreX, scale} in 0..1 of that frame
     rows,            the per-row scale factors actually applied
     warp             {min, max, mean} for checking how hard it worked
   }
   ========================================================================= */

(function (global) {
  "use strict";

  const CONFIG = {
    frameWidth: 768,     // the mannequin canvas the fit is solved against
    frameHeight: 1152,   // 2:3, matching assets/mannequin_base.jpg
    smoothRows: 9,       // vertical smoothing window for the per-row factors
    solveIterations: 4
  };

  const B = () => global.BodyModel;

  /* ---------------------------------------------------------- measuring rows */

  /**
   * For every row of the cutout: where the fabric starts, where it ends, and
   * how much of the row is fabric. `half` is what the reshape works on; `fill`
   * tells the difference between a solid row and a row that is only two thin
   * sleeves, which must never be squeezed to body width.
   */
  function measure(alpha, w, h, threshold) {
    const t = threshold === undefined ? 0.35 : threshold;
    const left = new Int32Array(h).fill(-1);
    const right = new Int32Array(h).fill(-1);
    const half = new Float32Array(h);
    const mid = new Float32Array(h);
    const fill = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let l = -1, r = -1, n = 0;
      for (let x = 0; x < w; x++) {
        if (alpha[y * w + x] < t) continue;
        if (l < 0) l = x;
        r = x;
        n++;
      }
      left[y] = l; right[y] = r;
      if (l >= 0) {
        half[y] = (r - l + 1) / 2;
        mid[y] = (l + r) / 2;
        fill[y] = n / Math.max(1, r - l + 1);
      }
    }
    return { left, right, half, mid, fill, height: h, width: w };
  }

  /** Box smooth over rows, skipping empty ones so a hem is not dragged inwards. */
  function smoothRows(values, valid, radius) {
    const n = values.length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0, count = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j < 0 || j >= n || !valid[j]) continue;
        sum += values[j];
        count++;
      }
      out[i] = count ? sum / count : values[i];
    }
    return out;
  }

  /* ------------------------------------------------------------------ solving */

  /**
   * Which row of the garment its size is taken from.
   *
   * The narrowest SOLID row in the window. Narrowest, because a flat photo only
   * ever exaggerates width — sleeves spread sideways, a skirt flares, a collar
   * sticks out — so the minimum is the one honest reading of how wide the
   * garment is where it meets the body. Solid, because a row that is mostly
   * holes is two sleeves with a gap between them, and its outer edges say
   * nothing about the torso.
   *
   * WHY THERE IS A WIDTH FLOOR. "Narrowest" is only meaningful among rows that
   * are actually part of the garment. One stray speck — a shoelace tip, a
   * hanger fragment, or a single dab left by the retouch brush — occupies a row
   * a few pixels wide, wins "narrowest" outright, and becomes the measurement
   * the whole fit is solved from. The scale then comes out as the ratio of a
   * body width to a three-pixel speck, which is where the sixty-fold blow-up
   * comes from: a handful of source columns smeared across the entire frame.
   * Ignoring rows under a quarter of the garment's widest makes that
   * impossible without changing the answer for any real garment, whose waist
   * is never that much narrower than its widest point.
   */
  function referenceRow(m, place, firstRow, lastRow) {
    const span = Math.max(1, lastRow - firstRow);

    let widest = 0;
    for (let y = firstRow; y <= lastRow; y++) if (m.half[y] > widest) widest = m.half[y];
    const floor = widest * 0.25;

    if (place.ref && place.ref.at !== undefined) {
      // an {at} row is a waistband, named by position rather than found by
      // width; if the photo happens to be ragged there, walk down to the first
      // row that carries a believable amount of fabric
      let row = Math.round(firstRow + place.ref.at * span);
      while (row < lastRow && m.half[row] < floor) row++;
      return row;
    }

    const from = firstRow + (place.ref ? place.ref.from : 0.45) * span;
    const to = firstRow + (place.ref ? place.ref.to : 0.95) * span;
    let bestRow = -1, bestHalf = Infinity;
    for (let y = Math.round(from); y <= Math.round(to); y++) {
      if (m.half[y] <= 0 || m.half[y] < floor || m.fill[y] < 0.6) continue;
      if (m.half[y] < bestHalf) { bestHalf = m.half[y]; bestRow = y; }
    }
    if (bestRow >= 0) return bestRow;
    // nothing solid in the window: fall back to a mid percentile of the whole
    for (let y = Math.round(from); y <= Math.round(to); y++) {
      if (m.half[y] > 0 && m.half[y] >= floor && m.half[y] < bestHalf) {
        bestHalf = m.half[y]; bestRow = y;
      }
    }
    return bestRow >= 0 ? bestRow : Math.round(firstRow + 0.6 * span);
  }

  /**
   * How wide and how tall the garment ends up on the body.
   *
   * Width is solved first and height follows from the photo's own proportions,
   * which is what makes a maxi skirt come out long and a mini short without
   * anyone labelling either.
   *
   * The subtlety is that the garment is matched to the body's width AT THE
   * HEIGHT ITS REFERENCE ROW ACTUALLY LANDS — and where it lands depends on how
   * tall the garment turned out, which depends on the width. So it is solved by
   * iteration rather than by guessing a landmark up front. Guessing was what
   * made the first version ride high: a dress sized at the bust and pinned at
   * the shoulders put its waist seam somewhere around the ribs.
   *
   * Props (shoes, bags) skip all of this. Nothing about the body decides how
   * wide a handbag is, so they are given an absolute width.
   */
  function solveScale(m, place, frameW, frameH) {
    const body = B();

    const firstRow = m.half.findIndex(v => v > 0);
    let lastRow = -1;
    for (let y = m.height - 1; y >= 0; y--) if (m.half[y] > 0) { lastRow = y; break; }
    if (firstRow < 0) throw new Error("cutout is empty");
    const srcSpan = lastRow - firstRow + 1;

    if (place.width !== undefined) {
      let widest = 0;
      for (let y = firstRow; y <= lastRow; y++) if (m.half[y] > widest) widest = m.half[y];
      const scale = place.width * frameW / Math.max(1, widest * 2);
      const spanFrac = clamp(srcSpan * scale / frameH, place.minSpan, place.maxSpan);
      const topY = place.bottom !== undefined ? place.bottom - spanFrac : place.top;
      return { scale, spanFrac, topY, firstRow, lastRow, srcSpan, refRow: -1 };
    }

    const refRow = referenceRow(m, place, firstRow, lastRow);
    const refHalf = Math.max(1, m.half[refRow]);
    const refT = (refRow - firstRow) / Math.max(1, srcSpan - 1);

    let scale = 0.5, spanFrac = clamp(srcSpan * scale / frameH, place.minSpan, place.maxSpan);
    for (let i = 0; i < CONFIG.solveIterations; i++) {
      const topY = place.bottom !== undefined ? place.bottom - spanFrac : place.top;
      const landsAt = clamp(topY + refT * spanFrac, 0.05, 0.95);
      const target = body.halfWidthAt(landsAt) * frameW * place.ease;
      const next = target / refHalf;
      const converged = Math.abs(next - scale) < 0.002;
      // average with the previous guess: the body narrows then widens, so a
      // bare fixed-point iteration can sit oscillating between ribs and hip
      scale = i === 0 ? next : (next + scale) / 2;
      spanFrac = clamp(srcSpan * scale / frameH, place.minSpan, place.maxSpan);
      if (converged) break;
    }

    // If the span clamp bit, the piece is drawn shorter or taller than its own
    // proportions rather than narrower: the width is the measurement that has
    // to be right, because that is what makes it look worn instead of pasted.
    const topY = place.bottom !== undefined ? place.bottom - spanFrac : place.top;
    return { scale, spanFrac, topY, firstRow, lastRow, srcSpan, refRow };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ------------------------------------------------------------------ fitting */

  /**
   * @param cutout    {canvas|alpha,width,height} from GarmentCutout
   * @param category  a key of BodyModel.PLACEMENT
   * @param opts      {frameWidth, frameHeight, ease, hug, maxWarp, reshape}
   *
   * `reshape:false` places the garment without changing its shape at all —
   * scaled and positioned, never squeezed row by row and never rotated. That
   * is what the mannequin shows BEFORE a render is asked for: reshaping is a
   * guess at what the fabric would do, and a guess that is visibly wrong is
   * worse than showing the photograph as it was taken. The AI render is what
   * gives the garment a body shape; until it is asked for, the wearer sees
   * their own clothes.
   */
  function fit(cutout, category, opts) {
    const body = B();
    if (!body) throw new Error("body-model.js must be loaded first");
    const options = opts || {};
    const base = body.PLACEMENT[category];
    if (!base) throw new Error("no placement for category " + category);
    const place = Object.assign({}, base, options.placement || {});
    if (options.ease !== undefined) place.ease = options.ease;

    // Zero hug is the whole of it: every row's factor comes out at exactly 1,
    // so the redraw below is a plain uniform scale. Nothing else has to change,
    // and the placement, the span and the reported numbers stay comparable
    // with a fitted render.
    const reshape = options.reshape !== false;
    if (!reshape) place.hug = [0, 0];

    const frameW = options.frameWidth || CONFIG.frameWidth;
    const frameH = options.frameHeight || CONFIG.frameHeight;

    /* Stand the garment up before measuring it.
       A garment cut from a posed photograph leans, and everything below works
       on rows, so it would fit the lean rather than remove it — and row-wise
       centring can only slide a row sideways, which straightens the outline
       while leaving the seams and the hem at the angle they were shot at. The
       rotation happens here rather than at import so that garments already in
       the closet get it too. It declines unless the lean is real; see
       garment-straighten.js. */
    let source = cutout;
    let straightened = { applied: false, why: "module not loaded" };
    const mayStraighten = place.straighten !== false && options.straighten !== false;
    if (!mayStraighten) straightened = { applied: false, why: "not a hanging garment" };
    if (global.GarmentStraighten && mayStraighten) {
      straightened = global.GarmentStraighten.straighten(cutout, options.straightenOpts);
      if (straightened.applied) source = straightened;
    }

    const srcW = source.width, srcH = source.height;
    const srcCtx = source.canvas.getContext("2d", { willReadFrequently: true });
    const srcPx = srcCtx.getImageData(0, 0, srcW, srcH).data;
    const alpha = source.alpha || alphaFrom(srcPx, srcW * srcH);

    const m = measure(alpha, srcW, srcH);
    const solved = solveScale(m, place, frameW, frameH);
    const { scale, spanFrac, topY, firstRow, lastRow, srcSpan } = solved;

    const centreX = (place.centreX === undefined ? body.BODY.centreX : place.centreX) * frameW;
    const topPx = topY * frameH;
    const spanPx = spanFrac * frameH;

    /* ---- the per-row scale factors --------------------------------------- */
    const rowScale = new Float32Array(srcH).fill(1);
    const valid = new Uint8Array(srcH);
    const hugTop = place.hug[0], hugBottom = place.hug[1];
    for (let y = firstRow; y <= lastRow; y++) {
      if (m.half[y] <= 0) continue;
      valid[y] = 1;
      const t = (y - firstRow) / Math.max(1, srcSpan - 1);
      const bodyY = topY + t * spanFrac;
      const naturalHalf = m.half[y] * scale;
      const bodyHalf = body.halfWidthAt(bodyY) * frameW * place.ease;

      // A row that is mostly holes is sleeves or straps with a gap between
      // them, not a band of fabric across the body; pulling it to body width
      // would drag the sleeves into the armpits. Let it keep its own shape.
      const solid = clamp((m.fill[y] - 0.45) / 0.35, 0, 1);
      const hug = (hugTop + (hugBottom - hugTop) * t) * solid;

      const want = naturalHalf > 0 ? bodyHalf / naturalHalf : 1;
      const blended = 1 + (want - 1) * hug;
      rowScale[y] = clamp(blended, 1 - place.maxWarp, 1 + place.maxWarp);
    }
    const smoothed = smoothRows(rowScale, valid, options.smoothRows || CONFIG.smoothRows);

    /* ---- redraw ----------------------------------------------------------- */
    const out = document.createElement("canvas");
    out.width = frameW;
    out.height = frameH;
    const oc = out.getContext("2d", { willReadFrequently: true });
    const img = oc.createImageData(frameW, frameH);
    const dst = img.data;

    const y0 = Math.max(0, Math.floor(topPx));
    const y1 = Math.min(frameH - 1, Math.ceil(topPx + spanPx));
    let warpMin = Infinity, warpMax = -Infinity, warpSum = 0, warpN = 0;

    for (let dy = y0; dy <= y1; dy++) {
      const t = (dy + 0.5 - topPx) / Math.max(1e-6, spanPx);
      if (t < 0 || t > 1) continue;
      const sy = firstRow + t * (srcSpan - 1);
      const syA = Math.floor(sy), syB = Math.min(srcH - 1, syA + 1);
      const fy = sy - syA;
      if (syA < 0 || syA >= srcH) continue;

      const rs = smoothed[Math.min(srcH - 1, Math.round(sy))] || 1;
      if (rs < warpMin) warpMin = rs;
      if (rs > warpMax) warpMax = rs;
      warpSum += rs; warpN++;

      const rowMid = m.mid[Math.min(srcH - 1, Math.round(sy))] ||
                     ((m.left[firstRow] + m.right[lastRow]) / 2);
      const colScale = scale * rs;

      for (let dx = 0; dx < frameW; dx++) {
        const sx = rowMid + (dx + 0.5 - centreX) / colScale;
        if (sx < 0 || sx >= srcW - 1) continue;
        const sxA = Math.floor(sx), sxB = Math.min(srcW - 1, sxA + 1);
        const fx = sx - sxA;

        const p00 = (syA * srcW + sxA) * 4, p01 = (syA * srcW + sxB) * 4;
        const p10 = (syB * srcW + sxA) * 4, p11 = (syB * srcW + sxB) * 4;
        const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy);
        const wc = (1 - fx) * fy, wd = fx * fy;

        const a = srcPx[p00 + 3] * wa + srcPx[p01 + 3] * wb + srcPx[p10 + 3] * wc + srcPx[p11 + 3] * wd;
        if (a < 2) continue;
        const d = (dy * frameW + dx) * 4;
        dst[d] = srcPx[p00] * wa + srcPx[p01] * wb + srcPx[p10] * wc + srcPx[p11] * wd;
        dst[d + 1] = srcPx[p00 + 1] * wa + srcPx[p01 + 1] * wb + srcPx[p10 + 1] * wc + srcPx[p11 + 1] * wd;
        dst[d + 2] = srcPx[p00 + 2] * wa + srcPx[p01 + 2] * wb + srcPx[p10 + 2] * wc + srcPx[p11 + 2] * wd;
        dst[d + 3] = a;
      }
    }
    oc.putImageData(img, 0, 0);

    return {
      canvas: out,
      width: frameW,
      height: frameH,
      placement: {
        top: topY, bottom: topY + spanFrac,
        centreX: centreX / frameW, scale, span: spanFrac
      },
      rows: smoothed,
      straightened: {
        applied: !!straightened.applied,
        lean: straightened.lean === undefined ? 0 : straightened.lean,
        topEdge: straightened.topEdge === undefined ? null : straightened.topEdge,
        why: straightened.why
      },
      warp: {
        min: +(warpMin === Infinity ? 1 : warpMin).toFixed(3),
        max: +(warpMax === -Infinity ? 1 : warpMax).toFixed(3),
        mean: +(warpN ? warpSum / warpN : 1).toFixed(3)
      }
    };
  }

  function alphaFrom(px, n) {
    const a = new Float32Array(n);
    for (let p = 0; p < n; p++) a[p] = px[p * 4 + 3] / 255;
    return a;
  }

  global.GarmentFit = { CONFIG, fit, measure, _internals: { solveScale, smoothRows, referenceRow } };

  if (typeof module !== "undefined" && module.exports) module.exports = global.GarmentFit;

})(typeof window !== "undefined" ? window : this);
