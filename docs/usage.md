# Usage

Step-by-step for running Pink Petal Closet, digitizing garments, styling
outfits, and validating changes to the isolation engine.

---

## 1. Run it

**Requirements:** Windows with PowerShell, and Chrome or Edge. Nothing else —
no Node, no npm, no Python, no install step.

For the vision features (naming and locating a garment when you upload it, and
fitting garments to the mannequin) set a Google AI Studio key once:
`setx GEMINI_API_KEY "your-key"`, then start the server from a **new** shell.
Without it the app still works, falling back to pixel-only isolation.

```powershell
cd "d:\Neko\Antigravity Projects\Outfit Generator"
powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8080
```

Then open **http://localhost:8080**.

> Serve it — do not double-click `index.html`. A `file://` page cannot read
> pixels back out of a canvas, so isolation fails silently there.

**On first load** the app seeds a demo wardrobe (22 items) and starts
downloading the parsing model (~26 MB, once) in the background. Wait for the
console line `garment engine: {backend: "mediapipe"}` before your first upload
if you want it to be instant; if you upload sooner it still works, just slower.

---

## 2. Digitize a garment

This is the core flow: a photo of someone wearing something → that something,
cut out, on transparency.

**Step 1 — go to Add Item.** Left sidebar → *Add Item*.

**Step 2 — pick what you want isolated.** The *AI Focus Mode* pills tell the
engine which garment to take from the photo:

| Pill | Use it for | Verified |
|---|---|---|
| 👚 Top / Shirt | t-shirts, blouses, crop tops, kurtis | yes |
| 👖 Bottoms / Pants | jeans, trousers, skirts | yes |
| 👗 Dress | dresses and gowns, incl. belted ones | yes |
| 🧥 Jacket / Coat | outerwear | not yet |
| 👟 Shoes / Boots | footwear | not yet |
| 👜 Bag | handbags, crossbody bags | not yet |
| 💍 Accessory | necklaces, jewellery | not yet |
| ✨ Full Garment | the whole outfit as one cutout (filed under Dresses) | partly |

"Not yet" means implemented and reachable, but with no test fixture — check the
result before trusting it.

**Step 3 — give it the photo.** Any of:

- click the dropzone and choose a file
- drag an image onto the dropzone
- **Ctrl+V** anywhere in the page — this works straight from a store screenshot.
  There used to be a *Paste Image* button too; it was a third way to reach
  something that already had two, so it is gone

**Step 4 — read the result.** A vision model looks at the photo first: it names
the item ("tan block-heel sandals"), picks its category, and marks exactly where
it sits, so only that piece is cut out — props, hangers and the rest of an outfit
are left behind. The preview shows the cutout and the form fills itself in. The
toast reports what it found, e.g. `✨ Isolated white ribbed crop tank top`.

This is also what makes white garments work: on a white backdrop there is no
colour difference to segment, so the box plus an edge-following fill is the only
thing that finds the garment's outline.


**Photos of someone wearing the garment work too.** Hair over a shoulder or an
arm across the waist takes a bite out of the piece, and that bite is filled back
in from the fabric around it — a model's forearm hid 4% of a red dress, and the
cutout comes back whole. When it is more than a twentieth of the garment the
toast says so: `✨ Isolated dress — hair or an arm hid 6% of it, painted back
from the fabric around it.`

Two things it deliberately will not do. It never fills above the bust, because a
neckline is an indentation with skin showing through it exactly like a bite is,
and turning your V-neck into a boat neck would be worse than leaving a notch. And
the paint can only continue the surrounding colour, so a repair across a bold
print has the right shape and the wrong pattern. **See It Worn** (§4) is what
fixes that properly, and those garments are the ones it offers to render first.

**Step 5 — correct anything you like.** Every field is editable. The auto values
are a starting point, not a verdict.

**Step 6 — Hang in Closet.** The cutout is stored with the item.

### When the result is wrong

| Toast | Meaning | Do this |
|---|---|---|
| `⚠ Isolated …, but the edges look rough` | quality scored under 70 | open the Cutout Studio (§3) |
| `⚠ Isolation model unavailable — used the colour fallback` | model could not load | reconnect once, then re-upload; the model is cached afterwards |
| `⚠ Couldn't isolate a garment here — using the photo as-is` | no garment found | try a photo where the garment is larger in frame, or use the Studio |

---

## 3. The Cutout Editor (tap to select, then retouch)

This is the manual override, and it behaves like long-press object select on a
phone gallery.

