# Pink Petal Closet

An AI digital wardrobe: it cuts your clothes out of any photograph, assembles
outfits for whatever you are actually doing, and renders them worn on a
mannequin.

**Live:** https://pink-petal-closet-fl3nzijd2q-uc.a.run.app

---

## What it does

Give it any clothing photo — a shop screenshot, a flat lay, or a picture of
someone wearing the garment — and it returns **just that garment**, cut out on
transparency, with the background, the model and the hanger gone. Those cutouts
become a searchable closet. Describe where you are going in plain words and it
assembles an outfit from your own clothes; press **See It Worn** and it returns
a photograph of that outfit actually being worn.

Three distinct pieces of work:

| | |
|---|---|
| **Isolation** | A vision-language model decides *which* garment the photo is about and where it sits. MediaPipe selfie-multiclass separates clothing from body. A marker-based watershed handles the case colour thresholds cannot: a white garment on a white backdrop. Fabric hidden behind hair or a forearm is reconstructed from the surrounding weave. A Cutout Editor (tap-to-pick, drag-box, and Erase / Draw Back / Fill In brushes) covers what the automatic pass gets wrong. |
| **Styling** | A typed occasion is sorted into one of fourteen buckets by whole-word match with a stated precedence order, then every garment is scored on tag fit and colour harmony. It chooses between a dress and separates by scoring the best dress against the best top-and-bottom pair. Slots can be locked, shuffled, or switched off. When it does not recognise a phrase, it says so. |
| **Showing** | Before anything is spent, the look is a flat display of your real cutouts on white. Pressing See It Worn sends them and a bare mannequin to Gemini 2.5 Flash Image via Vertex AI. The result is checked against your own photo for colour and length drift and refused if the model changed the garment, then stored in IndexedDB against that exact set of garments so returning to a look is free and instant. |

Full write-up: [`Pink_Petal_Closet_Documentation1.md`](Pink_Petal_Closet_Documentation1.md)
(architecture diagram, use cases, the reasoning behind each technical choice).

## Running it locally

No build step, no bundler, no dependencies.

```powershell
.\start.ps1          # serves on http://localhost:8080 and opens it
```

`start.ps1` obtains a Vertex AI token (via `gcloud`, or one you paste) so the AI
features work. Without it the app still runs, falling back to pixel-only
isolation with the render button disabled and the reason shown.

**Serve it — do not open `index.html` from disk.** A `file://` page cannot read
pixels back out of a canvas, so isolation fails silently.

## Deploying

```powershell
.\deploy.ps1 -Project <your-gcp-project>
```

Builds via Cloud Build (nothing is built locally) and deploys to Cloud Run.

## Credentials

**No key is in this repository, and none should ever be.**

- The browser never sees a credential. It talks only to this app's own server,
  which holds the credential and proxies to Google.
- Locally, `server.ps1` reads `GEMINI_API_KEY` from the environment.
- Deployed, `deploy.ps1` puts the key in **Secret Manager** and has Cloud Run
  inject it as the environment variable `GEMINI_API_KEY` — rather than setting
  it on the service directly, where `gcloud run services describe` would print
  it.
- Renders need no key at all: on Cloud Run the container asks the metadata
  server for a token for its own service account.

## Layout

```
index.html  app.js  style.css     the app (vanilla JS, no framework)
garment-engine.js                 human parsing, occlusion repair, matting
vlm-service.js  tryon-service.js  the two AI clients
modules/                          9 standalone modules behind narrow interfaces
server/server.js                  the deployed server: static files + API proxy
server/api-core.js                its decisions, as pure testable functions
server.ps1  start.ps1             local dev server
deploy.ps1  Dockerfile            Cloud Run
lab/                              the validation harness
```

## Tests

```powershell
.\lab\run-suite.ps1
```

**456 assertions across 20 headless-browser suites**, exercising the real
application rather than mocks: cutout quality on ten fixtures (three of them
white-on-white), occlusion repair measured with the repair on *and* off, which
isolation path each upload route reaches, what the AI prompts actually say,
render-fidelity rejection in both directions, tag distribution, the outfit
scorer's bucket accuracy and per-slot determinism, and board layout.

Two things worth knowing about the harness:

- It treats an **aborted** probe as a failure. A suite that throws part-way
  records zero failures and a short count, which reads exactly like success.
- `lab/apicore-mutant.html` is a **mutation test**: it breaks the server's core
  logic nine different ways in memory and requires each fault to be caught. It
  exists because the api-core suite passed on its first run, and in this project
  that has twice meant the test was measuring nothing.

## What is not built

- No accounts and no sync — the wardrobe lives in one browser on one machine.
- The phone pane is a simulator running the same code as the dashboard, not a
  packaged mobile build.
- Model behaviour is not regression-tested: every check costs a call and the
  same prompt does not return the same picture twice. The prompts are tested for
  *what they say*, and each render is verified on arrival instead.
