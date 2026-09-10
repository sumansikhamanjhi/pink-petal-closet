/* =========================================================================
   MODULE: worn-render.js
   -------------------------------------------------------------------------
   One job: ask an image model to re-photograph a garment as if it were being
   worn, so the cutout it produces already has a body's shape in it.

   WHY, AND WHAT IT REPLACES

   garment-fit.js can make a flat photograph the right width and the right
   length. It cannot put a chest in a bodice, an elbow in a sleeve, or an inside
   in an open coat, because none of those are in the photograph — they are
   missing information, and no warp invents them. Past a point the warp starts
   to look wrong precisely because it is trying.

   A generated image supplies the missing information instead.

   THE GHOST MANNEQUIN, AND WHY NOT "ON THE MANNEQUIN"

   The obvious request is "put this on my mannequin", and it was tried first. It
   produces a lovely picture and it is the wrong tool, because the model
   REGENERATES the scene rather than editing it: a different shop, a slightly
   different mannequin, every time. Measured, the returned frame was even a
   different shape (1024x1024 against a 768x1376 base). So the garment cannot
   be recovered by differencing against the known mannequin, and two garments
   generated separately do not belong to the same picture — which kills
   layering, and layering is the whole app.

   So the request here is for a GHOST MANNEQUIN shot instead: the garment
   holding its worn three-dimensional shape with no body visible at all, on a
   plain background. That is a real product-photography term, models know it,
   and it is better on every axis that matters:

     nothing has to be separated from a mannequin, so a white shirt is no
     harder than a black one;
     the background is plain, which is exactly what modules/seg-watershed.js is
     built for — measured, the extraction comes back at quality 100;
     and the result is an ordinary cutout, so garment-fit, outfit-compose,
     shuffling and layering all keep working untouched.

   WHERE IT IS WORTH THE MONEY

   Not everywhere, and the module says so rather than pretending. A garment
   already photographed as a clean product shot barely improves: for the
   burgundy dress the fit's own effort measure went from 0.346 to 0.342, which
   is nothing. What improves is the bad input — a hanger shot with no body in
   it, or a garment cut from a photo of a person mid-pose. So this is offered
   per garment rather than run over a wardrobe, and `worthIt` exists to say
   which ones would gain.

   ONE CALL PER GARMENT, EVER

   The result is stored as a cutout against the item, so the cost is paid once
   when a garment is added and never again — not per outfit, and certainly not
   per shuffle. Shuffling stays free.

   PUBLIC API
     WornRender.PROMPT_VERSION
     WornRender.CAN_RENDER            categories worth rendering at all
     WornRender.buildPrompt(category, label, {rgb,phrase})
     WornRender.worthIt(cutout, fitted)   -> {worth, why, effort}
     WornRender.generate(request)     -> {image}  (via the local proxy)
     WornRender.status()
   ========================================================================= */

