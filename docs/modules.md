# The modules

Four files under `modules/`, each answering one question and nothing else. They
know nothing about the wardrobe, the UI or each other's internals — the only
thing that passes between them is a cutout and a body.

```
seg-watershed.js     which pixels are the subject?
garment-cutout.js    what does that subject look like with the backdrop gone?
cutout-paint.js      what does the person want changed about that?
garment-straighten.js which way up is it meant to hang?
body-model.js        what shape is the mannequin?
garment-fit.js       what does this garment look like on that shape?
outfit-compose.js    what do several of them look like together?
outfit-display.js    how are the picked pieces shown before any render?
```

The split is not cosmetic. It is what makes the third problem — mixing garments
— almost disappear, and that is worth explaining before the parts.

## Why the order matters

The obvious way to dress a mannequin is to solve each outfit: take the pieces,
work out where each goes given the others, draw them. That is quadratic in
trouble. Every new combination is a new fitting problem, every swap re-opens
questions that were already settled, and a garment that looked right in one
outfit sits differently in the next.

Doing it the other way round, each garment is reshaped to the body ONCE, on its
own, with no knowledge of what it will be worn with. Two things follow:

- **Mixing becomes ordering.** `outfit-compose.js` is about 200 lines, most of
  which is deciding that a dress and a skirt are not worn together. There is no
  fitting logic in it at all, because there is nothing left to fit.
- **Swapping one piece leaves the rest untouched, by construction rather than by
  care.** Measured: swapping the shoes leaves `tops@0.235-0.445` and
  `bottoms@0.400-0.759` at identical placements; swapping the skirt for jeans
  leaves the top and shoes identical. Nothing enforces that. It cannot be
  otherwise, because neither garment's fit ever looked at the other.

---

## 1. `seg-watershed.js` — which pixels are the subject

### Why watershed and not a threshold

Asking "is this pixel closer to the subject's colours or the background's" fails
the moment the two are the same colour: a white top on a white sweep, the white
panels of a sneaker. Adding an edge barrier does not save it — the barrier fires
on the garment's own texture (a floral print, a seam) instead of on its
silhouette, the fill escapes around the outside, and the mask comes back
**inverted**. That was the behaviour being replaced.

Watershed is relative rather than absolute. Both markers grow at once, flooding
from low gradient to high, and meet on the strongest ridge *between* them. A soft
drop shadow is a weak ridge, but if it is the only thing separating the two
markers, that is where the boundary lands. Texture inside the subject is never
between the markers, so it is grown over rather than fought.

### Where the markers come from

Not from colour, and not from a box's centre. From the one thing reliably true
of a product photo: **the backdrop is flat**. Flood inwards from the image border
through everything below a gradient threshold; whatever is left inside the
region is the subject, including its flat white areas, because they are enclosed
by the silhouette rather than connected to the border.

### Choosing the threshold

This is the part that took the most work, and the interesting failures are worth
recording because each one looks like a fix until it is measured.

| Attempt | What happened |
| --- | --- |
| Small core in the middle of the box as the subject marker | Marker trapped behind internal pleats and print; `fg` came out at 7-15% of the frame |
| Backdrop flood at a fixed threshold | Leaked straight through white garments — the white top came out at 0.2% |
| Largest threshold that leaves the box's centre standing | Fixed two cases, still leaked on the dress and the sneakers |
| Also require the backdrop not to claim most of the box | Passed a threshold high enough to flood *between* the eyelet flowers, leaving the dress as confetti |
| **Sweep the threshold and take the stable plateau** | Correct on all ten fixtures |

The last one is the maximally-stable-extremal-region idea applied to a single
flood. Sweep the threshold and watch how much backdrop lands inside the region.
While the threshold is only eating into real backdrop, that number barely moves.
The step where the flood breaches the silhouette is a jump. Take the widest
plateau and use its highest rung: the tightest threshold still on the safe side
of the break.

Two guards sit around it:

- **A rung only counts if the flood reached most of the area outside the box.**
  Otherwise a threshold too low to connect the backdrop at all looks perfectly
  stable at nearly zero.
