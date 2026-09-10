/* =========================================================================
   MODULE 3: outfit-compose.js
   -------------------------------------------------------------------------
   One job: put several already-fitted garments on the mannequin together, so
   the result reads as one outfit rather than a pile of pictures.

   WHY THIS MODULE IS SMALL

   It is small on purpose, and that is the whole point of doing module 2 first.
   Once every garment has been reshaped to the SAME body in the SAME frame,
   mixing them is no longer a fitting problem — there is nothing left to solve
   per combination, because each piece already knows where it sits. What is
   left is genuinely only:

     1. decide which pieces belong in the outfit at all (a dress and a skirt
        are not worn together)
     2. draw them in the right order
     3. close the gaps a real garment would not leave — a top that stops just
        above a waistband shows a stripe of bare mannequin, which no amount of
        good fitting prevents, because the two photos were never taken to meet
     4. say what is still uncovered, so the caller never leaves the mannequin
        half dressed

   PUBLIC API
     OutfitCompose.plan(items)                 -> which pieces, in what order
     OutfitCompose.render(base, items, opts)   -> Promise<Composite>

   An item is { category, cutout }  (cutout from GarmentCutout, or already
   fitted via `fitted`). Everything else is derived.
   ========================================================================= */

(function (global) {
  "use strict";

  const CONFIG = {
    frameWidth: 512,
    bridgeLimit: 0.06,   // most of the body a waistband may be stretched over
    shadow: 0.22         // strength of the contact shadow under each layer
  };

  const B = () => global.BodyModel;
  const F = () => global.GarmentFit;

  /* --------------------------------------------------------------- planning */

  /**
   * Which pieces actually go on, and in what order.
   *
   * A dress is a complete outfit from shoulder to hem, so a top and a skirt
   * worn with it would only fight for the same space; drop them rather than
   * layering three things over one torso. Everything else is ordered by
   * LAYER_ORDER, which puts the jacket UNDER the top on purpose — a jacket
   * photographed flat is open, so drawing it last would hide the very piece
   * being styled around.
   */
  function plan(items) {
    const order = B().LAYER_ORDER;
    const present = new Set(items.map(i => i.category));
    const dropped = [];
    const kept = items.filter(item => {
      if (present.has("dresses") && (item.category === "tops" || item.category === "bottoms")) {
        dropped.push({ category: item.category, why: "a dress already covers this" });
        return false;
      }
      if (!B().PLACEMENT[item.category]) {
        dropped.push({ category: item.category, why: "no placement defined" });
        return false;
      }
      return true;
    });
    kept.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
    return { kept, dropped };
  }

  /**
   * What the outfit does NOT cover.
   *
   * The mannequin must never end up half dressed, and the only way to be sure
   * is to check the body itself rather than trust that "there is a top in the
   * list". A top that came out cropped leaves the midriff bare just as surely
   * as no top at all.
   */
  function coverage(fittedList) {
    const spans = fittedList.map(f => f.placement);
    const covered = (y) => spans.some(p => y >= p.top - 0.005 && y <= p.bottom + 0.005);
    const zones = {
      chest: [0.26, 0.34],
      midriff: [0.35, 0.40],
      hips: [0.42, 0.48],
      thighs: [0.50, 0.58]
    };
    const bare = [];
    for (const name of Object.keys(zones)) {
      const [a, b] = zones[name];
      let miss = 0, total = 0;
      for (let y = a; y <= b; y += 0.005) { total++; if (!covered(y)) miss++; }
      if (miss / Math.max(1, total) > 0.5) bare.push(name);
    }
    return bare;
  }

  /* --------------------------------------------------------------- bridging */

  /**
   * Close the stripe of bare mannequin between a hem and a waistband.
   *
   * Two garments photographed separately have no reason to meet: a top ends
   * where its photo ended and a skirt starts where its photo started. Rather
   * than stretch either piece — which would visibly distort a print — the
   * lower garment's own top row is repeated upwards to fill the gap. That row
   * is the waistband, so what appears is a band of exactly the right fabric,
   * and it is drawn UNDER the top, where only the few pixels that would have
   * been bare are ever visible.
   */
  function bridge(fitted, upToY, frameH) {
    const canvas = fitted.canvas;
    const topPx = Math.round(fitted.placement.top * frameH);
    const wantPx = Math.round(upToY * frameH);
    if (wantPx >= topPx) return 0;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const source = ctx.getImageData(0, topPx + 1, canvas.width, 1);

    // Only commit if that row actually holds fabric. This is the one place a
    // change to ONE garment reaches into another — the band is taken from the
    // bottoms but the height comes from the top's hem — so if the row is empty
    // the right thing is to leave the lower garment completely alone rather
    // than stretch nothing upward and then report the gap as covered.
    let hasFabric = false;
    for (let x = 0; x < canvas.width && !hasFabric; x++) {
      if (source.data[x * 4 + 3] > 90) hasFabric = true;
    }
    if (!hasFabric) return 0;

    const band = ctx.createImageData(canvas.width, topPx - wantPx);
    for (let y = 0; y < band.height; y++) {
      band.data.set(source.data, y * canvas.width * 4);
    }
    ctx.putImageData(band, 0, wantPx);
    fitted.placement.top = upToY;
    return topPx - wantPx;
  }

  /* ---------------------------------------------------------------- drawing */

  /**
   * A soft dark edge along the underside of a layer.
   *
   * Without it every piece looks pasted on, because real clothing casts a
   * little shadow where it lifts away from the body and where one layer meets
   * another. It is drawn from the layer's own alpha, offset down and blurred,
   * and clipped to the layer beneath — so it darkens the garment under it and
   * never the background.
   */
  function contactShadow(fittedCanvas, strength) {
    const w = fittedCanvas.width, h = fittedCanvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const c = out.getContext("2d");
    c.filter = "blur(6px)";
    c.globalAlpha = strength;
    c.drawImage(fittedCanvas, 0, 4);
    c.filter = "none";
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-in";
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);
    return out;
  }

  /**
   * @param base   the mannequin photo (Image or canvas)
   * @param items  [{category, cutout}] — cutouts from GarmentCutout
   * @param opts   {frameWidth, shadow, bridgeLimit, reshape, fit:{...}}
   *
   * `reshape:false` composes without changing any garment's shape: each piece
   * is scaled and placed, nothing is warped to the body, and no gap is bridged.
   * That is the state the mannequin sits in until a render is asked for.
   */
  async function render(base, items, opts) {
    const options = opts || {};
    if (!B() || !F()) throw new Error("body-model.js and garment-fit.js must be loaded first");

    const bw = base.naturalWidth || base.width;
    const bh = base.naturalHeight || base.height;
    const frameW = options.frameWidth || CONFIG.frameWidth;
    const frameH = Math.round(frameW * bh / bw);

    const chosen = plan(items);

    // Reshape every piece to this one body, once.
    //
    // One garment that cannot be fitted must cost one garment. Without the
    // try/catch a single unusable cutout — erased down to nothing in the
    // retouch brush, say — threw out of here, so the caller got no render at
    // all and fell back to a stock photograph of a completely different
    // outfit. Dropping it instead is already a reported outcome: the caller
    // puts chosen.dropped in the caption.
    const layers = [];
    for (const item of chosen.kept) {
      let fitted;
      try {
        fitted = item.fitted ||
          F().fit(item.cutout, item.category, Object.assign(
            { frameWidth: frameW, frameHeight: frameH, reshape: options.reshape !== false },
            options.fit || {}));
      } catch (e) {
        chosen.dropped.push({ category: item.category, why: e && e.message || "could not be fitted" });
        continue;
      }
      layers.push({ category: item.category, item, fitted });
    }

    // close the gap between a hem and the waistband below it
    //
    // Not in preview mode. Bridging paints fabric that is not in any of the
    // photographs, which is the right call once the pieces have been reshaped
    // to one body and are meant to read as a single worn outfit. Before a
    // render is asked for, the mannequin is showing the wearer their own
    // clothes, and inventing a waistband there would be showing them something
    // they never photographed.
    const bridged = [];
    const torso = options.reshape === false ? null
                : layers.find(l => l.category === "tops" || l.category === "dresses");
    const lower = layers.find(l => l.category === "bottoms");
    if (torso && lower) {
      const gap = lower.fitted.placement.top - torso.fitted.placement.bottom;
      const limit = options.bridgeLimit === undefined ? CONFIG.bridgeLimit : options.bridgeLimit;
      if (gap > 0.002) {
        const to = lower.fitted.placement.top - Math.min(gap + 0.01, limit);
        const px = bridge(lower.fitted, to, frameH);
        if (px) bridged.push({ category: "bottoms", pixels: px });
      }
    }

    const out = document.createElement("canvas");
    out.width = frameW;
    out.height = frameH;
    const ctx = out.getContext("2d");
    ctx.drawImage(base, 0, 0, frameW, frameH);

    const shadow = options.shadow === undefined ? CONFIG.shadow : options.shadow;
    for (const layer of layers) {
      if (shadow > 0) ctx.drawImage(contactShadow(layer.fitted.canvas, shadow), 0, 0);
      ctx.drawImage(layer.fitted.canvas, 0, 0);
    }

    return {
      canvas: out,
      width: frameW,
      height: frameH,
      layers: layers.map(l => ({
        category: l.category,
        placement: l.fitted.placement,
        warp: l.fitted.warp
      })),
      dropped: chosen.dropped,
      bridged,
      bare: coverage(layers.map(l => l.fitted))
    };
  }

  global.OutfitCompose = {
    CONFIG, plan, render,
    _internals: { coverage, bridge, contactShadow }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.OutfitCompose;

})(typeof window !== "undefined" ? window : this);
