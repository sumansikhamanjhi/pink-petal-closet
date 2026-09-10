/* =========================================================================
   MODULE 5: outfit-display.js
   -------------------------------------------------------------------------
   One job: show the pieces that were picked, as they were photographed, laid
   out together on white — so the wearer can see WHAT the stylist chose before
   paying anything to see it worn.

   WHY THIS IS NOT THE MANNEQUIN

   Putting a flat photograph on a mannequin invites a comparison it cannot win.
   The body is right there in the picture, so every place the fabric fails to
   follow it reads as a fault: a hem floating off a hip, a sleeve ending in
   mid-air, a waistband crossing the wrong part of the torso. None of that is a
   fault in the garment — it is the honest consequence of a photograph taken
   flat — but on a mannequin it looks like one.

   A flat-lay makes no such promise. Pieces arranged on white are read the way
   a shop lays stock on a table: this is the top, this is the skirt, these are
   the shoes. Nothing is claimed about how they will hang, so nothing can look
   wrong. The mannequin comes back when there is a real worn render to put on
   it, and then the fabric genuinely does follow the body.

   WHAT THE LAYOUT HAS TO GET RIGHT

     1. relative size — a dress must read bigger than a bracelet, or the board
        stops looking like an outfit and starts looking like a spreadsheet
     2. a floor under that — a bracelet cutout is a thin sliver of a photograph,
        and scaled by any honest rule it comes out too small to identify. Every
        piece gets a minimum share of the board whatever its own pixels say
     3. any combination — one dress, or a top and a jacket and three
        accessories. Nothing may be dropped for want of a slot
     4. white garments on white — a linen blouse laid on white has no edge at
        all, so every piece is given a soft shadow of its own silhouette

   PUBLIC API
     OutfitDisplay.render(items, opts) -> {canvas, width, height, placed}

   An item is { category, name, cutout } where cutout is anything drawable with
   a width and height — a GarmentCutout result, an Image, a canvas.
   ========================================================================= */

