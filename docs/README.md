# Pink Petal Closet — documentation

Start here.

| I want to… | Read |
|---|---|
| run the app and digitize a garment | [usage.md](usage.md) |
| understand how the code is put together | [architecture.md](architecture.md) |
| work on cutting out, fitting or layering garments | [modules.md](modules.md) |
| work on the garment isolation engine | [garment-engine.md](garment-engine.md) |
| validate a change before shipping it | [usage.md §7](usage.md#7-validate-a-change-to-the-engine) |

## Quick start

```powershell
powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8080
# then open http://localhost:8080
```

Serve it rather than opening `index.html` directly — see
[usage.md §1](usage.md#1-run-it) for why.

## The short version

Pink Petal Closet is a static, client-side digital wardrobe. Its distinctive
piece is **garment isolation**: give it a photo of a person wearing something
and it returns just that garment, cut out on transparency, with the background
and the model removed.

There are two isolation paths, chosen by **what the photo is of** — asked of the
picture itself, not inferred from whether the user drew a box:

- **A photo of a person wearing it** goes to `garment-engine.js`, which parses
  the body, takes the garment off it, and paints back the fabric that hair or a
  limb was standing in front of.
- **A product shot or flat-lay** goes to `modules/`, small single-purpose files
  that cut it off its backdrop. The same folder holds the mannequin's body
  model, the per-garment fit, and the display board the app actually shows. See
  [modules.md](modules.md).

Before any AI render the outfit is shown as a **flat display** of the pieces on
white — no mannequin. A body only appears once the image model has produced a
photograph of the outfit genuinely being worn; see
[architecture.md §5](architecture.md#5-the-outfit-picture) for why.

`app.js` handles everything else — closet, stylist, UI — and touches both paths
through one small adapter (section 8). `lab/` is a validation harness and is
never loaded at runtime.

## Also in this repository

Two documents predate this folder and describe intent rather than the current
code. They are kept because the intent is still useful:

- [`../architecture.md`](../architecture.md) — a **proposed** cloud backend
  (Postgres + pgvector, object storage, serverless image processing). None of it
  is implemented; the app is entirely client-side today.
- [`../Pink_Petal_Closet_Documentation.md`](../Pink_Petal_Closet_Documentation.md)
  — the product write-up: problem statement, features, design system, roadmap.

  ⚠ Its §3.1 still describes the original three-stage colour-based extraction
  (corner-pixel background removal → HSL skin removal → crop onto white). That
  algorithm was replaced; see [architecture.md §4](architecture.md#4-isolation-pipeline)
  for what actually runs.