- **The subject's core is measured, not assumed.** A fixed rectangle in the
  middle of the box is wrong for anything with a gap down the centre — the middle
  of a pair of jeans is the space between the legs, the middle of a pair of boots
  is the floor. Both looked like every threshold had "breached the core", the
  sweep was discarded, and both came out with a white fringe. Deriving the core
  from the gentlest connected flood follows the actual garment and fixed both.

Finally the chosen flood is **opened** (erode, keep what is still reachable from
the border, dilate back, intersect). A leak is a thin tendril squeezing through
one soft spot and then spreading inside; opening severs anything narrower than
a few pixels, and the pocket it fed goes with it.

---

## 2. `garment-cutout.js` — the subject without its backdrop

Segmentation, then five clean-up steps, then a crop. Three of the five are there
because of a specific artefact that showed up on the mannequin.

**Matte.** A soft alpha band across the silhouette, applied *only* in the
one-pixel band either side. Blurring the whole mask would also blur away thin
straps and shoelaces. This is also what stops chiffon reading as see-through:
opacity is decided by the silhouette, never by how thin the fabric looks.

**Decontaminate.** A pixel half garment and half backdrop was photographed as a
blend of the two, which is why cutouts from a white sweep get a pale rim on
anything darker. The band's colour is replaced with the nearest fully-opaque
fabric colour; the alpha still carries the softness.

**Open enclosed backdrop.** Seeding the subject as "everything the flood could
not reach" also captures anything the garment encloses — the studio white
showing through a neckline, the gap inside a bag's strap. Filled and made
opaque, a dress arrives at the mannequin with a white slab where its neckline
should be. Enclosed regions that look like backdrop are cut back out, and the
mannequin's own neck shows through.

**Hanger removal**, in two passes:

- The *hook*, by how far each row REACHES. A hook is a wire twenty pixels across;
  a camisole's two straps hold about the same amount of fabric but stand at
  opposite shoulders. Counting pixels confuses them — measured, a hook came to 5%
  of the widest row and a pair of straps to 7% — while measuring reach separates
  them by an order of magnitude.
- The *hanger itself*, by chroma, flooding down from the top. A pale wooden bar
  and a sage skirt are almost exactly as light as each other, so an RGB distance
  puts them 48 apart, inside the skirt's own variation from its pleats.
  Differencing the channels first throws brightness away and leaves hue: 42 apart,
  while a denim waistband against a denim jacket stays near zero. It floods
  rather than dropping rows because a hanger's shoulders slope away under the
  garment's own.

Hanger removal only runs for `tops`, `dresses`, `bottoms` and `jackets`. A
handbag's strap loop is narrow at the top and neutral in colour, and both tests
ate it happily until the category gated them.

### Rejected: trimming the outer rim by colour

Where the sweep shades off gently the flood stops short of the garment, and a few
pixels of backdrop stay attached. Eating inwards from the mask edge while pixels
match the backdrop is the obvious fix, and it works on a navy jacket. On a white
top against a white sweep the same rule walks straight through the garment:
measured, two thirds of the top gone. It is not in the code, and the reasoning is
left in a comment where someone would otherwise reinvent it.

The same colour comparison IS used for enclosed regions, and is safe there for
one reason: it can only act on regions completely surrounded by fabric, so on a
white-on-white photo there are none and it does nothing.

### The quality score

Measured on the RAW watershed mask, before holes are filled and specks dropped.
Measuring the tidied mask only ever says "perfect", which is worse than no score
at all because it hides the one failure that matters. It reports solidity (was
the interior chewed out), edge contrast (is the silhouette on a real ridge), and
shape sanity. White-on-white garments honestly score 76-81; contrasting ones 90-100.

---

## 2b. `cutout-paint.js` — correcting it by hand

No automatic rule gets every photograph, and the ones that come closest are the
ones that would destroy a garment when they are wrong — the abandoned rim trim
above, or an unconstrained hanger flood that would also eat a contrast yoke. A
brush is the honest answer to that class of problem: it costs the user two
seconds and it cannot guess wrong.

