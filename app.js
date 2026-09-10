// =========================================================
// PINK PETAL CLOSET - DIGITAL WARDROBE & AI STYLIST
// Garment isolation runs on-device via garment-engine.js (MediaPipe
// multiclass human parsing + colour instance split + alpha matting)
// =========================================================

// ============ 1. AI ENGINE METADATA ============
const AI_ENGINE_INFO = {
  name: "On-device garment isolation (MediaPipe multiclass human parsing)",
  version: "garment-engine v2",
  trainedDataset: "MediaPipe selfie-multiclass (background / hair / skin / clothes)",
  categoriesSupported: ["Tops", "Bottoms", "Dresses", "Jackets", "Footwear", "Bags", "Accessories"],
  fabricClasses: 48,
  confidenceThreshold: 0.94,
  status: "ONLINE & ACTIVE"
};

// ============ 2. WARDROBE DATABASE ============
const DEFAULT_ITEMS = [
  // -- TOPS --
  { id:"t7", name:"Rust Asymmetrical Ribbed Top", category:"tops", image:"assets/terracotta_ribbed_top.jpg", color:"#C86446", colorName:"Terracotta", fabric:"Ribbed Knit", tags:["chic","autumn","ribbed","asymmetrical","knit"], favorite:true },
  { id:"t6", name:"White Ribbed Square-Neck Top", category:"tops", image:"assets/white_ribbed_top.jpg", color:"#FFFFFF", colorName:"White", fabric:"Ribbed Cotton", tags:["minimal","summer","square-neck","ribbed","clean"], favorite:true },
  { id:"t1", name:"Pink Cable Knit Top", category:"tops", image:"assets/pink_knit_top.jpg", color:"#E8B4B8", colorName:"Blush Pink", fabric:"Cable Knit", tags:["cozy","pastel","spring","casual","knit"], favorite:true },
  { id:"t2", name:"Lavender Ribbed Crop Top", category:"tops", image:"assets/lavender_crop_top.jpg", color:"#B19CD9", colorName:"Lavender", fabric:"Ribbed Stretch", tags:["casual","summer","crop","purple","trendy"], favorite:false },
  { id:"t3", name:"White Linen Blouse", category:"tops", image:"assets/white_linen_blouse.jpg", color:"#FFFFFF", colorName:"White", fabric:"Linen", tags:["classic","minimal","work","summer","linen"], favorite:false },
  { id:"t4", name:"Black Silk Camisole", category:"tops", image:"assets/black_silk_camisole.jpg", color:"#1A1A1A", colorName:"Black", fabric:"Silk Satin", tags:["evening","party","chic","silk","date"], favorite:false },
  { id:"t5", name:"Olive Turtleneck", category:"tops", image:"assets/olive_turtleneck.jpg", color:"#556B2F", colorName:"Olive", fabric:"Fine Knit", tags:["autumn","cozy","layering","earthy","warm"], favorite:false },
  // -- BOTTOMS --
  { id:"b1", name:"Sage Pleated Skirt", category:"bottoms", image:"assets/sage_pleated_skirt.jpg", color:"#8F9E8B", colorName:"Sage Green", fabric:"Pleated Chiffon", tags:["chic","pastel","summer","date","pleated"], favorite:true },
  { id:"b2", name:"Beige Wide-Leg Trousers", category:"bottoms", image:"assets/beige_wide_trousers.jpg", color:"#D2B48C", colorName:"Beige", fabric:"Tailored Wool-Blend", tags:["work","elegant","neutral","office","classic"], favorite:false },
  { id:"b3", name:"Dark Wash Skinny Jeans", category:"bottoms", image:"assets/dark_skinny_jeans.jpg", color:"#2C3E6B", colorName:"Dark Denim", fabric:"Stretch Denim", tags:["casual","everyday","denim","versatile","blue"], favorite:true },
  { id:"b4", name:"Black Leather Mini Skirt", category:"bottoms", image:"assets/black_leather_skirt.jpg", color:"#1A1A1A", colorName:"Black", fabric:"Faux Leather", tags:["party","edgy","night","leather","chic"], favorite:false },
  // -- DRESSES --
  { id:"d1", name:"Floral Summer Dress", category:"dresses", image:"assets/floral_white_dress.jpg", color:"#FFF5F5", colorName:"White Floral", fabric:"Chiffon", tags:["romantic","floral","summer","party","airy"], favorite:true },
  { id:"d2", name:"Burgundy Cocktail Dress", category:"dresses", image:"assets/red_cocktail_dress.jpg", color:"#722F37", colorName:"Burgundy", fabric:"Crepe Bodycon", tags:["formal","party","evening","elegant","fitted"], favorite:true },
  // -- FOOTWEAR --
  { id:"f1", name:"Cream Retro Sneakers", category:"footwear", image:"assets/cream_retro_sneakers.jpg", color:"#F5F5DC", colorName:"Cream", fabric:"Leather & Suede", tags:["casual","comfy","pastel","walk","sporty"], favorite:true },
  { id:"f2", name:"Black Leather Ankle Boots", category:"footwear", image:"assets/black_ankle_boots.jpg", color:"#1A1A1A", colorName:"Black", fabric:"Smooth Leather", tags:["edgy","autumn","leather","chic","versatile"], favorite:false },
  // -- JACKETS --
  { id:"j1", name:"Navy Denim Jacket", category:"jackets", image:"assets/navy_denim_jacket.jpg", color:"#1B2A4A", colorName:"Dark Navy", fabric:"Denim", tags:["casual","layering","denim","versatile","spring"], favorite:true },
  // -- BAGS --
  { id:"bg1", name:"Sage Leather Shoulder Bag", category:"bags", image:"assets/sage_leather_handbag.jpg", color:"#8F9E8B", colorName:"Sage", fabric:"Pebbled Leather", tags:["chic","date","work","everyday","leather"], favorite:true },
  { id:"bg2", name:"White Chain Crossbody", category:"bags", image:"assets/white_crossbody_bag.jpg", color:"#F5F5F5", colorName:"White", fabric:"Smooth Leather", tags:["party","evening","elegant","gold","trendy"], favorite:false }
  /* -- ACCESSORIES --
     Deliberately none. The four that used to sit here — a choker, a chain, a
     bracelet and a headband — were the only garments in the closet with no
     photograph, standing in with an emoji and a colour gradient. Next to
     twenty cut-out photographs they read as placeholders rather than clothes,
     so they are gone.

     The three accessory SLOTS and the Accessories filter stay. Accessories can
     still be added from a photo like anything else; until one is, those slots
     stay empty and the filter shows its "nothing here yet" state, which is the
     honest thing for an empty category to do. */
];


const PRESET_UPLOADS = {
  preset_terracotta_top: { name:"Rust Asymmetrical Ribbed Top", category:"tops", image:"assets/terracotta_ribbed_top.jpg", tags:"chic, autumn, ribbed, asymmetrical, knit", color:"#C86446", colorName:"Terracotta" },
  preset_pink_top:       { name:"Pink Cable Knit Top", category:"tops", image:"assets/pink_knit_top.jpg", tags:"cozy, pastel, spring, casual, knit", color:"#E8B4B8", colorName:"Blush Pink" },
  preset_sage_skirt:     { name:"Sage Pleated Skirt", category:"bottoms", image:"assets/sage_pleated_skirt.jpg", tags:"chic, pastel, summer, date", color:"#8F9E8B", colorName:"Sage" },
  preset_floral_dress:   { name:"Floral Summer Dress", category:"dresses", image:"assets/floral_white_dress.jpg", tags:"romantic, floral, summer", color:"#FFF5F5", colorName:"White Floral" },
  preset_red_dress:      { name:"Burgundy Cocktail Dress", category:"dresses", image:"assets/red_cocktail_dress.jpg", tags:"formal, party, evening", color:"#722F37", colorName:"Burgundy" },
  preset_sneakers:       { name:"Cream Retro Sneakers", category:"footwear", image:"assets/cream_retro_sneakers.jpg", tags:"casual, comfy, pastel", color:"#F5F5DC", colorName:"Cream" },
  preset_lavender_top:   { name:"Lavender Ribbed Crop Top", category:"tops", image:"assets/lavender_crop_top.jpg", tags:"casual, summer, crop, purple", color:"#B19CD9", colorName:"Lavender" }
};


// ============ 3. STATE ============
let wardrobe = [];
let outfitsCount = 0;
let currentVibeCategory = "casual";
let extractionMode = "top";
let currentMannequinPhoto = null;   // whatever the mannequin is showing now
let compositeToken = 0;

let activeOutfit = {
  vibe: "Neutral Vibe",
  slots: {
    tops: { itemId:null, locked:false, enabled:true },
    bottoms: { itemId:null, locked:false, enabled:true },
    dresses: { itemId:null, locked:false, enabled:false },
    footwear: { itemId:null, locked:false, enabled:true },
    accessories_necklace: { itemId:null, locked:false, enabled:true },
    accessories_bracelet: { itemId:null, locked:false, enabled:true },
    accessories_headwear: { itemId:null, locked:false, enabled:true },
    bags: { itemId:null, locked:false, enabled:true },
    jackets: { itemId:null, locked:false, enabled:true },
  }
};
let manualBaseItem = null;
let currentRawImageSrc = null;
let currentUploadedImage = null;

/**
 * Whether currentUploadedImage is an isolated cutout or just the photograph.
 *
 * They cannot be told apart by looking: an isolation failure parks the raw photo
 * in the same variable, and both are data URLs by the time they are saved. The
 * mannequin needs to know, because a photo that was never isolated has to be run
 * through isolation before it can be worn, and a cutout must never be run
 * through it twice.
 */
let currentUploadedIsCutout = false;

/* What share of the garment being uploaded was hidden behind hair or a limb
   and had to be painted back in. Carried through to the saved item, because
   nothing downstream can work it out again: the repair is seamless by design,
   and only the parse of the original photograph knows it happened. */
let currentUploadedOccluded = 0;

/**
 * The uncropped working frame of the most recent isolation, kept for the retouch
 * brush. Held here rather than on the item because it is a couple of megabytes
 * and only matters between extracting a garment and saving it.
 */
let currentWorkingLayer = null;

/**
 * Counts isolation runs so a slow one cannot land on top of a newer result. An
 * extraction started before the user retouched the cutout would otherwise
 * finish afterwards and overwrite their work with no user action at all.
 */
let extractionGen = 0;

/**
 * Slots the wearer is allowed to take out of an outfit.
 *
 * Deliberately a fixed whitelist rather than "whatever is currently enabled".
 * `enabled` already carries something else — the structural choice between a
 * dress and separates, rewritten on every generate — so reading a wearer's
 * intention out of it would record "no dress today" as a preference and come
 * back after a reload with nothing to wear at all. Tops, bottoms, dresses and
 * shoes are not members: an outfit needs them.
 */
const OPTIONAL_SLOTS = new Set([
  "jackets", "bags", "accessories_necklace", "accessories_bracelet", "accessories_headwear"
]);
const SLOT_OPTOUT_KEY = "pp_slot_optout";
let slotOptOut = new Set();

/* Dress, or a top and a bottom? "auto" lets the stylist decide per prompt; the
   other two are the wearer overruling it, and the choice sticks — someone who
   does not wear dresses should not have to say so on every prompt. Kept here
   rather than inside activeOutfit because it is a standing preference, not
   part of the look on the board. */
const OUTFIT_SHAPE_KEY = "pp_outfit_shape";
let outfitShape = "auto";

function loadOutfitShape() {
  try {
    const raw = localStorage.getItem(OUTFIT_SHAPE_KEY);
    outfitShape = (raw === "dress" || raw === "separates") ? raw : "auto";
  } catch (e) { outfitShape = "auto"; }
  return outfitShape;
}

function setOutfitShape(shape) {
  outfitShape = (shape === "dress" || shape === "separates") ? shape : "auto";
  try { localStorage.setItem(OUTFIT_SHAPE_KEY, outfitShape); } catch (e) { /* nothing to do */ }
  // pinning a garment is a stronger statement than this switch, so it goes
  if (manualBaseItem && manualBaseItem.category !== "dresses" && outfitShape === "dress") {
    clearManualBaseItem();
  }
  generateOutfit(document.getElementById("stylist-prompt")?.value.trim() || activeOutfit.vibe);
}

let studioState = {
  activePreset: "top",
  startX: 0, startY: 0,
  isDragging: false,
  moved: false,
  scale: 1,
  box: null,
  hint: null,
  previewResult: null,
  // retouch brush; null until the user picks a paint tool
  paint: null,
  tool: null,
  stroke: null,
  gen: 0
};

// ============ 4. INIT ============
function initApp() {
  try {
    const stored = localStorage.getItem("pp_wardrobe_v3");
    if (stored) {
      wardrobe = JSON.parse(stored);
    }
  } catch (e) {
    wardrobe = [];
  }

  if (!wardrobe || wardrobe.length === 0) {
    wardrobe = JSON.parse(JSON.stringify(DEFAULT_ITEMS));
    saveWardrobeData();
  }

  /* Drop the four emoji placeholders from a closet saved before they were
     removed from the seed.

     Taking them out of DEFAULT_ITEMS only changes what a NEW closet gets. A
     browser that has opened this app before reads its wardrobe straight out of
     localStorage, so without this the cards stay on screen and the change
     looks like it did nothing.

     Narrow on purpose: only these four ids, and only while the item is still
     the placeholder it shipped as. If one has been given a photograph then
     somebody did that deliberately, and deleting their work to tidy the seed
     would be the wrong trade. Anything the wearer added is untouched. */
  const PLACEHOLDER_IDS = ["a1", "a2", "a3", "a4"];
  const before = wardrobe.length;
  wardrobe = wardrobe.filter(i =>
    !(PLACEHOLDER_IDS.indexOf(i.id) >= 0 && !i.image && !i.cutout));
  if (wardrobe.length !== before) {
    saveWardrobeData();
    console.log("removed " + (before - wardrobe.length) + " emoji placeholder garment(s)");
  }

  /* The saved looks ARE the count.
     "Outfits Crafted" used to be a free-standing number that only ever went
     up, because nothing was stored for it to count. Now that looks are kept,
     the stat is derived from them — so deleting a look makes the number go
     down, which is what a count of your looks should do. */
  loadLooks();
  outfitsCount = loadLooks().length;
  localStorage.setItem("pp_outfits_count_v3", outfitsCount.toString());
  /* Which looks have a render, read once at startup. Only the keys — they are
     a few bytes each, and holding them lets the UI ask "has this been
     rendered?" without awaiting, while the images stay on disk until one is
     actually shown. */
  loadRenderKeys().then(keys => {
    console.info("stored renders:", keys.size);
    renderLooks();
  });
  loadSlotOptOut();
  loadOutfitShape();
  // Load the parsing model up front so the first upload isolates instantly.
  warmUpGarmentEngine().then(s => console.info("garment engine:", s));
  initTryOnControls();
  setupEventListeners();
  setupClipboardPasteListener();
  switchTab("home");
  updateStats();
  renderCloset("all");
  renderLooks();
  generateOutfit("casual coffee date", true);
}

// ============ 5. GLOBAL PASTE & EVENT LISTENERS ============
function setupClipboardPasteListener() {
  window.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          switchTab("add");
          showToast("📋 Image pasted from clipboard!");
          handleImageUpload(file, "Pasted Garment");
          break;
        }
      }
    }
  });
}

function setupEventListeners() {
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(b.dataset.target);
    });
  });

  document.querySelectorAll(".m-nav-btn").forEach(b => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(b.dataset.target);
    });
  });

  document.querySelectorAll("#web-filter-tabs .filter-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#web-filter-tabs .filter-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      renderCloset(b.dataset.category);
    });
  });

  document.querySelectorAll(".btn-mode-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".btn-mode-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      extractionMode = pill.dataset.mode || "top";
      if (currentRawImageSrc) {
        runExtractionPipeline(currentRawImageSrc, null, null, extractionMode);
      }
    });
  });

  const dropzone = document.getElementById("add-dropzone");
  const fileInput = document.getElementById("file-input");
  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", e => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0]); });

    dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.style.borderColor = "var(--sage-green)"; });
    dropzone.addEventListener("dragleave", e => { e.preventDefault(); dropzone.style.borderColor = "var(--light-pink)"; });
    dropzone.addEventListener("drop", e => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--light-pink)";
      if (e.dataTransfer.files?.[0]) handleImageUpload(e.dataTransfer.files[0]);
    });
  }

  document.querySelectorAll(".demo-card-btn").forEach(b => {
    b.addEventListener("click", () => { const p = PRESET_UPLOADS[b.dataset.preset]; if (p) simulatePresetUpload(p); });
  });

  document.getElementById("btn-reupload")?.addEventListener("click", e => { e.stopPropagation(); resetUploadState(); });
  document.getElementById("btn-save-item")?.addEventListener("click", saveUploadedItem);
  document.getElementById("btn-generate-outfit")?.addEventListener("click", () => {
    generateOutfit(document.getElementById("stylist-prompt")?.value.trim() || "everyday casual");
  });
  document.getElementById("btn-shuffle-unlocked")?.addEventListener("click", shuffleOutfit);
  document.getElementById("btn-shuffle-around")?.addEventListener("click", shuffleOutfit);

  document.getElementById("btn-save-outfit")?.addEventListener("click", saveOutfit);
  document.getElementById("btn-trigger-manual-select")?.addEventListener("click", openManualSelectModal);
  document.getElementById("btn-close-modal")?.addEventListener("click", closeManualSelectModal);
  document.getElementById("btn-clear-base")?.addEventListener("click", clearManualBaseItem);

  document.getElementById("btn-crop-tool")?.addEventListener("click", e => {
    e.stopPropagation();
    openStudioModal();
  });
  document.getElementById("btn-close-crop")?.addEventListener("click", closeStudioModal);
  document.getElementById("btn-crop-reset")?.addEventListener("click", () => {
    closeStudioModal();
    if (currentRawImageSrc) runExtractionPipeline(currentRawImageSrc, null, null, "full");
  });
  document.getElementById("btn-crop-apply")?.addEventListener("click", applyStudioCutout);

  document.getElementById("tool-top-preset")?.addEventListener("click", () => setStudioPreset("top"));
  document.getElementById("tool-bottom-preset")?.addEventListener("click", () => setStudioPreset("bottom"));
  document.getElementById("tool-dress-preset")?.addEventListener("click", () => setStudioPreset("dress"));
  document.getElementById("tool-jacket-preset")?.addEventListener("click", () => setStudioPreset("jacket"));
  document.getElementById("tool-shoes-preset")?.addEventListener("click", () => setStudioPreset("footwear"));
  document.getElementById("tool-custom-box")?.addEventListener("click", () => setStudioPreset("custom"));

  document.getElementById("btn-aifit-needed")?.addEventListener("click", () => aiFitWholeCloset(false));
  // The bar stays hidden unless generation is actually reachable, so nobody is
  // offered a button that can only fail.
  if (window.WornRender) {
    window.WornRender.status().then(st => {
      const bar = document.getElementById("closet-aifit-bar");
      if (!bar || !st.ready) return;
      bar.style.display = "flex";
      const state = document.getElementById("aifit-state");
      if (state) {
        const fitted = Object.keys(loadWornStore()).length;
        state.textContent = fitted ? fitted + " already fitted" : "";
      }
    }).catch(() => {});
  }

  document.getElementById("tool-paint-erase")?.addEventListener("click", () => setStudioTool("erase"));
  document.getElementById("tool-paint-draw")?.addEventListener("click", () => setStudioTool("draw"));
  document.getElementById("tool-paint-fill")?.addEventListener("click", () => setStudioTool("fill"));
  document.getElementById("tool-paint-undo")?.addEventListener("click", undoStudioStroke);
  document.getElementById("paint-ghost")?.addEventListener("change", e => {
    if (studioState.paint) studioState.paint.ghost = e.target.checked;
    repaintStudioCanvas();
  });

  /* Clicking a modal's dark surround closes it — but a click fires on the
     nearest ancestor shared by the press and the release, so a drag that starts
     on the canvas and finishes out over the surround counts as a click on the
     surround. That closed the studio and threw the work away mid-gesture. It
     was always true of the drag box; the brush just makes it easy to hit. So
     require BOTH ends of the gesture to be on the surround. */
  let modalDownTarget = null;
  window.addEventListener("mousedown", e => { modalDownTarget = e.target; }, true);
  window.addEventListener("click", e => {
    const manual = document.getElementById("manual-select-modal");
    const crop = document.getElementById("crop-modal");
    if (e.target === manual && modalDownTarget === manual) closeManualSelectModal();
    if (e.target === crop && modalDownTarget === crop) closeStudioModal();
  });
}

