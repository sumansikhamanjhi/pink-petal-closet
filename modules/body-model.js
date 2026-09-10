/* =========================================================================
   MODULE: body-model.js
   -------------------------------------------------------------------------
   The mannequin's measurements, and nothing else. No drawing, no garments.

   Every other module asks this one "how wide is the body at this height" and
   "where does a skirt's waistband sit", so there is exactly one place those
   numbers live and exactly one place to correct them.

   The profile was measured off assets/mannequin_base.jpg with lab/grid.html and
   checked by drawing it back over the photo. Half-widths are fractions of image
   WIDTH, heights are fractions of image HEIGHT.

   THE CENTRE LINE, and how it was got wrong twice.
   Eyeballing a filled silhouette over the photo (lab/body-verify.html) said
   0.518, and that shipped. It is wrong: a translucent silhouette is far too
   forgiving a target to read a 2% offset off. lab/body-measure2.html finds the
   mannequin's edges from the gradient instead and reports the midpoint per
   height, and the rows where the detection is trustworthy — chest, bust,
   underbust, waist, upper hip, ankle — agree on 0.499, with the gap between the
   legs reading about 0.502. At 512px wide, 0.518 pushed every garment nine
   pixels right of the body.

   Note what that same measurement CANNOT settle: the half-widths. At waist and
   hip height the strongest gradient either side of the body is the mannequin's
   own arm, not its waist, so those rows read 0.128 and 0.180 against a real
   waist nearer 0.095. The numbers below stay as measured off the grid. Anything
   claiming to have auto-measured this mannequin's width should be checked
   against lab/out/body_measure2.png first, where the detected edges are drawn.

   PUBLIC API
     BodyModel.BODY                  {centreX, profile:[[y, halfWidth]...]}
     BodyModel.halfWidthAt(y)        interpolated half-width, 0..1 of width
     BodyModel.LANDMARKS             named heights (waist, hip, knee...)
     BodyModel.PLACEMENT[category]   where that kind of garment sits
   ========================================================================= */

