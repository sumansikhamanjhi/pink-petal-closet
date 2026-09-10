# Pink Petal Closet

### An AI digital wardrobe, outfit stylist and worn-render studio

**Version:** current as of 10 September 2026
**Type:** static client-side web application (no build step) + local API proxy
**Status:** working; 304 automated assertions passing across 16 validation suites

> This document supersedes the earlier `Pink_Petal_Closet_Documentation.md`,
> which describes an earlier design — including a pre-rendered "3D mannequin"
> feature that has since been removed from the product. Every claim below
> reflects what the application actually does today.

---

## 1. Project description

Pink Petal Closet turns a camera roll into a wardrobe you can actually style
from.

You give it any clothing photograph — a shop screenshot, a flat lay, or a
picture of someone wearing the garment — and it gives back **just that
garment**, cut out on transparency, with the background, the model and the
hanger removed. Those cutouts become a searchable closet. You then describe
where you are going in plain words, and the app assembles a coherent outfit
from your own clothes and, on request, returns a photograph of that outfit being
worn on a mannequin.

There are three distinct pieces of work in it:

**Getting the garment out of the photo.** A vision-language model first looks at
the picture and answers two questions no pixel rule can: *which* item is this
photo about, and *where* is it. That keeps props, hangers and the rest of an
outfit out of the result. A human-parsing model (MediaPipe selfie-multiclass)
then separates clothing from body, and a marker-based watershed segmentation
handles the case that defeats every colour-based method — a white garment on a
white backdrop. Fabric hidden behind hair or a forearm is reconstructed from the
surrounding weave, so a photo of a friend wearing a dress still yields a whole
dress rather than one with a bite out of it. Where the automatic pass gets it
wrong, a **Cutout Editor** lets you tap the garment you want, drag a box around
it, or repair the edge by hand with three brushes: *Erase*, *Draw Back* (which
restores the photograph's own pixels) and *Fill In* (which invents fabric from
the garment surrounding the gap).

**Deciding what to wear.** You type an occasion — "office meeting", "diwali
dinner", "trekking", "rainy day errands" — and the stylist sorts the phrase into
one of fourteen occasion buckets, then scores every garment in your closet on
how well its tags match the words you typed and the occasion itself, plus colour
harmony against anything you have pinned. It chooses between a dress and
separates by scoring the best dress against the best top-and-bottom pair, and
you can overrule it. Pieces can be locked while the rest are shuffled, a whole
outfit can be built around one garment, and any slot can be switched off for the
day. When it does not recognise a phrase, it says so rather than quietly
returning something generic.

**Showing it.** Before anything is spent, the look appears as a flat display of
your own pieces laid out on white. This answers *what did it pick* without
pretending to know how the fabric will hang — a flat photograph placed on a body
invites a comparison it cannot win. Pressing **See It Worn** sends the garment
cutouts and a bare mannequin to an image model and returns a photograph of the
outfit genuinely being worn, fabric following the body, with folds and contact
shadows.

---

## 2. Project use case

### The problem

Most people own more clothes than they can hold in their head. The consequences
are ordinary and constant: the same three outfits on rotation, garments bought
and never worn, and a decision every morning made against a wardrobe you cannot
see all of at once. Existing answers do not fit. A photo album is not a
wardrobe — you cannot ask it what goes together. Retail try-on tools style you
in clothes you do not own, which is advertising rather than help. And any tool
that starts with "photograph each garment against a plain background" has
already lost, because nobody does that.

### Who it is for

| User | What they get |
|---|---|
| Someone with a full wardrobe and no overview | Their real clothes, digitised from photos they already have, in one browsable catalogue |
| Someone deciding what to wear | An outfit assembled from what they own, for the occasion they name, in seconds |
| Someone shopping | A garment screenshotted from a shop, cut out, and tried against their existing clothes before buying |
| Someone packing or planning | Saved looks that can be recalled and restyled, rather than re-decided |

### Worked examples

**Digitising a garment you are already wearing.** You photograph a friend in a
dress. The vision model identifies the dress and its box; the parser separates
it from her body; the occlusion repair fills in the part her arm was covering.
What lands in the closet is the dress, alone, on transparency — usable in an
outfit even though no product photo of it ever existed.

**Dressing for a real occasion.** You type "diwali dinner". The stylist reads
*diwali* as a festival rather than as a meal, weighs your festive-tagged pieces,
and assembles a look. You lock the earrings, shuffle everything else twice, then
press See It Worn and get a photograph of it on a mannequin. You save it. Next
week you recall the look and swap the shoes.

**Shopping without guessing.** You screenshot a jacket from a shop's website. It
comes out cut from the page. You style it against the trousers you already own,
see it worn, and decide.

### What it deliberately does not do

Stated because a tool's limits are part of its description:

- It does not put clothes on **you**. There is a mannequin, not a body model.
- It does not simulate drape. Before a render, garments are shown as
  photographed, not warped onto a body — a wrong guess about fabric is more
  misleading than an honest flat lay.