function showToast(msg) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const t = document.createElement("div");
  t.className = "toast-notification";
  t.innerHTML = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "all 0.4s ease";
    setTimeout(() => t.remove(), 400);
  }, 2600);
}

// ============ 6. NAVIGATION ============
function switchTab(id) {
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.target === id));
  document.querySelectorAll(".m-nav-btn").forEach(b => b.classList.toggle("active", b.dataset.target === id));
  document.querySelectorAll(".content-sheet").forEach(s => s.classList.remove("active"));
  const sheet = document.getElementById(`web-sheet-${id}`);
  if (sheet) sheet.classList.add("active");
  const titles = { home:"Home", closet:"My Closet", assistant:"AI Stylist",
                   looks:"My Looks", add:"Add a Garment" };
  const mobileTitle = document.getElementById("mobile-title");
  if (mobileTitle) mobileTitle.textContent = titles[id] || id;
  if (id === "looks") renderLooks();
  renderMobileScreen(id);
}

// ============ 7. CLOSET ============
function renderCloset(filter = "all") {
  const grid = document.getElementById("web-closet-grid");
  if (!grid) return;
  const items = wardrobe.filter(i => {
    if (filter === "all") return true;
    if (filter === "accessories") return i.category.startsWith("accessories");
    return i.category === filter;
  });
  if (!items.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
      <p>No items in this category.</p><button class="btn btn-secondary btn-small" style="margin-top:10px;" onclick="switchTab('add')">Add Garment</button></div>`;
    return;
  }
  grid.innerHTML = items.map(item => {
    const imgHTML = item.image
      ? `<img src="${item.image}" alt="${item.name}">`
      : `<div style="width:100%;height:100%;background:${item.gradient||'var(--pink-light)'};display:flex;align-items:center;justify-content:center;font-size:2.8rem;">${item.emoji||'👚'}</div>`;
    const dot = item.color ? `<span class="color-dot" style="background:${item.color}"></span>` : '';
    const fabricBadge = item.fabric ? `<span class="fabric-badge">${item.fabric}</span>` : '';
    // The AI fit button only appears on garments a ghost render can help:
    // shoes and bags are already photographed on their own and have no body to
    // fill out, so offering it there would just sell someone a render.
    const canFit = window.WornRender && window.WornRender.CAN_RENDER.has(item.category) && item.image;
    const isFitted = !!wornCutoutFor(item.id);
    const fitBtn = canFit ? `
          <button class="btn-card-action ${isFitted ? 'fit-active' : ''}" onclick="onAiFitClick('${item.id}',event)"
                  title="${isFitted ? 'AI-fitted — click to remove and use the flat photo again' : 'Re-photograph this as worn, so it sits properly on the mannequin (one AI call)'}">
            <svg class="card-icon" width="14" height="14"><use href="#icon-sparkles"></use></svg>
          </button>` : "";
    const fitBadge = isFitted ? `<span class="ai-fit-badge" title="worn shape generated by AI">✨ AI fit</span>` : "";
    return `<div class="boutique-card">
      <div class="card-img-container">${imgHTML}${fitBadge}
        <div class="card-actions">
          <button class="btn-card-action ${item.favorite?'fav-active':''}" onclick="toggleFavorite('${item.id}',event)"><svg class="card-icon" width="14" height="14"><use href="#icon-heart"></use></svg></button>${fitBtn}
          <button class="btn-card-action btn-delete" onclick="deleteItem('${item.id}',event)"><svg class="card-icon" width="14" height="14"><use href="#icon-trash"></use></svg></button>
        </div>
      </div>
      <div class="card-details">
        <span class="card-category">${dot}${item.category.replace('accessories_','')} ${fabricBadge}</span>
        <span class="card-name">${item.name}</span>
        <div class="card-tags">${item.tags.slice(0,4).map(t=>`<span class="tag-label">${t}</span>`).join('')}</div>
      </div>
    </div>`;
  }).join('');
}

/**
 * The AI-fit button on a closet card. Toggles: generate if there is no render,
 * discard if there is.
 *
 * Discarding is offered because a render costs money and can still come back
 * wrong — a garment subtly redesigned, a colour drifted — and the honest thing
 * is to let someone go back to their own photograph rather than live with it.
 */
async function onAiFitClick(id, e) {
  if (e) e.stopPropagation();
  const item = wardrobe.find(i => i.id === id);
  if (!item) return;

  if (wornCutoutFor(id)) {
    forgetWornCutout(id);
    renderCloset(getActiveFilter());
    updateMannequinRender();
    showToast("Back to your own photo of " + item.name + ".");
    return;
  }

  showToast("✨ Re-photographing " + item.name + " as worn…");
  try {
    const out = await generateWornCutout(item);
    renderCloset(getActiveFilter());
    updateMannequinRender();
    showToast("✨ " + item.name + " now has a worn shape (" + out.kb + " KB, quality " + out.quality + ").");
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("AI fit failed for", item.name, msg);
    showToast("⚠ Couldn't AI-fit " + item.name + ": " + msg);
  }
}

/**
 * Renders every garment that would actually gain from it.
 *
 * Deliberately not "every garment": a clean product shot already has body
 * shape and measures as needing almost no warping, so paying for a render of
 * it buys nothing. WornRender.worthIt decides from the fit's own effort, and
 * the count is reported before anything is spent.
 */
async function aiFitWholeCloset(force) {
  if (!window.WornRender) { showToast("⚠ The AI fit module is not loaded."); return; }
  const st = await window.WornRender.status();
  if (!st.ready) { showToast("⚠ Image generation is not configured on the server."); return; }

  const candidates = [];
  for (const item of wardrobe) {
    if (!item.image) continue;
    if (!window.WornRender.CAN_RENDER.has(item.category)) continue;
    if (wornCutoutFor(item.id)) continue;
    if (force) { candidates.push({ item, why: "asked for everything" }); continue; }
    try {
      const cut = await window.GarmentCutout.extract(item.image, { category: item.category });
      const fitted = window.GarmentFit.fit(cut, item.category, { frameWidth: 512, frameHeight: 917 });
      // Hand back what was recorded when the photograph was first parsed. This
      // re-extraction works on the stored cutout, where the repair is already
      // baked in and indistinguishable from real fabric, so it cannot rediscover
      // that any of it was hidden — and a mostly-painted garment is the best
      // reason there is to spend a render.
      if (item.occluded && cut.metrics) cut.metrics.occluded = item.occluded;
      const verdict = window.WornRender.worthIt(cut, fitted);
      if (verdict.worth) candidates.push({ item, why: verdict.why });
    } catch (e) { /* an item we cannot even measure is not one to spend on */ }
  }

  if (!candidates.length) {
    showToast("Nothing needs it — every garment already has usable shape.");
    return;
  }
  const ok = confirm("AI-fit " + candidates.length + " garment" + (candidates.length > 1 ? "s" : "") +
    "?\n\n" + candidates.map(c => "• " + c.item.name + " — " + c.why).join("\n") +
    "\n\nThat is " + candidates.length + " image-generation call" + (candidates.length > 1 ? "s" : "") +
    ", roughly $" + (candidates.length * 0.04).toFixed(2) + ", paid once and stored.");
  if (!ok) return;

  let done = 0, failed = 0;
  for (const c of candidates) {
    showToast("✨ " + (done + failed + 1) + "/" + candidates.length + ": " + c.item.name + "…");
    try { await generateWornCutout(c.item); done++; }
    catch (e) { failed++; console.warn("AI fit failed for", c.item.name, e && e.message); }
    renderCloset(getActiveFilter());
  }
  updateMannequinRender();
  showToast("✨ AI-fitted " + done + " garment" + (done === 1 ? "" : "s") +
            (failed ? ", " + failed + " failed" : "") + ".");
}

function toggleFavorite(id, e) {
  e?.stopPropagation();
  const item = wardrobe.find(i => i.id === id);
  if (item) item.favorite = !item.favorite;
  saveWardrobeData(); renderCloset(getActiveFilter()); updateStats();
  renderMobileScreen(document.querySelector(".nav-btn.active")?.dataset.target);
}

function deleteItem(id, e) {
  e?.stopPropagation();
  if (!confirm("Remove this garment from closet?")) return;
  wardrobe = wardrobe.filter(i => i.id !== id);
  for (let s in activeOutfit.slots) { if (activeOutfit.slots[s].itemId === id) { activeOutfit.slots[s].itemId = null; activeOutfit.slots[s].locked = false; }}
  if (manualBaseItem?.id === id) clearManualBaseItem();
  saveWardrobeData(); renderCloset(getActiveFilter()); updateStats();
  renderSlotControls(); renderOutfitBreakdown();
  renderMobileScreen(document.querySelector(".nav-btn.active")?.dataset.target);
}

function getActiveFilter() { return document.querySelector("#web-filter-tabs .filter-btn.active")?.dataset.category || "all"; }

/* The next three exist because the phone pane needs to DO these things, not
   just show that they exist. Each moves the app's real state and then lets both
   front ends redraw from it, so the dashboard's filter pills and the phone's
   filter chips cannot disagree about which filter is on. */

function filterCloset(category) {
  document.querySelectorAll("#web-filter-tabs .filter-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.category === category));
  renderCloset(category);
  renderMobileScreen("closet");
}

function setExtractionMode(mode) {
  extractionMode = mode || "top";
  document.querySelectorAll(".btn-mode-pill").forEach(p =>
    p.classList.toggle("active", p.dataset.mode === extractionMode));
  // re-isolating on a mode change is the dashboard's behaviour; match it
  if (currentRawImageSrc) runExtractionPipeline(currentRawImageSrc, null, null, extractionMode);
  renderMobileScreen("add");
}

/** Style the whole outfit around one garment, from either front end. */
function styleAroundItem(id) {
  selectManualBaseItem(id);
  switchTab("assistant");
  shuffleOutfit();
}

// ============ 8. GARMENT ISOLATION — ADAPTER OVER garment-engine.js ============
// Every pixel decision lives in the GarmentEngine service (garment-engine.js):
// it parses the photo into background / hair / skin / clothes, splits the
// outfit into individual garments and mattes the chosen one onto transparency.
// This layer only translates between the app's vocabulary and the engine's.

let engineReady = null;

function warmUpGarmentEngine() {
  if (!window.GarmentEngine) return Promise.resolve({ backend: "unavailable" });
  if (!engineReady) engineReady = window.GarmentEngine.warmup().catch(() => ({ backend: "heuristic" }));
  return engineReady;
}

// the focus pills speak in engine modes; the vision model speaks in categories
const MODE_FOR_CATEGORY = {
  tops: "top", bottoms: "bottom", dresses: "dress", jackets: "jacket",
  footwear: "footwear", bags: "bag",
  accessories_necklace: "accessory", accessories_bracelet: "accessory",
  accessories_headwear: "accessory"
};
const CATEGORY_FOR_MODE = {
  top: "tops", bottom: "bottoms", dress: "dresses", jacket: "jackets",
  footwear: "footwear", bag: "bags", accessories: "accessories_necklace",
  accessory: "accessories_necklace", full: "dresses"
};

/* Words that would describe every garment and so describe none. The app filters
   them as well as the prompt forbidding them, because a tag can arrive from a
   model that ignored the instruction, from a fabric name, or from a colour
   name — and one list checked at the one place tags are built is easier to
   trust than three polite requests. */
const BANNED_TAG_WORDS = new Set([
  "chic", "boutique", "stylish", "trendy", "fashionable", "versatile",
  "beautiful", "pretty", "nice", "modern", "sleek", "custom",
  "garment", "clothing", "outfit", "item", "fashion", "wardrobe", "fabric"
]);

const CATEGORY_TAG = {
  tops: "top", bottoms: "bottom", dresses: "dress", jackets: "jacket",
  bags: "bag", footwear: "footwear",
  accessories_necklace: "necklace", accessories_bracelet: "bracelet",
  accessories_headwear: "headwear"
};

/* ---- tagging ------------------------------------------------------------

   WHAT A TAG IS FOR, and what the old tagger got wrong.

   Tags are the only thing the stylist scores a garment on. `tagInPrompt`
   compares a tag against the individual words the wearer typed, and
   `tagMatchesVibe` looks it up in VIBE_MAP's occasion lists. So a tag earns
   its place only if it is (a) a single word someone might actually type, or
   (b) a word in one of those lists. Everything else is dead weight that
   crowds out the useful ones, because the list is capped.

   Measured on the eighteen garment photographs this app ships, the tagger
   this replaces produced:

       chic       18/18   100%     hardcoded as the first tag, unconditionally
       minimal    11/18    61%     the fabric guess's else branch
       boutique   11/18    61%     the same else branch

   "chic" and "boutique" appear in no occasion list and in nobody's search, so
   they matched nothing while occupying two of five slots. "minimal" IS in the
   casual list — which made it worse than useless: on three garments in five it
   pushed every casual outfit towards no garment in particular.

   The fabric guess behind that else branch is a four-rung ladder off a single
   luminance-variance number, whose bottom rung is "Fine Woven Fabric" — every
   smooth, non-dark garment, which is most product photography. And it invented
   adjectives from it ("minimal", "boutique", "sleek") rather than naming the
   fabric, so nothing survived that a person would search for.

   What replaces it, in order of how much it is trusted:

     1. the vision model's own words. It has seen the photograph, and it is
        given the stylist's vocabulary to choose from (vlm-service.js), so what
        comes back is matchable by construction.
     2. the fabric, as the fabric's NAME — leather, denim, knit, linen — which
        are words people type, and four of which are in VIBE_MAP. Where the
        material is unrecognisable, this contributes nothing rather than an
        adjective.
     3. the colour, as a single word plus its family (see colourFamily).
     4. the category.

   Without a vision model an upload now gets three or four true tags instead of
   five with two lies in them. That is the trade, and it is the right way round:
   a tag that matches nothing is not free, it displaces one that would. */

/** Fabric words worth having: what people type, and what VIBE_MAP knows. */
const FABRIC_WORDS = [
  "leather", "suede", "denim", "linen", "cotton", "silk", "satin", "wool",
  "cashmere", "knit", "ribbed", "chiffon", "velvet", "lace", "tweed",
  "corduroy", "jersey", "twill", "fleece", "mesh", "sequin"
];

/**
 * The colour word a wearer would type.
 *
 * Needed because the colour NAME is drawn from a twenty-bucket table whose
 * entries include "Rosewood", "Butter", "Camel" and "Periwinkle". Those are
 * fine as labels and useless as tags: nobody searches for butter, and
 * `tagInPrompt` splits the prompt on whitespace so a two-word name like
 * "Light Grey" can never match anything at all. A family word alongside the
 * name makes "something brown" and "a yellow top" work.
 */
function colourFamily(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const L = l * 100, S = s * 100;

  /* The thresholds are set for the MEAN colour of a cutout, which is not the
     same thing as a colour swatch, and getting that wrong is what the first
     version did. A white top photographed with its own folds and shadows
     averages around L 80, not L 95 — measured: 205,205,201 for the white
     ribbed top, 226,226,225 for the linen blouse — so a "white" test needing
     L above 90 fired on nothing, and three white garments were all tagged
     grey. Black is the same story from the other end: real blacks came in at
     L 18 and L 21, so a cut-off at 14 sent two of three to grey. */
  if (L > 78 && S < 15) return "white";
  /* Dark AND colourless. The saturation half is not decoration: raising the
     lightness cut-off to catch real blacks (L 18-21) without it swallowed
     every dark colour there is — the burgundy dress at 73,13,21 (L 17) and the
     navy jacket at 26,34,48 (L 15) both came back "black", which is how a
     wardrobe ends up with one colour. Their saturations are 70% and 30%; a
     true black's is under 2%. */
  if (L < 22 && S < 20) return "black";
  if (S < 12) return "grey";

  let h = 0;
  if (d !== 0) {
    const R = r / 255, G = g / 255, B = b / 255;
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
    else if (max === G) h = ((B - R) / d + 2) / 6;
    else h = ((R - G) / d + 4) / 6;
  }
  h *= 360;

  // beige/camel/tan/cream: warm, washed out and light. A family of its own
  // because "beige" is a word people type and "brown" would be wrong for it.
  if (h >= 18 && h < 55 && S < 45 && L > 55) return "beige";
  if (h < 14 || h >= 346) {
    // A pale red is pink, and by hue alone it is not distinguishable from one:
    // the pink knit top measures 233,194,195, which is hue 358 — squarely in
    // the red band. Lightness is what separates them.
    return L > 70 ? "pink" : "red";
  }
  if (h < 40) return L < 45 ? "brown" : "orange";
  if (h < 66) {
    // A dark, muted yellow is olive, and olive is green to anyone looking at
    // it: the olive turtleneck measures 77,74,45, hue 54, which the hue bands
    // alone call yellow.
    return L < 40 ? "green" : "yellow";
  }
  if (h < 160) return "green";
  if (h < 250) return "blue";
  if (h < 292) return "purple";
  return "pink";
}

function buildTagList(extracted, vision) {
  const seen = new Set();
  const tags = [];
  const add = (word) => {
    if (!word) return;
    const t = String(word).trim().toLowerCase();
    // single words only: the prompt is split on whitespace, so "light grey"
    // could never be matched by anything the wearer types
    if (t.length < 3 || /\s/.test(t) || seen.has(t)) return;
    if (BANNED_TAG_WORDS.has(t)) return;
    seen.add(t);
    tags.push(t);
  };

  // 1. what the model saw, which is the only source that looked at the photo
  for (const t of (vision && vision.styleTags) || []) add(t);

  /* 2. the fabric, named rather than characterised — and only where the name
        is EVIDENCE.

        The vision model looked at the weave, so its material is taken as
        given. The engine's is a four-rung ladder, and only two of those rungs
        measure anything: "Ribbed Knit / Textured" and "Soft Cotton Knit" come
        from luminance variance, while "Smooth Twill" is returned for any
        garment whose colour is black or charcoal and "Fine Woven Fabric" is
        the catch-all for everything else. Reading a fabric out of those two is
        reading it out of the colour, and it showed: a silk camisole, a leather
        skirt and a pair of leather boots were all tagged "twill" because all
        three are black. So the engine may only contribute the words its own
        texture measurement supports. */
  const visionMaterial = (vision && vision.material || "").toLowerCase();
  const engineFabric = (extracted.fabric || "").toLowerCase();
  const measuredByEngine = /ribbed|textured|knit/.test(engineFabric);
  const material = visionMaterial || (measuredByEngine ? engineFabric : "");
  let fabricsAdded = 0;
  for (const word of FABRIC_WORDS) {
    if (fabricsAdded >= 2) break;
    if (material.includes(word)) { add(word); fabricsAdded++; }
  }

  // 3. colour: the family always, the specific name when it is one word
  add(colourFamily(extracted.color && extracted.color.hex));
  add((vision && vision.colorName) || (extracted.color && extracted.color.name));

  // 4. what it is
  add(CATEGORY_TAG[extracted.category]);

  return tags.slice(0, 6).join(", ");
}

/**
 * The same uncropped working frame for the human-parsing engine's results.
 *
 * That engine returns its cutout already cropped, but it also reports the crop's
 * exact position and the size of the frame it worked in (bbox.x/y and
 * bbox.procW/procH), so the full frame can be rebuilt without guessing at
 * anything. Both engines rasterise the whole photograph with the same
 * min(1, 768/longest side) and never crop that space, which is what lets one
 * paint frame serve either of them and lets the photograph's own pixels line up
 * with the cutout's exactly.
 */
function workingLayerFromEngine(src, res) {
  const bb = res && res.bbox;
  if (!bb || !res.maskCanvas || !bb.procW || !bb.procH) return null;

  // A drag box makes the engine work inside that box, so procW/procH describe
  // the box rather than the photograph and nothing here would line up with the
  // full frame. Decline, and let the caller isolate afresh for the brush.
  if (bb.cropOffset) return null;

  /* maskCanvas is NOT the working frame. It is the cutout cropped to its own
     bounding box and then, if the garment came out small, magnified by up to
     2.2x for output quality. Drawing it at the bounding box's origin at its own
     size — which is what this did first — lands the garment magnified and
     offset, so the brush could only reach the part that still fell inside the
     frame and the rest was cropped away on save. Scale it back down onto the
     box it came from instead. */
  const sx = res.maskCanvas.width / Math.max(1, bb.w);
  const sy = res.maskCanvas.height / Math.max(1, bb.h);
  // the two scales agree only if the canvas really is just the box; if a future
  // change pads it, refuse rather than misregister by the padding
  if (Math.abs(sx - sy) > 0.02 * Math.max(sx, sy)) return null;

  const cv = document.createElement("canvas");
  cv.width = bb.procW;
  cv.height = bb.procH;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(res.maskCanvas,
                0, 0, res.maskCanvas.width, res.maskCanvas.height,
                bb.x, bb.y, bb.w, bb.h);
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const alpha = new Float32Array(cv.width * cv.height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3] / 255;
  return { src, w: cv.width, h: cv.height, rgba: data, alpha };
}

/**
 * Runs modules/garment-cutout.js and describes the result the way the rest of
 * this file expects a GarmentEngine result to look, so the two isolation paths
 * stay interchangeable and nothing downstream has to know which one ran.
 */
/* Whether a photograph has a person in it — asked once per photograph.
   The studio re-runs the isolation on every preset pill, every tap and every
   Apply, all on the same picture, and the answer cannot change between them.
   Memoising it keeps the extra model call to one per upload instead of one per
   fiddle. */
const personProbeCache = new Map();

async function personInPhoto(imageSrc) {
  if (personProbeCache.has(imageSrc)) return personProbeCache.get(imageSrc);
  let verdict = { person: false, confident: false, why: "not probed" };
  try {
    await warmUpGarmentEngine();
    verdict = await window.GarmentEngine.detectPerson(imageSrc);
  } catch (e) {
    console.info("person probe failed, assuming a flat-lay:", e && e.message);
  }
  personProbeCache.set(imageSrc, verdict);
  return verdict;
}

/**
 * A box drawn in the Cutout Editor, in the units the cutout module wants.
 *
 * The editor works in source pixels and calls the fields `width`/`height`;
 * modules/garment-cutout.js works in fractions of the frame and calls them
 * `w`/`h`. Handing one straight to the other — which is what happened until
 * this existed — produces a region with `w` undefined and an `x` of several
 * hundred, so the module looked for the garment far outside the picture and
 * reported "nothing found inside the region". Every boxed extraction failed
 * that way, which is why a dragged box behaved worse than no box at all.
 * A vision model's region is already normalised and does not come through here.
 */
async function regionFromCropBox(imageSrc, cropBox) {
  if (!cropBox) return null;
  const img = await loadImageCached(imageSrc);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  return { x: cropBox.x / w, y: cropBox.y / h, w: cropBox.width / w, h: cropBox.height / h };
}

async function cutoutViaModules(imageSrc, region, category) {
  const cut = await window.GarmentCutout.extract(imageSrc, {
    region: region || undefined,
    category,
    // keep the uncropped frame so the retouch brush can paint back fabric the
    // crop threw away, without having to isolate the photo a second time
    keepWorking: true,
    outputMaxDim: 720
  });
  currentWorkingLayer = cut.working
    ? { src: imageSrc, w: cut.working.w, h: cut.working.h,
        rgba: cut.working.rgba, alpha: cut.working.alpha }
    : null;
  const ctx = cut.canvas.getContext("2d", { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, cut.width, cut.height).data;

  // the garment's colour, from the opaque middle of it: edge pixels are part
  // backdrop however carefully they were matted
  let r = 0, g = 0, b = 0, n = 0;
  for (let p = 0; p < cut.width * cut.height; p++) {
    if (px[p * 4 + 3] < 250) continue;
    r += px[p * 4]; g += px[p * 4 + 1]; b += px[p * 4 + 2]; n++;
  }
  n = Math.max(1, n);
  const colour = window.GarmentEngine
    ? window.GarmentEngine.describeColor(r / n, g / n, b / n)
    : { hex: "#8F9E8B", name: "Custom" };

  const warnings = [];
  if (cut.metrics.quality < 70) warnings.push("the garment's edge is faint against the backdrop");

  return {
    image: window.GarmentCutout.toRecord(cut).image,
    category,
    color: colour,
    fabric: "Fabric",
    bbox: { w: cut.width, h: cut.height },
    metrics: cut.metrics,
    backend: "watershed",
    warnings
  };
}

/**
 * Isolates one garment from a photo and returns it as a transparent cutout,
 * described the way the upload form expects.
 * options: { cropBox, targetMode, fileName, hintPoint }
 */
async function extractGarment(imageSrc, options = {}) {
  const { cropBox = null, targetMode = "top", fileName = "", hintPoint = null } = options;

  if (!window.GarmentEngine) {
    return { image: imageSrc, name: fileName || "Garment", category: "tops",
             color: "#8F9E8B", colorName: "Custom", fabric: "Cotton", tags: "casual",
             failed: true, warnings: ["garment-engine.js did not load"] };
  }

  await warmUpGarmentEngine();

  // Ask a vision model what the photo is actually of and where that item sits.
  // It settles the two things pixels alone keep getting wrong: which piece the
  // photo is about, and where its edge is when garment and backdrop are the
  // same colour. A box the user drew, or a garment they tapped, outranks it.
  let vision = null;
  if (window.VlmService && !cropBox && !hintPoint) {
    try {
      setLoaderStatus("Looking at the photo…", "Identifying the garment");
      vision = await window.VlmService.analyzeGarment(imageSrc);
    } catch (e) {
      console.info("vision analysis unavailable:", e && e.message);
    }
  }

  let extracted;
  /* WHICH PATH, and why a drawn box is not the answer.
     The backdrop-flood path is for photographs with a flat backdrop and no
     wearer; the human-parsing path is for photographs of someone dressed. The
     old test was "did the user drag a box", which conflates two unrelated
     things: a box says WHERE the garment is, not what else is in the frame.
     Drawing one round a garment being worn therefore sent the photo to the
     flood path — which knows nothing of hair or skin and cannot put back the
     fabric a fringe or a hand was standing in front of. So the picture is
     asked directly, and only when the vision model has not already said. */
  let personHere = null;
  if (cropBox && !hintPoint && !(vision && vision.region) && window.GarmentEngine) {
    personHere = await personInPhoto(imageSrc);
  }
  const boxed = (vision && vision.region && !vision.onBody) ||
                (cropBox && !hintPoint && !(personHere && personHere.person));
  if (boxed && window.GarmentCutout && window.Watershed) {
    // A product shot or flat-lay. This goes to the cutout module rather than
    // the human-parsing engine: there is no body in the frame for the parser to
    // find, and the one thing that IS reliable — the backdrop being flat — is
    // exactly what modules/seg-watershed.js works from. It is also the path
    // that gets white-on-white right, which the colour-based one never did.
    setLoaderStatus("Cutting out the " + ((vision && vision.label) || "garment") + "…",
                    "Backdrop-flood segmentation");
    try {
      const region = (vision && vision.region) ||
                     await regionFromCropBox(imageSrc, cropBox);
      extracted = await cutoutViaModules(imageSrc, region,
                                         (vision && vision.category) || CATEGORY_FOR_MODE[targetMode] || "tops");
      if (extracted.metrics && extracted.metrics.quality < 50) {
        throw new Error("backdrop cutout scored only " + extracted.metrics.quality);
      }
    } catch (e) {
      /* THE FLAT-BACKDROP ASSUMPTION DID NOT HOLD, so stop assuming it.
         Dragging a box is not a statement about the photograph — it says
         "the garment is in here", nothing about what else is. A box drawn
         round someone WEARING the garment sent the photo down this path, where
         there is no backdrop to flood and no notion of hair or skin, and it
         came back with "nothing found inside the region": the whole upload
         failed. Worse, when it did not fail outright it silently skipped the
         occlusion repair, which lives on the parsing path — so hair and hands
         were cut out of the garment and nothing put them back.
         Falling through to human parsing costs one extra pass on a photo that
         was not going to work anyway, and the box is honoured either way. */
      console.info("backdrop cutout declined, using human parsing instead:", e && e.message);
      setLoaderStatus("Isolating the garment…", "Human parsing and matting");
      // `cropBox` is in source pixels and a vision `region` is normalised, so
      // the region is handed over as a hint point instead of being converted —
      // which is what the parsing branch below does with it anyway.
      extracted = await window.GarmentEngine.extract(imageSrc, {
        mode: (vision && vision.category) ? MODE_FOR_CATEGORY[vision.category] || targetMode : targetMode,
        cropBox,
        hintPoint: (vision && vision.region)
          ? { x: vision.region.x + vision.region.w / 2, y: vision.region.y + vision.region.h / 2 }
          : null,
        background: "transparent",
        padding: 0,
        outputMaxDim: 720
      });
      currentWorkingLayer = workingLayerFromEngine(imageSrc, extracted);
    }
  } else if (vision && vision.region && !vision.onBody) {
    setLoaderStatus("Cutting out the " + (vision.label || "garment") + "…", "Box-guided isolation");
    extracted = await window.GarmentEngine.extractObject(imageSrc, {
      region: vision.region,
      category: vision.category || CATEGORY_FOR_MODE[targetMode] || "tops",
      background: "transparent",
      outputMaxDim: 720
    });
  } else {
    // someone is wearing it: the parsing model handles the body, and the
    // vision box just says which garment on it to take
    const centre = (vision && vision.region)
      ? { x: vision.region.x + vision.region.w / 2, y: vision.region.y + vision.region.h / 2 }
      : null;
    setLoaderStatus("Isolating the garment…", vision && vision.label ? vision.label : "Human parsing and matting");
    extracted = await window.GarmentEngine.extract(imageSrc, {
      mode: vision && vision.category ? MODE_FOR_CATEGORY[vision.category] || targetMode : targetMode,
      cropBox,
      hintPoint: hintPoint || centre,
      background: "transparent",
      // explicit rather than relying on the default: workingLayerFromEngine
      // maps maskCanvas back onto bbox, which is only exact with no padding
      padding: 0,
      outputMaxDim: 720
    });
    currentWorkingLayer = workingLayerFromEngine(imageSrc, extracted);
  }

  // the vision model names things better than a filename or a colour guess
  const category = (vision && vision.category) || extracted.category;
  const catLabel = (CATEGORY_TAG[category] || "Garment").replace(/^./, c => c.toUpperCase());
  const fallbackTitle = (fileName || (extracted.color.name + " " + catLabel));
  const cleanTitle = ((vision && vision.label) || fallbackTitle)
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]/g, " ")
    .replace(/^./, c => c.toUpperCase());

  const described = Object.assign({}, extracted, { category });
  return {
    image: extracted.image,
    name: cleanTitle,
    category,
    color: extracted.color.hex,
    colorName: (vision && vision.colorName) || extracted.color.name,
    fabric: (vision && vision.material) || extracted.fabric,
    /* The vision result goes in too, and that is a fix rather than a tidy-up.
       `described` carries the ENGINE's fabric, so a tagger given only that saw
       "Fine Woven Fabric" even when the model had said "Linen" — the item was
       displayed as linen and tagged as though its material were unknown. The
       model's own words were being computed, shown, and then discarded before
       the one place they were most useful. */
    tags: buildTagList(described, vision),
    quality: extracted.metrics.quality,
    // how much of this garment was hidden behind hair or a limb and had to be
    // painted back. Kept with the garment because the fact does not survive
    // re-extraction later: only the parser that saw the original photograph
    // knows what was in front of the fabric.
    occluded: extracted.metrics.occluded || 0,
    backend: extracted.backend,
    sheer: !!(vision && vision.sheer),
    vision: vision ? { label: vision.label, onBody: vision.onBody, clutter: vision.clutter } : null,
    warnings: extracted.warnings || []
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// ============ 9. UPLOAD & EXTRACTION PIPELINE ============
async function handleImageUpload(file, defaultTitle = null) {
  const reader = new FileReader();
  reader.onload = async function(e) {
    currentRawImageSrc = e.target.result;
    await runExtractionPipeline(currentRawImageSrc, null, defaultTitle || file.name, extractionMode);
  };
  reader.readAsDataURL(file);
}

async function runExtractionPipeline(rawSrc, cropBox = null, fileName = "Garment", mode = "top", hintPoint = null) {
  showLoader(`Parsing the photo for a ${mode}...`);

  // Isolation is slow enough to be overtaken. Without this counter a run
  // started before the user retouched the cutout finishes afterwards and
  // overwrites their brushwork, with no user action to explain it.
  const gen = ++extractionGen;

  let extracted;
  try {
    setLoaderStatus("Isolating the garment…", "Human parsing, garment split, edge matting");
    extracted = await extractGarment(rawSrc, { cropBox, targetMode: mode, fileName, hintPoint });
  } catch (err) {
    console.error("garment isolation failed", err);
    if (gen !== extractionGen) return;
    showPreview(rawSrc);
    currentUploadedImage = rawSrc;
    // the raw photo is NOT a cutout, and nothing downstream can tell by looking
    currentUploadedIsCutout = false;
    currentUploadedOccluded = 0;
    showToast("⚠ Couldn't isolate a garment here — using the photo as-is.");
    return;
  }
  if (gen !== extractionGen) return;

  setLoaderStatus("Reading colour, weave & silhouette…", `${extracted.fabric} (${extracted.colorName})`);

  currentUploadedImage = extracted.image;
  currentUploadedIsCutout = true;
  currentUploadedOccluded = extracted.occluded || 0;
  // this is the one place every "start the isolation again" route funnels
  // through — the focus pills, Full Photo, and the studio's own Apply — so
  // dropping stale brushwork here covers all of them at once
  studioState.paint = null;
  studioState.tool = null;
  showPreview(extracted.image);

  const nameInput = document.getElementById("item-name");
  const catInput = document.getElementById("item-category");
  const tagsInput = document.getElementById("item-tags");
  const colorInput = document.getElementById("item-color");
  const colorNameInput = document.getElementById("item-color-name");

  if (nameInput) nameInput.value = extracted.name || "Extracted Garment";
  if (catInput) catInput.value = extracted.category || mode;
  if (tagsInput) tagsInput.value = extracted.tags || "casual, boutique";
  if (colorInput) colorInput.value = extracted.color || "#C86446";
  if (colorNameInput) colorNameInput.value = extracted.colorName || "Custom";

  const label = (extracted.vision && extracted.vision.label)
    ? extracted.vision.label
    : (extracted.category || mode).replace("accessories_", "").toUpperCase();
  if (extracted.backend === "heuristic") {
    showToast("⚠ Isolation model unavailable — used the colour fallback. Reconnect once and it gets precise.");
  } else if (extracted.quality != null && extracted.quality < 70) {
    showToast(`⚠ Isolated ${label}, but the edges look rough — try the Cutout Studio.`);
  } else if (currentUploadedOccluded > 0.05) {
    // Say it. The repair is meant to be invisible, which is exactly why the
    // wearer should be told that a sixth of what they are looking at was
    // painted from the surrounding weave rather than photographed.
    showToast(`✨ Isolated ${label} — hair or an arm hid ` +
              Math.round(currentUploadedOccluded * 100) +
              `% of it, painted back from the fabric around it.`);
  } else {
    showToast(`✨ Isolated ${label} — ${extracted.fabric}, ${extracted.colorName}.`);
  }
  if (extracted.warnings && extracted.warnings.length) console.info("isolation notes:", extracted.warnings);
}

function simulatePresetUpload(preset) {
  currentRawImageSrc = preset.image;
  showLoader("Loading sample garment...");
  setTimeout(() => {
    setLoaderStatus("Matching the catalogue entry...", "Clean studio presentation");
    setTimeout(() => {
      currentUploadedImage = preset.image;
      // a sample garment is the catalogue photograph itself, background and all
      currentUploadedIsCutout = false;
      currentUploadedOccluded = 0;
      showPreview(preset.image);
      const nameInput = document.getElementById("item-name");
      const catInput = document.getElementById("item-category");
      const tagsInput = document.getElementById("item-tags");
      const colorInput = document.getElementById("item-color");
      const colorNameInput = document.getElementById("item-color-name");
      const favInput = document.getElementById("item-favorite");

      if (nameInput) nameInput.value = preset.name;
      if (catInput) catInput.value = preset.category;
      if (tagsInput) tagsInput.value = preset.tags;
      if (colorInput) colorInput.value = preset.color;
      if (colorNameInput) colorNameInput.value = preset.colorName;
      if (favInput) favInput.checked = true;
      showToast("✨ Sample garment loaded!");
    }, 200);
  }, 300);
}

function showLoader(msg) {
  const prompt = document.querySelector(".dropzone-prompt");
  const preview = document.getElementById("dropzone-preview");
  const loader = document.getElementById("dropzone-loader");
  if (prompt) prompt.style.display = "none";
  if (preview) preview.style.display = "none";
  if (loader) loader.style.display = "flex";
  setLoaderStatus(msg);
}

function setLoaderStatus(msg, submsg = "On-device garment isolation") {
  const status = document.getElementById("loader-status");
  const sub = document.getElementById("loader-substatus");
  if (status) status.textContent = msg;
  if (sub) sub.textContent = submsg;
}

function showPreview(src) {
  const loader = document.getElementById("dropzone-loader");
  const preview = document.getElementById("dropzone-preview");
  const img = document.getElementById("preview-img");
  if (loader) loader.style.display = "none";
  if (preview) preview.style.display = "flex";
  if (img) img.src = src;
}

function resetUploadState() {
  currentRawImageSrc = null;
  currentUploadedImage = null;
  currentUploadedIsCutout = false;
  currentWorkingLayer = null;
  currentUploadedOccluded = 0;
  studioState.box = null;
  // all three describe the garment being replaced, and a paint layer left
  // behind would be committed against the next photograph's name and category
  studioState.paint = null;
  studioState.tool = null;
  studioState.hint = null;
  studioState.previewResult = null;
  const prompt = document.querySelector(".dropzone-prompt");
  const loader = document.getElementById("dropzone-loader");
  const preview = document.getElementById("dropzone-preview");
  const img = document.getElementById("preview-img");
  if (prompt) prompt.style.display = "block";
  if (loader) loader.style.display = "none";
  if (preview) preview.style.display = "none";
  if (img) img.src = "";
  ["item-name","item-tags","item-color-name"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const cat = document.getElementById("item-category");
  const col = document.getElementById("item-color");
  const fav = document.getElementById("item-favorite");
  if (cat) cat.value = "tops";
  if (col) col.value = "#8F9E8B";
  if (fav) fav.checked = false;
}

function saveUploadedItem() {
  const nameInput = document.getElementById("item-name");
  const name = nameInput ? nameInput.value.trim() : "";
  if (!name) { alert("Please enter a name for your garment."); return; }
  const newItem = {
    id: "u_" + Date.now(),
    name,
    category: document.getElementById("item-category")?.value || "tops",
    tags: (document.getElementById("item-tags")?.value || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean),
    color: document.getElementById("item-color")?.value || "#8F9E8B",
    colorName: document.getElementById("item-color-name")?.value.trim() || "Custom",
    favorite: document.getElementById("item-favorite")?.checked || false,
  };
  if (currentUploadedImage) {
    newItem.image = currentUploadedImage;
    // Records whether this picture has already had its background removed. A
    // failed isolation parks the raw photo in the same variable, and both end
    // up as data URLs, so the mannequin cannot tell them apart by looking — and
    // it must isolate one and never the other.
    newItem.isolated = currentUploadedIsCutout;
    if (currentUploadedOccluded > 0.01) newItem.occluded = +currentUploadedOccluded.toFixed(4);
  } else {
    newItem.emoji = getEmojiForCategory(newItem.category);
    newItem.gradient = "linear-gradient(135deg,#fce4ec,#f8bbd0)";
  }

  // Persist FIRST, mutate after. A full closet made setItem throw out of here
  // with the garment already pushed onto the array: no toast, no tab switch,
  // and a Save button that added another copy on every further click.
  const pending = [newItem].concat(wardrobe);
  if (!saveWardrobeData(pending)) return;
  wardrobe = pending;
  resetUploadState();
  renderCloset("all");
  updateStats();
  switchTab("closet");
  showToast("🌸 Garment hung in your digital closet!");
}

function getEmojiForCategory(c) {
  return {
    tops: "👚",
    bottoms: "👖",
    dresses: "👗",
    footwear: "👠",
    bags: "👜",
    jackets: "🧥",
    accessories_necklace: "📿",
    accessories_bracelet: "💎",
    accessories_headwear: "👒"
  }[c] || "✨";
}

// ============ 10. INTERACTIVE PRECISION CUTOUT STUDIO ============
function openStudioModal() {
  if (!currentRawImageSrc) return;
  const modal = document.getElementById("crop-modal");
  const canvas = document.getElementById("crop-canvas");
  const wrapper = document.getElementById("crop-canvas-wrapper");
  const box = document.getElementById("crop-box");
  if (!modal || !canvas || !wrapper || !box) return;

  modal.style.display = "flex";
  box.style.display = "none";
  studioState.box = null;
  studioState.hint = null;
  studioState.previewResult = null;
  // Clear the paint layer before anything is shown. The canvas still holds the
  // previous garment's bitmap until img.onload fires, and a paint buffer sized
  // from it would be the wrong shape for this photograph.
  studioState.paint = null;
  studioState.tool = null;
  studioState.stroke = null;
  studioState.rawImage = null;
  studioState.gen++;
  document.querySelectorAll(".btn-paint").forEach(b => b.classList.remove("active"));
  document.getElementById("crop-canvas-wrapper")?.classList.remove("painting");
  refreshPaintControls();
  const dot = document.getElementById("studio-hint-dot");
  if (dot) dot.style.display = "none";
  const prev = document.getElementById("studio-preview-img");
  if (prev) { prev.style.display = "none"; prev.src = ""; }
  const st = document.getElementById("studio-status");
  if (st) st.textContent = "Tap the garment you want, or drag a box around it.";

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const maxW = 580, maxH = 380;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const scale = Math.min(maxW / w, maxH / h, 1);

    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    studioState.scale = scale;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    studioState.rawImage = img;

    setupStudioCanvasEvents(wrapper, canvas);
    setStudioPreset(extractionMode || "top");
  };
  // Without this a photo that fails to decode leaves the studio fully
  // interactive over whatever the canvas last held — the previous garment.
  img.onerror = () => {
    closeStudioModal();
    showToast("⚠ Couldn't open that photo in the studio.");
  };
  img.src = currentRawImageSrc;
}

/**
 * The studio pills pick WHICH garment to isolate, not a rectangle to crop —
 * the engine finds the garment's own outline, so a hand-drawn box would only
 * fight it. "Custom Drag Box" is still there for awkward photos.
 */
const STUDIO_PRESET_BUTTONS = {
  top: "tool-top-preset",
  bottom: "tool-bottom-preset",
  dress: "tool-dress-preset",
  jacket: "tool-jacket-preset",
  footwear: "tool-shoes-preset",
  custom: "tool-custom-box"
};

function setStudioPreset(preset) {
  studioState.activePreset = preset;
  document.querySelectorAll(".btn-tool-pill").forEach(b => b.classList.remove("active"));
  document.getElementById(STUDIO_PRESET_BUTTONS[preset] || "")?.classList.add("active");

  const box = document.getElementById("crop-box");
  const status = document.getElementById("studio-status");
  const dot = document.getElementById("studio-hint-dot");
  if (!box) return;

  box.style.display = "none";
  studioState.box = null;

  if (preset === "custom") {
    studioState.hint = null;
    if (dot) dot.style.display = "none";
    if (status) status.textContent = "Drag a box around the garment, then apply.";
    return;
  }

  // keep the main uploader pills in step with the studio choice
  extractionMode = preset;
  document.querySelectorAll(".btn-mode-pill").forEach(p => {
    p.classList.toggle("active", p.dataset.mode === preset);
  });

  studioState.hint = null;
  if (dot) dot.style.display = "none";
  previewStudioSelection();
}

function setupStudioCanvasEvents(wrapper, canvas) {
  const box = document.getElementById("crop-box");

  const getCanvasPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(canvas.height, e.clientY - rect.top))
    };
  };

  // The canvas is centred inside the wrapper, so overlays (the drag box, the
  // tap marker) have to be shifted by that gap or they land off to the side.
  const overlayOffset = () => ({ left: canvas.offsetLeft, top: canvas.offsetTop });
  const place = (el, x, y) => {
    const off = overlayOffset();
    el.style.left = `${x + off.left}px`;
    el.style.top = `${y + off.top}px`;
  };

  // The brush rides the SAME three handler properties as the drag box and the
  // tap. Assigning them replaces rather than accumulates, and this function
  // re-runs on every modal open, so adding the brush with addEventListener
  // instead would leave one extra live copy behind each time the studio was
  // opened.
  wrapper.onmousedown = (e) => {
    if (studioState.tool && studioState.paint) { paintPointerDown(e, canvas); return; }
    studioState.isDragging = true;
    const pos = getCanvasPos(e);
    studioState.startX = pos.x;
    studioState.startY = pos.y;
    studioState.moved = false;
    box.style.display = "block";
    place(box, studioState.startX, studioState.startY);
    box.style.width = "0px";
    box.style.height = "0px";
    document.querySelectorAll(".btn-tool-pill").forEach(b => b.classList.remove("active"));
    document.getElementById("tool-custom-box")?.classList.add("active");
  };

  wrapper.onmousemove = (e) => {
    if (studioState.tool && studioState.paint) { paintPointerMove(e, canvas); return; }
    if (!studioState.isDragging) return;
    const pos = getCanvasPos(e);
    if (Math.abs(pos.x - studioState.startX) > 4 || Math.abs(pos.y - studioState.startY) > 4) {
      studioState.moved = true;
      studioState.hint = null;
    }
    const x = Math.min(studioState.startX, pos.x);
    const y = Math.min(studioState.startY, pos.y);
    const w = Math.abs(pos.x - studioState.startX);
    const h = Math.abs(pos.y - studioState.startY);

    place(box, x, y);
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;

    studioState.box = {
      x: x / studioState.scale,
      y: y / studioState.scale,
      width: w / studioState.scale,
      height: h / studioState.scale
    };
  };

  // A click without a drag is "select this thing" — the long-press object
  // pick from a phone gallery. The tap tells the engine which garment the
  // user means; everything else is decided by the engine itself.
  wrapper.onmouseup = (e) => {
    if (studioState.tool && studioState.paint) { endStudioStroke(); return; }
    const wasDragging = studioState.isDragging;
    studioState.isDragging = false;
    if (!wasDragging || studioState.moved) return;
    const pos = getCanvasPos(e);
    studioState.hint = { x: pos.x / canvas.width, y: pos.y / canvas.height };
    studioState.box = null;
    box.style.display = "none";
    document.querySelectorAll(".btn-tool-pill").forEach(b => b.classList.remove("active"));
    const off = overlayOffset();
    showStudioHintMarker(pos.x + off.left, pos.y + off.top);
    previewStudioSelection();
  };

  // A stroke released outside the wrapper — over the modal's own chrome, or
  // off the window entirely — never reaches the wrapper's mouseup, and the
  // brush would then still be down the next time the pointer merely hovered
  // over the canvas. Ending it here as well covers that; endStudioStroke is
  // idempotent precisely because both fire for an ordinary stroke.
  window.onmouseup = () => {
    studioState.isDragging = false;
    endStudioStroke();
  };
}

function showStudioHintMarker(x, y) {
  const wrapper = document.getElementById("crop-canvas-wrapper");
  if (!wrapper) return;
  let dot = document.getElementById("studio-hint-dot");
  if (!dot) {
    dot = document.createElement("div");
    dot.id = "studio-hint-dot";
    dot.className = "studio-hint-dot";
    wrapper.appendChild(dot);
  }
  dot.style.display = "block";
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
}

/** Runs the engine on the tapped point and previews the cutout in the studio. */
async function previewStudioSelection() {
  const canvas = document.getElementById("crop-canvas");
  const status = document.getElementById("studio-status");
  if (!currentRawImageSrc || !canvas || !window.GarmentEngine) return;
  if (status) status.textContent = "Isolating what you tapped…";
  try {
    const res = await window.GarmentEngine.extract(currentRawImageSrc, {
      mode: extractionMode || "auto",
      hintPoint: studioState.hint,
      outputMaxDim: 480
    });
    studioState.previewResult = res;
    const prev = document.getElementById("studio-preview-img");
    if (prev) { prev.src = res.image; prev.style.display = "block"; }
    if (status) {
      status.textContent = `Selected: ${res.color.name} ${res.mode} · edge quality ${res.metrics.quality}/100`;
    }
  } catch (err) {
    if (status) status.textContent = "Nothing to isolate there — try another spot.";
  }
}

/* ---------------------------------------------------------------- retouch --
   Erase what is not the garment, paint back what the isolation removed.

   Everything below is a thin wrapper over modules/cutout-paint.js: this file
   turns a pointer into a fraction and hands it over. The module holds the mask
   and does the image work, which is what lets the lab harness drive the exact
   same primitive a finger does, with no test-only code path.
-------------------------------------------------------------------------- */

const PAINT_TOOL_BUTTONS = {
  erase: "tool-paint-erase",
  draw: "tool-paint-draw",
  fill: "tool-paint-fill"
};

/**
 * Builds the paint layer, once per photo.
 *
 * It needs the isolation's own uncropped output — not the raw photograph —
 * because the isolation repairs things: a neckline whose backdrop was cut away,
 * a gap that was filled in. Rebuilding the cutout from the original file would
 * bring the studio white back inside those repairs.
 *
 * The raw photograph is loaded alongside as the Draw Back brush's colour
 * source, which is the whole of that tool: a drawn-back pixel simply IS the
 * photograph's pixel, so there is no synthesis and no registration arithmetic.
 */
async function ensurePaintLayer() {
  if (studioState.paint) return studioState.paint;
  if (!window.CutoutPaint || !currentRawImageSrc) return null;

  let layer = currentWorkingLayer;
  if (!layer || layer.src !== currentRawImageSrc) {
    // A sample garment is loaded straight from assets/ without ever being
    // isolated, so there is no working frame to inherit. Isolate it now rather
    // than paint on an opaque rectangle.
    if (!window.GarmentCutout || !window.Watershed) return null;
    const status = document.getElementById("studio-status");
    if (status) status.textContent = "Preparing the brush…";
    try {
      const cut = await window.GarmentCutout.extract(currentRawImageSrc, {
        category: document.getElementById("item-category")?.value || undefined,
        keepWorking: true,
        outputMaxDim: 720
      });
      if (!cut.working) return null;
      layer = { src: currentRawImageSrc, w: cut.working.w, h: cut.working.h,
                rgba: cut.working.rgba, alpha: cut.working.alpha };
      currentWorkingLayer = layer;
    } catch (e) {
      if (status) status.textContent = "Couldn't prepare the brush for this photo.";
      return null;
    }
  }

  const raw = await loadImageCached(currentRawImageSrc);
  const rawCv = document.createElement("canvas");
  rawCv.width = layer.w;
  rawCv.height = layer.h;
  const rc = rawCv.getContext("2d", { willReadFrequently: true });
  rc.drawImage(raw, 0, 0, layer.w, layer.h);

  studioState.paint = window.CutoutPaint.create({
    w: layer.w, h: layer.h,
    baseAlpha: Float32Array.from(layer.alpha),
    baseRgba: Uint8ClampedArray.from(layer.rgba),
    rawRgba: rc.getImageData(0, 0, layer.w, layer.h).data,
    radius: paintBrushRadius()
  });
  // the raw photo is the paint layer's identity: if the user loads another
  // photograph, an Apply must not commit this one's pixels under the new name
  studioState.paint.rawSrc = currentRawImageSrc;
  studioState.paint.ghost = document.getElementById("paint-ghost")?.checked !== false;
  return studioState.paint;
}

function paintBrushRadius() {
  const el = document.getElementById("paint-brush-size");
  const v = el ? parseInt(el.value, 10) : NaN;
  return isNaN(v) ? 27 : v;
}

async function setStudioTool(tool) {
  const wrapper = document.getElementById("crop-canvas-wrapper");
  document.querySelectorAll(".btn-paint").forEach(b => b.classList.remove("active"));

  if (!tool) {
    studioState.tool = null;
    if (wrapper) wrapper.classList.remove("painting");
    repaintStudioCanvas();
    return;
  }

  const gen = ++studioState.gen;
  const layer = await ensurePaintLayer();
  if (gen !== studioState.gen) return;      // the user moved on while we loaded
  if (!layer) {
    showToast("⚠ The brush needs an isolated garment — try a preset or re-upload.");
    return;
  }

  studioState.tool = tool;
  document.getElementById(PAINT_TOOL_BUTTONS[tool])?.classList.add("active");
  if (wrapper) wrapper.classList.add("painting");

  // A selection box or tap marker still on screen describes something the user
  // is no longer manipulating, and the box's own styling dims the whole canvas.
  const box = document.getElementById("crop-box");
  if (box) box.style.display = "none";
  const dot = document.getElementById("studio-hint-dot");
  if (dot) dot.style.display = "none";

  const status = document.getElementById("studio-status");
  if (status) {
    status.textContent = tool === "erase"
      ? "Brush over anything that is not the garment."
      : tool === "draw"
        ? "Brush where fabric is missing — it comes back from the photo."
        : "Brush a gap the photo never had — fabric is made up from the garment around it.";
  }
  refreshPaintControls();
  repaintStudioCanvas();
}

function refreshPaintControls() {
  const undoBtn = document.getElementById("tool-paint-undo");
  if (undoBtn) undoBtn.disabled = !(studioState.paint && studioState.paint.strokes.length);
}

/**
 * The pointer's position as a FRACTION of the photo frame, from the canvas's
 * live rectangle.
 *
 * Deliberately not studioState.scale, which relates the photo to the canvas's
 * backing store and says nothing about how large the browser is drawing that
 * canvas on screen. The canvas is laid out with max-width/max-height, so the
 * displayed size differs from the backing size on any ordinary window and a
 * brush that trusted the scale factor would paint some way off. Fractions also
 * absorb devicePixelRatio and any scrolling of the modal body for free.
 */
function paintFraction(e, canvas) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
}

function paintPointerDown(e, canvas) {
  const f = paintFraction(e, canvas);
  // The canvas is centred in a wrapper that is usually wider than it, so most
  // of the visible stage is empty gutter. A press out there is not a stroke;
  // clamping it would drop a blob on the garment's edge instead.
  if (!f || f.fx < 0 || f.fx > 1 || f.fy < 0 || f.fy > 1) return false;
  studioState.stroke = { pts: [[f.fx, f.fy]], radius: paintBrushRadius() };
  studioState.paint.stroking = true;
  drawStrokePreview();
  return true;
}

function paintPointerMove(e, canvas) {
  if (!studioState.stroke) return;
  const f = paintFraction(e, canvas);
  if (!f) return;
  // clamp DURING a stroke, so a drag that swings out over the gutter and back
  // stays one continuous stroke rather than being cut in two
  studioState.stroke.pts.push([
    Math.max(0, Math.min(1, f.fx)),
    Math.max(0, Math.min(1, f.fy))
  ]);
  drawStrokePreview();
}

/**
 * Ends the current stroke and folds it into the layer.
 *
 * Idempotent, and it has to be: the wrapper's own mouseup and the window-level
 * one both fire for an ordinary stroke, so without the early return every
 * stroke would be recorded twice and one Undo would only half undo it.
 */
function endStudioStroke() {
  if (!studioState.paint || !studioState.paint.stroking) return;
  studioState.paint.stroking = false;
  const s = studioState.stroke;
  studioState.stroke = null;
  if (!s || !studioState.tool) { repaintStudioCanvas(); return; }
  window.CutoutPaint.stroke(studioState.paint, studioState.tool, s.pts, { radius: s.radius });
  refreshPaintControls();
  repaintStudioCanvas();
  const status = document.getElementById("studio-status");
  if (status) {
    const n = studioState.paint.strokes.length;
    status.textContent = n + (n === 1 ? " brush stroke" : " brush strokes") +
      " — Apply Extraction keeps them.";
  }
}

/** Live feedback while the finger is down, without recomputing the mask. */
function drawStrokePreview() {
  repaintStudioCanvas();
  const canvas = document.getElementById("crop-canvas");
  const s = studioState.stroke;
  if (!canvas || !s) return;
  const ctx = canvas.getContext("2d");
  const rScale = canvas.width / studioState.paint.w;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = studioState.tool === "erase" ? "#ff5c8a" : "#00e676";
  for (const [fx, fy] of s.pts) {
    ctx.beginPath();
    ctx.arc(fx * canvas.width, fy * canvas.height, s.radius * rScale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Redraws the studio canvas: the photo faintly underneath, then the cutout.
 *
 * The faint photo is the point. Whether a missing piece can be painted back
 * from the photograph or has to be invented depends on whether the photograph
 * has anything there, and that is not something anyone can guess from a
 * transparent hole. Showing it turns the question into something visible before
 * the stroke lands, which is a better answer to "the back of the coat is
 * missing" than either brush.
 */
function repaintStudioCanvas() {
  const canvas = document.getElementById("crop-canvas");
  if (!canvas || !studioState.rawImage) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const paint = studioState.paint;
  const ghost = paint && paint.ghost && studioState.tool;
  if (ghost) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.drawImage(studioState.rawImage, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  } else {
    ctx.drawImage(studioState.rawImage, 0, 0, canvas.width, canvas.height);
  }

  if (paint && studioState.tool) {
    const rendered = window.CutoutPaint.render(paint);
    ctx.drawImage(rendered.canvas, 0, 0, canvas.width, canvas.height);
  }
}

function undoStudioStroke() {
  if (!studioState.paint) return;
  if (!window.CutoutPaint.undo(studioState.paint)) return;
  refreshPaintControls();
  repaintStudioCanvas();
}

function closeStudioModal() {
  const modal = document.getElementById("crop-modal");
  if (modal) modal.style.display = "none";
  // Closing without applying is the deliberate start-over: say so rather than
  // keeping invisible edits that a later Apply would commit by surprise.
  if (studioState.paint && studioState.paint.strokes.length) {
    showToast("Brush edits discarded — Apply Extraction keeps them.");
  }
  studioState.paint = null;
  studioState.tool = null;
  studioState.stroke = null;
  document.getElementById("crop-canvas-wrapper")?.classList.remove("painting");
}

/**
 * Saves the retouched cutout as it stands, without isolating anything again.
 *
 * This is the whole reason the paint layer exists: re-running the extraction
 * here would throw the brushwork away and produce exactly the cutout the user
 * had just finished correcting.
 */
async function commitPaintedCutout() {
  const paint = studioState.paint;
  const done = window.CutoutPaint.commit(paint, 720);
  if (done.empty) {
    showToast("⚠ Nothing left after erasing — undo a stroke or two.");
    return false;
  }

  const type = supportsWebpEncode() ? "image/webp" : "image/png";
  currentUploadedImage = done.canvas.toDataURL(type, 0.92);
  currentUploadedIsCutout = true;
  // a commit is newer than any extraction still in flight
  extractionGen++;
  showPreview(currentUploadedImage);

  // the garment's colour may well have changed — a sleeve painted back, a prop
  // erased — so refresh what was auto-detected, and leave the name, category
  // and tags alone because the user may have typed them
  const ctx = done.canvas.getContext("2d", { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, done.width, done.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let p = 0; p < done.width * done.height; p++) {
    if (px[p * 4 + 3] < 250) continue;
    r += px[p * 4]; g += px[p * 4 + 1]; b += px[p * 4 + 2]; n++;
  }
  if (n && window.GarmentEngine) {
    const colour = window.GarmentEngine.describeColor(r / n, g / n, b / n);
    const colorInput = document.getElementById("item-color");
    const colorNameInput = document.getElementById("item-color-name");
    if (colorInput) colorInput.value = colour.hex;
    if (colorNameInput) colorNameInput.value = colour.name;
  }

  const strokes = paint.strokes.length;
  studioState.paint = null;
  studioState.tool = null;
  showToast(`✨ Kept your ${strokes} brush stroke${strokes === 1 ? "" : "s"}.`);
  return true;
}

let webpEncodeOk = null;
function supportsWebpEncode() {
  if (webpEncodeOk === null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpEncodeOk = c.toDataURL("image/webp").indexOf("image/webp") === 5;
  }
  return webpEncodeOk;
}

function applyStudioCutout() {
  const paint = studioState.paint;
  // Only commit the brushwork if it belongs to the photo on screen. Loading a
  // second photograph does not clear the studio, so without this check an Apply
  // could store photo A's pixels under photo B's name and category.
  const painted = paint && paint.strokes.length && paint.rawSrc === currentRawImageSrc;
  if (painted) {
    const modal = document.getElementById("crop-modal");
    if (modal) modal.style.display = "none";
    studioState.tool = null;
    document.getElementById("crop-canvas-wrapper")?.classList.remove("painting");
    commitPaintedCutout();
    return;
  }
  closeStudioModal();
  if (!currentRawImageSrc) return;
  runExtractionPipeline(
    currentRawImageSrc,
    studioState.box,
    document.getElementById("item-name")?.value || "Garment",
    extractionMode,
    studioState.hint
  );
}

// ============ 11. AI STYLIST ENGINE (WITH FROZEN BASE ITEM SUPPORT) ============
const VIBE_MAP = {
  party: {
    // "clubbing" and "dancing" are listed rather than derived: the whole-word
    // rule allows kw+"ing", and doubling the consonant defeats it — club+ing
    // is "clubing". Under the old substring rule "clubbing" matched by
    // accident; the moment that went, the word stopped being understood at all.
    primary: ["party","partying","cocktail","club","clubbing","gala","nightclub",
              "celebration","dance","dancing","prom","homecoming"],
    secondary: ["sparkly","fancy","evening","night","glamorous","glitter","sequin","festive","rave"]
  },
  casual: {
    primary: ["casual","coffee","brunch","walk","errands","mall","hangout","chill","relax","lounge","grocery"],
    secondary: ["comfy","everyday","cozy","pastel","spring","minimal","clean","easy","laid-back","weekend"]
  },
  work: {
    primary: ["work","office","meeting","interview","presentation","corporate","professional","business","conference"],
    secondary: ["smart","classic","elegant","polished","crisp","structured","tailored","boardroom"]
  },
  date: {
    primary: ["date","dinner","romantic","valentine","anniversary","candlelight"],
    secondary: ["cute","flirty","sweet","charming","lovely","blush","soft","delicate"]
  },
  edgy: {
    primary: ["edgy","punk","grunge","rock","concert","gig","biker","underground","rebel"],
    secondary: ["leather","dark","black","bold","fierce","alternative","indie","metal","tattoo","edgy"]
  },
  beach: {
    primary: ["beach","pool","swim","resort","tropical","island","coast","shore","seaside","picnic"],
    secondary: ["summer","sunny","vacation","airy","light","linen","breezy","sand","surf"]
  },
  autumn: {
    primary: ["autumn","fall","harvest","thanksgiving","pumpkin","sweater-weather","terracotta","rust","brown","mocha","taupe"],
    secondary: ["warm","layering","earthy","coat","knit","wool","flannel","rustic","cabin","fireside","hiking"]
  },
  formal: {
    primary: ["formal","wedding","ceremony","gala","reception","banquet","charity","opera","theatre","ball"],
    secondary: ["elegant","sophisticated","refined","luxurious","black-tie","upscale","classy","dressy"]
  },

  /* ---- the six that were missing ------------------------------------------

     Measured on twenty realistic prompts, four scored ZERO and were styled as
     "casual" without a word of them being understood: trekking, funeral, snow
     trip, yoga class. Two more landed somewhere only by accident — "hiking in
     the hills" reached autumn because `hiking` happened to sit in its
     secondary list, and "airport travel day" reached PARTY because `travel`
     contains `rave`.

     These are the gaps that produced that: nothing for moving about, nothing
     for weather, nothing for a day of travelling, nothing for a festival, and
     nothing for an occasion that calls for restraint. Word forms are listed
     rather than derived (trek AND trekking), because deriving them is how
     substring matching gets reinvented. */

  active: {
    primary: ["gym","workout","workouts","exercise","training","sport","sports","run","running",
              "jog","jogging","yoga","pilates","hike","hiking","trek","trekking","trekked",
              "cycling","climbing","match","practice","tennis","swimming"],
    secondary: ["sporty","athletic","stretchy","breathable","comfy","jersey","mesh","fleece",
                "trainers","sneakers","leggings","joggers","active"]
  },
  cold: {
    primary: ["winter","snow","snowy","cold","chilly","freezing","ski","skiing","mountains",
              "himalayas","frost","hill-station"],
    secondary: ["warm","layering","wool","cashmere","knit","coat","thermal","scarf","boots",
                "cozy","fleece","jacket"]
  },
  rain: {
    primary: ["rain","rainy","monsoon","drizzle","storm","stormy","wet","showers","puddles"],
    secondary: ["waterproof","boots","jacket","coat","umbrella","quick-dry","dark","practical"]
  },
  travel: {
    primary: ["travel","travelling","traveling","airport","flight","flying","journey","commute",
              "commuting","train","roadtrip","transit","layover"],
    secondary: ["comfy","easy","layering","breathable","stretchy","sneakers","loose","soft"]
  },
  festive: {
    primary: ["diwali","deepavali","eid","christmas","holi","navratri","pongal","onam","puja",
              "pooja","festival","rakhi","sankranti","baisakhi","lohri"],
    secondary: ["traditional","ethnic","embroidered","silk","gold","festive","bright","ornate","kurta"]
  },
  sombre: {
    primary: ["funeral","memorial","condolence","condolences","mourning","wake","prayer","shraddh",
              "remembrance"],
    secondary: ["modest","respectful","plain","subdued","muted","covered","quiet","dark","black"]
  },
};

function extractWords(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(w => w.length > 2);
}

/**
 * Does this typed word mean this keyword?
 *
 * WHOLE WORDS, with a little tolerance for endings — and emphatically not
 * "does the word contain the keyword", which is what this replaced. That rule
 * matched any keyword hiding inside a longer word, and the results were not
 * marginal: "gym workout" scored 18 for WORK, because `workout` contains
 * `work`, so asking for gym clothes returned office wear. "airport travel
 * day" came back as a PARTY outfit, because `travel` contains `rave`. Also
 * caught in the act: workshop, datebook, partyware.
 *
 * The tolerance is deliberately small — a plural or a gerund of the keyword —
 * because anything cleverer is a stemmer, and a stemmer is how `travel` finds
 * `rave` again by another route. Where a word form matters, the vocabulary
 * lists it (trek AND trekking) rather than trusting a rule to derive it.
 */
function wordMeans(word, kw) {
  if (word === kw) return true;
  if (word === kw + "s" || word === kw + "es" || word === kw + "ing" || word === kw + "ed") return true;
  // and the other way round: "hike" typed, "hiking" in the list
  if (kw === word + "s" || kw === word + "ing" || kw === word + "ed") return true;
  return false;
}

/**
 * Which bucket the prompt belongs in, how strongly, and on what evidence.
 *
 * Returns `{vibe, score, matched, confident}`. `confident` is false when
 * nothing matched at all — which used to be indistinguishable from a
 * deliberately casual prompt, because the function started at "casual" with a
 * score of zero and returned it either way. Measured, four prompts in twenty
 * fell through that hole silently: trekking, funeral, snow trip and yoga
 * class all came back styled as "casual" with no hint that not one word had
 * been understood.
 */
/**
 * Which bucket wins when two of them score the same.
 *
 * A real question, asked constantly: "rainy day errands" matches rain and
 * casual equally, "diwali dinner" matches festive and date equally, "winter
 * wedding" matches cold and formal equally. Something has to decide, and the
 * two obvious rules are both wrong — declaration order is arbitrary (it gave
 * "autumn walk" to casual), and keyword length is a proxy for nothing ("rainy"
 * is shorter than "errands", so it lost).
 *
 * So the order is stated outright, earliest wins, and it reads as a claim
 * about clothes: an occasion with a dress code outranks the weather, and the
 * weather outranks a general mood. You would wear black to a funeral in the
 * rain, and something warm for a walk in the snow.
 */
const VIBE_PRECEDENCE = [
  "sombre", "festive", "formal", "work", "party", "date",   // occasions: a dress code
  "active", "rain", "cold", "beach",                        // conditions: a constraint
  "edgy", "autumn", "travel", "casual"                       // moods: everything else
];

function detectVibe(promptText) {
  const words = extractWords(promptText);
  const rank = v => {
    const i = VIBE_PRECEDENCE.indexOf(v);
    return i < 0 ? VIBE_PRECEDENCE.length : i;
  };
  let best = { vibe: "casual", score: 0, matched: [] };

  for (const vibe in VIBE_MAP) {
    let score = 0;
    const matched = [];
    const { primary, secondary } = VIBE_MAP[vibe];

    for (const word of words) {
      for (const kw of primary) {
        if (!wordMeans(word, kw)) continue;
        score += 10;
        matched.push(kw);
        break;
      }
      for (const kw of secondary) {
        if (!wordMeans(word, kw)) continue;
        score += 4;
        matched.push(kw);
        break;
      }
    }

    const better = score > best.score ||
                   (score === best.score && score > 0 && rank(vibe) < rank(best.vibe));
    if (better) best = { vibe, score, matched };
  }

  return { vibe: best.vibe, score: best.score, matched: best.matched,
           confident: best.score > 0 };
}

/** The bucket alone, for callers that only need that. */
function detectVibeCategory(promptText) {
  return detectVibe(promptText).vibe;
}

function tagMatchesVibe(tag, vibeCategory) {
  const vibe = VIBE_MAP[vibeCategory];
  if (!vibe) return false;
  return vibe.primary.includes(tag) || vibe.secondary.includes(tag);
}

function tagInPrompt(tag, promptWords) {
  if (tag.length < 3) return false;
  /* The same whole-word rule the bucket detector uses, and for the same
     reason. A garment tagged "work" — the beige trousers are — scored the full
     eight points on "gym workout", because the typed word contains the tag. */
  return promptWords.some(word => wordMeans(word, tag));
}

/* ---- which slots the wearer wants today -------------------------------- */

function loadSlotOptOut() {
  try {
    const raw = JSON.parse(localStorage.getItem(SLOT_OPTOUT_KEY) || "[]");
    // filter against the whitelist on the way in, so a stale key from an older
    // build cannot silently switch off something the outfit needs
    slotOptOut = new Set((Array.isArray(raw) ? raw : []).filter(c => OPTIONAL_SLOTS.has(c)));
  } catch (e) {
    slotOptOut = new Set();
  }
}

function saveSlotOptOut() {
  try {
    localStorage.setItem(SLOT_OPTOUT_KEY, JSON.stringify([...slotOptOut]));
  } catch (e) { /* a full closet should not stop the outfit changing */ }
}

/** Every place that fills or reads a slot goes through this. */
function slotIncluded(cat) { return !slotOptOut.has(cat); }

/**
 * Put a slot back in the outfit and fill just that slot.
 *
 * Deliberately NOT a call to generateOutfit. Regenerating would re-roll every
 * other unlocked slot, so adding a jacket back would silently change the top,
 * the bottoms and the shoes — and the whole point of the mannequin work is that
 * one piece changing leaves the others exactly where they were.
 */
function includeSlot(cat) {
  if (slotOptOut.delete(cat)) saveSlotOptOut();
  const slot = activeOutfit.slots[cat];
  if (!slot) return;
  slot.enabled = true;
  if (!slot.itemId) fillSlot(cat, extractWords(activeOutfit.vibe || "everyday casual"));
}

/**
 * Take a slot out of the outfit.
 *
 * The item id has to be cleared here rather than left to the fill loops: those
 * loops `continue` past a skipped slot without touching it, so a stale id would
 * keep the garment on the mannequin, in the breakdown and in the colour
 * scoring — a Remove button that visibly did nothing.
 */
function excludeSlot(cat) {
  if (!OPTIONAL_SLOTS.has(cat)) return;
  slotOptOut.add(cat);
  saveSlotOptOut();
  const slot = activeOutfit.slots[cat];
  if (!slot) return;
  slot.itemId = null;
  slot.locked = false;
}

function toggleSlotInclusion(cat) {
  if (!OPTIONAL_SLOTS.has(cat)) {
    showToast("An outfit needs this piece — it cannot be removed.");
    return;
  }
  if (slotIncluded(cat)) excludeSlot(cat); else includeSlot(cat);
  updateMannequinRender();
  renderOutfitBreakdown();
  renderSlotControls();
  updateStyleAroundControls();
  const tab = document.querySelector(".nav-btn.active")?.dataset.target;
  if (tab === "assistant") renderMobileScreen("assistant");
}

/**
 * Picks the best wardrobe item for one slot. Split out of generateOutfit so a
 * single slot can be refilled without disturbing any other.
 */
/** How well one garment suits the prompt and the rest of the look. */
function scoreItemForLook(item, cat, promptWords, noise) {
  let score = 0;
  if (item.favorite) score += 2;

  (item.tags || []).forEach(tag => {
    if (tagInPrompt(tag, promptWords)) score += 8;
    if (tagMatchesVibe(tag, currentVibeCategory)) score += 5;
  });

  for (let oc in activeOutfit.slots) {
    const os = activeOutfit.slots[oc];
    // slotIncluded matters here: this is the one slot read in the file that
    // ignores `enabled`, so without it a garment the wearer removed would
    // still be steering the colour of everything they are actually wearing
    if (os.locked && os.itemId && slotIncluded(oc) && oc !== cat) {
      const li = wardrobe.find(i => i.id === os.itemId);
      if (li?.color && item.color) score += colorHarmonyScore(li.color, item.color);
    }
  }

  if (noise) score += Math.random() * noise;
  return score;
}

/** The best garment in a category, and how well it scored. */
function bestForSlot(cat, promptWords, noise) {
  const pool = wardrobe.filter(i => i.category === cat);
  if (!pool.length) return null;
  let best = null;
  for (const item of pool) {
    const score = scoreItemForLook(item, cat, promptWords, noise);
    if (!best || score > best.score) best = { item, score };
  }
  return best;
}

function fillSlot(cat, promptWords) {
  const slot = activeOutfit.slots[cat];
  if (!slot) return false;
  const best = bestForSlot(cat, promptWords, 1.5);
  if (!best) { slot.itemId = null; return false; }
  slot.itemId = best.item.id;
  return true;
}

function generateOutfit(promptText = "", isInitial = false) {
  let vibe = (promptText || "everyday casual").toLowerCase();
  activeOutfit.vibe = vibe;
  const vibeLabel = document.getElementById("current-vibe-label");
  if (vibeLabel) vibeLabel.textContent = vibe;

  /* Say when the prompt was not understood.
     Falling back to casual is the right thing to do — an outfit is better than
     an error — but doing it silently made the app look like it had an opinion
     about trekking when it had simply not recognised the word. Measured, four
     prompts in twenty landed here. The wearer can then rephrase, which is only
     possible if they know there is something to rephrase. */
  const read = detectVibe(vibe);
  currentVibeCategory = read.vibe;
  if (!isInitial && promptText && !read.confident) {
    showToast("I don't know “" + promptText.trim().slice(0, 28) +
              "” yet — styling it as everyday casual.");
  }

  /* DRESS OR SEPARATES — decided on merit, and overridable.
     This used to be a bare keyword test: a dress appeared only if the prompt
     literally contained dress, wedding, gala, cocktail, fancy, prom or ball.
     So "date night", "birthday party" and "diwali dinner" could never produce
     one, the two dresses in the closet were all but unreachable — and because
     the controls skip a disabled slot, there was no row to turn the dress slot
     back on with. Unreachable and uncorrectable at once.
     Now: the wearer's own choice wins if they have made one; otherwise the
     keyword still forces a dress, and for any occasion where a dress is
     plausible the best dress is SCORED against the best top-and-bottom pair
     and the higher one wins. */
  const promptWordsForShape = extractWords(vibe);
  const dressyVibe = ["party", "date", "formal", "festive", "beach"].includes(currentVibeCategory);
  let useDress;
  if (outfitShape === "dress") useDress = true;
  else if (outfitShape === "separates") useDress = false;
  else if (/\b(dress|wedding|gala|cocktail|fancy|prom|ball)\b/i.test(vibe)) useDress = true;
  else if (!dressyVibe) useDress = false;
  else {
    const dress = bestForSlot("dresses", promptWordsForShape, 0);
    const top = bestForSlot("tops", promptWordsForShape, 0);
    const bottom = bestForSlot("bottoms", promptWordsForShape, 0);
    const pair = (top ? top.score : -1) + (bottom ? bottom.score : -1);
    // a dress covers one slot where separates cover two, so it is compared
    // against their average rather than their sum
    useDress = !!dress && (!top || !bottom || dress.score > pair / 2);
  }
  if (manualBaseItem) {
    if (manualBaseItem.category === "dresses") useDress = true;
    else if (["tops","bottoms"].includes(manualBaseItem.category)) useDress = false;
  }
  activeOutfit.slots.dresses.enabled = useDress;
  activeOutfit.slots.tops.enabled = !useDress;
  activeOutfit.slots.bottoms.enabled = !useDress;

  // Lock base item. Pinning a garment is unambiguous consent to wear that
  // category, so it also clears any standing opt-out — otherwise the panel
  // would show a pinned jacket while the mannequin wore none.
  if (manualBaseItem && activeOutfit.slots[manualBaseItem.category]) {
    activeOutfit.slots[manualBaseItem.category].itemId = manualBaseItem.id;
    activeOutfit.slots[manualBaseItem.category].locked = true;
    if (slotOptOut.delete(manualBaseItem.category)) saveSlotOptOut();
    activeOutfit.slots[manualBaseItem.category].enabled = true;
  }

  const promptWords = extractWords(vibe);

  for (let cat in activeOutfit.slots) {
    const slot = activeOutfit.slots[cat];
    if (!slot.enabled || slot.locked) continue;
    // a slot the wearer took out stays out, and stays empty, across every
    // generate and every shuffle until they put it back
    if (!slotIncluded(cat)) { slot.itemId = null; continue; }
    if (manualBaseItem && manualBaseItem.category === cat) {
      slot.itemId = manualBaseItem.id; slot.locked = true; continue;
    }
    fillSlot(cat, promptWords);
  }

  if (manualBaseItem && activeOutfit.slots[manualBaseItem.category]) {
    activeOutfit.slots[manualBaseItem.category].itemId = manualBaseItem.id;
    activeOutfit.slots[manualBaseItem.category].locked = true;
  }

  /* Understanding the prompt and being able to dress for it are two different
     things, and the wearer deserves to know which one failed. Adding the
     active, cold, rain and festive buckets means "trekking" is now read
     correctly — and a closet of blouses and heels still has nothing tagged for
     it, so the picks come down to favourites. Saying so is more use than
     quietly presenting office trousers as a hiking outfit. */
  if (!isInitial && promptText && read.confident) {
    const chosen = Object.keys(activeOutfit.slots)
      .filter(c => activeOutfit.slots[c].enabled && activeOutfit.slots[c].itemId)
      .map(c => wardrobe.find(i => i.id === activeOutfit.slots[c].itemId))
      .filter(Boolean);
    const onVibe = chosen.filter(i => (i.tags || []).some(t => tagMatchesVibe(t, read.vibe)));
    if (chosen.length && !onVibe.length) {
      showToast("Nothing in your closet is tagged for “" + read.vibe +
                "” — here is the closest I have.");
    }
  }

  updateMannequinRender();
  renderOutfitBreakdown();
  renderSlotControls();
  const tab = document.querySelector(".nav-btn.active")?.dataset.target;
  if (tab === "assistant") renderMobileScreen("assistant");
}

function colorHarmonyScore(hex1, hex2) {
  const a = hexToHue(hex1), b = hexToHue(hex2);
  const dist = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  if (dist < 30) return 3;
  if (dist > 150 && dist < 210) return 2;
  if (dist > 90 && dist < 150) return 1;
  return 0;
}

function hexToHue(hex) {
  if (!hex || hex.length < 7) return 0;
  return rgbToHsl(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))[0];
}

// SHUFFLE OUTFIT: Freezes manualBaseItem completely while rotating unlocked pieces!
function shuffleOutfit() {
  const prompt = document.getElementById("stylist-prompt")?.value.trim() || activeOutfit.vibe;
  const vibe = prompt.toLowerCase();
  const promptWords = extractWords(vibe);

  currentVibeCategory = detectVibeCategory(vibe);
  activeOutfit.vibe = vibe;
  const vibeLabel = document.getElementById("current-vibe-label");
  if (vibeLabel) vibeLabel.textContent = vibe;

  // STRICT GUARANTEE: Lock base item before shuffle begins
  if (manualBaseItem && activeOutfit.slots[manualBaseItem.category]) {
    activeOutfit.slots[manualBaseItem.category].itemId = manualBaseItem.id;
    activeOutfit.slots[manualBaseItem.category].locked = true;
    if (slotOptOut.delete(manualBaseItem.category)) saveSlotOptOut();
    activeOutfit.slots[manualBaseItem.category].enabled = true;
  }

  for (let cat in activeOutfit.slots) {
    const slot = activeOutfit.slots[cat];
    // Skip if disabled, taken out by the wearer, locked, or the base item
    if (!slot.enabled || !slotIncluded(cat) || slot.locked ||
        (manualBaseItem && manualBaseItem.category === cat)) continue;

    const pool = wardrobe.filter(i => i.category === cat);
    if (pool.length <= 1) continue;

    const currentItemId = slot.itemId;
    const alternates = pool.filter(i => i.id !== currentItemId);
    if (!alternates.length) continue;

    const scored = alternates.map(item => {
      let score = 0;
      if (item.favorite) score += 2;
      item.tags.forEach(tag => {
        if (tagInPrompt(tag, promptWords)) score += 8;
        if (tagMatchesVibe(tag, currentVibeCategory)) score += 5;
      });
      /* Enough noise to give a different answer, not enough to give any answer.
         This was `* 8` — exactly what a tag matching the prompt is worth — so
         one lucky roll cancelled the strongest signal the scorer has. Measured
         on "office meeting": only five of ten shuffles picked a work-tagged
         top, and a pink cable-knit came up three times. At 3 the random term
         can still reorder garments the prompt is indifferent between, which is
         what shuffling is for, but it can no longer outvote the prompt. */
      score += Math.random() * 3;
      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);
    slot.itemId = scored[0].item.id;
  }

  // Re-affirm base item slot
  if (manualBaseItem && activeOutfit.slots[manualBaseItem.category]) {
    activeOutfit.slots[manualBaseItem.category].itemId = manualBaseItem.id;
    activeOutfit.slots[manualBaseItem.category].locked = true;
  }

  updateMannequinRender();

  renderOutfitBreakdown();
  renderSlotControls();
  updateStyleAroundControls();
  const heldCount = Object.keys(activeOutfit.slots)
    .filter(c => activeOutfit.slots[c].enabled && slotIncluded(c) && activeOutfit.slots[c].locked).length;
  if (manualBaseItem) showToast(`🔄 Restyled around ${manualBaseItem.name}.`);
  else if (heldCount) showToast(`🔄 Shuffled everything except your ${heldCount} locked piece${heldCount > 1 ? "s" : ""}.`);
  else showToast("🔄 Shuffled your whole look.");
  const tab = document.querySelector(".nav-btn.active")?.dataset.target;
  if (tab === "assistant") renderMobileScreen("assistant");
}

// ============ 12. THE OUTFIT PICTURE ============

async function updateMannequinRender() {
  const img = document.getElementById("mannequin-render");
  const loader = document.getElementById("mannequin-loading");
  if (!img) return;

  currentMannequinRender = null;
  /* The button has to be told, and this is the only place that knows.
     Every route that redraws the picture — Generate, Shuffle, Wear this, a
     slot change — comes through here and lands on the flat display. Without
     this line the label was only ever updated by the render path, so after one
     render the button read "Show pieces" for the rest of the session: the
     pieces were already on screen and the button offered to show them again. */
  updateWornControls();

  /* THE FLAT DISPLAY ALWAYS COMES FIRST, even for a look already rendered.
     A previous version jumped straight to a stored render whenever one
     existed, reasoning that it was paid for and was the better picture. That
     was the wrong call: it meant a look you had rendered once could never be
     seen as its own pieces again, and "See It Worn" stopped being a thing you
     chose — the app had already decided. The two views answer different
     questions (WHICH pieces, versus how they hang), and which one you want is
     yours to say. The render is still free to come back; you just press for
     it, and the caption says when it will cost nothing. */
  if (await renderOutfitDisplay()) return;

  // Nothing to draw — an empty board, or none of the chosen pieces has a
  // photograph. An empty white board is the honest picture of that; a
  // mannequin here would put a body in a view that is deliberately not about
  // one, and a stock photograph would show clothes nobody picked.
  const caption = document.getElementById("mannequin-caption");
  if (caption) caption.textContent = currentOutfitLayers().length
    ? "None of these pieces has a photo yet — add one from My Closet."
    : "Pick some pieces and they will appear here.";

  if (loader) loader.style.display = "none";
  img.style.transition = "opacity 0.35s ease";
  if (window.OutfitDisplay) {
    currentMannequinPhoto = encodeComposite(window.OutfitDisplay.render([]).canvas);
    img.src = currentMannequinPhoto;
  } else {
    img.removeAttribute("src");
    currentMannequinPhoto = null;
  }
  img.style.opacity = "1";
  img.style.transform = "scale(1)";
}

// ============ 12b. RENDER OUTFIT (AI) ============
// Sends the bare mannequin plus the outfit's garment cutouts to an image model
// and shows the mannequin actually wearing them.
//
// This is the ONLY place a mannequin appears. The view before it is a flat
// display of the pieces (§12c), which promises nothing about how the fabric
// will hang; a body only enters the picture when the fabric in it genuinely
// follows one. The control is disabled when the dev server has no key, and a
// render simply replaces the picture when it arrives.

const TRYON_BASE_SRC = "assets/mannequin_base.jpg";

// which garment goes with which isolation mode, and the order they are listed
const TRYON_SLOTS = [
  ["bottoms", "bottom"], ["dresses", "dress"], ["tops", "top"], ["jackets", "jacket"],
  ["footwear", "footwear"], ["bags", "bag"],
  ["accessories_necklace", "accessory"], ["accessories_bracelet", "accessory"],
  ["accessories_headwear", "accessory"]
];

const tryOnImageCache = new Map();   // src -> HTMLImageElement
const tryOnCutoutCache = new Map();  // item id -> cutout data URL
let currentMannequinRender = null;   // set when an AI render is on screen

let tryOnBusy = false;

function loadImageCached(src) {
  if (tryOnImageCache.has(src)) return Promise.resolve(tryOnImageCache.get(src));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { tryOnImageCache.set(src, img); resolve(img); };
    img.onerror = () => reject(new Error("could not load " + src));
    img.src = src;
  });
}

/** The garments in the current look that have a picture to send. */
function currentOutfitLayers() {
  const layers = [];
  for (const [cat, mode] of TRYON_SLOTS) {
    const slot = activeOutfit.slots[cat];
    if (!slot || !slot.enabled || !slot.itemId) continue;
    const item = wardrobe.find(i => i.id === slot.itemId);
    if (!item || !item.image) continue;      // emoji-only items cannot be worn
    layers.push({ cat, mode, item });
  }
  return layers;
}

/* ---- worn renders: one image-model call per garment, then never again ----

   A garment photographed flat has no body shape in it, and no amount of
   row-wise warping puts one there. So a garment can be re-photographed as a
   ghost-mannequin shot — worn shape, no mannequin, plain background — and the
   cutout taken from THAT is what goes on the mannequin.

   The store is what makes it affordable. A render is generated once, against a
   garment id and a prompt version, and reused for every outfit and every
   shuffle for ever. Generating per outfit instead would multiply the cost by
   however many looks the user browses, which is the whole trap being avoided.
*/

const WORN_STORE_KEY = "pp_worn_v2";
let wornStore = null;

function loadWornStore() {
  if (wornStore) return wornStore;
  try {
    const raw = JSON.parse(localStorage.getItem(WORN_STORE_KEY) || "{}");
    wornStore = (raw && typeof raw === "object") ? raw : {};
  } catch (e) { wornStore = {}; }
  return wornStore;
}

function saveWornStore() {
  try {
    localStorage.setItem(WORN_STORE_KEY, JSON.stringify(loadWornStore()));
    return true;
  } catch (e) {
    showToast("⚠ No room left to store the AI fit — delete a garment or two.");
    return false;
  }
}

/** The stored worn cutout for an item, if it is still current. */
function wornCutoutFor(id) {
  const store = loadWornStore();
  const rec = store[id];
  if (!rec || !rec.image) return null;
  // a changed prompt means the stored render was made to different
  // instructions, so it is stale rather than merely old
  if (window.WornRender && rec.version !== window.WornRender.PROMPT_VERSION) return null;
  return rec.image;
}

function forgetWornCutout(id) {
  const store = loadWornStore();
  if (!store[id]) return false;
  delete store[id];
  saveWornStore();
  tryOnCutoutCache.delete(id);
  return true;
}

/**
 * Re-photographs one garment as worn, extracts it, and stores the cutout.
 *
 * The extraction is the ordinary pipeline, unchanged: a ghost render is a
 * garment on a plain white background, which is precisely the case
 * seg-watershed.js was built for. Measured on the first one, it came back at
 * quality 100.
 */
async function generateWornCutout(item, opts) {
  const options = opts || {};
  if (!window.WornRender || !window.TryOnService) throw new Error("the AI fit modules are not loaded");
  if (!window.WornRender.CAN_RENDER.has(item.category)) {
    throw new Error("shoes, bags and accessories are photographed on their own already");
  }
  if (!item.image) throw new Error("this garment has no photo");

  const st = await window.WornRender.status();
  if (!st.ready) throw new Error(st.offline ? "the dev server is not reachable"
                                            : "image generation is not configured on the server");

  const res = await window.WornRender.generate({
    garment: item.image,
    category: item.category,
    label: item.name,
    /* No colour is passed. The stored `colorName` is a label from a coarse
       table — a golden-yellow dress is filed under "Amber" — and a prompt that
       repeated it asked for the drift it was meant to prevent. The render
       module measures the colour from the pixels it is about to send instead. */
    signature: "worn:" + item.id + ":v" + window.WornRender.PROMPT_VERSION
  });
  if (!res || !res.image) throw new Error("the model returned no image");

  // Store the CUTOUT, not the render. The render is a megabyte of mostly white
  // background; the cutout is about fifty kilobytes, which is the difference
  // between a wardrobe that fits in localStorage and one that does not.
  const cut = await window.GarmentCutout.extract(res.image, {
    category: item.category,
    outputMaxDim: 640
  });
  if (cut.metrics.quality < (options.minQuality === undefined ? 70 : options.minQuality)) {
    throw new Error("the render did not extract cleanly (quality " + cut.metrics.quality + ")");
  }

  /* CHECK IT IS STILL THE SAME GARMENT BEFORE KEEPING IT.
     The prompt asks firmly for the same colour and the same length, and a
     prompt is a request. What makes a wrong answer expensive here is the
     storing: this cutout replaces the wearer's own photograph in every outfit
     from now on, so an unchecked render is not one bad picture, it is the wrong
     dress for ever. Refusing it costs the price of the call that was already
     spent; keeping it costs the garment. */
  let check = { ok: true, why: "not compared" };
  try {
    const source = await window.GarmentCutout.extract(item.image, {
      category: item.category, outputMaxDim: 640
    });
    check = window.WornRender.fidelity(source, cut);
  } catch (e) {
    console.info("could not compare the render with the original:", e && e.message);
  }
  if (!check.ok && options.acceptAnyway !== true) {
    throw new Error("the model changed the garment — " + check.why +
                    ". Your own photo has been kept.");
  }

  const image = window.GarmentCutout.toRecord(cut).image;
  const store = loadWornStore();
  store[item.id] = {
    image,
    version: window.WornRender.PROMPT_VERSION,
    quality: cut.metrics.quality,
    // kept so a render that only just passed can be explained later
    colourShift: check.colourShift === undefined ? null : check.colourShift,
    lengthDrift: check.lengthDrift === undefined ? null : check.lengthDrift,
    at: Date.now()
  };
  saveWornStore();
  tryOnCutoutCache.delete(item.id);
  return { image, quality: cut.metrics.quality, kb: Math.round(image.length / 1024),
           fidelity: check };
}

/** An isolated cutout for an item; uploaded garments already are one. */
async function getItemCutout(layer) {
  const item = layer.item;
  // A garment that has been re-photographed as worn wins over its flat photo:
  // that cutout already has a body's shape in it, which is the one thing the
  // geometric fit cannot supply. Generated once when the garment is added and
  // stored, so it costs nothing here and nothing on a shuffle.
  const worn = wornCutoutFor(item.id);
  if (worn) return worn;
  // A data URL is usually already a cutout — but not always: an isolation
  // failure stores the raw photograph the same way. `isolated` is what
  // distinguishes them. Older saved items have no such field, and treating
  // those as cutouts keeps their existing behaviour rather than re-isolating a
  // whole closet on upgrade.
  if (item.image.indexOf("data:") === 0 && item.isolated !== false) return item.image;
  if (tryOnCutoutCache.has(item.id)) return tryOnCutoutCache.get(item.id);
  let cutout = item.image;
  // The built-in wardrobe is all product photography, so the cutout module is
  // the right tool: it works from the flatness of the backdrop rather than from
  // a body it would not find. The human-parsing engine stays as the fallback
  // for anything genuinely photographed on a person.
  if (window.GarmentCutout && window.Watershed) {
    try {
      const res = await window.GarmentCutout.extract(item.image, {
        category: layer.cat, outputMaxDim: 640
      });
      cutout = window.GarmentCutout.toRecord(res).image;
    } catch (e) {
      console.info("cutout module could not isolate", item.name, "-", e && e.message);
    }
  }
  if (cutout === item.image && window.GarmentEngine) {
    try {
      const res = await window.GarmentEngine.extract(item.image, {
        mode: layer.mode, outputMaxDim: 640
      });
      cutout = res.image;
    } catch (e) {
      console.info("isolation failed for", item.name, "- sending the photo as-is");
    }
  }
  tryOnCutoutCache.set(item.id, cutout);
  return cutout;
}

/** Identifies a look, so a paid render is never bought twice. */
function outfitSignature(layers) {
  return layers.map(l => l.cat + ":" + l.item.id).sort().join("|");
}

/* ---- every render, kept ------------------------------------------------

   The signature above identifies a look well enough to reuse a render, and
   tryon-service already caches by it in a Map. A Map dies with the tab, so
   coming back tomorrow to the same five garments paid for the same picture
   again: the look had not changed, only a variable had expired.

   WHY NOT localStorage. That was the first version of this, and it forced a
   cap. localStorage holds about five megabytes for the whole app — wardrobe
   included — and a render arrives around a megabyte, so keeping renders there
   meant evicting them, which meant a render you had paid for could vanish
   because you had rendered fourteen others since. Eviction is the wrong
   behaviour for something bought.

   IndexedDB has room for all of them (hundreds of megabytes, not five), so
   nothing is thrown away. localStorage stays as the fallback for the case
   where IndexedDB is unavailable — a private window, or a browser set to
   block site data — and only there does the cap apply, because only there is
   space actually scarce.

   Keys carry the prompt version as well as the signature, so a reworded
   prompt stops serving pictures made by the old wording. `renderKeys` holds
   just the keys in memory, which is what lets a synchronous function like
   renderLooks() ask "has this look been rendered?" without awaiting anything;
   the images themselves are only fetched when one is actually shown. */

const RENDER_DB_NAME = "pp_renders";
const RENDER_DB_STORE = "looks";
const LOOK_RENDER_KEY = "pp_look_renders_v1";   // the fallback's single key
const LOOK_RENDER_FALLBACK_MAX = 12;            // only when IndexedDB is unavailable
const LOOK_RENDER_MAXDIM = 720;                 // the panel is 320px wide; generous

let renderDbPromise = null;
let renderKeys = new Set();
let lookRenderStore = null;   // the localStorage fallback, lazily read

function openRenderDb() {
  if (renderDbPromise) return renderDbPromise;
  renderDbPromise = new Promise(resolve => {
    if (!window.indexedDB) return resolve(null);
    let req;
    try { req = indexedDB.open(RENDER_DB_NAME, 1); }
    catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RENDER_DB_STORE)) db.createObjectStore(RENDER_DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return renderDbPromise;
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function loadFallbackRenders() {
  if (lookRenderStore) return lookRenderStore;
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_RENDER_KEY) || "{}");
    lookRenderStore = (raw && typeof raw === "object") ? raw : {};
  } catch (e) { lookRenderStore = {}; }
  return lookRenderStore;
}

function saveFallbackRenders() {
  const store = loadFallbackRenders();
  const byUse = Object.keys(store).sort((a, b) => (store[b].usedAt || 0) - (store[a].usedAt || 0));
  for (const k of byUse.slice(LOOK_RENDER_FALLBACK_MAX)) delete store[k];
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      localStorage.setItem(LOOK_RENDER_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      const oldest = Object.keys(store).sort((a, b) => (store[a].usedAt || 0) - (store[b].usedAt || 0));
      if (!oldest.length) return false;
      delete store[oldest[0]];
    }
  }
  return false;
}

function lookRenderTag(signature) {
  const version = (window.TryOnService && window.TryOnService.OUTFIT_PROMPT_VERSION) || 1;
  return "v" + version + "|" + signature;
}

/** Reads which looks have a render, so the UI can ask without awaiting. */
async function loadRenderKeys() {
  renderKeys = new Set();
  const db = await openRenderDb();
  if (db) {
    try {
      const tx = db.transaction(RENDER_DB_STORE, "readonly");
      const keys = await idbRequest(tx.objectStore(RENDER_DB_STORE).getAllKeys());
      for (const k of keys) renderKeys.add(String(k));
      return renderKeys;
    } catch (e) { /* fall through to the fallback */ }
  }
  for (const k of Object.keys(loadFallbackRenders())) renderKeys.add(k);
  return renderKeys;
}

/** Has this look been rendered? Synchronous, from the keys held in memory. */
function hasLookRender(signature) {
  return renderKeys.has(lookRenderTag(signature));
}

/** The stored render for a look, or null. */
async function getLookRender(signature) {
  const tag = lookRenderTag(signature);
  if (!renderKeys.has(tag)) return null;
  const db = await openRenderDb();
  if (db) {
    try {
      const tx = db.transaction(RENDER_DB_STORE, "readonly");
      const row = await idbRequest(tx.objectStore(RENDER_DB_STORE).get(tag));
      if (row && row.image) return row.image;
    } catch (e) { /* fall through */ }
  }
  const entry = loadFallbackRenders()[tag];
  if (!entry || !entry.image) return null;
  entry.usedAt = Date.now();
  saveFallbackRenders();
  return entry.image;
}

/** Re-encodes a render down to panel size and keeps it against this look. */
async function rememberLookRender(signature, image) {
  let small = image;
  try {
    const img = await loadImageCached(image);
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const s = Math.min(1, LOOK_RENDER_MAXDIM / Math.max(w0, h0));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w0 * s));
    cv.height = Math.max(1, Math.round(h0 * s));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    small = cv.toDataURL("image/webp", 0.86);
    if (small.indexOf("data:image/webp") !== 0) small = cv.toDataURL("image/jpeg", 0.86);
  } catch (e) {
    console.info("could not shrink the render, storing as-is:", e && e.message);
  }

  const tag = lookRenderTag(signature);
  const row = { image: small, at: Date.now(), usedAt: Date.now(),
                kb: Math.round(small.length / 1024), signature };

  const db = await openRenderDb();
  if (db) {
    try {
      const tx = db.transaction(RENDER_DB_STORE, "readwrite");
      await idbRequest(tx.objectStore(RENDER_DB_STORE).put(row, tag));
      renderKeys.add(tag);
      return small;
    } catch (e) {
      console.info("IndexedDB refused the render, falling back:", e && e.message);
    }
  }
  loadFallbackRenders()[tag] = row;
  if (saveFallbackRenders()) renderKeys.add(tag);
  else showToast("⚠ No room to keep this render — it will need generating again.");
  return small;
}

async function forgetLookRenders() {
  renderKeys = new Set();
  lookRenderStore = {};
  try { localStorage.removeItem(LOOK_RENDER_KEY); } catch (e) { /* nothing to do */ }
  const db = await openRenderDb();
  if (!db) return;
  try {
    const tx = db.transaction(RENDER_DB_STORE, "readwrite");
    await idbRequest(tx.objectStore(RENDER_DB_STORE).clear());
  } catch (e) { /* nothing to do */ }
}

function setTryOnStatus(text, kind) {
  const el = document.getElementById("tryon-status");
  if (!el) return;
  el.textContent = text || "";
  el.className = "tryon-status" + (kind ? " " + kind : "");
}

/** Reveals the control only when the server actually has a model configured. */
async function initTryOnControls() {
  const btn = document.getElementById("btn-ai-tryon");
  if (!btn || !window.TryOnService) return;

  const st = await window.TryOnService.status();
  // it now sits beside Save This Look rather than in a bar of its own
  btn.style.display = "inline-flex";
  if (!st.ready) {
    // Shown, but plainly unusable. The picture on screen only ever draws the
    // flat garments, so this button is the one way to see them worn — hiding
    // it would leave no sign that the feature exists, and no hint of why.
    btn.disabled = true;
    setTryOnStatus(st.offline
      ? "Rendering needs the local server — run start.ps1."
      : "Rendering needs an API key on the server.", "err");
    console.info("AI render unavailable — run start.ps1 (Vertex) or set GEMINI_API_KEY");
    return;
  }
  /* There is no "auto" any more.
     It rendered every new look as soon as one appeared, and since each render
     is a paid call that quietly turned generating and shuffling — the two
     things the app most invites you to do — into spending. A setting whose
     best configuration is "off" is not a setting. Rendering is a press. */
  localStorage.removeItem("pp_tryon_auto");
  btn.addEventListener("click", () => toggleWornView());
  const again = document.getElementById("btn-ai-rerender");
  if (again) again.addEventListener("click", () => renderOutfitWithAI(true, true));
  updateWornControls();
  setTryOnStatus(st.mock ? "Mock mode: the server echoes the mannequin back." : "");
}

/**
 * Asks the image model to render the mannequin wearing the current look. The
 * ordinary render stays on screen until this lands, and a failure leaves it
 * alone rather than blanking the view.
 */
/* ---- the one button, and its three jobs --------------------------------

   The picture on the board is either the flat display of the pieces or a worn
   render, and the wearer should be able to go back and forth between them.
   Pressing the button used to mean "render" and then, once a render was up,
   "render it AGAIN" — a paid call sitting under the same press that a moment
   earlier had been free, and no way at all back to the pieces.

   So the button is a toggle, and re-rendering moved to a control of its own
   that only exists while a render is on screen. Spending money is now
   something you have to aim at. */

function updateWornControls() {
  const btn = document.getElementById("btn-ai-tryon");
  const again = document.getElementById("btn-ai-rerender");
  if (!btn) return;
  const showingRender = !!currentMannequinRender;
  const label = btn.querySelector(".btn-label");
  const icon = btn.querySelector("use");
  if (label) label.textContent = showingRender ? "Show pieces" : "See It Worn";
  if (icon) icon.setAttribute("href", showingRender ? "#icon-grid" : "#icon-sparkles");
  btn.title = showingRender
    ? "Back to the pieces this look is made of"
    : "Have this outfit rendered worn on the mannequin";
  if (again) again.style.display = showingRender ? "inline-flex" : "none";
}

/** The button: to the render and back, never spending unless it must. */
async function toggleWornView() {
  if (tryOnBusy) return;
  if (currentMannequinRender) {
    // back to the pieces. Nothing is discarded — the render stays stored.
    currentMannequinRender = null;
    setTryOnStatus("");
    await updateMannequinRender();
    updateWornControls();
    return;
  }
  await renderOutfitWithAI(true);
}

async function renderOutfitWithAI(explicit, force) {
  if (!window.TryOnService || tryOnBusy) return;
  const img = document.getElementById("mannequin-render");
  const loader = document.getElementById("mannequin-loading");
  const loaderText = document.getElementById("mannequin-loading-text");
  const layers = currentOutfitLayers();
  if (!img) return;
  if (!layers.length) {
    setTryOnStatus("None of these items have a photo to try on.", "err");
    return;
  }

  const signature = outfitSignature(layers);
  // in memory for this tab, then on disk from any previous day
  const hit = force ? null : (window.TryOnService.cached(signature) || await getLookRender(signature));
  const retry = !!force;
  if (hit) {
    img.src = hit;
    currentMannequinRender = hit;
    setTryOnStatus("Worn on the mannequin — you rendered this look before, so this cost nothing.", "ok");
    updateWornControls();
    renderMobileScreen("assistant");
    return;
  }

  tryOnBusy = true;
  if (loader) loader.classList.add("is-rendering");
  if (loader) loader.style.display = "flex";
  startRenderNarration(retry);
  setTryOnStatus(retry ? "Rendering it again…" : "Rendering the outfit on the mannequin…");

  try {
    const base = await loadImageCached(TRYON_BASE_SRC);
    const garments = [];
    for (const l of layers) {
      const cutout = await getItemCutout(l);
      // No colour is passed: tryon-service measures each garment from the very
      // pixels it sends, so the prompt cannot assert a colour the image denies.
      if (cutout) garments.push({ category: l.cat, name: l.item.name, image: cutout });
    }
    const res = await window.TryOnService.render({ base, garments, signature, force: retry });
    img.onload = null;
    img.src = res.image;
    img.style.opacity = "1";
    img.style.transform = "scale(1)";
    currentMannequinRender = res.image;
    setTryOnStatus(res.mock ? "Mock render returned (no model called)." : "Worn render complete.", "ok");
    // Kept against this exact set of garments, so returning to the look — today,
    // tomorrow, or after a reload — costs nothing and waits for nothing.
    if (!res.mock) rememberLookRender(signature, res.image);
    renderMobileScreen("assistant");
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    // Out of quota is not a bug to retry — Google's free tier allows zero image
    // requests, so say that plainly once and stop asking for more renders.
    if (/quota|RESOURCE_EXHAUSTED|\b429\b/i.test(msg)) {
      setTryOnStatus("Image rendering needs billing enabled on your Google AI project — " +
                     "the free tier allows 0 image requests.", "err");
    } else {
      setTryOnStatus("Couldn't render: " + msg.replace(/\s+/g, " ").slice(0, 160), "err");
    }
    console.warn("AI try-on failed", err);
  } finally {
    tryOnBusy = false;
    stopRenderNarration();
    if (loader) { loader.style.display = "none"; loader.classList.remove("is-rendering"); }
    if (loaderText) loaderText.textContent = "Gathering the pieces...";
    updateWornControls();
  }
}

/* ---- something to read while the model works ---------------------------

   A render takes ten to thirty seconds, and the old wait was a spinning ring
   over the words "Dressing the mannequin with AI..." — one static line for
   half a minute, which reads as a hang rather than as work. The messages
   below are in the order the thing actually happens, so the wait tells the
   wearer where it has got to, and the last one is honest about being the
   longest. */

const RENDER_NARRATION = [
  "Gathering your pieces…",
  "Measuring each garment's colour…",
  "Writing the instructions…",
  "Sending them to the studio…",
  "Draping the fabric on the shoulders…",
  "Setting the folds and the hems…",
  "Lighting the shot…",
  "Almost there — the last part is the slowest…"
];

let renderNarrationTimer = null;

function startRenderNarration(isRetry) {
  const el = document.getElementById("mannequin-loading-text");
  if (!el) return;
  stopRenderNarration();
  let i = 0;
  const lines = isRetry ? ["Rendering it again…"].concat(RENDER_NARRATION.slice(3)) : RENDER_NARRATION;
  el.textContent = lines[0];
  renderNarrationTimer = setInterval(() => {
    i++;
    // hold on the last line rather than looping: a message that comes round
    // again suggests the work has restarted, which it has not
    if (i >= lines.length) { stopRenderNarration(); return; }
    el.textContent = lines[i];
  }, 3200);
}

function stopRenderNarration() {
  if (renderNarrationTimer) { clearInterval(renderNarrationTimer); renderNarrationTimer = null; }
}

function renderOutfitBreakdown() {
  const container = document.getElementById("outfit-items-breakdown");
  if (!container) return;
  let html = "";
  for (let cat in activeOutfit.slots) {
    const slot = activeOutfit.slots[cat];
    if (!slot.enabled || !slot.itemId) continue;
    const item = wardrobe.find(i => i.id === slot.itemId);
    if (!item) continue;
    const thumb = item.image
      ? `<img src="${item.image}" alt="">`
      : `<span class="emoji-thumb">${item.emoji||"👚"}</span>`;
    const catLabel = cat.replace("accessories_","");
    const isBase = manualBaseItem && manualBaseItem.id === item.id;
    const baseTag = isBase ? `<span style="font-size:0.65rem;color:var(--sage-green);font-weight:700;margin-left:4px;">[Base 📌]</span>` : "";
    html += `<div class="breakdown-chip ${isBase?'base-pinned':''}">${thumb}<div><div class="chip-text">${item.name} ${baseTag}</div><div class="chip-cat">${catLabel}</div></div></div>`;
  }
  container.innerHTML = html || '<p style="font-size:0.8rem;color:var(--text-muted);text-align:center;">No items selected yet.</p>';
}

function renderSlotControls() {
  const container = document.getElementById("slot-controls-list");
  if (!container) return;
  const names = { tops:"Top", bottoms:"Bottom", dresses:"Dress", footwear:"Shoes", bags:"Bag", jackets:"Jacket",
    accessories_necklace:"Necklace", accessories_bracelet:"Bracelet", accessories_headwear:"Headwear" };
  /* The dress/separates switch, always shown.
     It has to be visible even — especially — when the dress slot is off,
     because that is exactly when someone wants to turn it on. The old
     behaviour hid the row for any disabled slot, so the one control that could
     have produced a dress disappeared precisely whenever a dress was not
     already being worn. */
  const wearingDress = activeOutfit.slots.dresses.enabled;
  let html = "<h5>Slot Controls</h5>" +
    `<div class="shape-switch" title="Wear a dress, or a top and a bottom?">
       <span class="shape-switch-label">Wearing</span>
       <button class="btn-shape ${outfitShape === "auto" ? "active" : ""}"
               onclick="setOutfitShape('auto')" title="Let the stylist choose per occasion"
       >Auto${outfitShape === "auto" ? (wearingDress ? " · dress" : " · separates") : ""}</button>
       <button class="btn-shape ${outfitShape === "dress" ? "active" : ""}"
               onclick="setOutfitShape('dress')">Dress</button>
       <button class="btn-shape ${outfitShape === "separates" ? "active" : ""}"
               onclick="setOutfitShape('separates')">Top + bottom</button>
     </div>`;
  for (let cat in activeOutfit.slots) {
    const slot = activeOutfit.slots[cat];
    const optional = OPTIONAL_SLOTS.has(cat);
    const removed = optional && !slotIncluded(cat);
    // A slot the wearer removed must keep its row, or there is nowhere left to
    // offer it back. Structural slots (the dress/separates pair) still vanish
    // when they are not part of this shape of outfit — that is not a choice
    // anyone made and there is nothing to offer back.
    if (!slot.enabled && !removed) continue;
    const item = wardrobe.find(i => i.id === slot.itemId);
    const isBase = manualBaseItem && manualBaseItem.category === cat;
    const worn = removed ? "Not today" : (item ? item.name : "Empty");
    html += `<div class="slot-control-item ${isBase?'base-slot-locked':''} ${removed?'slot-removed':''}">
      <span class="slot-name">${names[cat]||cat}: <em style="font-weight:400;color:var(--text-muted);font-size:0.7rem;">${worn}</em> ${isBase?'<span style="font-size:0.65rem;color:var(--sage-green);font-weight:600;">(Base Item 📌)</span>':''}</span>
      <div class="slot-control-actions">
        <button class="btn-slot-action ${(slot.locked||isBase)?"slot-locked":""}" onclick="toggleSlotLock('${cat}')" title="${(slot.locked||isBase)?"Unlock":"Lock"}">
          <svg width="11" height="11"><use href="${(slot.locked||isBase)?"#icon-lock":"#icon-unlock"}"></use></svg>
        </button>` +
        // appended AFTER the lock button on purpose: lab/style-around-probe.html
        // finds the lock with a positional query, so document order stays put
        (optional ? `
        <button class="btn-slot-action ${removed?"slot-off":""}" onclick="toggleSlotInclusion('${cat}')" title="${removed?`Wear a ${(names[cat]||cat).toLowerCase()} after all`:`Not wearing a ${(names[cat]||cat).toLowerCase()} today`}">
          <svg width="11" height="11"><use href="${removed?"#icon-plus":"#icon-minus"}"></use></svg>
        </button>` : "") + `
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

function toggleSlotLock(cat) {
  if (manualBaseItem && manualBaseItem.category === cat) {
    showToast("📌 This piece is your selected base item. Use 'Clear Base' to change it.");
    return;
  }
  activeOutfit.slots[cat].locked = !activeOutfit.slots[cat].locked;
  renderSlotControls();
  updateStyleAroundControls();
}

// ============ 12c. THE DISPLAY BOARD ============
// Lays the outfit's own garments out on white, as they were photographed.
//
// WHY THERE IS NO MANNEQUIN HERE ANY MORE
//
// Two versions of this stood on the mannequin. The first reshaped each garment
// to the body row by row; the second stopped reshaping and simply placed the
// flat photographs on it. Both had the same trouble, and the second made it
// plainer: the body is in the picture, so every place the fabric does not
// follow it reads as a defect — a hem floating off a hip, a sleeve stopping in
// mid-air. None of it is a defect in the garment. It is what a photograph taken
// flat looks like against a shape it was never draped over.
//
// A flat-lay claims nothing about drape, so nothing about it can be wrong. It
// answers the question this view is actually for — WHICH pieces did the stylist
// pick — and it answers it better than a mannequin did, because every piece is
// shown whole and at a size chosen to be legible rather than anatomical.
//
// The mannequin comes back the moment there is something true to put on it:
// See It Worn (§12b) sends the bare mannequin and these cutouts to an image
// model and returns a photograph of the outfit being worn.
//
// The layout lives in modules/outfit-display.js. What is left here is the app's
// side: find the cutouts, call the module, put the result on screen.

const COMPOSITE_BASE_SRC = "assets/mannequin_base.jpg";

function displayModulesReady() {
  return !!window.OutfitDisplay;
}

/** A stored cutout image, in the shape the fit module expects. */
function cutoutFromImage(img) {
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth || img.width;
  cv.height = img.naturalHeight || img.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const alpha = new Float32Array(cv.width * cv.height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3] / 255;
  return { canvas: cv, width: cv.width, height: cv.height, alpha };
}

function encodeComposite(canvas) {
  try {
    const webp = canvas.toDataURL("image/webp", 0.9);
    if (webp.indexOf("data:image/webp") === 0) return webp;
  } catch (e) { /* fall through */ }
  return canvas.toDataURL("image/png");
}

const SLOT_WORD = {
  tops: "top", bottoms: "bottom", dresses: "dress", jackets: "jacket",
  footwear: "shoes", bags: "bag", accessories_necklace: "necklace",
  accessories_bracelet: "bracelet", accessories_headwear: "headwear"
};

async function renderOutfitDisplay() {
  const img = document.getElementById("mannequin-render");
  const loader = document.getElementById("mannequin-loading");
  if (!img) return false;
  const layers = currentOutfitLayers();
  if (!layers.length) return false;
  if (!displayModulesReady()) {
    console.warn("outfit-display.js missing - check the module script tags");
    return false;
  }

  const token = ++compositeToken;
  if (loader) loader.style.display = "flex";
  img.style.opacity = "0.35";
  img.style.transition = "opacity 0.3s ease";

  try {
    const cutoutUrls = await Promise.all(layers.map(l => getItemCutout(l)));

    const items = [];
    let missing = 0;
    for (let i = 0; i < layers.length; i++) {
      if (!cutoutUrls[i]) { missing++; continue; }
      try {
        const loaded = await loadImageCached(cutoutUrls[i]);
        items.push({ category: layers[i].cat, name: layers[i].item.name, cutout: loaded });
      } catch (e) { missing++; }   // one unreadable photo must not lose the board
    }
    if (token !== compositeToken) return true;      // a newer look superseded this
    if (!items.length) throw new Error("no garment photos to show");

    const result = window.OutfitDisplay.render(items);
    if (token !== compositeToken) return true;

    currentMannequinPhoto = encodeComposite(result.canvas);
    img.onload = () => {
      if (loader) loader.style.display = "none";
      img.style.opacity = "1";
      img.style.transform = "scale(1)";
    };
    img.src = currentMannequinPhoto;
    img.style.opacity = "1";
    if (loader) loader.style.display = "none";

    const caption = document.getElementById("mannequin-caption");
    if (caption) {
      const notes = [];
      if (missing > 0) notes.push(missing + " item" + (missing > 1 ? "s" : "") + " has no photo");
      // Saying "no jacket" is only worth saying because the wearer chose it.
      // An outfit is not incomplete for missing what was taken off on purpose.
      const removedOnPurpose = [...OPTIONAL_SLOTS].filter(c => !slotIncluded(c));
      if (removedOnPurpose.length) {
        notes.push("no " + removedOnPurpose.map(c => SLOT_WORD[c] || c).join(" or ") + " today");
      }
      /* Say when pressing is free.
         A look already rendered keeps its picture, and the flat display is
         still what shows first — so the wearer needs to know that seeing it
         worn again costs nothing, or they will avoid a button they have
         already paid for. */
      const already = hasLookRender(outfitSignature(layers));
      caption.textContent = "The " + items.length + " piece" + (items.length === 1 ? "" : "s") +
        " in this look, as you photographed them" +
        (notes.length ? " (" + notes.join("; ") + ")" : "") +
        (already
          ? ". You have already rendered this look — See It Worn brings it back for free."
          : ". Press See It Worn to have them rendered on the mannequin.");
    }
    if (document.querySelector(".m-nav-btn.active")?.dataset.target === "assistant") {
      renderMobileScreen("assistant");
    }
    return true;
  } catch (e) {
    console.warn("display render failed", e);
    if (loader) loader.style.display = "none";
    img.style.opacity = "1";
    return false;
  }
}

// ============ 13. MANUAL SELECT ============
function openManualSelectModal() {
  const grid = document.getElementById("modal-items-grid");
  const modal = document.getElementById("manual-select-modal");
  if (!grid || !modal) return;
  grid.innerHTML = wardrobe.map(item => {
    const display = item.image ? `<img src="${item.image}" alt="">` : `<span class="emoji-ph">${item.emoji||"👚"}</span>`;
    return `<button class="modal-item-btn" onclick="selectManualBaseItem('${item.id}')">${display}<span class="name">${item.name}</span></button>`;
  }).join("");
  modal.style.display = "flex";
}

function closeManualSelectModal() {
  const modal = document.getElementById("manual-select-modal");
  if (modal) modal.style.display = "none";
}

function selectManualBaseItem(id) {
  const item = wardrobe.find(i => i.id === id);
  if (!item) return;
  manualBaseItem = item;
  const emojiEl = document.getElementById("base-item-emoji");
  const nameEl = document.getElementById("base-item-name");
  const dispEl = document.getElementById("selected-base-display");
  if (emojiEl) emojiEl.textContent = item.emoji || "👚";
  if (nameEl) nameEl.textContent = item.name;
  if (dispEl) dispEl.style.display = "block";
  closeManualSelectModal();

  // Freeze this base item in its slot, and leave every other slot as the user
  // left it — anything they locked by hand stays locked. Pinning also overrides
  // a standing "not today" for that category: choosing to style around a jacket
  // is a clearer statement than having removed one earlier.
  const slot = activeOutfit.slots[item.category];
  if (slot) {
    slot.itemId = item.id;
    slot.locked = true;
    if (slotOptOut.delete(item.category)) saveSlotOptOut();
    slot.enabled = true;
  }

  updateStyleAroundControls();
  generateOutfit(document.getElementById("stylist-prompt")?.value.trim() || "everyday casual");
  showToast(`📌 ${item.name} is locked in - use "Shuffle the Rest" to restyle around it.`);
}

/**
 * Keeps the "Style Around an Item" panel honest about what is held: the hint
 * names the base item and every slot the user has locked, so it is obvious that
 * shuffling from here keeps those and changes the rest.
 */
function updateStyleAroundControls() {
  const hint = document.getElementById("style-around-hint");
  if (!hint) return;
  const names = { tops:"top", bottoms:"bottom", dresses:"dress", footwear:"shoes", bags:"bag",
    jackets:"jacket", accessories_necklace:"necklace", accessories_bracelet:"bracelet",
    accessories_headwear:"headwear" };
  const alsoHeld = [];
  for (const cat in activeOutfit.slots) {
    const slot = activeOutfit.slots[cat];
    if (!slot.enabled || !slotIncluded(cat) || !slot.locked) continue;
    if (manualBaseItem && manualBaseItem.category === cat) continue;
    alsoHeld.push(names[cat] || cat);
  }
  hint.textContent = alsoHeld.length
    ? `Keeps this piece (and your locked ${alsoHeld.join(", ")}) and swaps everything else.`
    : "Keeps this piece and swaps everything else.";
}

function clearManualBaseItem() {
  const wasBase = manualBaseItem;
  manualBaseItem = null;
  const dispEl = document.getElementById("selected-base-display");
  if (dispEl) dispEl.style.display = "none";
  // release only the base item's own slot; locks the user set stay set
  if (wasBase && activeOutfit.slots[wasBase.category]) {
    activeOutfit.slots[wasBase.category].locked = false;
  }
  updateStyleAroundControls();
  generateOutfit(document.getElementById("stylist-prompt")?.value.trim() || "everyday casual");
  showToast("🔓 Base item cleared.");
}

/* ============ 13b. SAVED LOOKS ============

   WHAT THIS USED TO BE. "Save This Look" incremented a counter, wrote it to
   localStorage, and showed a toast saying the look had been "saved to your
   catalog". There was no catalog. Nothing about the outfit was recorded — not
   the garments, not the vibe, not the picture — and there was nowhere in the
   app to look at a saved one, because there was nothing to look at. The button
   was a number going up.

   A saved look now records the garments it is made of, by id, plus the vibe
   and the picture that was on screen. The garments matter more than the
   picture: ids are a few bytes and let a look be put back ON the board and
   shuffled around, which is the point of saving an outfit rather than
   screenshotting one. The picture is kept small, purely so the list is
   recognisable at a glance. */

const LOOKS_KEY = "pp_looks_v1";
const LOOKS_MAX = 30;
const LOOK_THUMB_MAXDIM = 420;

let looksStore = null;

function loadLooks() {
  if (looksStore) return looksStore;
  try {
    const raw = JSON.parse(localStorage.getItem(LOOKS_KEY) || "[]");
    looksStore = Array.isArray(raw) ? raw : [];
  } catch (e) { looksStore = []; }
  return looksStore;
}

function saveLooks() {
  const looks = loadLooks();
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      localStorage.setItem(LOOKS_KEY, JSON.stringify(looks.slice(0, LOOKS_MAX)));
      return true;
    } catch (e) {
      /* Out of room. Drop the oldest look's THUMBNAIL first — a look without a
         picture is still a look you can wear, whereas a look thrown away is
         gone. Only when every thumbnail is gone does a look get dropped. */
      const withThumb = looks.filter(l => l.thumb);
      if (withThumb.length) { delete withThumb[withThumb.length - 1].thumb; continue; }
      if (looks.length > 1) { looks.pop(); continue; }
      return false;
    }
  }
  return false;
}

