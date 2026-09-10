/* =========================================================================
   MODULE: cutout-paint.js
   -------------------------------------------------------------------------
   One job: let a person correct a cutout by hand — erase what is not the
   garment, paint back what the segmentation wrongly removed — and hand back a
   finished cutout of exactly the same shape the automatic path produces.

   No DOM, no events, no app state. The app maps a pointer to a fraction and
   calls stroke(); the test harness calls the same stroke() with numbers. There
   is deliberately no test-only code path, because a brush that is only ever
   exercised through synthetic events is a brush whose real behaviour is
   untested.

   WHAT SPACE IT PAINTS IN

   The uncropped WORKING FRAME, the same one the segmentation ran in. Not the
   cropped cutout, because a brush that can only paint inside the crop cannot
   paint back a sleeve that was cut off — there would be nowhere to paint TO.
   Both isolation backends rasterise the whole photograph to the same working
   size and never crop that space, so one frame serves either of them, and the
   photograph's own pixels line up with the cutout's pixel-for-pixel with no
   registration arithmetic anywhere.

   THE TWO WAYS TO PAINT BACK

   Both are offered because they answer different questions.

     draw   takes the photograph's own pixels. Exact, and right whenever the
            fabric really is in the photo and the segmentation merely missed
            it, which is the common case. Nothing is invented.

     fill   synthesises fabric from the garment around the gap, for the case
            where the photograph never contained what is missing — the back of
            a coat behind its own open front. Diffusion alone gives the right
            colour and a dead flat surface, so the low frequencies come from
            diffusion and the grain is borrowed from real fabric elsewhere on
            the same garment (see synthesiseFill). It is honest rather than
            magic: at a wardrobe thumbnail's size it reads as fabric, and it is
            the second choice rather than the default for a reason.

   WHAT KEEPS AN EDIT LOCAL

   Every stroke's effect is confined to its own dilated footprint:

       final[p] = footprint[p] ? edited[p] : base[p]

   so painting a sleeve cannot move the hem by a single pixel. That matters
   beyond tidiness: the mannequin's whole layering approach rests on a garment's
   fit being decided by its own silhouette, so a retouch that quietly shifted
   an untouched edge would move the garment on the body.

   PUBLIC API
     CutoutPaint.create({w, h, baseAlpha, baseRgba, rawRgba, radius}) -> Layer
     CutoutPaint.stroke(layer, tool, points, opts)   points are [fx, fy] 0..1
     CutoutPaint.undo(layer) -> boolean
     CutoutPaint.clear(layer)
     CutoutPaint.render(layer) -> {canvas, alpha, dirty, strokes, footprintPixels}
     CutoutPaint.commit(layer, maxDim) -> {canvas, alpha, bounds, empty}
   ========================================================================= */