(function (global) {
  "use strict";

  /* Bump when buildPrompt changes so stored renders are known to be stale.
     2: fidelity clauses rewritten as prohibitions and moved to the front and
        back of the prompt, after a floral dress came back a different colour
        and a different length under version 1.
     3: the colour is now MEASURED from the garment's pixels and stated as sRGB,
        replacing the wardrobe's stored colour name. Version 2 repeated that
        name, and the name for a golden-yellow dress was "Amber" — so the
        prompt was asking for the very drift it was written to prevent. */
  const PROMPT_VERSION = 3;

  const CONFIG = {
    // CIE76: about where a person stops calling it the same colour
    maxColourShift: 12,
    // a fifth: a midi becoming a mini. Below that is measurement noise between
    // a flat photograph and a worn one
    maxLengthDrift: 0.20
  };

  // Shoes and bags are photographed on their own already and have no body to
  // fill out; a ghost render of a handbag is a handbag. Accessories likewise.
  const CAN_RENDER = new Set(["tops", "bottoms", "dresses", "jackets"]);

  const SHAPE = {
    tops: {
      what: "top",
      worn: "filled out across the chest and shoulders as if worn, with the " +
            "shoulders and any sleeves holding their shape"
    },
    bottoms: {
      what: "skirt or pair of trousers",
      worn: "filled out at the waist and hips as if worn, with the waistband " +
            "circular and open at the top and the legs or hem hanging naturally"
    },
    dresses: {
      what: "dress",
      worn: "filled out across the bust, taken in at the waist and following " +
            "the hips as if worn, with the skirt hanging and draping naturally"
    },
    jackets: {
      what: "jacket or coat",
      worn: "filled out across the chest and shoulders as if worn, with both " +
            "sleeves rounded and hanging down as though arms were in them"
    }
  };

  /**
   * The instruction.
   *
   * Every clause earns its place. "No mannequin, no body" is what makes the
   * result extractable without having to separate the garment from a form.
   * "Plain white seamless, no shadow on the background" is what the backdrop
   * flood in seg-watershed.js needs to work at all. The hollow openings are
   * what stop a filled-out garment reading as a solid lump of fabric.
   *
   * WHY THE FIDELITY CLAUSES ARE SHOUTED. Version 1 said "same colour, same
   * fabric, same pattern, same cut, same length. Do not redesign it" — polite,
   * accurate, and one line in the middle of a paragraph. A floral dress came
   * back a different colour and a different length. Asked to make a product
   * photograph of a garment, a model that quietly improves it is not
   * malfunctioning; it was never told that the garment is the subject rather
   * than the brief.
   *
   * So fidelity now opens the prompt and closes it, the two things that
   * actually drifted are named, and the rules are prohibitions. "Do not shorten
   * the hem" binds an image model in a way "keep the length" does not, because
   * a negative names the specific act it might otherwise perform.
   *
   * AND THE COLOUR IS MEASURED, NOT LOOKED UP. Version 2 stated the wardrobe's
   * stored colour name, on the sound reasoning that an explicit target beats a
   * rule to remember. The source was the problem: that name comes from a
   * twenty-bucket table where every saturated hue from 25 to 45 is "Amber", so
   * a golden-yellow dress is filed as an "Amber Dress" and the prompt then
   * asked, in as many words, for an amber dress. The lesson is not "do not name
   * the colour" — it is that the only colour worth naming is one measured from
   * the pixels being sent, which cannot disagree with them.
   */
  function buildPrompt(category, label, colour) {
    const shape = SHAPE[category] || { what: "garment", worn: "filled out as if worn" };
    const clean = s => String(s).replace(/["\r\n]/g, "");
    const named = label ? ('the "' + clean(label) + '"') : "this garment";
    /* `colour` is MEASURED from the garment's pixels, never the wardrobe's
       stored colour name. That name comes from a coarse twenty-bucket table in
       which any saturated hue between 25 and 45 is "Amber", so a golden-yellow
       dress is filed as an "Amber Dress" — and a prompt that repeated the label
       told the model to make it amber. A measurement cannot disagree with the
       image it was taken from. */
    const rgb = colour && colour.rgb ? "sRGB(" + colour.rgb.join(", ") + ")" : null;
    const phrase = colour && colour.phrase ? clean(colour.phrase) : null;
    const stated = rgb ? (rgb + (phrase ? " — " + phrase : "")) : null;
    return [
      "TASK: re-photograph a garment that already exists. You are NOT designing",
      "a garment. The attached image IS the garment — not a reference, not",
      "inspiration. Reproduce it exactly; do not reinterpret it.",
      "",
      "The attached image is " + named + ", a " + shape.what +
        (stated ? ". Its colour, measured from that image, is " + stated + "." : "."),
      "",
      "THE IMAGE IS THE AUTHORITY. Where any word here seems to disagree with what",
      "the image shows, the image is correct. Match the pixels, not the wording.",
      "The garment's name above is only a label its owner typed: if it mentions a",
      "colour, IGNORE that word and use the measured colour. A garment called",
      "\"Amber Dress\" whose measured colour is yellow is a YELLOW dress.",
      "",
      "Produce a GHOST MANNEQUIN product photograph of that same garment: the",
      "garment shown as if worn by an invisible person, holding its full",
      "three-dimensional worn shape, with NO mannequin, NO body, NO head, NO",
      "limbs and NO person visible anywhere.",
      "",
      "FIDELITY — the rules that matter most:",
      "- COLOUR: exactly the colour in the attached image" +
        (stated ? ", which measures " + stated + "." : ".") +
        " Do not shift the",
      "  hue — a yellow garment must not come back amber, gold, mustard or orange,",
      "  and the same applies to every other colour. Do not deepen or lighten it, do",
      "  not saturate or desaturate it, do not recolour it to look better against",
      "  white, and do not colour-grade the picture.",
      "- PATTERN: if it is floral, striped or printed, reproduce THAT print at the",
      "  same scale and density. Do not substitute another floral, another print, or",
      "  a plain fabric.",
      "- LENGTH: exactly the length in the attached image. Do not shorten or lengthen",
      "  the hem, the sleeves or the straps. A midi stays midi, a maxi stays maxi, a",
      "  cropped top stays cropped. Keep the same ratio of length to width.",
      "- CUT: same neckline, same sleeves, same waist, same buttons, same seams, same",
      "  trim. Add nothing — no belt, no collar, no slit, no pockets, no logo.",
      "- Do not redesign it, restyle it, modernise it, tidy it up or make it more",
      "  attractive, and do not replace it with a similar garment. If it looks",
      "  unusual or unflattering, reproduce it as it is.",
      "",
      "Worn shape, not flat: " + shape.worn + ",",
      "with soft realistic folds, and a hollow dark opening at the neck and at",
      "any cuff, waistband or hem opening. Changing the SHAPE from flat to worn is",
      "the only change permitted; colour, print, length and cut stay identical.",
      "",
      "Straight and symmetrical, facing the camera front-on, vertical, centred.",
      "Plain pure white seamless background, evenly lit, no floor, no cast",
      "shadow on the background, no props, no hanger, no clips, no labels added.",
      "The entire garment visible with a small margin of empty white around it.",
      "Photographic and realistic, like a clothing catalogue product shot.",
      "",
      "Before you answer, compare your result with the attached image: same",
      "colour, same print, same length. If it differs, correct it.",
      "",
      "Return one image only, no text: the SAME garment" +
        (stated ? " in " + stated : "") + ", at the same length, with the",
      "same print, now holding its worn shape."
    ].join("\n");
  }

  /**
   * Would a render actually improve this garment?
   *
   * Answered from the fit's own effort rather than by guessing: `warp` reports
   * how far from 1.0 the per-row squeeze had to go and how much it varied, and
   * a garment the fit is straining against is a garment with no body shape in
   * it. A clean product shot needs almost no persuading and is not worth
   * paying for.
   */
  function worthIt(cutout, fitted) {
    if (!fitted || !fitted.warp) return { worth: false, why: "nothing measured", effort: 0 };
    const w = fitted.warp;
    const effort = Math.abs(w.mean - 1) + (w.max - w.min);
    const straightened = fitted.straightened && fitted.straightened.applied;
    const quality = cutout && cutout.metrics ? cutout.metrics.quality : 100;

    /* A garment that was largely hidden is the best case there is for a paid
       render. The extraction puts back fabric that hair or an arm was standing
       in front of, but it can only diffuse the surrounding colour into the
       gap: the shape comes out right and the weave does not, so a print stops
       at the edge of the repair and a seam simply vanishes. That is precisely
       what an image model can supply and local code cannot, which makes this
       the strongest reason to spend a call — stronger than a strained fit,
       hence ahead of it. */
    const occluded = cutout && cutout.metrics && cutout.metrics.occluded || 0;
    if (occluded > 0.02) {
      return { worth: true, effort: +effort.toFixed(3),
               why: "hair or a limb hid " + Math.round(occluded * 100) +
                    "% of this garment — the missing part is painted, not photographed" };
    }
    if (straightened) {
      return { worth: true, effort: +effort.toFixed(3),
               why: "cut from a posed photo — it had to be rotated upright, so it has no worn shape" };
    }
    if (effort > 0.45) {
      return { worth: true, effort: +effort.toFixed(3),
               why: "the fit is straining to give this a body shape" };
    }
    if (quality < 85) {
      return { worth: true, effort: +effort.toFixed(3),
               why: "the cutout's own edges are poor, so a clean re-render would help" };
    }
    return { worth: false, effort: +effort.toFixed(3),
             why: "this is already a clean product shot with body shape in it" };
  }

  /* ------------------------------------------------------- checking the render

     A PROMPT IS A REQUEST, NOT A GUARANTEE.

     However firmly the instruction is worded, the model may still hand back a
     garment of a different colour or a different length — and the two ways that
     could go wrong were both reported before this existed. Worse, the render is
     STORED against the garment and reused for every outfit from then on, so one
     bad render is not a bad picture once; it is the wrong dress for ever.

     Both failures are measurable, so they are measured rather than hoped about.
     What is deliberately NOT done is anything clever: no attempt to judge
     whether the render is prettier, better lit or more convincing. Two numbers,
     both comparing the render against the photograph the wearer owns. */

  /** sRGB -> CIE Lab (D65), enough for a colour-difference measure. */
  function toLab(r, g, b) {
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const R = f(r), G = f(g), B = f(b);
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const k = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
    const fx = k(X), fy = k(Y), fz = k(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /**
   * The garment's own colour and proportions, from a cutout.
   *
   * Colour is the mean over SOLIDLY opaque pixels only: an edge pixel is part
   * background however well it was matted, and on a white ghost-render
   * background including them drags every measurement towards white.
   *
   * Length is expressed as height over SHOULDER width, not over the widest
   * point. The widest point is exactly what a ghost render is supposed to
   * change — filling a garment out makes it broader at the bust and hip — so a
   * plain aspect ratio conflates "correctly filled out" with "wrongly
   * shortened". The shoulders are already at full width in a flat photograph
   * and stay there, which makes them the one width that means the same thing in
   * both pictures.
   */
  function measure(cutout) {
    const w = cutout.width, h = cutout.height;
    const ctx = cutout.canvas.getContext("2d", { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, w, h).data;

    let n = 0, L = 0, A = 0, B = 0;
    let top = h, bottom = -1;
    const rowWidth = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let lo = -1, hi = -1;
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (d[p + 3] < 250) continue;
        if (lo < 0) lo = x;
        hi = x;
        const lab = toLab(d[p], d[p + 1], d[p + 2]);
        L += lab[0]; A += lab[1]; B += lab[2]; n++;
      }
      if (lo >= 0) {
        rowWidth[y] = hi - lo + 1;
        if (y < top) top = y;
        bottom = y;
      }
    }
    if (!n || bottom < top) return null;

    const span = bottom - top + 1;
    // a band around the shoulders rather than one row, so a strap or a fold
    // does not decide the measurement
    let shoulder = 0, rows = 0;
    for (let y = top + Math.round(span * 0.06); y <= top + Math.round(span * 0.18); y++) {
      if (rowWidth[y] > 0) { shoulder += rowWidth[y]; rows++; }
    }
    shoulder = rows ? shoulder / rows : 0;
    let widest = 0;
    for (let y = top; y <= bottom; y++) if (rowWidth[y] > widest) widest = rowWidth[y];

    return {
      lab: [L / n, A / n, B / n],
      height: span,
      shoulder: +shoulder.toFixed(1),
      widest,
      lengthRatio: shoulder > 2 ? +(span / shoulder).toFixed(3) : null
    };
  }

  /**
   * Did the render come back as the same garment?
   *
   * The thresholds are set to catch what was actually reported and nothing
   * subtler. A CIE76 difference of 12 is roughly "a person would call that a
   * different colour"; ordinary lighting and fabric-sheen differences between a
   * flat photograph and a worn one sit well below it. A length change of a
   * fifth is a midi becoming a mini — smaller drifts are inside the error of
   * measuring a shoulder width across two differently-shaped pictures, and
   * failing a render for them would reject good work.
   *
   * Erring towards accepting is the right way round here. A render wrongly
   * refused costs the price of one call; a render wrongly kept becomes the
   * wearer's garment in every outfit from then on, which is the failure this
   * whole check exists to prevent — so the numbers are reported either way and
   * the caller says what happened.
   */
  function fidelity(before, after) {
    const a = before && measure(before);
    const b = after && measure(after);
    if (!a || !b) return { ok: true, why: "nothing measurable to compare", colourShift: null, lengthDrift: null };

    const colourShift = +Math.sqrt(
      Math.pow(a.lab[0] - b.lab[0], 2) +
      Math.pow(a.lab[1] - b.lab[1], 2) +
      Math.pow(a.lab[2] - b.lab[2], 2)).toFixed(1);

    let lengthDrift = null;
    if (a.lengthRatio && b.lengthRatio) {
      lengthDrift = +((b.lengthRatio - a.lengthRatio) / a.lengthRatio).toFixed(3);
    }

    const faults = [];
    if (colourShift > CONFIG.maxColourShift) {
      faults.push("the colour came back different (ΔE " + colourShift + ")");
    }
    if (lengthDrift !== null && Math.abs(lengthDrift) > CONFIG.maxLengthDrift) {
      faults.push("the length came back " + (lengthDrift < 0 ? "shorter" : "longer") +
                  " by " + Math.round(Math.abs(lengthDrift) * 100) + "%");
    }
    return {
      ok: faults.length === 0,
      why: faults.length ? faults.join(" and ") : "same colour and length",
      colourShift, lengthDrift,
      before: { lengthRatio: a.lengthRatio, shoulder: a.shoulder, height: a.height },
      after: { lengthRatio: b.lengthRatio, shoulder: b.shoulder, height: b.height }
    };
  }

  /**
   * Asks the local proxy for a ghost render. Deliberately sends ONLY the
   * garment: the mannequin is not needed and every image sent is input tokens
   * paid for.
   */
  async function generate(request) {
    const svc = global.TryOnService;
    if (!svc) throw new Error("tryon-service.js is not loaded");
    const { garment, category, label, signature } = request || {};
    if (!garment) throw new Error("need a garment image");
    if (!CAN_RENDER.has(category)) throw new Error("a ghost render makes no sense for " + category);

    // Measured here rather than taken from the caller: the one colour worth
    // stating in a prompt is the one the image actually has.
    let colour = null;
    try {
      const img = await new Promise((ok, no) => {
        if (garment && (garment.nodeName === "IMG" || garment.nodeName === "CANVAS")) return ok(garment);
        const i = new Image();
        i.crossOrigin = "anonymous";
        i.onload = () => ok(i);
        i.onerror = () => no(new Error("could not read the garment"));
        i.src = garment;
      });
      if (svc.colourOf) colour = svc.colourOf(img);
    } catch (e) { /* an unmeasurable garment just gets no colour clause */ }

    return svc.render({
      base: garment,                 // the transport's first image; there is no mannequin here
      garments: [],
      prompt: buildPrompt(category, label, colour),
      signature
    });
  }

  function status() {
    const svc = global.TryOnService;
    if (!svc) return Promise.resolve({ ready: false, why: "tryon-service.js is not loaded" });
    return svc.status();
  }

  global.WornRender = {
    PROMPT_VERSION, CAN_RENDER, SHAPE, CONFIG,
    buildPrompt, worthIt, fidelity, generate, status,
    _internals: { measure, toLab }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.WornRender;

})(typeof window !== "undefined" ? window : this);