/** A small picture of the look, for the list. */
async function lookThumbnail(src) {
  if (!src) return null;
  try {
    const img = await loadImageCached(src);
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const s = Math.min(1, LOOK_THUMB_MAXDIM / Math.max(w0, h0));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w0 * s));
    cv.height = Math.max(1, Math.round(h0 * s));
    const c = cv.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, cv.width, cv.height);
    c.drawImage(img, 0, 0, cv.width, cv.height);
    const webp = cv.toDataURL("image/webp", 0.7);
    return webp.indexOf("data:image/webp") === 0 ? webp : cv.toDataURL("image/jpeg", 0.7);
  } catch (e) { return null; }
}

async function saveOutfit() {
  const layers = currentOutfitLayers();
  const slots = {};
  for (const cat in activeOutfit.slots) {
    const slot = activeOutfit.slots[cat];
    if (slot.enabled && slot.itemId) slots[cat] = slot.itemId;
  }
  if (!Object.keys(slots).length) {
    showToast("Nothing to save yet — generate a look first.");
    return;
  }

  const looks = loadLooks();
  const signature = layers.length ? outfitSignature(layers) : "";
  // Saving the same outfit twice should not fill the list with duplicates.
  const already = looks.findIndex(l => l.signature && l.signature === signature);
  const look = {
    id: "look_" + Date.now(),
    vibe: activeOutfit.vibe || "Saved look",
    signature,
    slots,
    worn: !!currentMannequinRender,
    at: Date.now(),
    /* Always the FLAT board, never the render, even when a render is on screen.
       The render is already kept in its own store and the card has a button to
       show it, so putting it in the thumbnail too would store the same picture
       twice and make the grid inconsistent — some cards worn, some flat,
       depending on which button you happened to press before saving. The
       thumbnail's job is to identify the look; the button's job is to show it
       worn. */
    thumb: await lookThumbnail(currentMannequinPhoto || currentMannequinRender)
  };
  if (already >= 0) {
    look.id = looks[already].id;
    looks.splice(already, 1);
    showToast("🌸 Updated this look in My Looks.");
  } else {
    showToast("🌸 Saved to My Looks — find it in the sidebar.");
  }
  looks.unshift(look);
  if (!saveLooks()) {
    showToast("⚠ No room left to save looks — delete one to make space.");
    return;
  }

  outfitsCount = loadLooks().length;
  localStorage.setItem("pp_outfits_count_v3", outfitsCount.toString());
  updateStats();
  renderLooks();
  renderMobileScreen(document.querySelector(".m-nav-btn.active")?.dataset.target);
}