(function (global) {
  "use strict";

  const CONFIG = {
    feather: 1.4,        // brush edge softness, in working-frame pixels
    resample: 0.5,       // stroke points are resampled at radius * this
    bakeAfter: 60,       // strokes past this are folded into the base
    fillGrain: 0.8       // how much borrowed texture is added back to a fill
  };

  const TOOLS = { erase: 1, draw: 2, fill: 3 };

  /* -------------------------------------------------------------- geometry */

  /**
   * A stroke's coverage, rasterised without touching a canvas.
   *
   * A canvas would mean one getImageData per stroke to read the coverage back,
   * and undo replays every stroke from the base, so that is a full-frame
   * readback per stroke per undo. Testing distance against a circle is a few
   * hundred thousand comparisons for a whole stroke and needs no readback at
   * all.
   */
  function stamp(target, w, h, points, radius) {
    const r = Math.max(1, radius);
    const r2 = r * r;
    let touched = 0;
    const dab = (cx, cy) => {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          if (dx * dx + dy * dy > r2) continue;
          const p = y * w + x;
          if (!target[p]) { target[p] = 1; touched++; }
        }
      }
    };

    // Resample along the path. A fast drag delivers pointer events far apart,
    // and dabs placed only at those points leave a dotted line rather than a
    // stroke.
    const step = Math.max(1, r * CONFIG.resample);
    if (!points.length) return 0;
    dab(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let k = 1; k <= n; k++) {
        dab(x0 + (x1 - x0) * (k / n), y0 + (y1 - y0) * (k / n));
      }
    }
    return touched;
  }

  function dilate1(mask, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!mask[p]) continue;
        out[p] = 1;
        if (x > 0) out[p - 1] = 1;
        if (x < w - 1) out[p + 1] = 1;
        if (y > 0) out[p - w] = 1;
        if (y < h - 1) out[p + w] = 1;
      }
    }
    return out;
  }

  /** Separable box blur of one channel, used for the fill's grain transfer. */
  function blurChannel(src, w, h, r) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const span = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / span;
        sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
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

  /* ------------------------------------------------------------------- fill */

  /**
   * Fabric for a gap the photograph never contained.
   *
   * Two stages, because one is not enough and the second is cheap.
   *
   * The colour comes from diffusion: spread inwards ring by ring from the edge
   * of the gap, averaging only pixels that are KNOWN GARMENT. That last part is
   * the whole trick. The obvious thing is to average whatever is adjacent, and
   * whatever is adjacent to a garment's outline is the studio backdrop, so a
   * gap opening onto the silhouette fills with white and the repair is worse
   * than the hole.
   *
   * The grain comes from real fabric. Diffusion converges on a smooth field, so
   * on its own a filled coat panel is a flat colour patch surrounded by weave —
   * plausible in hue, obviously synthetic in texture. So a patch of the same
   * garment is high-pass filtered and its detail added back on top of the
   * diffused colour. The patch is looked for at the mirror position first:
   * garments in a wardrobe photo are shot front-on and are close to
   * symmetrical, so the mirrored pixel is usually the same part of the same
   * garment under the same light, and it carries the vertical structure — the
   * weave direction, the shading falloff — that a nearby patch would not.
   */
  function synthesiseFill(w, h, rgba, alpha, region, known) {
    let count = 0;
    for (let p = 0; p < w * h; p++) if (region[p]) count++;
    if (!count) return null;

    const out = new Float32Array(w * h * 3);
    const settled = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (region[p] || !known[p]) continue;
      settled[p] = 1;
      out[p * 3] = rgba[p * 4];
      out[p * 3 + 1] = rgba[p * 4 + 1];
      out[p * 3 + 2] = rgba[p * 4 + 2];
    }

    /* Ring-by-ring breadth-first fill, with a queued flag.
       The flag is not an optimisation. A pixel is reachable from up to four of
       its neighbours, so without it every pixel enters the next ring's queue
       once per settled neighbour, those duplicates each enqueue THEIR
       neighbours again, and the queue multiplies by about four per ring. It is
       exponential, and it does not look like it: a small gap finishes and a
       large one locks the tab up inside a mouseup handler. Measured, a fill
       across a jacket never returned at all. */
    const queued = new Uint8Array(w * h);
    let frontier = [];
    const enqueue = p => {
      if (!region[p] || settled[p] || queued[p]) return;
      queued[p] = 1;
      frontier.push(p);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!region[p]) continue;
        if ((x > 0 && settled[p - 1]) || (x < w - 1 && settled[p + 1]) ||
            (y > 0 && settled[p - w]) || (y < h - 1 && settled[p + w])) enqueue(p);
      }
    }
    // A gap with no known fabric anywhere around it cannot be filled from the
    // garment, and guessing from the backdrop is what this function exists to
    // avoid, so say so instead.
    if (!frontier.length) return null;

    while (frontier.length) {
      const writes = [];
      for (const p of frontier) {
        queued[p] = 0;
        if (settled[p]) continue;
        const x = p % w, y = (p - x) / w;
        let r = 0, g = 0, b = 0, n = 0;
        const take = q => {
          if (!settled[q]) return;
          r += out[q * 3]; g += out[q * 3 + 1]; b += out[q * 3 + 2]; n++;
        };
        if (x > 0) take(p - 1);
        if (x < w - 1) take(p + 1);
        if (y > 0) take(p - w);
        if (y < h - 1) take(p + w);
        if (n) writes.push([p, r / n, g / n, b / n]);
      }
      if (!writes.length) break;
      for (const [p, r, g, b] of writes) {
        out[p * 3] = r; out[p * 3 + 1] = g; out[p * 3 + 2] = b;
        settled[p] = 1;
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

    // smooth the diffused field so ring artefacts do not show as contours
    for (let it = 0; it < 3; it++) {
      const copy = out.slice();
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (!region[p]) continue;
          for (let c = 0; c < 3; c++) {
            out[p * 3 + c] = (copy[(p - 1) * 3 + c] + copy[(p + 1) * 3 + c] +
                              copy[(p - w) * 3 + c] + copy[(p + w) * 3 + c]) / 4;
          }
        }
      }
    }

    addBorrowedGrain(w, h, rgba, known, region, out);

    return out;
  }

  /**
   * Add real fabric detail on top of the diffused colour.
   *
   * For each pixel to fill, look for a donor: the mirror of that pixel about
   * the garment's own vertical centre line, and failing that a fixed offset
   * away. A donor only counts if it is known garment and outside the gap. The
   * donor's high-frequency part — itself minus a blurred copy of itself — is
   * what gets added, so the colour still comes from the diffusion and only the
   * weave comes from the donor. Adding the donor's colour too would paste a
   * visible patch of somewhere else.
   */
  function addBorrowedGrain(w, h, rgba, known, region, out) {
    let sum = 0, n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!known[p] || region[p]) continue;
        sum += x; n++;
      }
    }
    if (!n) return;
    const axis = Math.round(sum / n);

    // a luminance high-pass of the whole frame, computed once
    const luma = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      luma[p] = 0.299 * rgba[p * 4] + 0.587 * rgba[p * 4 + 1] + 0.114 * rgba[p * 4 + 2];
    }
    const low = blurChannel(luma, w, h, 3);

    const usable = q => q >= 0 && q < w * h && known[q] && !region[q];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!region[p]) continue;
        const mx = 2 * axis - x;
        let donor = -1;
        if (mx >= 0 && mx < w && usable(y * w + mx)) donor = y * w + mx;
        else {
          for (const dx of [12, -12, 24, -24, 40, -40]) {
            const q = y * w + (x + dx);
            if (x + dx >= 0 && x + dx < w && usable(q)) { donor = q; break; }
          }
        }
        if (donor < 0) continue;
        const detail = (luma[donor] - low[donor]) * CONFIG.fillGrain;
        for (let c = 0; c < 3; c++) {
          const v = out[p * 3 + c] + detail;
          out[p * 3 + c] = v < 0 ? 0 : (v > 255 ? 255 : v);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ layer */

  function create(spec) {
    const w = spec.w, h = spec.h;
    if (!w || !h) throw new Error("cutout-paint needs a frame size");
    if (!spec.baseAlpha || spec.baseAlpha.length !== w * h) {
      throw new Error("cutout-paint needs a base alpha of w*h");
    }
    return {
      w, h,
      baseAlpha: spec.baseAlpha,
      baseRgba: spec.baseRgba,
      rawRgba: spec.rawRgba || spec.baseRgba,
      radius: spec.radius || Math.max(6, Math.round(Math.min(w, h) * 0.035)),
      strokes: [],
      cache: null,
      stroking: false
    };
  }

  /** @param points [[fx,fy],...] as fractions of the frame, 0..1 */
  function stroke(layer, tool, points, opts) {
    if (!TOOLS[tool]) throw new Error("unknown paint tool: " + tool);
    if (!points || !points.length) return false;
    const options = opts || {};
    const pts = points.map(pt => [
      Math.max(0, Math.min(layer.w - 1, pt[0] * layer.w)),
      Math.max(0, Math.min(layer.h - 1, pt[1] * layer.h))
    ]);
    layer.strokes.push({ tool, pts, r: options.radius || layer.radius });
    layer.cache = null;
    if (layer.strokes.length > CONFIG.bakeAfter) bake(layer);
    return true;
  }

  /**
   * Fold the oldest strokes into the base so replay stays bounded.
   * Undo past a bake is no longer possible, which is why the limit is high
   * enough that nobody reaches it by correcting one garment.
   */
  function bake(layer) {
    const keep = layer.strokes.slice(-20);
    const older = layer.strokes.slice(0, -20);
    const folded = replay(layer, older);
    layer.baseAlpha = folded.alpha;
    layer.baseRgba = folded.rgba;
    layer.strokes = keep;
    layer.cache = null;
  }

  function undo(layer) {
    if (!layer.strokes.length) return false;
    layer.strokes.pop();
    layer.cache = null;
    return true;
  }

  function clear(layer) {
    if (!layer.strokes.length) return false;
    layer.strokes = [];
    layer.cache = null;
    return true;
  }

  /** Applies a list of strokes to the base and returns fresh buffers. */
  function replay(layer, strokes) {
    const w = layer.w, h = layer.h, n = w * h;
    const alpha = Float32Array.from(layer.baseAlpha);
    const rgba = new Uint8ClampedArray(layer.baseRgba ? layer.baseRgba.length : n * 4);
    if (layer.baseRgba) rgba.set(layer.baseRgba);
    const footprint = new Uint8Array(n);
    const fillWanted = new Uint8Array(n);
    let fillAny = false;

    for (const s of strokes) {
      const hit = new Uint8Array(n);
      stamp(hit, w, h, s.pts, s.r);
      for (let p = 0; p < n; p++) {
        if (!hit[p]) continue;
        footprint[p] = 1;
        if (s.tool === "erase") {
          alpha[p] = 0;
          fillWanted[p] = 0;
        } else if (s.tool === "draw") {
          alpha[p] = 1;
          fillWanted[p] = 0;
          if (layer.rawRgba) {
            rgba[p * 4] = layer.rawRgba[p * 4];
            rgba[p * 4 + 1] = layer.rawRgba[p * 4 + 1];
            rgba[p * 4 + 2] = layer.rawRgba[p * 4 + 2];
          }
        } else {
          alpha[p] = 1;
          fillWanted[p] = 1;
          fillAny = true;
        }
      }
    }

    if (fillAny) {
      // known fabric is everything opaque that is not itself being filled
      const known = new Uint8Array(n);
      for (let p = 0; p < n; p++) known[p] = (!fillWanted[p] && alpha[p] >= 0.5) ? 1 : 0;
      const field = synthesiseFill(w, h, rgba, alpha, fillWanted, known);
      if (field) {
        for (let p = 0; p < n; p++) {
          if (!fillWanted[p]) continue;
          rgba[p * 4] = field[p * 3];
          rgba[p * 4 + 1] = field[p * 3 + 1];
          rgba[p * 4 + 2] = field[p * 3 + 2];
        }
      } else if (layer.rawRgba) {
        // nothing to synthesise from; the photograph is a better guess than a
        // block of one colour, and the user can erase it again
        for (let p = 0; p < n; p++) {
          if (!fillWanted[p]) continue;
          rgba[p * 4] = layer.rawRgba[p * 4];
          rgba[p * 4 + 1] = layer.rawRgba[p * 4 + 1];
          rgba[p * 4 + 2] = layer.rawRgba[p * 4 + 2];
        }
      }
    }

    return { alpha, rgba, footprint };
  }

  /**
   * The edited cutout, as a full-frame canvas.
   *
   * The brush leaves a hard circular edge, which reads as cut out with
   * scissors, so the edited alpha is re-matted. That is done over the whole
   * frame and then written back ONLY inside the stroke footprint, so every
   * pixel the user did not touch keeps its original alpha to the bit — which is
   * what stops a retouch on a sleeve from moving the garment's hem, and with it
   * the garment's placement on the mannequin.
   */
  function render(layer) {
    if (layer.cache) return layer.cache;
    const w = layer.w, h = layer.h, n = w * h;

    if (!layer.strokes.length) {
      const cv = frameCanvas(w, h, layer.baseRgba, layer.baseAlpha);
      layer.cache = { canvas: cv, alpha: Float32Array.from(layer.baseAlpha),
                      dirty: false, strokes: 0, footprintPixels: 0 };
      return layer.cache;
    }

    const out = replay(layer, layer.strokes);
    const grown = dilate1(out.footprint, w, h);

    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p++) mask[p] = out.alpha[p] >= 0.5 ? 1 : 0;

    const soft = softAlpha(mask, w, h);
    const finalAlpha = out.alpha;
    for (let p = 0; p < n; p++) {
      finalAlpha[p] = grown[p] ? soft[p] : layer.baseAlpha[p];
    }

    let footprintPixels = 0;
    for (let p = 0; p < n; p++) if (out.footprint[p]) footprintPixels++;

    layer.cache = {
      canvas: frameCanvas(w, h, out.rgba, finalAlpha),
      alpha: finalAlpha,
      dirty: true,
      strokes: layer.strokes.length,
      footprintPixels
    };
    return layer.cache;
  }

  /** Feathered alpha from a binary mask, reusing the cutout module's matte. */
  function softAlpha(mask, w, h) {
    const gc = global.GarmentCutout;
    if (gc && gc._internals && gc._internals.matte) {
      return gc._internals.matte(mask, w, h, { featherRadius: CONFIG.feather });
    }
    const a = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) a[p] = mask[p] ? 1 : 0;
    return a;
  }

  function frameCanvas(w, h, rgba, alpha) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const img = ctx.createImageData(w, h);
    for (let p = 0; p < w * h; p++) {
      if (rgba) {
        img.data[p * 4] = rgba[p * 4];
        img.data[p * 4 + 1] = rgba[p * 4 + 1];
        img.data[p * 4 + 2] = rgba[p * 4 + 2];
      }
      img.data[p * 4 + 3] = Math.round(Math.max(0, Math.min(1, alpha[p])) * 255);
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /**
   * The finished cutout, cropped to what is left and scaled for storage.
   * Same shape as GarmentCutout.extract's own output, so the caller does not
   * have to know whether a garment was retouched.
   */
  function commit(layer, maxDim, padding) {
    const r = render(layer);
    const w = layer.w, h = layer.h;
    const a = r.alpha;
    // 0.35 matches the threshold GarmentFit measures a silhouette with, so a
    // faint brush edge cannot become the garment's bounds here and then be
    // ignored there
    const t = 0.35;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (a[y * w + x] < t) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { canvas: null, alpha: null, bounds: null, empty: true };

    const pad = padding === undefined ? 3 : padding;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

    const crop = document.createElement("canvas");
    crop.width = cw; crop.height = ch;
    crop.getContext("2d").drawImage(r.canvas, x0, y0, cw, ch, 0, 0, cw, ch);

    const limit = maxDim || 512;
    const s = Math.min(1, limit / Math.max(cw, ch));
    let outCv = crop;
    if (s < 1) {
      outCv = document.createElement("canvas");
      outCv.width = Math.max(1, Math.round(cw * s));
      outCv.height = Math.max(1, Math.round(ch * s));
      const c = outCv.getContext("2d", { willReadFrequently: true });
      c.imageSmoothingQuality = "high";
      c.drawImage(crop, 0, 0, outCv.width, outCv.height);
    }
    const oc = outCv.getContext("2d", { willReadFrequently: true });
    const d = oc.getImageData(0, 0, outCv.width, outCv.height).data;
    const alpha = new Float32Array(outCv.width * outCv.height);
    for (let p = 0; p < alpha.length; p++) alpha[p] = d[p * 4 + 3] / 255;

    return {
      canvas: outCv,
      width: outCv.width,
      height: outCv.height,
      alpha,
      bounds: { x: x0 / w, y: y0 / h, w: cw / w, h: ch / h },
      empty: false
    };
  }

  global.CutoutPaint = {
    CONFIG, TOOLS, create, stroke, undo, clear, render, commit,
    _internals: { stamp, dilate1, synthesiseFill, addBorrowedGrain, replay, frameCanvas }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.CutoutPaint;

})(typeof window !== "undefined" ? window : this);