Open it with **✂️ Edit Cutout** under the preview.

**Tap the garment you want.** A pink marker lands where you clicked and the
right-hand panel shows the isolated piece plus an edge-quality score:

```
ISOLATED GARMENT
[cutout on a checkerboard]
Selected: Light Grey bottom · edge quality 99/100
```

A tap **outranks the mode pill**: tap the jeans while *Top* is selected and you
get the jeans, saved as Bottoms.

Other controls:

| Control | Effect |
|---|---|
| Top / Bottoms / Dress / Jacket / Footwear pills | switch which garment to isolate, and refresh the preview |
| 📦 Custom Drag Box | drag a rectangle to restrict the search to part of the photo — for group shots or cluttered frames |
| Full Photo | isolate the whole outfit as one piece and close |
| ✨ Apply Extraction | send the current selection back to the Add Item form |

Practical order: tap first. Reach for the drag box only when there are two
people in frame, or the garment is small in a busy photo.

### Fixing it by hand — Erase, Draw Back, Fill In

Under the preset pills is a **Retouch** row. Use it when the automatic pass got
*most* of the garment: a hanger it kept, a prop it kept, a sleeve it dropped.

| Tool | What it does | Reach for it when |
|---|---|---|
| **Erase** | takes fabric away | a hanger arc, a clip, a price tag or a bit of the model is still attached |
| **Draw Back** | paints fabric back **using the photograph's own pixels** | the isolation cut off a sleeve, a strap or a hem that IS in the photo |
| **Fill In** | paints fabric back by **inventing it from the garment around the gap** | the photograph never had what is missing — the back of a coat behind its own open front |
| **Size** | brush width | a wire hook wants 6, a coat panel wants 60 |
| **Undo** | drops the last stroke | always available; strokes are stored as strokes, not as pictures |
| **Show photo underneath** | draws the photo faintly under the cutout | leave it on — see below |

**Leave "Show photo underneath" on.** It is what tells you which of the two
brushes you want. Whether a missing piece can be *drawn back* or has to be
*filled in* depends entirely on whether the photograph has anything there, and a
transparent hole looks the same either way. With the photo showing through at
28% you can see the answer before you stroke.

Draw Back invents nothing — a drawn-back pixel is the photograph's pixel. So if
you brush somewhere the photo only has studio backdrop, you will get studio
backdrop. That is the tool being honest, not a bug; undo and use Fill In.

Fill In takes the colour by spreading inwards from the fabric around the gap,
then borrows the weave from real fabric elsewhere on the same garment (from the
mirror position first, since a garment shot front-on is close to symmetrical).
At a wardrobe thumbnail's size it reads as fabric. It is not a reconstruction of
what the garment actually looks like there — nothing could be — so it is the
second choice, not the default.

**Apply Extraction keeps your strokes.** It does *not* isolate the photo again,
which would throw them away. Closing the studio any other way discards them, and
says so.

---

## 4. Build an outfit

**Step 1 —** left sidebar → *Outfit Assistant*.

**Step 2 —** describe the occasion in plain words: `casual coffee date`,
`office meeting`, `going to a party`, `summer brunch`.

**Step 3 — Generate Outfit.** The stylist assembles a look from *your* closet,
scored on tag relevance to the prompt and colour harmony, lays those actual
garments out as a display, and lists them underneath.

**There is no mannequin until you ask for one.** The picture is a flat-lay of
your own pieces on white — each one whole, at its own shape, sized so you can
see it. Small things are scaled up deliberately: a bracelet photographed as a
thin oval would otherwise be a hairline on the board, so it is enlarged until it
is recognisable, while still reading as smaller than the clothes. Every unlocked
piece changes when you shuffle; a pinned piece stays.

It is laid out flat on purpose. A flat photograph placed on a mannequin invites
a comparison it cannot win — the body is right there, so a hem that floats off a
hip or a sleeve that stops in mid-air looks like a fault in the garment when it
is only a photograph taken flat. A display makes no promise about drape, so
nothing about it can be wrong, and it answers what this view is for: which
pieces did the stylist pick.

The caption under the picture says how many pieces are shown and mentions
anything left off — a piece with no photo, or a slot you have switched off for
the day.

To see the outfit **worn on the mannequin** — fabric wrapping the body, folds
and contact shadows — press **See It Worn**.

### See It Worn (AI)

```powershell
setx GEMINI_API_KEY "your-google-ai-studio-key"   # once, then open a new shell
powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8080
```

