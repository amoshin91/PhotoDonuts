/* =============================================================================
   app.js — State + UI wiring for the Glaze & Co. donut builder.
   Depends on: config.js (DB), menu.js (Menu), donut-svg.js (DonutSVG),
               pricing.js (Pricing), pickup.js (Pickup).

   Flow note: the store is chosen BEFORE the builder, because each store
   stocks its own icings and sprinkle colors. Everything the builder offers
   is filtered through Menu.forStore(selectedStore()).
   ============================================================================ */
(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------ STATE ---------------------------------- */
  const DEFAULT_DESIGN = () => ({
    typeId: "classic-ring",
    fillingId: "none",
    icingId: "vanilla",
    // custom icing
    tieDyeIcing: false,
    icingTintId: null,
    // drizzle (icing lines on top) — reuses the icing flavors/colors, or Custom
    drizzleId: null,
    drizzleCustomId: null,
    // sprinkles
    sprinkleColorIds: [],
    noSprinkles: true,
    rainbowSprinkles: false,
    chocolateSprinkles: false,
    heavySprinkles: false,
    halfSprinkles: false,
  });

  const state = {
    design: DEFAULT_DESIGN(),
    editingBoxId: null,
    cart: { boxes: [] }, // {id, design, qty}
    pickup: { location: null, locationLabel: "", storeId: null, dateStr: null, slotHm: null },
    checkout: { mode: "guest", name: "", email: "", phone: "", consent: false },
    placed: null, // confirmation payload
  };

  let nextBoxId = 1;

  // Card fields live in memory only — they survive checkout re-renders (picking
  // a store/day/slot rebuilds the DOM) but are never written to localStorage.
  const payment = { card: "", exp: "", cvc: "" };

  /* --------------------- PERSISTENCE (localStorage) ---------------------- */
  /* Cart + pickup + checkout survive navigation to the separate checkout page
     (and a page refresh). The in-progress builder design is NOT persisted. */
  const LS_KEY = "glaze_order_v1";
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        boxes: state.cart.boxes, nextBoxId, pickup: state.pickup, checkout: state.checkout,
      }));
    } catch (e) {}
  }
  function loadPersisted() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Array.isArray(d.boxes)) state.cart.boxes = d.boxes;
      if (typeof d.nextBoxId === "number") nextBoxId = d.nextBoxId;
      if (d.pickup) state.pickup = Object.assign(state.pickup, d.pickup);
      if (d.checkout) state.checkout = Object.assign(state.checkout, d.checkout);
      validatePersistedPickup();
    } catch (e) {}
  }

  // Persisted pickup can go stale between visits: the store may no longer
  // exist (config change), the date may now be in the past, or the slot may
  // have filled / fallen inside the lead time. Drop whatever no longer holds.
  function validatePersistedPickup() {
    const p = state.pickup;
    if (!p.storeId) return;
    // boxes.html doesn't load pickup.js — nothing there reads the schedule, so
    // leave the persisted pickup alone for the page that actually uses it.
    if (typeof Pickup === "undefined") return;
    const store = DB.STORES.find((s) => s.id === p.storeId);
    // Gone from config, or the dashboard has since paused online ordering there.
    if (!store || store.active === false) { p.storeId = null; p.dateStr = null; p.slotHm = null; return; }
    if (p.dateStr && p.dateStr < Pickup.minSelectableDate(store)) { p.dateStr = null; p.slotHm = null; return; }
    if (p.dateStr && p.slotHm) {
      const res = Pickup.generateSlots(store, p.dateStr);
      const slot = res.slots.find((s) => s.hm === p.slotHm);
      if (!slot || !slot.available) p.slotHm = null;
    }
  }
  function clearPersisted() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }

  // The active order panel: the checkout page's main column, or the cart drawer.
  function panelRoot() { return document.getElementById("checkoutMain") || document.getElementById("drawerBody"); }
  // Re-render whichever panel is showing.
  function refreshPanel() {
    if (document.getElementById("checkoutMain")) renderCheckoutPage();
    else renderDrawer();
  }

  /* --------------------------- DESIGN HELPERS ---------------------------- */
  function activeIcing(d) { return DB.ICINGS.find((i) => i.id === d.icingId); }
  function activeType(d) { return DB.DONUT_TYPES.find((t) => t.id === d.typeId); }

  /* ------------------------- STORE-SCOPED MENU --------------------------- */
  // The chosen store decides which icings and sprinkle colors exist. Until one
  // is chosen the builder is locked, so currentMenu() is only consulted for
  // rendering — never to silently widen what's on offer.
  function selectedStore() { return Menu.storeById(state.pickup.storeId); }
  function currentMenu() { return Menu.forStore(selectedStore()); }
  function hasStore() { return !!selectedStore(); }

  // Vanilla unlocks one bonus sprinkle slot → max 5 instead of 4.
  function maxSprinkleColors(d) {
    const icing = activeIcing(d);
    return DB.MAX_SPRINKLE_COLORS + (icing && icing.bonusSprinkle ? 1 : 0);
  }

  function paletteById(id) { return DB.SPRINKLE_PALETTE.find((s) => s.id === id); }

  function resolveDesign(d) {
    const icing = activeIcing(d);

    // icing: solid/tinted color or tie-dye swirl
    let icingHex = null, tieDye = false;
    if (icing && icing.custom) {
      if (d.tieDyeIcing) tieDye = true;
      else if (d.icingTintId) { const t = paletteById(d.icingTintId); icingHex = t ? t.hex : null; }
    }

    // sprinkle mode: none → rainbow → chocolate → custom colors
    let sprinkleHexes = [], sprinkleNames = [], rainbowColors = false;
    if (!d.noSprinkles) {
      if (d.rainbowSprinkles) {
        sprinkleHexes = DB.RAINBOW_SPRINKLE_IDS.map((id) => (paletteById(id) || {}).hex).filter(Boolean);
        sprinkleNames = ["Rainbow"];
        rainbowColors = true;
      } else if (d.chocolateSprinkles) {
        sprinkleHexes = [DB.CHOCOLATE_SPRINKLE_HEX];
        sprinkleNames = ["Chocolate"];
      } else {
        const cols = d.sprinkleColorIds.map(paletteById).filter(Boolean);
        sprinkleHexes = cols.map((c) => c.hex);
        sprinkleNames = cols.map((c) => c.name);
      }
    }

    // drizzle: an icing flavor's color, or a custom palette color
    let drizzleHex = null, drizzleName = null;
    if (d.drizzleId === "custom") {
      const c = paletteById(d.drizzleCustomId);
      if (c) { drizzleHex = c.hex; drizzleName = c.name; }
    } else if (d.drizzleId) {
      const dz = DB.ICINGS.find((i) => i.id === d.drizzleId);
      if (dz) { drizzleHex = dz.color; drizzleName = dz.name; }
    }

    return {
      typeId: d.typeId,
      fillingId: d.fillingId,
      icingId: d.icingId,
      icingHex,
      tieDye,
      drizzleHex,
      drizzleName,
      sprinkleHexes,
      sprinkleNames,
      rainbowColors,
      heavySprinkles: d.heavySprinkles,
      halfSprinkles: d.halfSprinkles,
      noSprinkles: d.noSprinkles,
    };
  }

  function sprinkleActive(d) {
    return !d.noSprinkles && (d.rainbowSprinkles || d.chocolateSprinkles || d.sprinkleColorIds.length > 0);
  }

  // decorative color dots for cart / order summary (names are in the text desc)
  function sprinkleDotsHtml(d) {
    if (!sprinkleActive(d)) return "";
    let dots = "";
    if (d.rainbowSprinkles) dots = `<span class="spr-dot spr-dot--rainbow"></span>`;
    else if (d.chocolateSprinkles) dots = `<span class="spr-dot" style="background:${DB.CHOCOLATE_SPRINKLE_HEX}"></span>`;
    else dots = d.sprinkleColorIds.map((id) => { const c = paletteById(id); return c ? `<span class="spr-dot" style="background:${c.hex}"></span>` : ""; }).join("");
    return `<div class="spr-dots" aria-hidden="true">${dots}</div>`;
  }

  function designSummaryText(d) {
    const type = activeType(d);
    const icing = activeIcing(d);
    const parts = [type.name];

    // icing
    if (icing && icing.custom) {
      if (d.tieDyeIcing) parts.push("Tie-dye icing");
      else if (d.icingTintId) { const t = paletteById(d.icingTintId); parts.push((t ? t.name : "Custom") + " icing"); }
      else parts.push("Custom icing");
    } else if (icing) {
      parts.push(icing.name + " icing");
    }

    if (type.fillable && d.fillingId && d.fillingId !== "none") {
      const f = DB.FILLINGS.find((x) => x.id === d.fillingId);
      if (f) parts.push(f.name + " filling");
    }

    if (d.drizzleId === "custom") {
      const c = paletteById(d.drizzleCustomId);
      if (c) parts.push(c.name + " drizzle");
    } else if (d.drizzleId) {
      const dz = DB.ICINGS.find((i) => i.id === d.drizzleId);
      if (dz) parts.push(dz.name + " drizzle");
    }

    // sprinkles
    let spr;
    if (!sprinkleActive(d)) spr = "no sprinkles";
    else if (d.rainbowSprinkles) spr = "rainbow sprinkles";
    else if (d.chocolateSprinkles) spr = "chocolate sprinkles";
    else spr = d.sprinkleColorIds.length + (d.sprinkleColorIds.length === 1 ? " sprinkle color" : " sprinkle colors");
    if (sprinkleActive(d)) {
      const fin = [];
      if (d.heavySprinkles) fin.push("extra heavy");
      if (d.halfSprinkles) fin.push("half top");
      if (fin.length) spr += " · " + fin.join(", ");
    }
    parts.push(spr);
    return parts.filter(Boolean).join(" · ");
  }

  /* --------------------------- BUILD CONTROLS ---------------------------- */
  function buildTypeOptions() {
    const root = $("#typeOptions");
    root.innerHTML = "";
    DB.DONUT_TYPES.forEach((t) => {
      const thumb = DonutSVG.render(
        { typeId: t.id, fillingId: "none", icingId: "vanilla", sprinkleHexes: ["#e83e8c", "#ffd43b", "#1971c2"], noSprinkles: false },
        { size: 64, decorative: true }
      );
      const tags = t.allergens.map((a) => `<span class="allergen-tag">${DB.ALLERGEN_LABELS[a] || a}</span>`).join("");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-card";
      btn.setAttribute("role", "radio");
      btn.dataset.id = t.id;
      btn.innerHTML = `
        <span class="type-card__check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </span>
        <span class="type-card__thumb">${thumb}</span>
        <span class="type-card__name">${t.name}</span>
        <span class="type-card__blurb">${t.blurb}</span>
        <span class="allergens">${tags}</span>`;
      root.appendChild(btn);
    });
    wireRadiogroup(root, (id) => setType(id));
  }

  function buildFillingOptions() {
    const root = $("#fillingOptions");
    root.innerHTML = "";
    DB.FILLINGS.forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.setAttribute("role", "radio");
      btn.dataset.id = f.id;
      btn.innerHTML =
        (f.color ? `<span class="chip__dot" style="background:${f.color}"></span>` : "") +
        `<span>${f.name}</span>`;
      root.appendChild(btn);
    });
    wireRadiogroup(root, (id) => { state.design.fillingId = id; update(); });
  }

  /* The four groups below are STORE-DEPENDENT: their contents change when the
     store changes, so they only populate DOM. Their listeners are delegated
     from the container and attached once in wireControls(), which keeps
     repopulating cheap and free of duplicate handlers. */
  function buildIcingOptions() {
    const root = $("#icingOptions");
    root.innerHTML = "";
    currentMenu().icings.forEach((i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.setAttribute("role", "radio");
      btn.dataset.id = i.id;
      btn.innerHTML = `<span class="chip__dot" style="background:${i.color}"></span><span>${i.name}</span>`;
      root.appendChild(btn);
    });
  }

  function buildDrizzleOptions() {
    const root = $("#drizzleOptions");
    root.innerHTML = "";
    const menu = currentMenu();
    const chip = (id, name, dot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.setAttribute("role", "radio");
      btn.dataset.id = id;
      btn.innerHTML = (dot || "") + `<span>${name}</span>`;
      root.appendChild(btn);
    };
    chip("", "None", "");
    // drizzle reuses the store's icing flavors; Custom opens a color picker
    menu.icings.filter((i) => !i.custom).forEach((i) => chip(i.id, i.name, `<span class="chip__dot" style="background:${i.color}"></span>`));
    if (menu.hasCustomIcing) chip("custom", "Custom", `<span class="chip__dot chip__dot--rainbow"></span>`);
  }

  function buildDrizzleTintOptions() {
    const root = $("#drizzleTintOptions");
    root.innerHTML = "";
    currentMenu().sprinkles.forEach((c) => root.appendChild(makeSwatch(c, "radio")));
  }

  function buildSprinkleOptions() {
    const root = $("#sprinkleOptions");
    root.innerHTML = "";
    currentMenu().sprinkles.forEach((c) => {
      const sw = makeSwatch(c, "checkbox");
      sw.classList.add("swatch--check");
      sw.insertAdjacentHTML("beforeend", `<span class="swatch__check" aria-hidden="true"></span>`);
      root.appendChild(sw);
    });
  }

  function buildTintOptions() {
    const root = $("#tintOptions");
    root.innerHTML = "";
    currentMenu().sprinkles.forEach((c) => root.appendChild(makeSwatch(c, "radio")));
  }

  // Repopulate everything the store scopes, then re-sync the UI. Called after
  // the store changes; the design has already been coerced onto the new menu.
  function rebuildStoreOptions() {
    buildIcingOptions();
    buildDrizzleOptions();
    buildDrizzleTintOptions();
    buildTintOptions();
    buildSprinkleOptions();
  }

  // One-time delegated listeners for the store-dependent groups.
  function wireControls() {
    wireRadiogroup($("#icingOptions"), (id) => setIcing(id));
    wireRadiogroup($("#drizzleOptions"), (id) => { state.design.drizzleId = id || null; update(); });

    $("#drizzleTintOptions").addEventListener("click", (e) => {
      const btn = e.target.closest(".swatch");
      if (!btn || btn.disabled) return;
      const id = btn.dataset.id;
      state.design.drizzleCustomId = state.design.drizzleCustomId === id ? null : id;
      update();
    });

    $("#tintOptions").addEventListener("click", (e) => {
      const btn = e.target.closest(".swatch");
      if (!btn || btn.disabled) return;
      const id = btn.dataset.id;
      state.design.icingTintId = state.design.icingTintId === id ? null : id;
      state.design.tieDyeIcing = false; // tint and tie-dye are mutually exclusive
      update();
    });

    $("#sprinkleOptions").addEventListener("click", (e) => {
      const btn = e.target.closest(".swatch");
      if (!btn || btn.disabled) return;
      toggleSprinkle(btn.dataset.id);
    });

    $("#noSprinkles").addEventListener("change", (e) => {
      state.design.noSprinkles = e.target.checked;
      if (e.target.checked) {
        state.design.sprinkleColorIds = [];
        state.design.rainbowSprinkles = false;
        state.design.chocolateSprinkles = false;
      }
      update();
    });
  }

  function makeSwatch(color, kind) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.setAttribute("role", kind === "radio" ? "radio" : "checkbox");
    btn.dataset.id = color.id;
    btn.innerHTML = `<span class="swatch__chip" style="background:${color.hex}"></span><span class="swatch__name">${color.name}</span>`;
    return btn;
  }

  /* --------------------------- STATE MUTATORS ---------------------------- */
  function setType(id) {
    state.design.typeId = id;
    const t = activeType(state.design);
    if (!t.fillable) state.design.fillingId = "none";
    update();
  }
  function setIcing(id) {
    state.design.icingId = id;
    const icing = activeIcing(state.design);
    if (!icing || !icing.custom) { state.design.tieDyeIcing = false; state.design.icingTintId = null; }
    // leaving Vanilla drops the max from 5 → 4: trim any extra color
    const max = maxSprinkleColors(state.design);
    if (state.design.sprinkleColorIds.length > max) {
      state.design.sprinkleColorIds = state.design.sprinkleColorIds.slice(0, max);
    }
    update();
  }
  function toggleSprinkle(id) {
    const d = state.design;
    const idx = d.sprinkleColorIds.indexOf(id);
    if (idx !== -1) {
      d.sprinkleColorIds.splice(idx, 1);
      flashNote("");
    } else {
      const max = maxSprinkleColors(d);
      if (d.sprinkleColorIds.length >= max) {
        flashNote(`Up to ${max} colors — remove one to swap.`, true);
        return;
      }
      d.noSprinkles = false;
      d.rainbowSprinkles = false; // hand-picking colors leaves preset modes
      d.chocolateSprinkles = false;
      d.sprinkleColorIds.push(id);
    }
    update();
  }

  let noteTimer;
  function flashNote(msg, warn) {
    const note = $("#sprinkleNote");
    note._sticky = !!msg && !!warn;
    note.textContent = msg;
    note.classList.toggle("field-note--warn", !!warn);
    clearTimeout(noteTimer);
    if (warn) noteTimer = setTimeout(() => { syncSprinkleNote(); }, 2200);
  }

  /* ------------------------------- UPDATE -------------------------------- */
  function update() {
    syncUI();
    renderPreview();
    renderDozen();
    renderPrice();
    renderBreakdown();
    renderAllergens();
    autoManageDozen();
  }

  function syncUI() {
    const d = state.design;
    const type = activeType(d);
    const icing = activeIcing(d);

    // type
    $$("#typeOptions .type-card").forEach((c) => setChecked(c, c.dataset.id === d.typeId));
    // filling visibility
    const fillingGroup = $("#fillingGroup");
    fillingGroup.hidden = !type.fillable;
    $$("#fillingOptions .chip").forEach((c) => setChecked(c, c.dataset.id === d.fillingId));
    // icing
    $$("#icingOptions .chip").forEach((c) => setChecked(c, c.dataset.id === d.icingId));
    // drizzle (icing lines)
    $$("#drizzleOptions .chip").forEach((c) => setChecked(c, (c.dataset.id || null) === (d.drizzleId || null)));
    $("#drizzleCustomBlock").hidden = d.drizzleId !== "custom";
    $$("#drizzleTintOptions .swatch").forEach((c) => setChecked(c, c.dataset.id === d.drizzleCustomId));
    // custom icing (tie-dye / tint)
    $("#customBlock").hidden = !(icing && icing.custom);
    $("#tieDyeBtn").setAttribute("aria-pressed", d.tieDyeIcing ? "true" : "false");
    $$("#tintOptions .swatch").forEach((c) => {
      setChecked(c, !d.tieDyeIcing && c.dataset.id === d.icingTintId);
      c.disabled = d.tieDyeIcing;
    });

    // sprinkles
    const count = d.sprinkleColorIds.length;
    const max = maxSprinkleColors(d);
    const presetActive = d.rainbowSprinkles || d.chocolateSprinkles;
    $("#noSprinkles").checked = d.noSprinkles;
    // Rainbow is a fixed 7-color mix — hidden at stores that don't stock all 7
    $("#rainbowBtn").hidden = !currentMenu().rainbowAvailable;
    $("#rainbowBtn").setAttribute("aria-pressed", d.rainbowSprinkles ? "true" : "false");
    $("#chocBtn").setAttribute("aria-pressed", d.chocolateSprinkles ? "true" : "false");
    // counter: X/4, or X/5 when Vanilla unlocks the bonus slot
    const counter = $("#sprinkleCounter");
    counter.textContent = `${presetActive ? 0 : count}/${max}`;
    $$("#sprinkleOptions .swatch").forEach((c) => {
      const id = c.dataset.id;
      const order = d.sprinkleColorIds.indexOf(id);
      const selected = order !== -1 && !presetActive && !d.noSprinkles;
      setChecked(c, selected);
      const atMax = count >= max;
      // swatches stay enabled even with "No sprinkles" on — clicking one simply
      // turns sprinkles back on (handled in toggleSprinkle)
      c.disabled = presetActive || (!d.noSprinkles && atMax && order === -1);
    });
    // finish modifiers (only when some sprinkles are on)
    $("#sprinkleMods").hidden = !sprinkleActive(d);
    $("#heavyBtn").setAttribute("aria-pressed", d.heavySprinkles ? "true" : "false");
    $("#halfBtn").setAttribute("aria-pressed", d.halfSprinkles ? "true" : "false");
    syncSprinkleNote();

    // roving tabindex: a radiogroup is one tab stop; arrows move within it
    ["#typeOptions", "#fillingOptions", "#icingOptions", "#drizzleOptions", "#drizzleTintOptions", "#tintOptions"].forEach((sel) => updateRoving($(sel)));

    // add button label
    $("#addToCart").textContent = state.editingBoxId ? "Update box" : "Add box to order";
  }

  function updateRoving(container) {
    if (!container) return;
    const opts = $$('[role="radio"]', container);
    let active = false;
    opts.forEach((o) => {
      const checked = o.getAttribute("aria-checked") === "true";
      o.tabIndex = checked ? 0 : -1;
      if (checked) active = true;
    });
    if (!active && opts[0]) opts[0].tabIndex = 0; // e.g. accent group with nothing chosen
  }

  function syncSprinkleNote() {
    const note = $("#sprinkleNote");
    if (note._sticky) return;
    note.classList.remove("field-note--warn");
    const d = state.design;
    if (d.noSprinkles) { note.textContent = "No sprinkles — clean and simple."; return; }
    if (d.rainbowSprinkles) { note.textContent = "Rainbow sprinkles — a mix of 7 colors, no extra charge."; return; }
    if (d.chocolateSprinkles) { note.textContent = "Chocolate sprinkles — no extra charge."; return; }
    const count = d.sprinkleColorIds.length;
    const max = maxSprinkleColors(d);
    const extra = Math.max(0, count - 1);
    const bonus = max > DB.MAX_SPRINKLE_COLORS ? " (Vanilla unlocks a 5th)" : "";
    if (count === 0) { note.textContent = `Choose up to ${max} colors. First color is free.${bonus}`; return; }
    const perColor = Pricing.tableFor(state.pickup.storeId).additionalSprinkleColor;
    const extraTxt = extra > 0 ? `+${Pricing.fmt(extra * perColor)} for ${extra} extra` : "no extra charge";
    note.textContent = `${count} of ${max} colors selected · ${extraTxt}.${bonus}`;
  }

  function setChecked(el, on) {
    const attr = el.getAttribute("role") === "checkbox" ? "aria-checked" : el.hasAttribute("aria-pressed") ? "aria-pressed" : "aria-checked";
    el.setAttribute(attr, on ? "true" : "false");
  }

  /* ------------------------------ PREVIEW -------------------------------- */
  let previewTimer;
  function renderPreview() {
    const hero = $("#previewHero");
    const resolved = resolveDesign(state.design);
    hero.innerHTML = DonutSVG.render(resolved, { size: 340, ariaLabel: "Live preview: " + DonutSVG.label({ ...resolved }) });
    const svg = hero.firstElementChild;
    if (svg) {
      svg.classList.add("is-swapping");
      svg.addEventListener("animationend", function h() { svg.classList.remove("is-swapping"); svg.removeEventListener("animationend", h); });
    }
    $("#previewCaption").textContent = designSummaryText(state.design);
  }

  function renderDozen() {
    const grid = $("#dozenGrid");
    const resolved = resolveDesign(state.design);
    let html = "";
    for (let i = 0; i < DB.BOX_SIZE; i++) {
      // render per cell so each SVG gets unique gradient/clip ids (no duplicate
      // DOM ids); the fixed seed keeps all 12 visually identical
      const svg = DonutSVG.render(resolved, { size: 100, decorative: true });
      html += `<div class="dozen__cell" style="animation-delay:${i * 22}ms">${svg}</div>`;
    }
    grid.innerHTML = html;
  }

  /* ----------------------- dozen collapse (12-box) ----------------------- *
   * The hero donut always shows at full size. When the sticky column can't
   * fit every section at full height, the 12-box is auto-collapsed to make
   * room. A manual toggle is also available; once the user clicks it, we stop
   * auto-managing and respect their choice. */
  let dozenUserSet = false;

  function dozenIsCollapsed() {
    const sec = $("#dozenSection");
    return !!sec && sec.classList.contains("dozen--collapsed");
  }

  function setDozenCollapsed(collapsed) {
    const sec = $("#dozenSection");
    const toggle = $("#dozenToggle");
    if (!sec || !toggle) return;
    sec.classList.toggle("dozen--collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    const txt = toggle.querySelector(".dozen__toggle-text");
    if (txt) txt.textContent = collapsed ? "Show" : "Hide";
  }

  function autoManageDozen() {
    if (dozenUserSet) return;
    const pinned = $(".stage__pinned");
    if (!pinned || getComputedStyle(pinned).position !== "sticky") {
      // stacked / mobile layout — nothing is pinned, so keep the box open
      setDozenCollapsed(false);
      return;
    }
    // Expand first to measure the natural (uncompressed) full height, then
    // collapse the 12-box only if every section can't fit in the viewport at
    // full size. Reading layout between class writes forces a synchronous
    // reflow but no paint, so there is no visible flash.
    setDozenCollapsed(false);
    const topOffset = parseFloat(getComputedStyle(pinned).top) || 0;
    const available = window.innerHeight - topOffset - 16; // small bottom gap
    const needed = pinned.scrollHeight;
    if (needed > available) setDozenCollapsed(true);
  }

  function renderPrice() {
    const { subtotal } = Pricing.priceBox(state.design, state.pickup.storeId);
    const el = $("#boxPrice");
    if (el.textContent !== Pricing.fmt(subtotal)) {
      el.textContent = Pricing.fmt(subtotal);
      el.classList.remove("is-bumped");
      void el.offsetWidth; // reflow to restart animation
      el.classList.add("is-bumped");
    }
  }

  function renderBreakdown() {
    const panel = $("#breakdownPanel");
    const { lines, subtotal } = Pricing.priceBox(state.design, state.pickup.storeId);
    panel.innerHTML =
      lines.map((l) => `<div class="breakdown__row"><span>${l.label}</span><span>${Pricing.fmt(l.amount)}</span></div>`).join("") +
      `<div class="breakdown__row breakdown__row--total"><span>Box subtotal (12)</span><span>${Pricing.fmt(subtotal)}</span></div>` +
      `<p class="field-note" style="margin-top:.4rem">Tax is added at checkout.</p>`;
  }

  function renderAllergens() {
    const type = activeType(state.design);
    const labels = type.allergens.map((a) => (DB.ALLERGEN_LABELS[a] || a).replace("Contains ", "").toLowerCase());
    $("#allergenSummary").textContent = `${type.name} contains ${labels.join(", ")}. Made in a facility that handles nuts.`;
  }

  /* ----------------------------- CART / DRAWER --------------------------- */
  function addOrUpdateBox() {
    if (!requireStore()) return; // no store → no menu → nothing valid to add
    const design = JSON.parse(JSON.stringify(state.design));
    if (state.editingBoxId) {
      const box = state.cart.boxes.find((b) => b.id === state.editingBoxId);
      if (box) {
        box.design = design;
        toast("Box updated");
      } else {
        // the box being edited was removed from the cart — keep the design
        state.cart.boxes.push({ id: nextBoxId++, design, qty: 1 });
        toast("Box added to your order");
      }
      state.editingBoxId = null;
    } else {
      state.cart.boxes.push({ id: nextBoxId++, design, qty: 1 });
      toast("Box added to your order");
    }
    syncCartCount();
    openDrawer();
    renderDrawer();
  }

  function editBox(id) {
    const box = state.cart.boxes.find((b) => b.id === id);
    if (!box) return;
    state.design = JSON.parse(JSON.stringify(box.design));
    state.editingBoxId = id;
    closeDrawer();
    update();
    document.getElementById("builder").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Editing box — change it, then Update");
  }
  function duplicateBox(id) {
    const box = state.cart.boxes.find((b) => b.id === id);
    if (!box) return;
    state.cart.boxes.push({ id: nextBoxId++, design: JSON.parse(JSON.stringify(box.design)), qty: 1 });
    syncCartCount();
    refreshPanel();
    toast("Box duplicated");
  }
  function removeBox(id) {
    state.cart.boxes = state.cart.boxes.filter((b) => b.id !== id);
    if (state.editingBoxId === id) {
      state.editingBoxId = null;
      if (!document.getElementById("checkoutMain")) update(); // "Update box" → "Add box to order"
    }
    syncCartCount();
    refreshPanel();
  }
  function changeQty(id, delta) {
    const box = state.cart.boxes.find((b) => b.id === id);
    if (!box) return;
    box.qty = Math.max(1, box.qty + delta);
    syncCartCount();
    refreshPanel();
  }

  function dozenCount() { return state.cart.boxes.reduce((s, b) => s + b.qty, 0); }
  function syncCartCount() {
    const n = dozenCount();
    const badge = $("#cartCount");
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }
    persist();
  }
  function expandedBoxes() { return state.cart.boxes.flatMap((b) => Array(b.qty).fill(b)); }

  /* ------------------------------- DRAWER -------------------------------- */
  let lastFocused = null;
  function openDrawer() {
    lastFocused = document.activeElement;
    $("#drawerOverlay").hidden = false;
    $("#orderDrawer").hidden = false;
    requestAnimationFrame(() => {
      $("#drawerOverlay").classList.add("is-open");
      $("#orderDrawer").classList.add("is-open");
      document.body.classList.add("no-scroll");
    });
    $("#closeDrawer").focus();
  }
  function closeDrawer() {
    captureCheckoutInputs();
    destroyStoreMap();
    $("#drawerOverlay").classList.remove("is-open");
    $("#orderDrawer").classList.remove("is-open");
    document.body.classList.remove("no-scroll");
    setTimeout(() => {
      $("#drawerOverlay").hidden = true;
      $("#orderDrawer").hidden = true;
    }, 400);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function captureCheckoutInputs() {
    const body = panelRoot();
    if (!body) return;
    const name = $("#coName", body); if (name) state.checkout.name = name.value;
    const email = $("#coEmail", body); if (email) state.checkout.email = email.value;
    const phone = $("#coPhone", body); if (phone) state.checkout.phone = phone.value;
    const consent = $("#coConsent", body); if (consent) state.checkout.consent = consent.checked;
    // card fields: kept in memory only so re-renders don't wipe them —
    // deliberately NOT persisted to localStorage
    const card = $("#coCard", body); if (card) payment.card = card.value;
    const exp = $("#coExp", body); if (exp) payment.exp = exp.value;
    const cvc = $("#coCvc", body); if (cvc) payment.cvc = cvc.value;
    persist();
  }

  // The cart drawer now holds ONLY what's in the cart, plus a Checkout button
  // that navigates to the dedicated checkout page (pickup + payment).
  function renderDrawer() {
    captureCheckoutInputs();
    const body = $("#drawerBody");
    if (!body) return;
    if (!state.cart.boxes.length) {
      body.innerHTML = `
        <div class="cart-empty">
          <svg viewBox="0 0 24 24" width="48" height="48" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          <p>Your order is empty.</p>
          <p style="font-size:.85rem;margin-top:.3rem">Design a dozen and add it here.</p>
          <button class="btn btn--ghost" style="margin-top:1rem" id="emptyClose">Back to builder</button>
        </div>`;
      $("#emptyClose").addEventListener("click", closeDrawer);
      return;
    }

    const totals = Pricing.priceCart(expandedBoxes(), state.pickup.storeId);
    body.innerHTML =
      renderCartSection({ context: "drawer" }) +
      `<div class="cart-foot">
        <div class="cart-foot__row"><span>Subtotal · ${dozenCount()} dozen</span><span>${Pricing.fmt(totals.subtotal)}</span></div>
        <p class="field-note" style="margin:.25rem 0 .85rem">Tax &amp; pickup are chosen at checkout. Minimum order is 1 dozen.</p>
        <button class="btn btn--primary btn--block" id="goCheckout">Checkout</button>
      </div>`;
    bindCart(body);
  }

  function renderCartSection(opts) {
    const ctx = (opts && opts.context) || "drawer";
    const rows = state.cart.boxes.map((b) => {
      const resolved = resolveDesign(b.design);
      const svg = DonutSVG.render(resolved, { size: 56, decorative: true });
      const price = Pricing.priceBox(b.design, state.pickup.storeId).subtotal;
      const manage = ctx === "drawer"
        ? `<button class="link-btn" data-act="edit" data-id="${b.id}">Edit</button>
           <button class="link-btn link-btn--muted" data-act="dup" data-id="${b.id}">Duplicate</button>`
        : "";
      return `
        <div class="box-item">
          <div class="box-item__thumb">${svg}</div>
          <div class="box-item__body">
            <div class="box-item__title">${activeType(b.design).name} dozen</div>
            <div class="box-item__desc">${designSummaryText(b.design)}</div>
            ${sprinkleDotsHtml(b.design)}
            <div class="box-item__actions">
              <span class="box-item__qty">
                <button class="qty-btn" data-act="dec" data-id="${b.id}" aria-label="Decrease quantity">−</button>
                <span class="qty-val" aria-label="Quantity">${b.qty}</span>
                <button class="qty-btn" data-act="inc" data-id="${b.id}" aria-label="Increase quantity">+</button>
              </span>
              ${manage}
              <button class="link-btn link-btn--muted" data-act="rm" data-id="${b.id}">Remove</button>
            </div>
          </div>
          <div class="box-item__price">${Pricing.fmt(price * b.qty)}</div>
        </div>`;
    }).join("");
    const foot = ctx === "drawer"
      ? `<button class="btn btn--ghost btn--block" id="addAnother" style="margin-top:.9rem">+ Design another box</button>`
      : `<a class="link-btn" href="index.html#builder" style="display:inline-block;margin-top:.7rem">← Back to builder to add or edit boxes</a>`;
    const step = ctx === "drawer" ? "" : `<span class="order-section__step">1</span> `;
    return `
      <section class="order-section">
        <h3 class="order-section__title">${step}Your boxes <span style="margin-left:auto;font-size:.8rem;font-weight:500;color:var(--ink-faint)">${dozenCount()} dozen</span></h3>
        ${rows}
        ${foot}
      </section>`;
  }

  /* --------------------------- STORE CHOOSER ------------------------------
     Shared by the builder page's step-1 gate and the checkout page's pickup
     section. Renders location search + map + nearby dropdown + the chosen
     store's card. Requires pickup.js, so it is never used on boxes.html. */

  const STORE_PIN = `<span class="store-card__pin"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg></span>`;

  function storeCardHtml(store) {
    const open = isStoreOpenNow(store);
    const dist = store.distance != null ? `${store.distance.toFixed(1)} mi` : "";
    return `
      <div class="store-card store-card--selected">
        ${STORE_PIN}
        <span style="flex:1">
          <span class="store-card__name">${escapeHtml(store.name)}</span>
          <span class="store-card__addr">${escapeHtml(store.address)}</span>
          <span class="store-card__meta">
            <span class="${open.open ? "store-open" : "store-closed"}">${open.label}</span>
            <span>${tzShort(store.timezone)}</span>
          </span>
        </span>
        ${dist ? `<span class="store-card__dist">${dist}</span>` : ""}
      </div>`;
  }

  // What this store can actually make — the reason store selection comes first.
  function storeMenuSummaryHtml(store) {
    const menu = Menu.forStore(store);
    if (menu.isFull) {
      return `<p class="menu-summary menu-summary--full">✓ Full menu — every icing and all ${DB.SPRINKLE_PALETTE.length} sprinkle colors.</p>`;
    }
    const icings = menu.icings.map((i) => escapeHtml(i.name)).join(", ");
    const dots = menu.sprinkles.map((c) => `<span class="spr-dot" style="background:${c.hex}"></span>`).join("");
    return `
      <div class="menu-summary">
        <p class="menu-summary__line"><strong>Icings here:</strong> ${icings}${menu.hasCustomIcing ? "" : " <span class=\"menu-summary__missing\">(no custom colors)</span>"}</p>
        <p class="menu-summary__line"><strong>Sprinkles:</strong> ${menu.sprinkles.length} of ${DB.SPRINKLE_PALETTE.length} colors <span class="spr-dots" aria-hidden="true">${dots}</span></p>
        ${menu.rainbowAvailable ? "" : `<p class="menu-summary__line menu-summary__missing">Rainbow mix isn't available at this location.</p>`}
      </div>`;
  }

  function storeChooserHtml() {
    const p = state.pickup;
    const stores = Pickup.sortStoresByDistance(p.location);

    let html = `
      <div class="locate-row">
        <input class="input" id="locInput" type="text" inputmode="text" placeholder="Zip, city, or address" value="${escapeHtml(p.locationLabel || "")}" aria-label="Search location" />
        <button class="btn btn--ghost" id="locSearch" type="button">Search</button>
      </div>
      <button class="btn btn--ghost btn--block geo-btn" id="geoBtn" type="button" style="margin-bottom:.9rem">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        Use my current location
      </button>`;

    html += renderMap(stores.find((s) => s.id === p.storeId), p.location);

    if (p.location && stores.length && stores[0].distance != null) {
      html += `<p class="field-note" style="margin:0 0 .2rem">Nearest: <strong>${escapeHtml(stores[0].name)}</strong> — ${stores[0].distance.toFixed(1)} mi from ${escapeHtml(p.locationLabel || "your location")}</p>`;
    }

    html += `
      <div class="field" style="margin-top:.9rem">
        <label class="field-label" for="storeSelect">Nearby stores${p.location ? " · nearest first" : " — search above to sort by distance"}</label>
        <select class="input input--full select" id="storeSelect">
          <option value="">Choose a store…</option>
          ${stores.map((s) => {
            const dist = s.distance != null ? ` · ${s.distance.toFixed(1)} mi` : "";
            return `<option value="${s.id}"${s.id === p.storeId ? " selected" : ""}>${escapeHtml(s.name + dist)}</option>`;
          }).join("")}
        </select>
      </div>`;
    return html;
  }

  /* ---- builder page: the step-1 gate ------------------------------------- */
  // Once a store is set the chooser collapses to a compact confirmed card;
  // "Change store" re-opens it. Not persisted — a reload starts collapsed.
  let storeChooserOpen = false;

  function renderStoreGate() {
    const body = $("#storeStepBody");
    if (!body) return;
    destroyStoreMap();
    const store = selectedStore();

    if (store && !storeChooserOpen) {
      const withDist = Pickup.sortStoresByDistance(state.pickup.location).find((s) => s.id === store.id) || store;
      body.innerHTML = `
        <div class="store-chosen">
          ${storeCardHtml(withDist)}
          ${storeMenuSummaryHtml(store)}
          <button class="btn btn--ghost store-chosen__change" id="changeStore" type="button">Change store</button>
        </div>`;
      $("#changeStore").addEventListener("click", () => {
        storeChooserOpen = true;
        renderStoreGate();
        $("#storeStepBody").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      syncBuilderLock();
      return;
    }

    body.innerHTML = `
      <div class="store-picker">
        <p class="store-picker__lede">Every shop stocks its own icings and sprinkle colors, so we'll only show you what your store can actually make.</p>
        ${storeChooserHtml()}
        ${store ? `<button class="btn btn--ghost" id="cancelStoreChange" type="button" style="margin-top:.8rem">Keep ${escapeHtml(store.name)}</button>` : ""}
      </div>`;
    bindStoreChooser(body);
    const cancel = $("#cancelStoreChange", body);
    if (cancel) cancel.addEventListener("click", () => { storeChooserOpen = false; renderStoreGate(); });
    initStoreMap();
    syncBuilderLock();
  }

  /* ---- checkout page: pickup store & time -------------------------------- */
  function renderPickupSection() {
    const store = selectedStore();
    let inner;

    if (store && !storeChooserOpen) {
      const withDist = Pickup.sortStoresByDistance(state.pickup.location).find((s) => s.id === store.id) || store;
      inner = storeCardHtml(withDist) +
        `<button class="btn btn--ghost btn--block" id="changeStore" type="button" style="margin-top:.6rem">Change store</button>` +
        renderDateTime(store);
    } else {
      inner = storeChooserHtml() +
        (store ? `<button class="btn btn--ghost" id="cancelStoreChange" type="button" style="margin-top:.8rem">Keep ${escapeHtml(store.name)}</button>` : "");
    }

    return `
      <section class="order-section">
        <h3 class="order-section__title"><span class="order-section__step">2</span> Pickup store &amp; time</h3>
        ${inner}
      </section>`;
  }

  /* ---- shared wiring ----------------------------------------------------- */
  function bindStoreChooser(root) {
    const locSearch = $("#locSearch", root);
    if (locSearch) locSearch.addEventListener("click", () => doLocationSearch($("#locInput", root).value));
    const locInput = $("#locInput", root);
    if (locInput) locInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doLocationSearch(locInput.value); } });
    const geoBtn = $("#geoBtn", root);
    if (geoBtn) geoBtn.addEventListener("click", doGeolocate);
    const storeSelect = $("#storeSelect", root);
    if (storeSelect) storeSelect.addEventListener("change", () => pickStore(storeSelect.value || null));
  }

  // Re-render whichever surface owns the chooser on this page.
  function rerenderStoreUI() {
    if (document.getElementById("checkoutMain")) renderCheckoutPage();
    else renderStoreGate();
  }

  /* Boxes in the cart that the CURRENT store can't make. Normally empty —
     pickStore() clears them at switch time — but a store's menu can change
     between visits, so checkout re-checks rather than trusting the cart. */
  function incompatibleBoxes() {
    const store = selectedStore();
    if (!store) return [];
    return state.cart.boxes
      .map((b) => ({ box: b, problems: Menu.checkDesign(b.design, store).problems }))
      .filter((x) => x.problems.length);
  }

  /* ---- choosing / changing the store ------------------------------------ */
  /* Switching stores can strand boxes the new store can't make. Rather than
     dropping them silently or blocking the switch, list exactly what's
     affected and let the customer decide. */
  async function pickStore(id) {
    if (!id) { rerenderStoreUI(); return; } // "Choose a store…" placeholder
    if (id === state.pickup.storeId) { storeChooserOpen = false; rerenderStoreUI(); return; }

    const next = Menu.storeById(id);
    if (!next) { rerenderStoreUI(); return; }

    const blocked = state.cart.boxes
      .map((b) => ({ box: b, problems: Menu.checkDesign(b.design, next).problems }))
      .filter((x) => x.problems.length);

    if (blocked.length) {
      const n = blocked.reduce((sum, x) => sum + x.box.qty, 0);
      const list = blocked.map((x) => `
        <li>
          <strong>${escapeHtml(activeType(x.box.design).name)} dozen</strong>${x.box.qty > 1 ? ` ×${x.box.qty}` : ""}
          <span class="dlg-list__why">needs ${escapeHtml(x.problems.join(", "))}</span>
        </li>`).join("");
      const ok = await confirmDialog({
        title: "Some boxes can't be made there",
        html: `
          <p>${escapeHtml(next.name)} doesn't carry everything ${blocked.length === 1 ? "one of your boxes uses" : "some of your boxes use"}:</p>
          <ul class="dlg-list">${list}</ul>
          <p>Switching removes ${n === 1 ? "that dozen" : `those ${n} dozen`} from your order. The rest stays put.</p>`,
        confirmLabel: "Remove & switch store",
        cancelLabel: "Keep my current store",
      });
      if (!ok) { storeChooserOpen = false; rerenderStoreUI(); return; }
      const drop = new Set(blocked.map((x) => x.box.id));
      state.cart.boxes = state.cart.boxes.filter((b) => !drop.has(b.id));
      if (drop.has(state.editingBoxId)) state.editingBoxId = null;
    }

    applyStore(id);
  }

  function applyStore(id) {
    const changedStore = state.pickup.storeId !== id;
    state.pickup.storeId = id;
    if (changedStore) { state.pickup.dateStr = null; state.pickup.slotHm = null; }
    storeChooserOpen = false;

    // pull the in-progress builder design onto the new store's menu
    const adjustments = Menu.coerceDesign(state.design, selectedStore());
    persist();

    if (document.getElementById("controls")) {
      rebuildStoreOptions();
      update();
    }
    // ready-made boxes and their prices are both store-scoped now
    renderFeatured();
    syncCartCount();
    rerenderStoreUI();
    if (adjustments.length) toast("Design adjusted: " + adjustments.join("; "), true);
  }

  // The builder stays inert until a store is chosen — its options don't exist
  // until we know which store's menu to draw from.
  function syncBuilderLock() {
    const builder = document.getElementById("builder");
    if (!builder) return;
    const locked = !hasStore();
    builder.classList.toggle("is-locked", locked);
    const note = $("#builderLockedNote");
    if (note) note.hidden = !locked;
    const grid = $(".builder__grid", builder);
    if (grid) {
      grid.setAttribute("aria-hidden", locked ? "true" : "false");
      if ("inert" in grid) grid.inert = locked; // real keyboard/AT blocking
    }
  }

  /* ---- small confirm dialog (used for destructive store switches) -------- */
  function confirmDialog(opts) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const wrap = document.createElement("div");
      wrap.className = "dlg-overlay";
      wrap.innerHTML = `
        <div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitle" aria-describedby="dlgBody">
          <h2 class="dlg__title" id="dlgTitle">${escapeHtml(opts.title)}</h2>
          <div class="dlg__body" id="dlgBody">${opts.html}</div>
          <div class="dlg__actions">
            <button class="btn btn--ghost" type="button" data-act="cancel">${escapeHtml(opts.cancelLabel || "Cancel")}</button>
            <button class="btn btn--primary" type="button" data-act="ok">${escapeHtml(opts.confirmLabel || "Confirm")}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);

      const close = (val) => {
        document.removeEventListener("keydown", onKey, true);
        wrap.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); close(false); return; }
        if (e.key !== "Tab") return;
        const f = $$("button", wrap);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      document.addEventListener("keydown", onKey, true);
      wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); });
      $('[data-act="cancel"]', wrap).addEventListener("click", () => close(false));
      $('[data-act="ok"]', wrap).addEventListener("click", () => close(true));
      $('[data-act="ok"]', wrap).focus();
    });
  }

  function renderMap(selected, loc) {
    const key = DB.GOOGLE_MAPS_API_KEY;
    if (key && selected) {
      const q = `${selected.lat},${selected.lng}`;
      return `<div class="map-frame"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map of ${escapeHtml(selected.name)}" src="https://www.google.com/maps/embed/v1/place?key=${key}&q=${q}&zoom=14"></iframe></div>`;
    }
    // free interactive map (Leaflet + OpenStreetMap, no API key) — markers are
    // added by initStoreMap() after this HTML is in the DOM
    if (typeof L !== "undefined") {
      return `<div class="map-frame"><div id="storeMap" class="store-map" role="img" aria-label="Map of nearby stores"></div></div>`;
    }
    // graceful static fallback (no key, Leaflet unavailable e.g. offline)
    const label = selected ? selected.name : loc ? "Stores near you" : "Find a store to see it on the map";
    return `
      <div class="map-frame"><div class="map-static">
        <span class="map-static__pin" style="left:50%;top:46%;transform:translate(-50%,-100%)">
          <svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>
        </span>
        <span class="map-static__note">${escapeHtml(label)}</span>
      </div></div>`;
  }

  // ---- free interactive map (Leaflet + CARTO/OSM tiles) -------------------
  /* Styled to read like Google Maps: Voyager basemap (see DB.MAP_TILES), red
     teardrop pins, a blue "you are here" dot, and rounded zoom controls in the
     bottom-right. Pins are inline-SVG divIcons rather than Leaflet's default
     PNG marker — same look on retina, and no extra image requests. */
  let _storeMap = null;
  function destroyStoreMap() {
    if (_storeMap) { try { _storeMap.remove(); } catch (e) {} _storeMap = null; }
  }

  // Google-style red teardrop. `selected` gets the full-size, saturated pin.
  function storePinIcon(selected) {
    const w = selected ? 27 : 22;
    const h = Math.round(w * (36 / 26));
    return L.divIcon({
      className: "map-pin" + (selected ? " map-pin--sel" : ""),
      html: `<svg width="${w}" height="${h}" viewBox="0 0 26 36" aria-hidden="true">
          <path d="M13 .8C6.3.8.9 6.2.9 12.9c0 4.5 2.6 9.5 5.3 13.4a60 60 0 0 0 6.8 8.4 60 60 0 0 0 6.8-8.4c2.7-3.9 5.3-8.9 5.3-13.4C25.1 6.2 19.7.8 13 .8z"
                fill="${selected ? "#ea4335" : "#d93025"}" stroke="#a50e0e" stroke-width="1.1"/>
          <circle cx="13" cy="12.9" r="4.4" fill="#a50e0e"/>
        </svg>`,
      iconSize: [w, h],
      iconAnchor: [w / 2, h],
      popupAnchor: [0, -h + 4],
    });
  }

  function initStoreMap() {
    destroyStoreMap();
    const el = document.getElementById("storeMap");
    if (!el || typeof L === "undefined") return;
    const p = state.pickup;
    const stores = Pickup.sortStoresByDistance(p.location);
    // zoom control is re-added bottom-right, the way Google places it
    const map = L.map(el, { scrollWheelZoom: false, zoomControl: false });
    _storeMap = map;
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const t = DB.MAP_TILES;
    L.tileLayer(t.url, {
      subdomains: t.subdomains || "abc",
      maxZoom: t.maxZoom || 19,
      attribution: t.attribution,
      detectRetina: false,
      // serve @2x tiles on retina so labels stay crisp, like Google's
      r: L.Browser.retina ? "@2x" : "",
    }).addTo(map);

    // Set the view BEFORE adding markers: Leaflet can't position a popup on a
    // map that has no centre yet, so opening one here would silently no-op.
    const pts = stores.map((s) => [s.lat, s.lng]);
    if (p.location) pts.push([p.location.lat, p.location.lng]);
    const sel = stores.find((s) => s.id === p.storeId);
    if (sel) map.setView([sel.lat, sel.lng], 14);
    else if (pts.length) map.fitBounds(pts, { padding: [34, 34], maxZoom: 14 });
    else map.setView([40.78, -73.47], 10); // Long Island default

    stores.forEach((s) => {
      const isSel = s.id === p.storeId;
      const marker = L.marker([s.lat, s.lng], {
        icon: storePinIcon(isSel),
        zIndexOffset: isSel ? 1000 : 0, // selected pin sits above its neighbours
        title: s.name,
      }).addTo(map);
      const dist = s.distance != null ? `<span class="map-iw__dist">${s.distance.toFixed(1)} mi away</span>` : "";
      marker.bindPopup(
        `<div class="map-iw">
           <div class="map-iw__name">${escapeHtml(s.name)}</div>
           <div class="map-iw__addr">${escapeHtml(s.address)}</div>
           ${dist}
         </div>`
      );
      marker.on("click", () => { pickStore(s.id); });
      if (isSel) marker.openPopup();
    });

    if (p.location) {
      // Google's blue location dot: white-ringed core inside a soft halo
      L.marker([p.location.lat, p.location.lng], {
        icon: L.divIcon({
          className: "map-dot",
          html: `<span class="map-dot__halo"></span><span class="map-dot__core"></span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          popupAnchor: [0, -12],
        }),
        zIndexOffset: 500,
      }).addTo(map).bindPopup(`<div class="map-iw"><div class="map-iw__name">Your location</div></div>`);
    }
    // the drawer animates in; recompute size once layout has settled
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 90);
  }

  // a slot only works for this order if it can hold ALL of its dozens
  function slotFitsOrder(s, need) {
    return s.passesLead && s.remaining >= need;
  }

  function renderDateTime(store) {
    const p = state.pickup;
    const need = Math.max(1, dozenCount());
    // Lead time, window length and per-slot capacity are all set per store in
    // the dashboard, so the copy below has to read them rather than hardcode.
    const sched = Pickup.schedulingFor(store);
    const cap = sched.slotCapacityDozen;
    const minDate = Pickup.minSelectableDate(store);
    if (!p.dateStr) p.dateStr = firstOpenDate(store, minDate, need);

    // day chips for the next 12 days
    let chips = "";
    for (let i = 0; i < 12; i++) {
      const ds = Pickup.addDays(minDate, i);
      const res = Pickup.generateSlots(store, ds);
      const disabled = res.closed || !res.slots.some((s) => slotFitsOrder(s, need));
      const [y, m, d] = ds.split("-").map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      const mon = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
      chips += `<button class="day-chip" type="button" data-date="${ds}" aria-pressed="${ds === p.dateStr}" ${disabled ? "disabled aria-disabled=true" : ""}>
        <span class="day-chip__dow">${dow}</span><span class="day-chip__num">${d}</span><span class="day-chip__mon">${mon}</span>
      </button>`;
    }

    const slotData = Pickup.generateSlots(store, p.dateStr);
    let slotsHtml;
    if (need > cap) {
      slotsHtml = `<p class="notice notice--warn">This order is ${need} dozen — more than the ${cap}-dozen-per-slot limit. Please call the store to arrange a large order.</p>`;
    } else if (slotData.closed) {
      slotsHtml = `<p class="notice notice--warn">${slotData.reason}</p>`;
    } else if (!slotData.slots.some((s) => slotFitsOrder(s, need))) {
      slotsHtml = `<p class="notice">${need > 1 ? `No time on this day has room for all ${need} dozen — try another day.` : slotData.reason || "No remaining pickup times for this day."}</p>`;
    } else {
      slotsHtml = `<div class="slots">` + slotData.slots.map((s) => {
        if (!s.passesLead) return ""; // hide past / too-soon times entirely
        const full = !slotFitsOrder(s, need);
        const low = !full && s.remaining < need + 4;
        const cap = s.remaining <= 0 ? "Full" : full ? `Only ${s.remaining} left` : `${s.remaining} left`;
        return `<button class="slot ${low ? "slot--low" : ""}" type="button" data-slot="${s.hm}" aria-pressed="${s.hm === p.slotHm}" ${full ? "disabled aria-disabled=true" : ""}>
          ${s.label}<span class="slot__cap">${cap}</span>
        </button>`;
      }).join("") + `</div>`;
    }

    const needTxt = need > 1 ? ` · your order needs room for ${need} dozen` : "";
    return `
      <div class="field" style="margin-top:1rem">
        <span class="field-label">Pickup day <span style="font-weight:500;color:var(--ink-faint)">(${tzShort(store.timezone)})</span></span>
        <div class="day-chips">${chips}</div>
      </div>
      <div class="field">
        <span class="field-label">Pickup time · ${sched.slotIncrementMinutes}-min windows</span>
        ${slotsHtml}
        <p class="field-note" style="margin-top:.5rem">${Pickup.formatDuration(sched.leadTimeMinutes)} minimum lead time · same-day cutoff &amp; store hours applied · ${cap} dozen per slot${needTxt}.</p>
      </div>`;
  }

  function firstOpenDate(store, minDate, need) {
    for (let i = 0; i < 14; i++) {
      const ds = Pickup.addDays(minDate, i);
      const res = Pickup.generateSlots(store, ds);
      if (!res.closed && res.slots.some((s) => slotFitsOrder(s, need))) return ds;
    }
    return minDate;
  }

  function pickupComplete() {
    const p = state.pickup;
    if (!p.storeId || !p.dateStr || !p.slotHm) return false;
    const store = DB.STORES.find((s) => s.id === p.storeId);
    if (!store) return false;
    const res = Pickup.generateSlots(store, p.dateStr);
    const slot = res.slots.find((s) => s.hm === p.slotHm);
    return !!(slot && slotFitsOrder(slot, Math.max(1, dozenCount())));
  }

  /* ------------------------------ CHECKOUT ------------------------------- */
  function renderCheckoutSection() {
    const ready = pickupComplete();
    const c = state.checkout;
    if (!ready) {
      return `
        <section class="order-section" aria-disabled="true" style="opacity:.6">
          <h3 class="order-section__title"><span class="order-section__step">3</span> Contact &amp; payment</h3>
          <p class="field-note">Choose a store, day, and time above to continue to payment.</p>
        </section>`;
    }
    return `
      <section class="order-section">
        <h3 class="order-section__title"><span class="order-section__step">3</span> Contact &amp; payment</h3>
        <div class="seg" role="group" aria-label="Checkout type">
          <button class="seg__btn" type="button" data-mode="guest" aria-pressed="${c.mode === "guest"}">Guest checkout</button>
          <button class="seg__btn" type="button" data-mode="account" aria-pressed="${c.mode === "account"}">Create account</button>
        </div>
        <div class="form-grid">
          <div class="field">
            <label class="field-label" for="coName">Full name</label>
            <input class="input input--full" id="coName" type="text" autocomplete="name" value="${escapeHtml(c.name)}" placeholder="Alex Rivera" />
          </div>
          <div class="form-grid form-grid--2">
            <div class="field">
              <label class="field-label" for="coEmail">Email</label>
              <input class="input input--full" id="coEmail" type="email" autocomplete="email" value="${escapeHtml(c.email)}" placeholder="you@email.com" />
            </div>
            <div class="field">
              <label class="field-label" for="coPhone">Mobile (for SMS)</label>
              <input class="input input--full" id="coPhone" type="tel" autocomplete="tel" value="${escapeHtml(c.phone)}" placeholder="(555) 123-4567" />
            </div>
          </div>
          ${c.mode === "account" ? `
          <div class="field">
            <label class="field-label" for="coPass">Create a password</label>
            <input class="input input--full" id="coPass" type="password" autocomplete="new-password" placeholder="At least 8 characters" />
          </div>` : ""}
        </div>

        <p class="field-label" style="margin:1rem 0 .4rem">Payment</p>
        <div class="pay-card">
          <div class="pay-card__row"><span>Pay online now</span><span>🔒 Secure</span></div>
          <input class="input input--full input-dark" id="coCard" inputmode="numeric" autocomplete="cc-number" placeholder="Card number" aria-label="Card number" value="${escapeHtml(payment.card)}" style="margin:.6rem 0" />
          <div class="form-grid form-grid--2">
            <input class="input input--full input-dark" id="coExp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM / YY" aria-label="Expiration date" value="${escapeHtml(payment.exp)}" />
            <input class="input input--full input-dark" id="coCvc" inputmode="numeric" autocomplete="cc-csc" placeholder="CVC" aria-label="Security code" maxlength="4" value="${escapeHtml(payment.cvc)}" />
          </div>
        </div>

        <label class="consent">
          <input type="checkbox" id="coConsent" ${c.consent ? "checked" : ""} />
          <span>Email + text me my order confirmation and pickup reminders.</span>
        </label>
        <p class="field-error" id="coError" hidden></p>
      </section>`;
  }

  // Shown only if a store's menu changed under an existing cart.
  function renderUnmakeableSection() {
    const bad = incompatibleBoxes();
    if (!bad.length) return "";
    const store = selectedStore();
    const list = bad.map((x) => `
      <li><strong>${escapeHtml(activeType(x.box.design).name)} dozen</strong>${x.box.qty > 1 ? ` ×${x.box.qty}` : ""}
      <span class="dlg-list__why">needs ${escapeHtml(x.problems.join(", "))}</span></li>`).join("");
    return `
      <section class="order-section">
        <p class="notice notice--warn" style="margin-bottom:.8rem">
          ${escapeHtml(store.name)} can no longer make ${bad.length === 1 ? "one box" : `${bad.length} boxes`} in this order.
        </p>
        <ul class="dlg-list">${list}</ul>
        <button class="btn btn--ghost btn--block" id="dropUnmakeable" type="button">
          Remove ${bad.length === 1 ? "it" : "them"} and continue
        </button>
        <p class="field-note" style="margin-top:.5rem">Or pick a different store above.</p>
      </section>`;
  }

  function renderTotalsSection() {
    const totals = Pricing.priceCart(expandedBoxes(), state.pickup.storeId);
    const ready = pickupComplete() && !incompatibleBoxes().length;
    const store = DB.STORES.find((s) => s.id === state.pickup.storeId);
    const whenText = ready ? Pickup.formatPickupWhen(store, state.pickup.dateStr, state.pickup.slotHm) : null;
    return `
      <section class="order-section">
        ${whenText ? `<p class="notice" style="margin-bottom:.9rem">Pickup at <strong>${escapeHtml(store.name)}</strong><br>${whenText}</p>` : ""}
        <div class="totals">
          <div class="totals__row"><span>Subtotal · ${dozenCount()} dozen</span><span>${Pricing.fmt(totals.subtotal)}</span></div>
          <div class="totals__row"><span>Tax (${(totals.taxRate * 100).toFixed(2)}%)</span><span>${Pricing.fmt(totals.tax)}</span></div>
          <div class="totals__row totals__row--grand"><span>Total</span><span>${Pricing.fmt(totals.total)}</span></div>
        </div>
        <button class="btn btn--primary btn--block" id="placeOrder" style="margin-top:1rem" ${ready ? "" : "disabled"}>
          ${ready ? "Pay " + Pricing.fmt(totals.total) + " & reserve pickup"
            : incompatibleBoxes().length ? "Resolve unavailable boxes to continue"
            : "Select pickup to continue"}
        </button>
        <p class="field-note" style="text-align:center;margin-top:.6rem">Minimum order is 1 dozen.</p>
      </section>`;
  }

  // Cart actions (qty / edit / duplicate / remove) + footer buttons. Used on
  // both the cart drawer and the checkout page's order summary.
  function bindCart(root) {
    const addAnother = $("#addAnother", root);
    if (addAnother) addAnother.addEventListener("click", () => { closeDrawer(); state.editingBoxId = null; update(); document.getElementById("builder").scrollIntoView({ behavior: "smooth" }); });

    const goCheckout = $("#goCheckout", root);
    if (goCheckout) goCheckout.addEventListener("click", () => { captureCheckoutInputs(); window.location.href = "checkout.html"; });

    $$(".box-item [data-act]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = +btn.dataset.id;
        const act = btn.dataset.act;
        if (act === "inc") changeQty(id, 1);
        else if (act === "dec") changeQty(id, -1);
        else if (act === "edit") editBox(id);
        else if (act === "dup") duplicateBox(id);
        else if (act === "rm") removeBox(id);
      });
    });
  }

  // Pickup + contact/payment controls — checkout page only.
  function bindCheckoutControls(root) {
    bindStoreChooser(root); // location search + geolocate + nearby dropdown

    const changeStore = $("#changeStore", root);
    if (changeStore) changeStore.addEventListener("click", () => { storeChooserOpen = true; renderCheckoutPage(); });
    const cancelChange = $("#cancelStoreChange", root);
    if (cancelChange) cancelChange.addEventListener("click", () => { storeChooserOpen = false; renderCheckoutPage(); });

    $$(".day-chip", root).forEach((chip) => {
      if (chip.disabled) return;
      chip.addEventListener("click", () => { state.pickup.dateStr = chip.dataset.date; state.pickup.slotHm = null; renderCheckoutPage(); });
    });
    $$(".slot", root).forEach((slot) => {
      if (slot.disabled) return;
      slot.addEventListener("click", () => { state.pickup.slotHm = slot.dataset.slot; renderCheckoutPage(); });
    });

    $$(".seg__btn", root).forEach((b) => b.addEventListener("click", () => { captureCheckoutInputs(); state.checkout.mode = b.dataset.mode; renderCheckoutPage(); }));

    // live formatting: card in groups of 4, expiry as MM / YY
    const cardEl = $("#coCard", root);
    if (cardEl) cardEl.addEventListener("input", () => {
      const digits = cardEl.value.replace(/\D/g, "").slice(0, 19);
      cardEl.value = digits.replace(/(.{4})/g, "$1 ").trim();
    });
    const expEl = $("#coExp", root);
    if (expEl) expEl.addEventListener("input", () => {
      let digits = expEl.value.replace(/\D/g, "").slice(0, 4);
      expEl.value = digits.length >= 3 ? digits.slice(0, 2) + " / " + digits.slice(2) : digits;
    });
    const cvcEl = $("#coCvc", root);
    if (cvcEl) cvcEl.addEventListener("input", () => { cvcEl.value = cvcEl.value.replace(/\D/g, "").slice(0, 4); });

    const place = $("#placeOrder", root);
    if (place) place.addEventListener("click", placeOrder);
  }

  /* --------------------------- CHECKOUT PAGE ----------------------------- */
  // Renders the full pickup + payment flow into #checkoutMain on checkout.html.
  function renderCheckoutPage() {
    destroyStoreMap();
    if (state.placed) { renderConfirmation(); return; }
    captureCheckoutInputs();
    const main = $("#checkoutMain");
    if (!main) return;
    if (!state.cart.boxes.length) {
      main.innerHTML = `
        <div class="cart-empty">
          <svg viewBox="0 0 24 24" width="48" height="48" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          <p>Your order is empty.</p>
          <p style="font-size:.85rem;margin-top:.3rem">Add a dozen before checking out.</p>
          <a class="btn btn--primary" style="margin-top:1rem" href="index.html#builder">Back to builder</a>
        </div>`;
      return;
    }
    main.innerHTML =
      renderCartSection({ context: "checkout" }) +
      renderUnmakeableSection() +
      renderPickupSection() +
      renderCheckoutSection() +
      renderTotalsSection();
    bindCart(main);
    bindCheckoutControls(main);
    const drop = $("#dropUnmakeable", main);
    if (drop) drop.addEventListener("click", () => {
      const gone = new Set(incompatibleBoxes().map((x) => x.box.id));
      state.cart.boxes = state.cart.boxes.filter((b) => !gone.has(b.id));
      if (gone.has(state.editingBoxId)) state.editingBoxId = null;
      persist();
      syncCartCount();
      renderCheckoutPage();
      toast(gone.size === 1 ? "Box removed" : `${gone.size} boxes removed`);
    });
    initStoreMap();
  }

  async function doLocationSearch(value) {
    const q = (value || "").trim();
    if (!q) return;
    const btn = $("#locSearch");
    if (btn) { btn.disabled = true; btn.textContent = "Searching…"; }
    let loc = null;
    try { loc = await Pickup.geocode(q); } catch (e) { loc = null; }
    if (!loc) {
      if (btn) { btn.disabled = false; btn.textContent = "Search"; }
      toast("Couldn't find that location — try another zip, city, or address.", true);
      return;
    }
    state.pickup.location = { lat: loc.lat, lng: loc.lng };
    state.pickup.locationLabel = loc.label || q;
    rerenderStoreUI();
  }
  function doGeolocate() {
    if (!navigator.geolocation) { toast("Geolocation isn't available — enter a location.", true); return; }
    toast("Locating you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.pickup.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.pickup.locationLabel = "Your current location";
        rerenderStoreUI();
        toast("Sorted by distance from you");
      },
      () => toast("Location blocked — enter a zip or city instead.", true),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  /* ----------------------------- PLACE ORDER ----------------------------- */
  // Luhn checksum — catches typos in the demo card field. (Real payments will
  // move to Stripe Elements; see PROJECT_STATUS.)
  function luhnOk(num) {
    const d = num.replace(/\D/g, "");
    if (d.length < 13 || d.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = +d[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }
  function expiryOk(v) {
    const m = v.replace(/\s/g, "").match(/^(\d{2})\/?(\d{2})$/);
    if (!m) return false;
    const mm = +m[1], yy = 2000 + +m[2];
    if (mm < 1 || mm > 12) return false;
    const now = new Date();
    return yy > now.getFullYear() || (yy === now.getFullYear() && mm >= now.getMonth() + 1);
  }

  function placeOrder() {
    captureCheckoutInputs();
    const c = state.checkout;
    const body = panelRoot();
    const err = $("#coError", body);

    // last line of defence: never submit an order the store can't make
    const unmakeable = incompatibleBoxes();
    if (unmakeable.length) {
      renderCheckoutPage();
      toast("Some boxes aren't available at this store — resolve them first.", true);
      return;
    }
    const problems = []; // { sel, msg } — sel marks the offending field
    if (!c.name.trim()) problems.push({ sel: "#coName", msg: "your name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) problems.push({ sel: "#coEmail", msg: "a valid email" });
    if (c.phone.replace(/\D/g, "").length < 10) problems.push({ sel: "#coPhone", msg: "a 10-digit mobile number" });
    if (!luhnOk(payment.card)) problems.push({ sel: "#coCard", msg: "a valid card number" });
    if (!expiryOk(payment.exp)) problems.push({ sel: "#coExp", msg: "a valid expiration (MM / YY)" });
    if (payment.cvc.replace(/\D/g, "").length < 3) problems.push({ sel: "#coCvc", msg: "the card's CVC" });
    if (!c.consent) problems.push({ sel: "#coConsent", msg: "confirmation consent" });

    $$(".input", body).forEach((i) => { i.classList.remove("is-invalid"); i.removeAttribute("aria-invalid"); });
    if (problems.length) {
      problems.forEach((p) => {
        const el = $(p.sel, body);
        if (el && el.classList.contains("input")) { el.classList.add("is-invalid"); el.setAttribute("aria-invalid", "true"); }
      });
      err.hidden = false;
      err.textContent = "Please add " + problems.map((p) => p.msg).join(", ") + ".";
      const first = $(problems[0].sel, body);
      if (first && first.focus) first.focus();
      err.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const store = DB.STORES.find((s) => s.id === state.pickup.storeId);
    const totals = Pricing.priceCart(expandedBoxes(), state.pickup.storeId);
    state.placed = {
      orderId: "GC-" + Math.random().toString(36).slice(2, 7).toUpperCase(),
      store,
      when: Pickup.formatPickupWhen(store, state.pickup.dateStr, state.pickup.slotHm),
      totals,
      email: c.email.trim(),
      phone: c.phone.trim(),
      dozens: dozenCount(),
      accountCreated: c.mode === "account",
    };
    // order submitted — clear the working cart so a refresh doesn't re-checkout
    state.cart.boxes = [];
    payment.card = payment.exp = payment.cvc = "";
    clearPersisted();
    renderConfirmation();
  }

  function renderConfirmation() {
    const o = state.placed;
    const body = panelRoot();
    const title = $("#drawerTitle"); if (title) title.textContent = "Order confirmed";
    body.innerHTML = `
      <div class="confirm">
        <div class="confirm__check"><svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>
        <h2 class="confirm__title">You're all set!</h2>
        <p class="confirm__sub">Order <strong>${o.orderId}</strong>${o.accountCreated ? " · account created" : ""}</p>
        <div class="confirm__notify">
          <span class="notify-pill">✉︎ Email sent to ${escapeHtml(maskEmail(o.email))}</span>
          <span class="notify-pill">✆ Text sent to ${escapeHtml(maskPhone(o.phone))}</span>
        </div>
        <div class="confirm__card">
          <p style="font-weight:600;margin-bottom:.3rem">${escapeHtml(o.store.name)}</p>
          <p style="font-size:.86rem;color:var(--ink-soft)">${escapeHtml(o.store.address)}</p>
          <p style="margin-top:.6rem"><strong>Pickup:</strong> ${o.when}</p>
          <div class="totals" style="margin-top:.8rem">
            <div class="totals__row"><span>${o.dozens} dozen</span><span>${Pricing.fmt(o.totals.subtotal)}</span></div>
            <div class="totals__row"><span>Tax</span><span>${Pricing.fmt(o.totals.tax)}</span></div>
            <div class="totals__row totals__row--grand"><span>Paid</span><span>${Pricing.fmt(o.totals.total)}</span></div>
          </div>
        </div>
        <button class="btn btn--primary btn--block" id="newOrder" style="margin-top:1.2rem">Start a new order</button>
      </div>`;
    $("#newOrder").addEventListener("click", () => {
      state.placed = null;
      state.cart.boxes = [];
      state.pickup = { location: null, locationLabel: "", storeId: null, dateStr: null, slotHm: null };
      state.checkout = { mode: "guest", name: "", email: "", phone: "", consent: false };
      state.design = DEFAULT_DESIGN();
      state.editingBoxId = null;
      clearPersisted();
      // from the checkout page, return to the builder to start fresh
      if (document.getElementById("checkoutMain")) { window.location.href = "index.html"; return; }
      syncCartCount();
      const t = $("#drawerTitle"); if (t) t.textContent = "Your order";
      closeDrawer();
      update();
    });
  }

  /* ------------------------------- HELPERS ------------------------------- */
  function isStoreOpenNow(store) {
    const today = Pickup.weekdayOf(localDateForStore(store));
    const hours = store.hours[today];
    if (!hours) return { open: false, label: "Closed today" };
    const nowMin = nowMinutesInZone(store.timezone);
    const open = nowMin >= Pickup.hmToMinutes(hours.open) && nowMin < Pickup.hmToMinutes(hours.close);
    return { open, label: open ? "Open now · until " + Pickup.formatClock(Pickup.hmToMinutes(hours.close)) : "Opens " + Pickup.formatClock(Pickup.hmToMinutes(hours.open)) };
  }
  function localDateForStore(store) {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: store.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    return f.format(new Date());
  }
  function nowMinutesInZone(tz) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const parts = f.formatToParts(new Date());
    let h = +parts.find((p) => p.type === "hour").value;
    if (h === 24) h = 0;
    const m = +parts.find((p) => p.type === "minute").value;
    return h * 60 + m;
  }
  function tzShort(tz) {
    try {
      const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" });
      return f.formatToParts(new Date()).find((p) => p.type === "timeZoneName").value;
    } catch (e) { return tz; }
  }
  function maskEmail(e) {
    const [u, d] = e.split("@");
    if (!d) return e;
    return (u.length <= 2 ? u[0] + "•" : u.slice(0, 2) + "•••") + "@" + d;
  }
  function maskPhone(p) {
    const digits = p.replace(/\D/g, "");
    return "•••-•••-" + digits.slice(-4);
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function toast(msg, warn) {
    const region = $("#toastRegion");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span class="toast__dot" style="${warn ? "background:var(--warn)" : ""}"></span><span>${escapeHtml(msg)}</span>`;
    region.appendChild(el);
    setTimeout(() => { el.classList.add("is-leaving"); setTimeout(() => el.remove(), 320); }, 2600);
  }

  /* ------------------------- ARIA radiogroup wiring ---------------------- */
  function wireRadiogroup(container, onSelect) {
    container.addEventListener("click", (e) => {
      const opt = e.target.closest('[role="radio"]');
      if (!opt || opt.getAttribute("aria-disabled") === "true") return;
      onSelect(opt.dataset.id);
      opt.focus();
    });
    container.addEventListener("keydown", (e) => {
      const opts = $$('[role="radio"]', container).filter((o) => !o.disabled);
      const i = opts.indexOf(document.activeElement);
      if (i === -1) return;
      let n = i;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % opts.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + opts.length) % opts.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = opts.length - 1;
      else return;
      e.preventDefault();
      opts[n].focus();
      onSelect(opts[n].dataset.id);
    });
  }

  /* -------------------------- FEATURED / PREMADE ------------------------- */
  // Build a complete design from a preset's partial design.
  function premadeDesign(p) {
    return Object.assign(DEFAULT_DESIGN(), JSON.parse(JSON.stringify(p.design)));
  }

  /* Ready-made boxes on offer: the shipped catalog minus anything the chosen
     store switched off in its dashboard, plus any designs that store authored
     itself. Before a store is chosen, show the full shipped catalog. */
  function storePremades() {
    const id = state.pickup.storeId;
    return id && window.Settings ? Settings.premadesFor(id) : DB.PREMADE_BOXES;
  }

  function renderFeatured() {
    const root = $("#featuredGrid");
    if (!root) return;
    const store = selectedStore();
    root.innerHTML = storePremades().map((p) => {
      const design = premadeDesign(p);
      const svg = DonutSVG.render(resolveDesign(design), { size: 134, decorative: true });
      const price = Pricing.priceBox(design, state.pickup.storeId).subtotal;
      // once a store is chosen, say up front which presets it can't make
      const problems = premadeBlocked(p);
      const note = problems
        ? `<p class="feature-card__unavailable">Not available at ${escapeHtml(store.name)} — needs ${escapeHtml(problems.join(", "))}.</p>`
        : "";
      return `
        <article class="feature-card${problems ? " feature-card--unavailable" : ""}">
          <div class="feature-card__art">
            <span class="feature-card__badge">${escapeHtml(p.occasion)}</span>
            <div class="feature-card__donut">${svg}</div>
          </div>
          <div class="feature-card__body">
            <h3 class="feature-card__name">${escapeHtml(p.name)}</h3>
            <p class="feature-card__blurb">${escapeHtml(p.blurb)}</p>
            ${note}
            <div class="feature-card__foot">
              <span class="feature-card__price">${Pricing.fmt(price)}<span class="feature-card__per">/ dozen</span></span>
              <div class="feature-card__actions">
                <button class="btn btn--ghost" data-premade-edit="${p.id}">Customize</button>
                <button class="btn btn--primary" data-premade-add="${p.id}" ${problems ? "disabled" : ""}>Add to order</button>
              </div>
            </div>
          </div>
        </article>`;
    }).join("");

    // On a page without the builder (boxes.html), the cart + builder live on the
    // main page, so hand off there via a query param; index.html acts on it.
    const standalone = !document.getElementById("controls");
    $$("[data-premade-add]", root).forEach((b) => b.addEventListener("click", () => {
      if (standalone) location.href = "index.html?add=" + encodeURIComponent(b.dataset.premadeAdd);
      else addPremade(b.dataset.premadeAdd);
    }));
    $$("[data-premade-edit]", root).forEach((b) => b.addEventListener("click", () => {
      if (standalone) location.href = "index.html?customize=" + encodeURIComponent(b.dataset.premadeEdit);
      else customizePremade(b.dataset.premadeEdit);
    }));
  }

  // A premade only works if the chosen store stocks everything it uses.
  function premadeBlocked(p) {
    if (!hasStore()) return null;
    const res = Menu.checkDesign(premadeDesign(p), selectedStore());
    return res.ok ? null : res.problems;
  }

  function addPremade(id) {
    const p = storePremades().find((x) => x.id === id);
    if (!p) return;
    if (!requireStore()) return;
    const problems = premadeBlocked(p);
    if (problems) {
      toast(`${selectedStore().name} can't make ${p.name} — needs ${problems.join(", ")}.`, true);
      return;
    }
    state.cart.boxes.push({ id: nextBoxId++, design: premadeDesign(p), qty: 1 });
    syncCartCount();
    openDrawer();
    renderDrawer();
    toast(`${p.name} box added to your order`);
  }

  function customizePremade(id) {
    const p = storePremades().find((x) => x.id === id);
    if (!p) return;
    if (!requireStore()) return;
    state.design = premadeDesign(p);
    state.editingBoxId = null;
    // trim anything this store can't make, and say what changed
    const adjustments = Menu.coerceDesign(state.design, selectedStore());
    update();
    document.getElementById("builder").scrollIntoView({ behavior: "smooth", block: "start" });
    toast(adjustments.length
      ? `Loaded "${p.name}" — adjusted for ${selectedStore().name}: ${adjustments.join("; ")}`
      : `Loaded "${p.name}" — make it your own`, adjustments.length > 0);
  }

  // Nudge the visitor to step 1 when an action needs a store and none is set.
  function requireStore() {
    if (hasStore()) return true;
    const step = document.getElementById("storeStep");
    if (step) step.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Choose your store first — menus differ by location.", true);
    return false;
  }

  /* ------------------------------- FOOTER -------------------------------- */
  function renderFooterStores() {
    const el = $("#footerStores");
    if (!el) return;
    el.innerHTML = DB.STORES.map((s) => `
      <div class="footer-store">
        <div class="footer-store__name">${s.name.replace("Glaze & Co. — ", "")}</div>
        <div class="footer-store__addr">${s.address}</div>
        <div class="footer-store__addr">${s.phone}</div>
      </div>`).join("");
  }

  /* -------------------------------- INIT --------------------------------- */
  // The Boxes page (boxes.html) hands off to the builder via a query param.
  // Act on it once, then strip it so a refresh doesn't repeat the action.
  function handleEntryActions() {
    const params = new URLSearchParams(location.search);
    const customize = params.get("customize");
    const add = params.get("add");
    const order = params.get("order");
    if (!customize && !add && !order) return;
    if (window.history && history.replaceState) {
      history.replaceState(null, "", location.pathname + location.hash);
    }
    if (customize) customizePremade(customize);
    else if (add) addPremade(add);
    else if (order) { openDrawer(); renderDrawer(); }
  }

  function initBuilder() {
    buildTypeOptions();
    buildFillingOptions();
    rebuildStoreOptions(); // icing / drizzle / sprinkles / tints — store-scoped
    wireControls();        // their listeners are delegated, so wire once
    renderFeatured();
    renderFooterStores();

    // a persisted store may already narrow the menu; make the design fit it
    if (hasStore()) Menu.coerceDesign(state.design, selectedStore());
    renderStoreGate();

    // custom icing tie-dye
    $("#tieDyeBtn").addEventListener("click", () => {
      state.design.tieDyeIcing = !state.design.tieDyeIcing;
      if (state.design.tieDyeIcing) state.design.icingTintId = null;
      update();
    });
    // sprinkle preset modes
    $("#rainbowBtn").addEventListener("click", () => {
      const on = !state.design.rainbowSprinkles;
      state.design.rainbowSprinkles = on;
      if (on) { state.design.chocolateSprinkles = false; state.design.noSprinkles = false; }
      update();
    });
    $("#chocBtn").addEventListener("click", () => {
      const on = !state.design.chocolateSprinkles;
      state.design.chocolateSprinkles = on;
      if (on) { state.design.rainbowSprinkles = false; state.design.noSprinkles = false; }
      update();
    });
    // sprinkle finish modifiers
    $("#heavyBtn").addEventListener("click", () => { state.design.heavySprinkles = !state.design.heavySprinkles; update(); });
    $("#halfBtn").addEventListener("click", () => { state.design.halfSprinkles = !state.design.halfSprinkles; update(); });

    // 12-box collapse: manual toggle disables auto-management thereafter
    $("#dozenToggle").addEventListener("click", () => {
      dozenUserSet = true;
      setDozenCollapsed(!dozenIsCollapsed());
    });
    let dozenResizeT;
    window.addEventListener("resize", () => {
      clearTimeout(dozenResizeT);
      dozenResizeT = setTimeout(autoManageDozen, 150);
    });
    window.addEventListener("load", autoManageDozen);

    // the builder form has no submit button — block implicit submission
    // (e.g. Enter on the "No sprinkles" checkbox) from reloading the page
    $("#controls").addEventListener("submit", (e) => e.preventDefault());

    $("#addToCart").addEventListener("click", addOrUpdateBox);
    $("#cartButton").addEventListener("click", () => { openDrawer(); renderDrawer(); });
    $("#closeDrawer").addEventListener("click", closeDrawer);
    $("#drawerOverlay").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#orderDrawer").hidden) closeDrawer(); });

    // focus trap: the drawer is aria-modal, so Tab must not escape into the
    // page behind it while it's open
    $("#orderDrawer").addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', $("#orderDrawer"))
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    update();
    syncCartCount();

    handleEntryActions(); // act on a hand-off from the Boxes page, if any
  }

  // Checkout page: render the pickup + payment flow from the saved cart.
  function initCheckoutPage() {
    syncCartCount();
    const cb = document.getElementById("cartButton");
    if (cb) cb.addEventListener("click", () => { window.location.href = "index.html"; });
    renderCheckoutPage();
  }

  // Boxes page (boxes.html): only the premade grid + footer. The order/builder
  // live on the main page, so the cart button and card actions point there.
  function initBoxesPage() {
    renderFeatured();
    renderFooterStores();
    syncCartCount(); // reflect any persisted cart in the header badge
    const cb = document.getElementById("cartButton");
    if (cb) cb.addEventListener("click", () => { window.location.href = "index.html?order=1"; });
  }

  function init() {
    loadPersisted();
    if (document.getElementById("checkoutMain")) initCheckoutPage();
    else if (document.getElementById("controls")) initBuilder();
    else initBoxesPage();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