**It paints in the uncropped working frame**, the same one the segmentation ran
in — not the cropped cutout. A brush confined to the crop could not paint back a
sleeve that was cut off, because there would be nowhere to paint TO. Both
isolation backends rasterise the whole photograph at the same
`min(1, 768/longest side)` and never crop that space, so one paint frame serves
either of them and the photograph's pixels line up with the cutout's exactly,
with no registration arithmetic anywhere. For the human-parsing engine the frame
is rebuilt from its own reported `bbox.procW/procH` and crop offset, which are
public fields rather than debug ones.

**It seeds from the isolation's output, not the original file.** The difference
shows exactly where the isolation repaired something: a neckline whose backdrop
was cut away, a gap that was inpainted. Rebuilding from the original photograph
would bring the studio white back inside those repairs. `GarmentCutout.extract`
takes `keepWorking: true` for this — off by default, because it is a 2.4MB pair
of buffers and nothing that merely imports a garment needs them.

### The two ways to paint back, and why both exist

The user offered the choice explicitly, and it is a real choice because the two
answer different questions.

**Draw Back takes the photograph's own pixels.** Nothing is synthesised. A
drawn-back pixel *is* the photograph's pixel, which makes this the exact case
the working frame was chosen for — no scaling, no offset, no invention. It is
right whenever the fabric is in the photo and the segmentation merely missed it,
which is most of the time.

**Fill In synthesises fabric from the garment around the gap**, for when the
photograph never had what is missing. Two stages:

- *Colour* from diffusion inwards from the gap's edge, averaging only pixels
  that are **known garment**. That restriction is the whole trick. The obvious
  version averages whatever is adjacent, and whatever is adjacent to a garment's
  outline is the studio backdrop — so a gap opening onto the silhouette fills
  with white and the repair is worse than the hole. This is the specific defect
  that makes `garment-cutout.js`'s own `inpaintHoles` unsuitable here: it sets
  `known[p] = hole[p] ? 0 : 1`, which counts backdrop as a colour source.
- *Grain* borrowed from real fabric. Diffusion converges on a smooth field, so
  by itself a filled coat panel is a flat patch surrounded by weave — right in
  hue, obviously synthetic in texture. So a donor patch is high-pass filtered and
  its detail added on top. The donor is looked for at the **mirror position**
  first: every garment photo in `assets/` except the footwear and bags is a
  centred, front-on, near-symmetrical shot, so the mirrored pixel is usually the
  same part of the same garment under the same light, and it carries the vertical
  structure — weave direction, shading falloff — that a neighbouring patch would
  not. Only the detail is borrowed, never the colour; borrowing the colour would
  paste a visible patch of somewhere else.

Draw Back is the default. Fill In is one button away and the UI says plainly
that it makes fabric up.

**The ghost render is the third part of the answer**, and arguably the most
useful. Which brush you want depends on whether the photograph has anything
where the hole is, and a transparent hole looks identical either way. Drawing the
photo under the cutout at 28% turns that into something visible *before* the
stroke lands. It also keeps Fill In honest rather than a trap — the user reaches
for it after seeing there is nothing there.

### What keeps an edit local

Every stroke's effect is confined to its own dilated footprint:

```
final[p] = footprint[p] ? edited[p] : base[p]
```

so painting a sleeve cannot move the hem by one pixel. That matters beyond
tidiness: the whole layering approach rests on a garment's fit being decided by
its own silhouette, so a retouch that quietly shifted an untouched edge would
move the garment on the body. The brush leaves a hard circular edge, which reads
as cut out with scissors, so the edited alpha is re-matted — over the whole frame
and then written back only inside the footprint, which is what makes the
untouched pixels byte-identical rather than merely similar.

Undo stores **strokes, not bitmaps** (a few kilobytes against a few megabytes),
replayed from the base. That also makes the stroke the module's single primitive,
which is what lets the harness and the finger call the same function —
`CutoutPaint.stroke(layer, tool, points, opts)` with points as fractions of the
frame. There is deliberately no test-only path.