(function (global) {
  "use strict";

  const BODY = {
    centreX: 0.500,
    profile: [
      [0.100, 0.052],  // top of head
      [0.140, 0.062],  // head
      [0.190, 0.040],  // chin
      [0.220, 0.036],  // neck
      [0.250, 0.135],  // shoulder
      [0.280, 0.132],  // chest
      [0.310, 0.128],  // bust
      [0.350, 0.112],  // underbust
      [0.405, 0.095],  // waist
      [0.440, 0.115],  // upper hip
      [0.462, 0.125],  // hip
      [0.500, 0.118],  // crotch
      [0.560, 0.104],  // thigh
      [0.640, 0.086],  // above knee
      [0.700, 0.072],  // knee
      [0.760, 0.064],  // calf
      [0.840, 0.050],  // ankle
      [0.880, 0.055],  // foot
      [0.905, 0.075]   // floor
    ]
  };

  const LANDMARKS = {
    chin: 0.190, neck: 0.220, shoulder: 0.250, chest: 0.280, bust: 0.310, underbust: 0.350,
    waist: 0.405, upperHip: 0.440, hip: 0.462, crotch: 0.500, thigh: 0.560,
    knee: 0.700, calf: 0.760, ankle: 0.840, foot: 0.880, floor: 0.905
  };

  function halfWidthAt(y) {
    const t = BODY.profile;
    if (y <= t[0][0]) return t[0][1];
    if (y >= t[t.length - 1][0]) return t[t.length - 1][1];
    for (let i = 1; i < t.length; i++) {
      if (y <= t[i][0]) {
        const k = (y - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
        return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k;
      }
    }
    return t[t.length - 1][1];
  }

  /**
   * Where each kind of garment sits, and how much it is allowed to be reshaped.
   *
   *   top/bottom  body height the garment's top (or bottom) edge is pinned to
   *   ref       WHICH row of the garment its size is taken from, as a fraction
   *             of the garment's own height. Not a body landmark: a body
   *             landmark would have to be guessed against a garment whose
   *             length is not known yet. `{from,to}` takes the NARROWEST solid
   *             row in that window — for a top that is the hem or waist, for a
   *             dress the waist seam — which is the one measurement a flat
   *             photo gives honestly, because sleeves and flare only ever make
   *             a row wider. `{at}` takes one specific row, used for a
   *             waistband sitting right at the top edge.
   *   ease      how much wider than the body the garment sits (fabric is not
   *             painted on: 1.12 is a fitted tee, 1.32 an outer jacket)
   *   width     absolute width instead, as a fraction of the frame. Shoes and
   *             bags are props, not clothing: nothing about the body decides
   *             how wide a handbag is, so measuring one against the waist just
   *             makes it wrong in a new way.
   *   straighten false for anything that does not HANG. Standing a leaning
   *             garment upright is right for a dress and meaningless for a pair
   *             of shoes: a shoe photographed at three-quarters has a centre
   *             line that leans by construction, and rotating it to vertical
   *             just tips the shoes over. Measured, it moved the footwear
   *             placement by a few pixels for no gain.
   *   hug       how strongly each row is pulled towards the body's own width,
   *             as [at the top of the garment, at the bottom]. A dress hugs at
   *             the bodice and is left alone at the hem so the skirt still
   *             flares; a jacket hugs weakly everywhere because it hangs.
   *   maxWarp   ceiling on the per-row squeeze or stretch. Without it the
   *             sleeves of a flat-photographed jacket get crushed into the
   *             torso, because at that height the body is only shoulders wide.
   *   minSpan/maxSpan  how much of the body's height the piece may cover, so a
   *             mis-sized photo cannot produce a top that reaches the knees
   */
  const PLACEMENT = {
    tops:     { top: 0.235, ref: { from: 0.45, to: 0.95 }, ease: 1.14, hug: [0.85, 0.85], maxWarp: 0.22, minSpan: 0.10, maxSpan: 0.30 },
    dresses:  { top: 0.238, ref: { from: 0.15, to: 0.60 }, ease: 1.12, hug: [0.90, 0.12], maxWarp: 0.28, minSpan: 0.26, maxSpan: 0.58 },
    bottoms:  { top: 0.400, ref: { at: 0.06 },             ease: 1.12, hug: [0.90, 0.25], maxWarp: 0.26, minSpan: 0.20, maxSpan: 0.50 },
    jackets:  { top: 0.228, ref: { from: 0.45, to: 0.95 }, ease: 1.32, hug: [0.45, 0.35], maxWarp: 0.16, minSpan: 0.16, maxSpan: 0.36 },
    footwear: { bottom: 0.916, width: 0.250, hug: [0, 0], maxWarp: 0, minSpan: 0.04, maxSpan: 0.14, straighten: false },
    bags:     { top: 0.430, width: 0.150, centreX: 0.700, hug: [0, 0], maxWarp: 0, minSpan: 0.06, maxSpan: 0.24, straighten: false },
    accessories_necklace: { top: 0.205, width: 0.100, hug: [0, 0], maxWarp: 0, minSpan: 0.03, maxSpan: 0.09, straighten: false },
    accessories_bracelet: { top: 0.475, width: 0.065, centreX: 0.290, hug: [0, 0], maxWarp: 0, minSpan: 0.02, maxSpan: 0.06, straighten: false },
    accessories_headwear: { bottom: 0.178, width: 0.135, hug: [0, 0], maxWarp: 0, minSpan: 0.04, maxSpan: 0.11, straighten: false }
  };

  // Drawing order, innermost first. The jacket goes ON TOP of the top, because
  // that is where a jacket goes; an earlier version drew it underneath so a
  // pinned top would stay visible, and the result was a jacket collar floating
  // over the chest like a bib. Keeping a pinned item visible is the app's
  // problem to solve in what it puts in the outfit, not this module's to solve
  // by dressing the mannequin wrongly.
  const LAYER_ORDER = ["bottoms", "dresses", "tops", "jackets", "footwear", "bags",
                       "accessories_necklace", "accessories_bracelet", "accessories_headwear"];

  global.BodyModel = { BODY, LANDMARKS, PLACEMENT, LAYER_ORDER, halfWidthAt };

  if (typeof module !== "undefined" && module.exports) module.exports = global.BodyModel;

})(typeof window !== "undefined" ? window : this);