The key stays on your machine — `server.ps1` forwards the request, the browser
never sees it. (`start.ps1` is the easier route: it uses your Google Cloud
credits through Vertex AI instead. See below.)

| Control | Behaviour |
|---|---|
| See It Worn | renders the current look on the mannequin; takes 10–30s. Always a deliberate press — there is no automatic rendering, because each one is a paid call |
| See It Worn, pressed again | if you are looking at a render of this exact look, pressing again **renders it afresh** — for when the model has changed something. That is another paid call |

Every render is **kept against that exact set of garments** — all of them, with
nothing thrown away — so coming back to a look you have already rendered costs
neither a wait nor a call. Shuffle away and back, close the tab, come back
tomorrow: press **See It Worn** and it is there straight away.

It is not shown *unasked*, though. The picture you get first is always the flat
display of the pieces, because that answers a different question — which
garments is this look made of — and a look you rendered once should still be
viewable as its own clothes. When a render exists, the caption tells you that
pressing the button will cost nothing.

Without a key the button is still there, greyed out, and says what is missing.
If a render fails, the picture already on screen stays and the reason appears
beneath the button.

### When the AI changes the garment

An image model asked for a shop-window photograph will, given half a chance,
produce a *nicer* garment than the one you gave it — a floral dress came back a
different colour and a different length, and a yellow dress came back amber. The
instructions now say, first and last, that the photograph **is** the garment and
not a suggestion, and they forbid the specific things that went wrong: no
shifting the hue, no substituting another floral, no shortening a hem, no adding
a belt.

Two of those causes are worth knowing about, because they explain drift that
looks like the model ignoring you:

- **The shop is warmly lit.** A model that "harmonises" a garment with the room's
  light will turn yellow into amber without changing anything it was told not to.
  The instruction now says explicitly: keep the colour and change the light.
- **Your garment's name is not its colour.** The app fills in names and colour
  labels automatically, and its colour table is coarse — a golden-yellow dress
  gets filed as an *"Amber Dress"*. Telling the model "it is amber" then asks for
  exactly the wrong thing. So the colour is now **measured from your photo** and
  given as a precise value, and the instruction says outright that the picture
  wins over any word, including the item's own name.

Because an instruction is still only a request, the **per-garment AI fit**
(*AI fit* in My Closet) measures what came back against your own photo and
**refuses to keep a render whose colour or length has drifted** — you keep your
photograph and the toast says what changed. That matters because a stored render
replaces your photo in every outfit from then on, so a wrong one would be wrong
for ever rather than wrong once.

**See It Worn** cannot be checked the same way — it returns several garments on
a mannequin, with nothing single to compare — so if it changes something, press
the button again for a fresh render.

To exercise the whole path without a key or any cost:

```powershell
$env:PP_TRYON_MOCK = "1"     # the proxy echoes the mannequin back
powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8080
```

Other knobs: `PP_TRYON_MODEL` overrides the model name; `GOOGLE_API_KEY` works
in place of `GEMINI_API_KEY`.

**Step 4 — iterate:**

| Action | Effect |
|---|---|
| 🔒 lock a slot (Slot Controls) | that piece is frozen; regenerating and shuffling keep it |
| **−** remove a slot (Slot Controls) | you are not wearing that today; the slot empties and stays empty |
| **+** add it back | the slot fills again, and nothing else in the outfit moves |
| Shuffle Unlocked | new options for everything not locked |
| Select Base Item | pick one garment and have the outfit built around it — its slot is locked automatically |
| Save This Look | keeps the outfit in **My Looks** — see below |

**Style around an item** is the flow to use when you know what you want to wear.
Pick it with *Select Base Item*; it is locked into the look and marked 📌 in Slot
Controls, and a **Shuffle the Rest** button appears right below it that keeps
that piece and swaps everything else. Locks you set by hand in Slot Controls are
kept too — the hint under the button names exactly what is being held.

**Not wearing a jacket today?** Press the **−** beside it in Slot Controls. The
slot empties and stays empty through every Generate and every Shuffle until you
press **+**, and the choice survives a reload. The same control is on the bag
and the three accessory slots.

Two things worth knowing about it. Removing or restoring one slot **moves no
other slot** — restoring the jacket does not quietly re-roll your top and shoes,
because it fills that one slot rather than regenerating the look. And pinning a
garment with *Select Base Item* overrides a removal: choosing to style around a
jacket is a clearer statement than having taken one off earlier, so the slot
comes back.