(function (global) {
  "use strict";

  const CONFIG = {
    width: 640,
    height: 1144,          // the tallest board allowed; most looks need less
    minBoardHeight: 0.45,  // ...and the shortest, so one earring is not a letterbox
    pad: 26,
    gap: 20,
    background: "#ffffff",
    shadow: 0.20,          // how dark each piece's own shadow is
    shadowBlur: 9,
    shadowDrop: 5,
    minHeight: 0.055,      // no piece smaller than this share of the board's height
    minWidth: 0.13,        // ...or this share of its width, whichever binds first
    growLimit: 1.35        // how far the whole board may be enlarged to fill the width
  };

  /**
   * How tall each kind of thing is drawn, as a share of the board.
   *
   * These are proportions of a display, not measurements of a body: a dress
   * takes nearly half the board and a bracelet a fifteenth of it, which is
   * roughly how a shop window weights them. Sizing by the cutout's own pixels
   * instead would make whichever garment happened to be photographed closest
   * the biggest thing on the board.
   */
  const DISPLAY_HEIGHT = {
    dresses: 0.42,
    bottoms: 0.26,
    jackets: 0.23,
    tops: 0.20,
    bags: 0.13,
    footwear: 0.095,
    accessories_headwear: 0.085,
    accessories_necklace: 0.085,
    accessories_bracelet: 0.075
  };

  /** Reading order: the pieces the outfit is about, then what completes it. */
  const DISPLAY_ORDER = [
    "dresses", "tops", "bottoms", "jackets",
    "footwear", "bags",
    "accessories_headwear", "accessories_necklace", "accessories_bracelet"
  ];

  const sizeOf = (src) => ({
    w: src.naturalWidth || src.width || 0,
    h: src.naturalHeight || src.height || 0
  });

  const drawableOf = (cutout) =>
    (cutout && cutout.canvas) ? cutout.canvas : cutout;

  /* ------------------------------------------------------------------ layout */

  /**
   * Shelf packing: fill a row left to right, wrap when the next piece will not
   * fit, then centre every row and the block as a whole.
   *
   * Chosen over a table of fixed positions per category because a fixed table
   * has to answer "where does the jacket go when there is also a dress and two
   * bracelets", and every answer is a special case. Packing has no cases: each
   * piece is given its size, and the rows fall out of the arithmetic. The cost
   * is that the arrangement changes as the outfit changes, which for a display
   * of what was picked is not a cost at all.
   */
  function layout(items, opts) {
    const W = opts.width, H = opts.height;
    const pad = opts.pad, gap = opts.gap;
    const availW = W - pad * 2;
    const availH = H - pad * 2;

    const minH = opts.minHeight * H;
    const minW = opts.minWidth * W;

    const sized = [];
    for (const item of items) {
      const src = drawableOf(item.cutout);
      if (!src) continue;
      const { w, h } = sizeOf(src);
      if (!w || !h) continue;

      const targetH = (DISPLAY_HEIGHT[item.category] || 0.14) * H;
      let scale = targetH / h;
      // never wider than the board
      if (w * scale > availW) scale = availW / w;

      /* The floor, and why it is two-sided.
         A bracelet is photographed as a wide flat oval: given its share of the
         board's HEIGHT it stays a hairline, and given its share of the WIDTH it
         is a recognisable bracelet. A pendant necklace is the other way round.
         So the piece is enlarged only until it reaches whichever floor it meets
         FIRST — insisting on both would blow a wide item up until it filled the
         board. */
      if (h * scale < minH && w * scale < minW) {
        scale = Math.min(minH / h, minW / w, availW / w);
      }

      sized.push({
        item,
        src,
        w: Math.max(1, Math.round(w * scale)),
        h: Math.max(1, Math.round(h * scale))
      });
    }
    // an empty look still gets a board, at the shortest size allowed
    if (!sized.length) {
      return { rows: [], width: W, height: Math.round(H * opts.minBoardHeight),
               placed: [], scale: 1 };
    }

    sized.sort((a, b) =>
      DISPLAY_ORDER.indexOf(a.item.category) - DISPLAY_ORDER.indexOf(b.item.category));

    const rows = [];
    let row = null;
    for (const piece of sized) {
      if (!row || row.w + gap + piece.w > availW) {
        row = { pieces: [], w: 0, h: 0 };
        rows.push(row);
      }
      row.w += (row.pieces.length ? gap : 0) + piece.w;
      row.h = Math.max(row.h, piece.h);
      row.pieces.push(piece);
    }

    /* One uniform scale for the whole board, then the board is cut down to what
       it holds.
       Widen first: the widest row is stretched out to the margins, up to a cap,
       which makes every piece bigger on screen without disturbing their
       relative sizes. The cap is what stops a single bracelet being blown up
       into a hula hoop — the size floor is a floor, not a target.
       Then shrink, if a busy look still overflows the tallest board allowed.
       Re-packing at the new size would fit more per row and produce a
       completely different arrangement for the sake of one extra accessory, so
       the arrangement is fixed and only the scale moves. */
    const maxRowW = rows.reduce((m, r) => Math.max(m, r.w), 1);
    let scale = Math.min(availW / maxRowW, opts.growLimit);
    let total = (rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1)) * scale;
    if (total > availH) {
      scale *= availH / total;
      total = availH;
    }
    if (scale !== 1) {
      for (const r of rows) {
        r.h = Math.max(1, Math.round(r.h * scale));
        r.w = 0;
        for (const p of r.pieces) {
          p.w = Math.max(1, Math.round(p.w * scale));
          p.h = Math.max(1, Math.round(p.h * scale));
          r.w += (r.w ? gap : 0) + p.w;
        }
      }
    }
    total = rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1);

    /* The board is only as tall as the look needs.
       A fixed portrait board cannot serve both a lone dress and eight pieces:
       whatever height suits one leaves the other either squeezed or floating in
       a field of white. Since the panel takes its height from this image, an
       honest content height is also the one that draws the garments largest —
       the wasted band at the bottom of a fixed board was costing a third of the
       space the clothes could have used. A floor keeps a single bracelet from
       producing a letterbox. */
    const boardH = Math.round(Math.max(
      Math.min(total + pad * 2, H),
      H * opts.minBoardHeight
    ));

    const placed = [];
    let y = pad + Math.max(0, (boardH - pad * 2 - total) / 2);
    for (const r of rows) {
      let x = pad + Math.max(0, (availW - r.w) / 2);
      for (const p of r.pieces) {
        placed.push({
          category: p.item.category,
          name: p.item.name || p.item.category,
          src: p.src,
          x: Math.round(x),
          y: Math.round(y + (r.h - p.h) / 2),      // sit the row on one centre line
          w: p.w,
          h: p.h
        });
        x += p.w + gap;
      }
      y += r.h + gap;
    }
    return { rows, width: W, height: boardH, placed, scale: +scale.toFixed(3) };
  }

  /* ------------------------------------------------------------------- paint */

  /**
   * A soft shadow of the piece's own silhouette.
   *
   * Not decoration. A white blouse or a cream sneaker laid on a white board has
   * no boundary — the cutout is genuinely the same colour as the background, so
   * the garment simply is not there to look at. A blurred, offset copy of its
   * alpha gives every piece an edge without tinting the garment itself.
   */
  function shadowOf(src, w, h, opts) {
    const pad = opts.shadowBlur * 2 + opts.shadowDrop + 2;
    const cv = document.createElement("canvas");
    cv.width = w + pad * 2;
    cv.height = h + pad * 2;
    const c = cv.getContext("2d");
    c.filter = "blur(" + opts.shadowBlur + "px)";
    c.globalAlpha = opts.shadow;
    c.drawImage(src, pad, pad + opts.shadowDrop, w, h);
    c.filter = "none";
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-in";
    c.fillStyle = "#5b5550";
    c.fillRect(0, 0, cv.width, cv.height);
    return { canvas: cv, pad };
  }

  /**
   * @param items [{category, name, cutout}]
   * @param opts  {width, height, background, shadow, ...} — CONFIG is the default
   */
  function render(items, opts) {
    const options = Object.assign({}, CONFIG, opts || {});
    const plan = layout(items || [], options);

    const out = document.createElement("canvas");
    out.width = plan.width;
    out.height = plan.height;      // what the look needed, not what was offered
    const ctx = out.getContext("2d");
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";

    for (const p of plan.placed) {
      if (options.shadow > 0) {
        const sh = shadowOf(p.src, p.w, p.h, options);
        ctx.drawImage(sh.canvas, p.x - sh.pad, p.y - sh.pad);
      }
    }
    for (const p of plan.placed) {
      ctx.drawImage(p.src, p.x, p.y, p.w, p.h);
    }

    return {
      canvas: out,
      width: out.width,
      height: out.height,
      rows: plan.rows.length,
      scale: plan.scale === undefined ? 1 : plan.scale,
      placed: plan.placed.map(p => ({
        category: p.category, name: p.name,
        x: p.x, y: p.y, w: p.w, h: p.h
      }))
    };
  }

  global.OutfitDisplay = {
    CONFIG, DISPLAY_HEIGHT, DISPLAY_ORDER, render,
    _internals: { layout, shadowOf }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.OutfitDisplay;

})(typeof window !== "undefined" ? window : this);
