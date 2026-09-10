# Garment Isolation Engine — reference

`garment-engine.js` is a standalone service with one job: given a photo of
someone (or a mannequin) wearing clothes, cut **one garment** out of the
picture — background, model and everything else removed — the way long-press
"select object" works in a phone gallery.

It has no dependency on `app.js`. The app talks to it through a thin adapter
(section 8 of `app.js`).

---

## Using it

```html
<script src="garment-engine.js"></script>
```

```js
await GarmentEngine.warmup();              // loads the parsing model (do this early)

const result = await GarmentEngine.extract(imageSrcOrElement, {
  mode: "dress",                           // see modes below
  hintPoint: { x: 0.5, y: 0.4 },           // optional: "the garment I tapped"
  cropBox: { x, y, width, height },        // optional: restrict to a region (source px)
  background: "transparent",               // or "white"
  outputMaxDim: 720,                       // longest edge of the returned image
  inpaintHoles: true,                      // paint fabric back where a strap crossed
  backend: "auto"                          // or "heuristic" to force the fallback
});
```

### Result

| field | meaning |
|---|---|
| `image` | the cutout as a data URL — WebP with alpha, PNG where WebP is unavailable |
| `thumb` | the same cutout at 320px |
| `imagePng` / `imageOnWhite` | lossless PNG / JPEG matted on studio white |
| `mode`, `category` | what it decided this garment is (`dresses`, `tops`, `bottoms`, …) |
| `color` | `{ hex, name }` of the fabric, sampled from opaque pixels only |
| `fabric`, `texture` | weave guess from local luminance variance |
| `metrics` | `coverage`, `skinLeak`, `bgLeak`, `patched`, `edgeRatio`, `fill`, `quality` (0–100) |
| `pieces`, `chosenPiece` | the garment stack it found, and which one it returned |
| `backend` | `mediapipe` (the model) or `heuristic` (colour fallback) |
| `warnings` | plain-language notes, e.g. "trimmed bare limbs read as fabric" |

`metrics.quality` is the engine's own opinion of the cutout. Below ~70 the app
tells the user to open the Cutout Studio instead of pretending it worked.

### Modes

`auto` · `top` · `bottom` · `dress` · `jacket` · `bag` · `accessory` ·
`footwear` · `full` (plus aliases: `tshirt`, `skirt`, `jeans`, `gown`, `coat`, …)

A `hintPoint` outranks the mode: if the user taps the jeans while the mode
says "top", they get the jeans, categorised as bottoms.

---

## How it works

1. **Semantic pass** — MediaPipe's selfie-multiclass model labels every pixel
   `background / hair / body-skin / face-skin / clothes / accessory`. The model
   (~16MB) is fetched once and kept in the Cache API, so later runs are local.
2. **Anatomy** — head, shoulder, hip and knee lines are estimated from the
   *face* mask (hair reaches the waist and would wreck the estimate).
3. **Piece split** — an outfit is a vertical stack, so each row is assigned to
   a garment by its dominant Lab colour cluster. Slicing by rows rather than by
   colour blobs is what keeps a garment **solid**: cluster-based selection
   shatters a dress along its own folds. A stretch of rows with no clothing at
   all (a bare midriff) is a hard separator, so a cream top and cream jeans stay
   two garments; a thin band of a different colour (a belt) does not split a
   dress in two.
4. **Selection** — pieces are scored on their relative place in the stack, not
   on absolute landmarks. A dress additionally claims every piece it is
   physically joined to in the same colour family.
5. **Cleanup** — accessories lying on the fabric are dropped by colour island
   analysis (a bag is surrounded by garment and has a hard edge; a printed
   panel reaches the silhouette and is kept). Straps and chains are caught by
   shape: long, thin, diagonal, high-contrast. Four or more parallel lines are
   read as texture (pleats, ribbing) and left alone. Bare limbs parsed as
   trousers are trimmed when the garment narrows to limb width *and* turns the
   colour of the wearer's own skin.
6. **Matting** — a trimap plus a local linear alpha estimate gives soft edges,
   and colour decontamination removes background bleed. Holes left by removed
   occluders are inpainted from the surrounding fabric.
7. **Metrics** — the result is scored against the semantic masks so callers can
   detect a bad cutout instead of shipping it.

### The fallback

If the model cannot load (offline on first use, CDN blocked), the engine falls
back to colour segmentation: an adaptive flood fill from the border plus a
multi-colour-space skin detector. It is genuinely good on plain-background
product shots (quality 89–96 in the test set) and weak on people photographed
in real scenes. The app says so explicitly rather than passing it off as the
model's work.

---

## Validating a change

The lab renders every stage so a regression is visible, not just numerical.

```powershell
# full suite: 14 cases (model + forced-fallback), writes review sheets + metrics
powershell -ExecutionPolicy Bypass -File lab\run-lab.ps1

# one case, every stage dumped at processing resolution
powershell -ExecutionPolicy Bypass -File lab\run-lab.ps1 `
  -Page "lab/focus.html?file=testset/dress_white_outdoor.jpg&mode=dress"

# the wired app, driven the way a user drives it (upload, tap, apply, save)
powershell -ExecutionPolicy Bypass -File lab\run-lab.ps1 -Page "lab/app-smoke.html"
```

Results land in `lab/out/`: `report.json` plus PNG review sheets
(source | semantic classes | colour clusters + piece bands | final matte |
cutout on a checkerboard). `lab/testset/` holds the fixtures — four dress
photos, a casual outfit, and two of the app's own mannequin renders.

`lab/` is a development harness. Nothing the app ships at runtime reads it.

---

## See also

- [usage.md](usage.md) — running the app, the tap-to-select studio, and the
  step-by-step validation commands
- [architecture.md](architecture.md) — where this service sits in the app, the
  adapter boundary, and the cleanup discriminators in table form