- It does not fill in a garment's **neckline**. A neckline and an occlusion bite
  are indistinguishable at pixel level, and turning a V-neck into a boat neck
  would be worse than leaving a notch.
- It does not render automatically. Every render is a paid API call, so it is
  always a deliberate press.

---

## 3. Architecture diagram

Everything runs in the browser. The only server is a local dev proxy whose sole
purpose is to keep the API key out of the page.

```
                        ┌──────────────────────────────────────┐
                        │            THE BROWSER               │
                        │   (static files, no build step)      │
                        └──────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────────────────┐
  │  index.html  ·  style.css                                            │
  │  Dashboard pane            +            Phone-simulator pane         │
  │  (both panes call the same functions — one app, two front ends)      │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  │
  ┌───────────────────────────────▼───────────────────────────────────────┐
  │  app.js — state · closet · stylist · UI · storage                    │
  │                                                                       │
  │   §8 isolation adapter   §11 stylist   §12 the picture   §13b looks   │
  └───┬───────────────┬───────────────┬──────────────────┬────────────────┘
      │               │               │                  │
      │               │               │                  │
┌─────▼──────┐  ┌─────▼───────┐  ┌────▼──────────┐  ┌────▼─────────────┐
│ vlm-       │  │ garment-    │  │ modules/  (9) │  │ tryon-service.js │
│ service.js │  │ engine.js   │  │               │  │                  │
│            │  │             │  │ seg-watershed │  │ builds the prompt│
│ WHICH item │  │ human       │  │ garment-cutout│  │ measures colours │
│ is this,   │  │ parsing,    │  │ cutout-paint  │  │ caches by outfit │
│ and WHERE  │  │ occlusion   │  │ body-model    │  │                  │
│            │  │ repair,     │  │ garment-fit   │  └────┬─────────────┘
│            │  │ matting     │  │ straighten    │       │
└─────┬──────┘  └─────┬───────┘  │ outfit-compose│       │
      │               │          │ outfit-display│       │
      │               │          │ worn-render   │       │
      │               │          └───────────────┘       │
      │               │                                   │
      │               ▼                                   │
      │      ┌──────────────────┐                          │
      │      │ MediaPipe model  │  fetched once, then      │
      │      │ (Cache API)      │  cached in the browser   │
      │      └──────────────────┘                          │
      │                                                    │
      └──────────────────┬─────────────────────────────────┘
                         │  POST /api/vlm   ·   POST /api/tryon
                         ▼
       ┌──────────────────────────────────────────────────┐
       │  server.ps1  —  local dev server + API proxy     │
       │  serves the static files; holds the API key so    │
       │  the browser never sees it                        │
       │  /api/vlm   /api/tryon   /api/tryon/status        │
       └───────────────────────┬──────────────────────────┘
                               │
                               ▼
       ┌──────────────────────────────────────────────────┐
       │  Google Vertex AI                                │
       │  · vision-language model  (identify + locate)    │
       │  · Gemini 2.5 Flash Image (the worn render)      │
       └──────────────────────────────────────────────────┘

  PERSISTENCE (all client-side, nothing leaves the machine)
  ┌────────────────────────────────────────────────────────────────────┐
  │ localStorage   pp_wardrobe_v3      the closet, cutouts included    │
  │                pp_looks_v1         saved looks (garment ids)       │
  │                pp_worn_v2          per-garment ghost renders       │
  │                pp_slot_optout      slots switched off "not today"  │
  │                pp_outfit_shape     dress / separates preference    │
  │ IndexedDB      pp_renders ▸ looks  every worn render, uncapped     │
  │ Cache API                          the MediaPipe model             │
  └────────────────────────────────────────────────────────────────────┘
```

### The isolation pipeline, in order

```
  photo
    │
    ▼
  [1] decode, downscale to 768px
    │
    ▼
  [2] semantic pass — background / hair / skin / face / clothes / accessory
    │            (MediaPipe; colour-heuristic fallback when offline)
    ▼
  [3] anatomy — shoulder, hip and knee lines, derived from the FACE
    │
    ▼
  [4] piece split — rows grouped into stacked garments by colour cluster
    │
    ▼
  [5] selection — which stacked piece the user asked for
    │
    ▼
  [6] cleanup — straps, props and bare limbs read as fabric, removed
    │
    ▼
  [6b] occlusion repair — fabric behind hair or a limb, put back
    │
    ▼
  [7] matting — soft alpha edge + colour decontamination + inpainting
    │
    ▼
  [8] render — tight crop, encode to WebP with alpha
    │
    ▼
  [9] metrics — score the cutout so a bad one can be flagged, not shipped
    │
    ▼
  cutout + colour + fabric + tags  →  the closet
```

### Two routes to a picture