### The bug that measurement found and reading did not

The diffusion was a breadth-first fill with **no visited set**. A pixel is
reachable from up to four neighbours, so each one joined the next ring's queue
once per settled neighbour, every duplicate enqueued *its* neighbours again, and
the queue grew about fourfold per ring. Exponential — and it does not look like
it. A small gap finished fine and passed every test; a jacket-sized fill never
returned at all, inside a `mouseup` handler, which is a frozen tab.

Reading the loop did not find it; timing it did. `lab/module-paint.html` now
times a typical fill and a very large one, and the large one was what hung.
After adding the flag: 83ms. The identical omission was sitting latent in
`garment-cutout.js`'s `inpaintHoles` and is fixed there too — it had never been
triggered because that function reports zero pixels on every fixture.

### The bug that made the editor look zoomed in

Reported as "why is it zooming in like that, I can only edit part of the coat and
the rest gets cut out once I save" — and it was one line.

For a garment photographed on a person the isolation goes to
`garment-engine.js`, whose `maskCanvas` is **not** the working frame: it is the
cutout cropped to its own bounding box and then, if the garment came out small,
**magnified by up to 2.2×** for output quality. Measured on all three on-body
fixtures, the factor was 2.2 every time. Pasting that canvas at the bounding
box's origin at its own size put the garment on the paint frame magnified and
offset, so the editor showed a huge garment over the photo, the brush could only
reach the part still inside the frame, and the commit cropped the rest away.

The fix maps it back down onto the box it came from. `lab/onbody-paint-probe.html`
asserts the invariant that catches it: the opaque region of the paint layer,
measured against the frame, must land on the rectangle the engine reported as
`bbox` — now within a pixel, where before it was out by a factor of two. It also
declines the frame entirely when a drag box was used, because then `procW/procH`
describe the box rather than the photograph and nothing would register.

### Two more pre-existing bugs

Both had to be fixed before the brush could ship safely, because painting is what
triggers them:

- **`garment-fit.js` picked a stray speck as its reference row.** "Narrowest
  solid row" is only meaningful among rows that are part of the garment; a
  three-pixel dab won "narrowest" outright and the fit scale came out as a body
  width divided by a speck — a sixty-fold blow-up that smeared a few source
  columns across the whole frame. There is now a floor at a quarter of the
  garment's widest row, which no real waist comes near.
- **`outfit-compose.js` had no per-item try/catch.** One garment erased down to
  nothing threw out of the render, so the caller got nothing and fell back to a
  stock photograph of a completely different outfit. One unusable garment now
  costs one garment, reported in the caption.

---

## 2c. `garment-straighten.js` — standing a posed garment up

A garment cut from a photograph keeps the pose it was worn in. A model with her
weight on one hip, a runway stride, an arm across the body — all of it is baked
into the cutout, and the mannequin stands perfectly straight. Measured over the
test photographs, a posed garment's own centre line wanders 0.79 to 1.19 of its
half-width off vertical; the flat studio control manages 0.42. That difference is
what reads as a garment not laying straight.

**Row-wise centring cannot fix it.** `garment-fit.js` already samples each
destination row around that row's own midpoint, which straightens the
*silhouette* — but it only ever slides a row sideways, so the seams, the hem and
the shading stay at the angle they were shot at and the result reads as bunched
fabric. Standing a leaning garment up is a rotation, and nothing built out of
horizontal translations can express one.

**The lean is measured from the centre line**, weighted by how much fabric each
row holds — not from principal axes, because a crop top is three times wider
than it is tall and its principal axis is horizontal.

It runs inside `GarmentFit.fit` rather than at import, so garments already in
the closet benefit without a migration. `PLACEMENT` turns it off for anything
that does not hang: a shoe photographed at three-quarters has a leaning centre
line by construction, and rotating it to vertical just tips the shoes over
(measured — it moved the footwear placement for no gain).

### The second signal that was measured and then rejected