function deleteLook(id) {
  const looks = loadLooks();
  const i = looks.findIndex(l => l.id === id);
  if (i < 0) return;
  looks.splice(i, 1);
  saveLooks();
  outfitsCount = looks.length;
  localStorage.setItem("pp_outfits_count_v3", outfitsCount.toString());
  updateStats();
  renderLooks();
  renderMobileScreen(document.querySelector(".m-nav-btn.active")?.dataset.target);
  showToast("Look removed.");
}

/**
 * Puts a saved look back on the board.
 *
 * This is why the garment ids are what get saved. A look is restored as a
 * live outfit — every slot filled with the piece it had — so it can be worn,
 * shuffled around, or styled with one piece pinned. A saved screenshot could
 * only be looked at.
 */
function wearLook(id) {
  const look = loadLooks().find(l => l.id === id);
  if (!look) return;
  let missing = 0;
  for (const cat in activeOutfit.slots) {
    const want = look.slots[cat];
    const slot = activeOutfit.slots[cat];
    if (!want) { slot.itemId = null; slot.enabled = false; continue; }
    if (!wardrobe.some(i => i.id === want)) { missing++; slot.itemId = null; slot.enabled = false; continue; }
    slot.itemId = want;
    slot.enabled = true;
    slot.locked = false;
  }
  activeOutfit.vibe = look.vibe || activeOutfit.vibe;
  manualBaseItem = null;
  const tag = document.getElementById("current-vibe-tag");
  if (tag) tag.textContent = activeOutfit.vibe;
  switchTab("assistant");
  renderOutfitBreakdown();
  renderSlotControls();
  updateStyleAroundControls();
  updateMannequinRender();
  showToast(missing
    ? "Wearing this look — " + missing + " piece" + (missing > 1 ? "s are" : " is") + " no longer in your closet."
    : "Wearing this look.");
}