The top, bottom, dress and shoe slots have no **−**. An outfit needs them, and
the stylist decides for itself whether a look is a **dress** or a
**top + bottom** on each generation, based on the prompt and what your closet
holds — that is a structural choice rather than a preference, so it is not
something to switch off. Those slots only appear in Slot Controls when they are
in play for the current look.

---

## 5. My Looks

**Save This Look** keeps the outfit, and **My Looks** in the sidebar is where it
goes. (It used to keep nothing: the button incremented a counter and claimed the
look was saved to a catalog that did not exist.)

What is stored is the **garments**, by id — which is why each card offers
**Wear this**: it puts the whole outfit back on the board, so you can shuffle
around it, pin one piece and restyle the rest, or render it. A picture you could
only look at would be a screenshot; this is the outfit.

| On a look card | Effect |
|---|---|
| Wear this | every slot filled with the piece it had, and you land on the Outfit Assistant. If a garment has since been deleted from your closet, it says how many are missing rather than pretending |
| Delete | removes the look, and the *Outfits Crafted* count goes down with it |
| See it worn | **only appears on looks you have already rendered.** It swaps the card's picture to that render, and the button becomes *Show pieces* to swap back. It never generates anything, so it never costs anything — a look with no render simply has no such button rather than one that would quietly spend money |
| "rendered" badge | this look has a stored render behind that button |

Saving the same combination twice updates the existing entry rather than adding
a duplicate. Looks are kept in your browser (`pp_looks_v1`), thirty at most; if
space runs short the oldest **thumbnails** are dropped before any look is, since
a look without a picture is still a look you can wear.

---

## 6. On the phone

The right-hand iPhone pane is the same app, not a mockup of it. Every screen is
wired to the same functions the dashboard uses, so state cannot drift between
them — change the closet filter on the phone and the dashboard's pills move too.

| Phone tab | What you can do |
|---|---|
| Home | your counts, quick links, and your two most recent looks — tap one to wear it |
| Closet | the whole closet with the same filters, and per item: favourite, style-around, AI fit, delete |
| Stylist | type a vibe, Generate, Shuffle, See It Worn, Save Look, plus every slot's lock and the not-today toggle |
| Looks | the saved looks, with wear and delete |
| Add | choose or snap a photo and pick the focus mode; it runs the same extraction |

The one thing the phone hands over rather than reproducing is the **Cutout
Editor**. It is a full-screen canvas with a drag box and three brushes, it
already opens over the whole page, and a 320px copy would be a worse tool
pretending to be a feature — so the phone says where to find it.

---

## 7. Manage the closet

*My Closet* shows every item as a card. Filter by category with the tabs, click
the heart to favourite, click ✕ to delete. Deleting an item also clears it from
the active outfit.

Everything lives in your browser's `localStorage` under `pp_wardrobe_v3` —
per-browser, per-machine, no account. Clearing site data clears the closet.
Budget is roughly **90–100 uploaded garments** (cutouts are 38–52 KB each in a
~5 MB store); the shipped demo items cost almost nothing because they reference
files on disk.

---

## 8. Use the engine from your own code

The isolation service is independent of the app — you can call it from any page.

```html
<script src="garment-engine.js"></script>
```

```js
await GarmentEngine.warmup();                  // load the model up front

const r = await GarmentEngine.extract(imgOrDataUrl, {
  mode: "dress",                 // auto | top | bottom | dress | jacket |
                                 // bag | accessory | footwear | full
  hintPoint: { x: 0.5, y: 0.4 }, // optional: normalised "I tapped here"
  outputMaxDim: 720
});

r.image           // data URL, WebP with alpha (PNG fallback)
r.category        // "dresses"
r.color           // { hex: "#a30214", name: "Wine" }
r.metrics.quality // 0–100, the engine's own opinion
r.backend         // "mediapipe" | "heuristic"
r.warnings        // e.g. ["trimmed bare limbs read as fabric"]
```

Full reference, including every option and result field: [garment-engine.md](garment-engine.md).

---

## 9. Validate a change to the engine

Run these from the **project root**. Each starts a local server, drives headless
Chrome, writes results to `lab/out/`, and exits on its own.

**Full suite** — 14 cases (model path + forced fallback), one review sheet per
case plus `report.json`:

```powershell
powershell -ExecutionPolicy Bypass -File lab\run-lab.ps1
```

**One case, every stage** — when you need to see *why* something went wrong:

```powershell
powershell -ExecutionPolicy Bypass -File lab\run-lab.ps1 `
  -Page "lab/focus.html?file=testset/dress_white_outdoor.jpg&mode=dress"