The centre line misses a class of tilt. A crop top shot with the arms overhead
comes out as a wide band whose midline is vertical while both its edges slope:
centre-line lean 1.7°, shoulder line 6.2°. So a top-edge tilt was implemented as
a candidate second signal — and then not acted on, because the **control** case
settled it:

| case | centre lean | top edge | truth |
|---|---|---|---|
| crop top, arms overhead | 1.7° | 6.2° | tilted |
| runway walk | 1.1° | 11.5° | mildly tilted |
| outdoor pose | 14.5° | 28.4° | badly tilted — straightened |
| **flat mannequin shot (control)** | −2.6° | **−13.4°** | **straight** |

The control's waistband slopes, so the top edge reports 13° of tilt on a garment
that is not tilted at all. Acting on it would have rotated the one case that was
already correct. It stays in the output as a diagnostic and nothing reads it.

That leaves a real limit: a garment deformed by the pose rather than merely
leaning — a top stretched by raised arms — is not something a rotation can fix,
and it is not fixed.

---

## 3. `body-model.js` and `garment-fit.js` — the garment on the body

### The body

Measured off `assets/mannequin_base.jpg` with `lab/grid.html`. One file, so
there is one place to correct it — which turned out to matter.

**The centre line was got wrong twice.** Eyeballing a translucent silhouette
over the photo (`lab/body-verify.html`) said 0.518, and that shipped. It is
wrong: a translucent overlay is far too forgiving a target to read a 2% offset
off. `lab/body-measure2.html` finds the mannequin's edges from the gradient and
reports a midpoint per height; the rows where detection is trustworthy — chest,
bust, underbust, waist, upper hip, ankle — all agree on **0.499**, and the gap
between the legs reads about 0.502. At 512px wide, 0.518 had been pushing every
garment nine pixels right of the body.

**The same measurement cannot settle the half-widths, and it is worth knowing
why.** At waist and hip height the strongest gradient either side of the body is
the mannequin's own *arm*, not its waist, so those rows read 0.128 and 0.180
against a real waist nearer 0.095 — an error of 35% to 45% in the direction that
looks plausible. The half-widths stay as measured off the grid. Any claim to have
auto-measured this mannequin's width should be checked against
`lab/out/body_measure2.png`, which draws every detected edge back onto the photo,
before it is believed.

### Why reshape rather than scale

Scaling a flat photo to fit and pasting it on the body is what makes an outfit
look like stickers. A flat garment is cut wide and straight; a body goes in at
the waist and out at the hip. Uniformly scaled, the top is either too wide at the
waist or too narrow across the bust, and no amount of nudging the placement fixes
it, because the mismatch is a difference in SHAPE.

So each horizontal row is scaled by its own factor: rows that should cling are
pulled towards the body's width at that height, rows that should hang keep their
own proportions. Three limits keep it from destroying the garment:

- `hug` — how much a row may follow the body at all, from the top of the garment
  to the bottom. A dress hugs at the bodice and is left alone at the hem, so the
  skirt still flares.
- `maxWarp` — a hard ceiling on any single row. Without it a jacket photographed
  with its sleeves spread gets them crushed into the torso, because the body is
  only shoulders wide up there.
- vertical smoothing of the per-row factors, so the edge stays a curve.

A row that is mostly holes is sleeves with a gap between them, not a band of
fabric across the body, so it is left alone regardless of `hug`.


### `reshape: false` — and why the app passes it

All of the above answers "how should this garment be reshaped to the body". The
app's mannequin now asks a different question: **show me the clothes I picked.**
So it passes `reshape: false`, which sets `hug` to `[0, 0]`; every row's factor
comes out at exactly `1` and the redraw is a plain uniform scale, placed and
sized but not warped. `OutfitCompose.render(..., {reshape: false})` passes it
down and also skips bridging, which would otherwise paint a waistband that is in
none of the photographs.

This is not a retreat from the reshaping. It is an admission about *when* a
guess is worth making. Reshaping is an inference about what fabric would do, and
when it is wrong it is conspicuous — a sleeve pinched into the ribs, a print
stretched out of shape — whereas a flat garment merely looks flat, which is what
it is. The AI render is what supplies a real worn shape, so the flat view is what
the wearer sees until they ask for one. `lab/preview-probe.html` measures both
paths in the same run: warp `0.72–1.02` reshaped, exactly `1–1` flat, with the
flat render holding the photograph's own aspect ratio to within 2%.