/**
 * Swaps a look's card between its pieces and its stored render.
 *
 * A toggle rather than a one-way switch, because both pictures are worth
 * having: the flat one says which garments the look is, the render says how it
 * hangs. Nothing is generated here — the button only exists on cards whose
 * look already has a render, so this is free by construction.
 */
const lookShowingWorn = new Set();

async function toggleLookWorn(id) {
  const look = loadLooks().find(l => l.id === id);
  if (!look || !look.signature) return;
  // both front ends draw a card for the same look, so both are updated
  const imgs = ["look-img-" + id, "m-look-img-" + id]
    .map(x => document.getElementById(x)).filter(Boolean);
  const btns = ["look-worn-" + id, "m-look-worn-" + id]
    .map(x => document.getElementById(x)).filter(Boolean);
  if (!imgs.length) return;

  const relabel = (worn) => btns.forEach(b => {
    if (b.className === "m-mini") { b.textContent = worn ? "pieces" : "worn"; return; }
    const label = b.querySelector(".btn-label");
    if (label) label.textContent = worn ? "Pieces" : "Worn";
    b.title = worn ? "Show the pieces this look is made of" : "Show this look worn on the mannequin";
  });

  if (lookShowingWorn.has(id)) {
    lookShowingWorn.delete(id);
    if (look.thumb) imgs.forEach(i => { i.src = look.thumb; });
    relabel(false);
    return;
  }
  const worn = await getLookRender(look.signature);
  if (!worn) {
    // the render was cleared since the card was drawn
    showToast("That render is no longer stored — press See It Worn on the board.");
    renderLooks();
    renderMobileScreen("looks");
    return;
  }
  lookShowingWorn.add(id);
  imgs.forEach(i => { i.src = worn; });
  relabel(true);
}