```

**The wired app end-to-end** — upload, tap in the studio, apply, save to closet:

```powershell
powershell -ExecutionPolicy Bypass -File lab\run-lab.ps1 -Page "lab/app-smoke.html"
```

### Reading the output

Each review sheet in `lab/out/` has five panels, left to right:

1. **source** photo
2. **semantic classes** — background dark, hair blue, skin orange, face yellow,
   clothes green, accessories red
3. **colour clusters + piece bands** — the chosen piece is outlined in green
4. **final matte** over the photo, with the anatomy lines
5. **the cutout** on a checkerboard

Look at panel 5 first, then walk left to find where it went wrong: a bad cutout
with a good panel 2 is a selection bug; a bad panel 2 is a model/backend issue.

`report.json` carries per-case `metrics`, `pieces`, `chosenPiece`, `backend`,
timings and `warnings`. Do **not** trust the metrics alone — they are computed
against the same masks the cutout came from, and scored 98 while a dress was
coming out in fragments. Always look at the sheets.

### Adding a fixture

Drop an image in `lab/testset/`, add a line to the `CASES` array in
`lab/garment-lab.html`, re-run. Cases accept `{ file, mode, backend }` where
`backend: "heuristic"` forces the offline path.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Nothing happens on upload, console shows a canvas security error | opened as `file://` | serve via `server.ps1` |
| First extraction takes ~8 s | cold model download | subsequent ones are ~0.7 s; it is cached |
| Every result says "colour fallback" | CDN blocked or offline | allow `cdn.jsdelivr.net` and `storage.googleapis.com` once |
| `Failed to execute 'setItem'` / saving stops working | localStorage full | delete unused closet items |
| Legs or an arm included in the cutout | occlusion or a mannequin limb read as fabric | tap the garment in the Studio; if it persists, drag a box |
| A strap or bag still visible | it was not fully surrounded by fabric | Studio → drag a box tight around the garment |
| Emoji and dashes show as `ðŸ"š` gibberish | the file is being decoded as Windows-1252 | serve via `server.ps1`, which declares `charset=utf-8`; if you edit the source, save as UTF-8 |
| A garment is missing from the mannequin | that item has no photo (accessories ship as emoji), or its isolation failed | it still counts in the look and is listed in the breakdown |
| Port 8080 already in use | another server (often an older copy of this one) | stop it, or `server.ps1 -Port 8090` |
| Render Outfit is greyed out | the server has no key, or it is an old instance | run `start.ps1`, or set `GEMINI_API_KEY` and **restart** `server.ps1` in a NEW shell; the message under the button says which. Check `/api/tryon/status` |
| There is no mannequin in the picture | that is the default view — a flat display of the pieces you picked | press **See It Worn** to see them worn on one |
| A bracelet looks too big / a dress too small | sizes are proportions of the board, not of a body, so every piece stays legible | nothing to fix; the relative sizes are deliberate |
| Part of a garment is still missing after hair or an arm was over it | the repair declined that area. It fills a dent in the outline that an occluder is standing in; it will not fill one that is open to the background (the outline there is unknowable), and it never fills above the garment's own top edge, because that is a neckline | draw it back with **Retouch → Draw Back** in the Cutout Editor, or press **See It Worn** — a heavily repaired garment is the first thing it offers to render |
| "Couldn't render: ..." under the mannequin | the model refused or the request failed | the message carries the API's own reason; the picture on screen is left alone |
| "The model changed the garment — the colour came back different" | the AI fit produced a garment that is not yours, and it was refused rather than stored | your own photo is untouched; try **AI fit** again, or leave it — the flat photo is always a valid fallback |
| Render Outfit changed a garment's colour or length | the prompt forbids it but cannot guarantee it, and a whole-outfit render cannot be checked automatically | press **See It Worn** again while looking at that render — it forces a fresh call |

---

## 11. Where things are documented

| Question | Document |
|---|---|
| How do I use the app? | this file |
| How is it put together, and why? | [architecture.md](architecture.md) |
| How does isolation work internally? | [garment-engine.md](garment-engine.md) |
| How do I get a photorealistic worn render? | [usage.md §4](usage.md#rendering-the-outfit-as-actually-worn-ai) |
| What is the product, and the roadmap? | [`../Pink_Petal_Closet_Documentation.md`](../Pink_Petal_Closet_Documentation.md) |
| What would the cloud backend look like? | [`../architecture.md`](../architecture.md) |