### Sizing, and why it is solved by iteration

Width is decided first and height follows from the photo's own proportions, which
is what makes a maxi skirt come out long and a mini short without anyone
labelling either.

The reference measurement is the **narrowest solid row** in a category-specific
window — for a top the hem or waist, for a dress the waist seam. Narrowest,
because a flat photo only ever exaggerates width: sleeves spread, skirts flare,
collars stick out. Solid, because a row that is mostly holes says nothing about
the torso.

The garment is then matched to the body's width *at the height that reference row
actually lands* — and where it lands depends on how tall the garment turned out,
which depends on the width. So it is solved by a short iteration rather than by
guessing a landmark up front. Guessing was the first version, and it made
everything ride high: a dress sized at the bust and pinned at the shoulders put
its waist seam somewhere around the ribs.

Shoes and bags skip all of this and take an absolute width. Nothing about the
body decides how wide a handbag is; sizing one against the waist read a strap row
as the reference and produced a bag the size of the torso.

---

## 4. `outfit-compose.js` — several garments together

Small on purpose. It decides which pieces belong in the outfit (a dress means the
top and skirt are dropped rather than layered over the same torso), draws them in
`LAYER_ORDER`, and does two things a per-garment fit cannot:

**Bridging.** Two garments photographed separately have no reason to meet: a top
ends where its photo ended, a skirt starts where its photo started, and a stripe
of bare mannequin shows between them. Rather than stretch either piece — which
would visibly distort a print — the lower garment's own top row is repeated
upwards. That row is the waistband, so what appears is a band of exactly the
right fabric, drawn under the top where only the few bare pixels are ever visible.

**Coverage.** Which zones of the body the outfit does not cover, checked against
the body rather than against the list of items — a top that came out cropped
leaves the midriff bare just as surely as no top at all. The app puts it in the
caption.

Jackets are drawn ON TOP of tops. An earlier version drew them underneath so that
a pinned top would stay visible, and the result was a jacket collar floating over
the chest like a bib. Keeping a pinned item visible is the app's problem to solve
in what it puts in the outfit, not this module's to solve by dressing the
mannequin wrongly.

> **The app does not run this module any more.** The view before a render is a
> flat display (module 5), and the view after one comes from the image model, so
> nothing left in the app layers garments onto a mannequin. It is kept with its
> harness because it is the finished half of a problem the render may not always
> be available to solve — but it is honest to say it is not on any live path.

---

## 5. `outfit-display.js` — the pieces, on white

What the mannequin panel actually shows before a render: the outfit's own
cutouts laid out on a white board.

This module exists because of a conclusion the two mannequin versions above
earned the hard way. **Putting a flat photograph on a body invites a comparison
it cannot win.** With the mannequin in frame, every place the fabric fails to
follow it reads as a defect — a hem floating off a hip, a sleeve stopping in
mid-air — and none of it is a defect in the garment; it is what a photograph
taken flat looks like against a shape it was never draped over. Reshaping
(module 3) was the first attempt to close that gap and produced its own tells;
not reshaping was the second and made the gap plainer. A flat-lay promises
nothing about drape, so nothing about it can be wrong, and it answers what the
view is for — *which pieces were picked* — better than a mannequin did, because
every piece is whole and sized to be legible.

### Sizing

`DISPLAY_HEIGHT` gives each category a share of the board's height — a dress
0.42, a bracelet 0.075. These are proportions of a *display*, not measurements
of a body: sizing by the cutout's own pixels would make whichever garment
happened to be photographed closest the biggest thing on the board.

Under that sit two floors, `minHeight` and `minWidth`, and the reason there are
two is shape rather than size. A bracelet is photographed as a wide flat oval:
given its share of the board's height it stays a hairline, and given its share
of the width it is a recognisable bracelet. A pendant necklace is the other way
round. So a piece is enlarged until it reaches whichever floor it meets
**first** — insisting on both would blow a wide item up until it filled the
board.