/** The My Looks page. */
function renderLooks() {
  const grid = document.getElementById("looks-grid");
  if (!grid) return;
  const looks = loadLooks();
  const empty = document.getElementById("looks-empty");
  if (empty) empty.style.display = looks.length ? "none" : "block";
  grid.innerHTML = looks.map(look => {
    const names = Object.keys(look.slots)
      .map(cat => {
        const item = wardrobe.find(i => i.id === look.slots[cat]);
        return item ? item.name : null;
      })
      .filter(Boolean);
    const picture = look.thumb
      ? `<img src="${look.thumb}" alt="${look.vibe}" id="look-img-${look.id}">`
      : `<div class="look-noimg">${names.length} piece${names.length === 1 ? "" : "s"}</div>`;
    const when = new Date(look.at || Date.now()).toLocaleDateString();
    /* The worn button appears only where there IS a render.
       A saved look keeps its pieces; whether it has ever been rendered is a
       separate fact, and one that can change after saving — render the look
       later and the button should appear on the card without re-saving it. So
       it is asked of the render store at draw time rather than read from the
       look, and a look with no render shows no button instead of a button that
       would quietly spend money. */
    const rendered = look.signature && hasLookRender(look.signature);
    /* ONE WORD, NO ICON, and never truncated.
       "See it worn" wrapped onto three lines in a card this narrow and left
       every button in the row a different height. Replacing it with an icon
       plus one word made it worse, not better: icon, gap and word did not fit
       either, so the label came out as "W…" — and the ellipsis that did that
       was mine, hiding the overflow instead of fixing the fit.
       A word is the label. The trash button keeps its icon because there the
       icon IS the label, and it cannot wrap. */
    const wornBtn = rendered
      ? `<button class="btn btn-secondary btn-tiny" id="look-worn-${look.id}"
                 title="Show this look worn on the mannequin"
                 onclick="toggleLookWorn('${look.id}')"
         ><span class="btn-label">Worn</span></button>`
      : "";
    return `<div class="look-card">
      <div class="look-img">${picture}${rendered ? '<span class="look-badge">rendered</span>' : ""}</div>
      <div class="look-body">
        <div class="look-vibe">${look.vibe}</div>
        <div class="look-pieces">${names.join(" · ") || "pieces no longer in your closet"}</div>
        <div class="look-when">${when}</div>
        <div class="look-actions">
          <button class="btn btn-primary btn-tiny" title="Put this look back on the board"
                  onclick="wearLook('${look.id}')"
          ><span class="btn-label">Wear</span></button>
          ${wornBtn}
          <button class="btn btn-secondary btn-tiny btn-icon-only" title="Delete this look"
                  onclick="deleteLook('${look.id}')"
          ><svg width="13" height="13"><use href="#icon-trash"></use></svg></button>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ============ 14. MOBILE RENDERER ============
//
// The phone pane used to be a picture of an app: four screens of read-only
// markup, a closet capped at ten items with no way to act on any of them, and
// an Upload tab whose only control was a button reading "Use Web Uploader →".
// Every real action lived on the left-hand dashboard, so the simulator showed
// what the product would look like rather than what it would do.
//
// It is now wired to the same functions the dashboard calls. Same wardrobe,
// same stylist, same saved looks, same render — one app with two front ends,
// which is the only arrangement in which "it works on the phone" means
// anything. What is deliberately NOT reproduced at 320px is the Cutout Editor:
// it is a full-screen canvas with a drag box and three brushes, it already
// opens over the whole page, and a phone-sized copy of it would be a worse
// tool pretending to be a feature. The phone hands that one over and says so.

function mobileNames(slots) {
  return Object.keys(slots || {})
    .map(cat => (wardrobe.find(i => i.id === slots[cat]) || {}).name)
    .filter(Boolean);
}

function renderMobileScreen(id) {
  const c = document.getElementById("mobile-body-container");
  if (!c) return;
  const looks = loadLooks();

  if (id === "home") {
    const recent = looks.slice(0, 2).map(l => `
      <div class="m-look-card" onclick="wearLook('${l.id}')">
        ${l.thumb ? `<img class="m-look-thumb" src="${l.thumb}" alt="">`
                  : `<div class="m-look-thumb"></div>`}
        <div class="m-look-meta">
          <div class="m-look-vibe">${l.vibe}</div>
          <div class="m-look-pieces">${mobileNames(l.slots).join(" · ") || "—"}</div>
        </div>
      </div>`).join("");
    c.innerHTML = `<div class="m-welcome-banner"><h4>Hi, Gorgeous 🌸</h4><p>Let's find the perfect look for today.</p></div>
    <div class="m-stats-row">
      <div class="m-stat-card"><span class="num">${wardrobe.length}</span><span class="lbl">Items</span></div>
      <div class="m-stat-card"><span class="num">${wardrobe.filter(i => i.favorite).length}</span><span class="lbl">Favs</span></div>
      <div class="m-stat-card"><span class="num">${looks.length}</span><span class="lbl">Looks</span></div>
    </div>
    <div class="m-section-title">Quick Access</div>
    <div class="m-row">
      <button class="btn btn-primary btn-small" onclick="switchTab('closet')">Closet</button>
      <button class="btn btn-secondary btn-small" onclick="switchTab('assistant')">Stylist</button>
      <button class="btn btn-secondary btn-small" onclick="switchTab('add')">Add Item</button>
    </div>
    ${looks.length ? `<div class="m-section-title">Recent looks</div>${recent}
      <button class="btn btn-secondary btn-small btn-block" onclick="switchTab('looks')">All ${looks.length} looks</button>` : ""}`;
  }

  else if (id === "closet") {
    const filter = getActiveFilter();
    const items = wardrobe.filter(i => filter === "all" ? true
      : (filter === "accessories" ? i.category.startsWith("accessories") : i.category === filter));
    const pills = ["all", "tops", "bottoms", "dresses", "jackets", "footwear", "bags", "accessories"]
      .map(f => `<button class="m-mini" style="${f === filter ? "border-color:var(--sage-green);color:var(--sage-green);" : ""}" onclick="filterCloset('${f}')">${f}</button>`)
      .join("");
    const cards = items.map(item => {
      const img = item.image
        ? `<img src="${item.image}" alt="">`
        : `<div style="width:100%;height:100%;background:${item.gradient || "var(--pink-light)"};display:flex;align-items:center;justify-content:center;font-size:1.3rem;">${item.emoji || "👚"}</div>`;
      const aiFit = (window.WornRender && window.WornRender.CAN_RENDER.has(item.category) && item.image)
        ? `<button class="m-mini" onclick="onAiFitClick('${item.id}', event)">${wornCutoutFor(item.id) ? "AI ✓" : "AI fit"}</button>`
        : "";
      return `<div class="m-closet-item-card">
        <div class="m-item-img">${img}</div>
        <div class="m-item-details">
          <span class="m-item-cat">${item.category.replace("accessories_", "")}</span>
          <div class="m-item-name">${item.name}</div>
          <div class="m-chip-row" style="margin:3px 0 0 0;">
            <button class="m-mini" onclick="toggleFavorite('${item.id}')">${item.favorite ? "♥ fav" : "♡ fav"}</button>
            <button class="m-mini" onclick="styleAroundItem('${item.id}')">style</button>
            ${aiFit}
            <button class="m-mini" onclick="deleteItem('${item.id}')">del</button>
          </div>
        </div>
      </div>`;
    }).join("");
    c.innerHTML = `<div class="m-chip-row">${pills}</div>
      <div class="m-closet-list">${cards || `<p class="m-status">Nothing in this category.</p>`}</div>`;
  }

  else if (id === "assistant") {
    // the phone shows the same picture the dashboard has, whatever kind it is
    const src = currentMannequinRender || currentMannequinPhoto || "";
    const layers = currentOutfitLayers();
    const chips = layers.map(l => `<span class="m-chip">${l.item.image ? `<img src="${l.item.image}" alt="">` : ""}${l.item.name}</span>`).join("");
    const slotRows = Object.keys(activeOutfit.slots).map(cat => {
      const slot = activeOutfit.slots[cat];
      const item = wardrobe.find(i => i.id === slot.itemId);
      const optional = OPTIONAL_SLOTS.has(cat);
      const included = slotIncluded(cat);
      const optBtn = optional
        ? `<button class="m-mini" onclick="toggleSlotInclusion('${cat}')">${included ? "−" : "+"}</button>`
        : "";
      return `<div class="m-slot ${included ? "" : "off"}">
        <span class="m-slot-name">${SLOT_WORD[cat] || cat}</span>
        <span class="m-slot-val">${included ? (item ? item.name : "empty") : "not today"}</span>
        <button class="m-mini" onclick="toggleSlotLock('${cat}')">${slot.locked ? "🔒" : "🔓"}</button>
        ${optBtn}
      </div>`;
    }).join("");
    // same toggle as the dashboard, same words, so neither side surprises you
    const renderBtn = window.TryOnService
      ? `<button class="btn btn-secondary btn-small" id="m-render" onclick="toggleWornView()">${
           currentMannequinRender ? "▦ Show pieces" : "✨ See It Worn"}</button>`
      : "";
    const shapeRow = `<div class="m-chip-row" style="justify-content:center;margin:2px 0 4px 0;">
        <span class="m-slot-name" style="align-self:center;">wearing</span>
        ${["auto", "dress", "separates"].map(s =>
          `<button class="m-mini" style="${outfitShape === s ? "border-color:var(--sage-green);color:var(--sage-green);" : ""}"
                   onclick="setOutfitShape('${s}')">${s === "separates" ? "top+bottom" : s}</button>`).join("")}
      </div>`;
    const status = document.getElementById("tryon-status");
    c.innerHTML = `<div style="text-align:center;margin-bottom:6px;"><span class="vibe-tag">${activeOutfit.vibe}</span></div>
      <input class="m-field" id="m-vibe" placeholder="where are we going today?">
      <div class="m-row">
        <button class="btn btn-primary btn-small" onclick="generateOutfit(document.getElementById('m-vibe').value || 'casual')">Generate</button>
        <button class="btn btn-secondary btn-small" onclick="shuffleOutfit()">Shuffle</button>
      </div>
      ${src ? `<img class="m-mannequin-img" src="${src}" alt="This look">` : ""}
      <div class="m-row">
        ${renderBtn}
        <button class="btn btn-secondary btn-small" onclick="saveOutfit()">Save Look</button>
      </div>
      <div class="m-chip-row">${chips}</div>
      ${shapeRow}
      <div class="m-section-title">Slots</div>
      <div class="m-slot-list">${slotRows}</div>
      <p class="m-status" id="m-status">${status ? status.textContent : ""}</p>`;
  }

  else if (id === "looks") {
    c.innerHTML = looks.length
      ? looks.map(l => {
          // same rule as the dashboard: the worn button only where a render exists
          const rendered = l.signature && hasLookRender(l.signature);
          return `<div class="m-look-card">
          ${l.thumb ? `<img class="m-look-thumb" src="${l.thumb}" alt="" id="m-look-img-${l.id}">`
                    : `<div class="m-look-thumb"></div>`}
          <div class="m-look-meta">
            <div class="m-look-vibe">${l.vibe}${rendered ? ' <span class="m-worn-dot">•</span>' : ""}</div>
            <div class="m-look-pieces">${mobileNames(l.slots).join(" · ") || "—"}</div>
            <div class="m-chip-row" style="margin:3px 0 0 0;">
              <button class="m-mini" onclick="wearLook('${l.id}')">wear</button>
              ${rendered ? `<button class="m-mini" id="m-look-worn-${l.id}" onclick="toggleLookWorn('${l.id}')">worn</button>` : ""}
              <button class="m-mini" onclick="deleteLook('${l.id}')">del</button>
            </div>
          </div>
        </div>`; }).join("")
      : `<p class="m-status">No saved looks yet. Build one in Stylist and press <strong>Save Look</strong>.</p>`;
  }

  else if (id === "add") {
    const modes = ["top", "bottom", "dress", "jacket", "shoes", "bag", "accessory", "full"]
      .map(m => `<button class="m-mini" style="${extractionMode === m ? "border-color:var(--sage-green);color:var(--sage-green);" : ""}" onclick="setExtractionMode('${m}')">${m}</button>`)
      .join("");
    c.innerHTML = `<div style="text-align:center;padding:6px 2px;">
      <div style="border:2px dashed var(--light-pink);background:var(--pink-light);padding:22px 12px;border-radius:var(--radius-card);margin-bottom:10px;"
           onclick="document.getElementById('m-file').click()">
        <span style="font-size:2.2rem;display:block;margin-bottom:8px;">📸</span>
        <h4 style="font-size:0.9rem;margin-bottom:4px;">Snap / Choose a photo</h4>
        <p style="font-size:0.72rem;">The garment is cut out for you — background gone, model gone.</p>
      </div>
      <input type="file" id="m-file" accept="image/*" style="display:none;"
             onchange="onMobileFilePicked(this)">
      <div class="m-chip-row" style="justify-content:center;">${modes}</div>
      <p class="m-status">Pick what to look for, then choose a photo. Fine-tuning the cutout
      — the drag box and the erase / draw brushes — opens full screen, because it needs the room.</p>
    </div>`;
  }
}

/** The phone's file picker feeds the same upload pipeline the dashboard uses. */
function onMobileFilePicked(input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  switchTab("add");
  handleImageUpload(file, file.name);
  input.value = "";
}

// ============ 15. HELPERS ============
function updateStats() {
  const total = document.getElementById("stats-total-items");
  const fav = document.getElementById("stats-fav-items");
  const outfits = document.getElementById("stats-outfits");
  if (total) total.textContent = wardrobe.length;
  if (fav) fav.textContent = wardrobe.filter(i => i.favorite).length;
  if (outfits) outfits.textContent = outfitsCount;
}
/**
 * Writes the closet, and says whether it worked.
 *
 * Cutouts are big and localStorage is small, so a full closet is a real
 * outcome rather than a theoretical one. It used to throw from here and take
 * the caller down with it halfway through adding a garment.
 */
function saveWardrobeData(items) {
  const data = items || wardrobe;
  try {
    localStorage.setItem("pp_wardrobe_v3", JSON.stringify(data));
    return true;
  } catch (e) {
    showToast("⚠ Your closet is full — delete a garment or two to make room.");
    return false;
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

window.onload = initApp;