```
   an outfit on the board
            │
            ├──────────────── free, instant ────────────────┐
            │                                               │
            ▼                                               ▼
   FLAT DISPLAY                                     "See It Worn"
   the real cutouts, laid                            (a paid call)
   out on white, sized                                     │
   for legibility                                           ▼
            ▲                                    prompt states each garment's
            │                                    colour as measured sRGB
            │                                               │
            │                                               ▼
            │                                    render returned, then CHECKED
            │                                    against your own photo for
            │                                    colour drift and length drift
            │                                               │
            │                                    ┌──────────┴──────────┐
            │                                    ▼                     ▼
            │                              matches: kept        drifted: refused,
            │                              in IndexedDB         your photo retained
            │                                    │
            └────────── toggle ──────────────────┘
                    (free, either way)
```

---

## 4. Key technical decisions

Each of these was reached by measurement, and each replaced something that
looked reasonable and did not work.

| Decision | Why |
|---|---|
| **Watershed segmentation** rather than a colour threshold | A white top on a white sweep has no colour difference to threshold. Flooding from the backdrop with a stability sweep over 16 candidate thresholds gets it; measured cutout quality 94-100 on clean shots, 76-81 on white-on-white. |
| **Occlusion repair works from notches, not from deleted pixels** | Hair over a shoulder is labelled *hair* from the start, so it never enters the "removed" set the earlier repair worked from. Closing the garment outline and filling only dents an occluder is standing in reduced one bite from 1145 px to 43, another from 4310 to 1427. |
| **A flat display before any render** | Placing a flat photograph on a mannequin invites a comparison it cannot win: every place the fabric fails to follow the body reads as a defect in the garment. A flat lay promises nothing about drape. |
| **The render prompt states a MEASURED colour** | An earlier version quoted the wardrobe's stored colour name — and that name comes from a coarse 20-bucket table where any saturated gold is "Amber". It was asking for an amber dress about a yellow one. The colour is now measured from the pixels being sent, as sRGB. |
| **Renders are verified, not trusted** | A prompt is a request. The result is compared against the wearer's own photo (CIE76 colour difference; length as height over shoulder width) and refused if it drifted. Calibrated on a faithful render: ΔE 1.4, 0.1% drift, against thresholds of 12 and 20%. |
| **Renders live in IndexedDB, uncapped** | localStorage has ~5 MB for the whole app, which forced eviction — a render you had paid for could vanish because you had rendered others since. Wrong behaviour for something bought. |
| **Whole-word matching in the stylist** | Substring matching made "gym workout" an office outfit (*workout* contains *work*) and "airport travel day" a party outfit (*travel* contains *rave*). |
| **Tags come from a vision model, with a supplied vocabulary** | The mechanical tagger put "chic" on 100% of garments and "boutique" on 61% — words in no occasion list and no real search, occupying two of five tag slots. |

---

## 5. Validation

Correctness is held by a harness, not by inspection: **16 headless-browser
suites, 304 assertions**, run with one command and exercising the real
application rather than mocks.

| Suite | What it holds |
|---|---|
| `module-cutout`, `module-watershed` | cutout quality on 10 fixtures, including three white-on-white |
| `occlusion-probe` | every fixture extracted twice, with the repair on **and** off, so the comparison is between two runs rather than against remembered numbers |
| `path-probe` | which isolation path each realistic upload route actually reaches |
| `fidelity-probe` | what the AI prompts say, and that a drifted render is caught in both directions |
| `stylist-probe` | 22 prompts sorted into buckets; per-slot determinism |
| `tags-probe` | tag distribution across the whole catalogue, and a colour table for 14 garments whose colour is not in dispute |
| `parity-probe` | saved looks, render persistence, and that every control the phone renders is wired to a function that exists |
| `dress-probe`, `display-probe`, `preview-probe` | the dress/separates choice, board layout, and that no button label is clipped |

The runner treats an **aborted** probe as a failure. A suite that throws
part-way records zero failures and a short count, which reads exactly like
success — so that case is caught explicitly rather than left to be noticed.

---

## 6. How to run it

```powershell
cd "path\to\Outfit Generator"
.\start.ps1                     # serves on http://localhost:8080 and opens it
```

`start.ps1` obtains a Vertex AI token (via `gcloud`, or a pasted one) so the AI
features work; without it the app still runs, falling back to pixel-only
isolation and disabling the render button with the reason shown.

To run the full validation suite:

```powershell
.\lab\run-suite.ps1
```

**Serve it — do not open `index.html` from disk.** A `file://` page cannot read
pixels back out of a canvas, so isolation fails silently.

---

## 7. What is not built

Stated plainly, because an honest boundary is more useful than an implied one:

- **No accounts, no cloud sync.** The wardrobe lives in one browser on one
  machine. A user's closet does not follow them to another device.
- **No real mobile app.** The phone pane is a simulator running the same code as
  the dashboard, which is what makes the layout and the flows real — but it is
  not a packaged iOS or Android build.
- **The Cutout Editor is desktop-only by design.** It is a full-screen canvas
  with a drag box and three brushes; a 320px copy would be a worse tool
  pretending to be a feature.
- **Model behaviour is not regression-tested.** Every check of it costs a call
  and the same prompt does not always return the same picture, so the prompts
  are tested for *what they say* and each render is verified on arrival.