`growLimit` caps how far the whole board may then be enlarged to fill the width.
That cap is what keeps the floor a floor rather than a target: without it, an
outfit consisting of one bracelet is a hula hoop.

### Layout

Shelf packing — fill a row left to right, wrap when the next piece will not fit,
centre every row and the block. Chosen over a table of positions per category
because a fixed table has to answer *"where does the jacket go when there is
also a dress and two bracelets"*, and every answer is a special case. Packing
has none: each piece is given its size and the rows fall out of the arithmetic.

If a busy look overflows, one uniform scale is applied to everything rather than
re-packing. Re-packing at the smaller size would fit more per row and produce a
completely different board for the sake of one extra accessory.

### The board is only as tall as the look needs

A fixed portrait board cannot serve both a lone dress and eight pieces —
whatever height suits one leaves the other squeezed or floating in white. Since
the panel takes its height from this image (`.mannequin-img{height:auto}`), the
honest content height is also the one that draws the clothes largest: the wasted
band under a fixed board was costing a third of the space the garments could
have used. The board is cut to its content between `minBoardHeight` and
`height`.

### Every piece gets a shadow

Not decoration. A white blouse or a cream sneaker on a white board has no
boundary at all — the cutout is genuinely the same colour as the background, so
the garment is not there to look at. A blurred, offset copy of its own alpha
gives it an edge without tinting the garment.

`lab/display-probe.html` checks the things that can actually go wrong, none of
them by eye: nothing dropped, nothing clipped, no two pieces overlapping, a
bracelet above the floor but still smaller than the clothes, the biggest thing
on the board a garment rather than an accessory, and the background white to the
corners — which is what "no mannequin" means in pixels.

---

## Running the harnesses

Each module has one, and each writes a sheet to `lab/out/` plus a JSON report.

```powershell
lab\run-lab.ps1 -Page "lab/module-watershed.html"    # markers and masks, 5 hard cases
lab\run-lab.ps1 -Page "lab/module-cutout.html"       # 10 cutouts on black, grey and checks
lab\run-lab.ps1 -Page "lab/module-fit.html"          # each garment reshaped, against the body profile
lab\run-lab.ps1 -Page "lab/module-outfit.html"       # whole outfits, including two swap tests
lab\run-lab.ps1 -Page "lab/zoom-cutout.html"         # cutout tops blown up, for hanger leftovers
lab\run-lab.ps1 -Page "lab/app-mannequin-smoke.html" # the REAL app, driven through its own state
lab\run-lab.ps1 -Page "lab/body-recheck.html"        # candidate centre lines and widths, drawn over the photo
lab\run-lab.ps1 -Page "lab/body-measure2.html"       # edges found from the gradient, with every reading drawn back
lab\run-lab.ps1 -Page "lab/module-paint.html"        # erase / draw / fill, plus the fill's timing
lab\run-lab.ps1 -Page "lab/paint-app-probe.html"     # the brush driven through the real app with real mouse events
lab\run-lab.ps1 -Page "lab/paint-shot.html"          # before and after on the leftover hanger arc
lab\run-lab.ps1 -Page "lab/onbody-paint-probe.html"  # the paint frame registers with an on-body photo
lab\run-lab.ps1 -Page "lab/posed-fit-probe.html"     # posed garments on the mannequin, with lean measured
lab\run-lab.ps1 -Page "lab/slots-probe.html"         # removing and restoring the jacket
lab\run-lab.ps1 -Page "lab/occlusion-probe.html"     # bites from hair and limbs, each fixture extracted with the repair on AND off
lab\run-lab.ps1 -Page "lab/display-probe.html"       # the flat display board: sizes, packing, nothing dropped or clipped
lab\run-lab.ps1 -Page "lab/path-probe.html"          # WHICH isolation path each realistic upload route takes
lab\run-lab.ps1 -Page "lab/parity-probe.html"        # saved looks, renders that outlive the tab, and the phone pane doing real work
lab\run-lab.ps1 -Page "lab/fidelity-probe.html"      # what the AI prompts say, and the check that a render is still the same garment
lab\run-lab.ps1 -Page "lab/preview-probe.html"       # the app-level view: no lookbook, no mannequin, Render Outfit named right
lab\run-lab.ps1 -Page "lab/bite-debug.html"          # one hard case in detail: patch map, semantics, and the paint's colour vs the fabric's
lab\run-lab.ps1 -Page "lab/syntax-check.html"        # every script parses (catches a bad splice instantly)
```

The boxes in every harness are hardcoded from a measured run, so no vision-model
quota is spent and results are comparable between runs.

`app-mannequin-smoke.html` is the one that catches what the others cannot: a
script tag in the wrong order, a renamed field, a module that never loaded. It
drives the actual page in an iframe and reads the actual mannequin image back
out. Note that `app.js` declares its state with `let`/`const`, which in a classic
script does NOT put it on `window`, so the harness reaches it through
`frame.contentWindow.eval`.

Cutouts on black are not optional. A leftover rim of white backdrop is invisible
against the page and unmistakable against black, which is how three of them were
found.

## Known limits

- The occlusion repair fills a dent in the garment's outline that an occluder is
  standing in. Two kinds of missing fabric are therefore out of reach. A dent
  **open to the background** — hair hanging off a shoulder into the room — is
  refused, because there is no second edge of garment to say where the outline
  should have run; the shape there is genuinely unknowable, and a guess would
  invent a silhouette. And a bite that removed part of the **outline itself**
  rather than denting it (a hand overlapping the edge, long hair covering a whole
  sleeve) leaves a smaller convex shape, not a concavity, so nothing marks it as
  missing at all. Both are cases for the Draw Back brush or a paid render.
- Necklines are told apart from bites by what lies ABOVE, not by anatomy. The
  first rule refused to fill anything above an estimated bust line: it did
  protect V-necks, and it also refused every bite hair leaves on a shoulder or a
  chest, so the repair went on leaving precisely the holes it exists to close.
  The rule now asks, column by column, whether the garment continues above the
  dent — a neckline is the garment's own top edge and scores near zero, a lock of
  hair over a chest scores near one. `lab/occlusion-probe.html` guards it by
  measuring the *damage* rather than re-asking the same question: filling a
  neckline pulls the garment's top edge up towards the chin, so the top edge is
  compared between the repaired and unrepaired runs across the middle of the
  garment. Two earlier semantic rulers were thrown away for flagging a shoulder
  bite as a neckline — one because a widened face box covered half the picture,
  one because a skin flood ran down the arm of a model resting her hand on her
  chin.
- Measured on `lab/testset`, a bite of 1145 px comes down to 43 and one of
  4310 px to 1359, with the paint within 23 (summed over RGB) of the fabric it
  continues, and no garment's top edge moving by more than 1 px. Every fixture is
  extracted twice, with the repair on and off, so the comparison is between two
  runs rather than against numbers written down earlier.
- The repair diffuses the surrounding colour into the gap, so it gets the shape
  right and the weave wrong: a bold print stops at the edge of the repair. That
  is what makes a heavily-repaired garment the strongest case for a paid render,
  which is why `WornRender.worthIt` puts `occluded > 2%` ahead of every other
  reason.
- A hanger whose arms slope away *under* the garment's own shoulders leaves a
  thin arc: the colour flood is connectivity-constrained and the fabric splits
  the wood into pieces it cannot reach. Removing the constraint would also eat
  contrast yokes and colour-blocked panels, which is much the worse failure — so
  this one is left to the Erase brush, which is a second of work and cannot
  guess wrong. `lab/paint-shot.html` pictures it.
- A garment photographed against a backdrop that is not flat — a room, a street —
  has no reliable backdrop to flood, and falls back to the human-parsing engine in
  `garment-engine.js`.
- The fit is a row-wise warp of a flat photo. It reads as worn rather than
  pasted, but it is not a drape simulation, and a garment photographed at an
  angle stays at that angle.
