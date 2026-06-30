/* =============================================================================
   app.js — State + UI wiring for the Glaze & Co. donut builder.
   Depends on: config.js (DB), donut-svg.js (DonutSVG), pricing.js (Pricing),
               pickup.js (Pickup).
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
    } catch (e) {}
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

  function buildIcingOptions() {
    const root = $("#icingOptions");
    root.innerHTML = "";
    DB.ICINGS.forEach((i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.setAttribute("role", "radio");
      btn.dataset.id = i.id;
      btn.innerHTML = `<span class="chip__dot" style="background:${i.color}"></span><span>${i.name}</span>`;
      root.appendChild(btn);
    });
    wireRadiogroup(root, (id) => setIcing(id));
  }

  function buildDrizzleOptions() {
    const root = $("#drizzleOptions");
    root.innerHTML = "";
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
    // same flavors/colors as the icing; Custom opens a color picker below
    DB.ICINGS.filter((i) => !i.custom).forEach((i) => chip(i.id, i.name, `<span class="chip__dot" style="background:${i.color}"></span>`));
    chip("custom", "Custom", `<span class="chip__dot chip__dot--rainbow"></span>`);
    wireRadiogroup(root, (id) => { state.design.drizzleId = id || null; update(); });
  }

  function buildDrizzleTintOptions() {
    const root = $("#drizzleTintOptions");
    root.innerHTML = "";
    DB.SPRINKLE_PALETTE.forEach((c) => root.appendChild(makeSwatch(c, "radio")));
    root.addEventListener("click", (e) => {
      const btn = e.target.closest(".swatch");
      if (!btn || btn.disabled) return;
      const id = btn.dataset.id;
      state.design.drizzleCustomId = state.design.drizzleCustomId === id ? null : id;
      update();
    });
  }

  function buildSprinkleOptions() {
    const root = $("#sprinkleOptions");
    root.innerHTML = "";
    DB.SPRINKLE_PALETTE.forEach((c) => {
      const sw = makeSwatch(c, "checkbox");
      sw.classList.add("swatch--check");
      sw.insertAdjacentHTML("beforeend", `<span class="swatch__check" aria-hidden="true"></span>`);
      root.appendChild(sw);
    });
    root.addEventListener("click", (e) => {
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

  function buildTintOptions() {
    const root = $("#tintOptions");
    root.innerHTML = "";
    DB.SPRINKLE_PALETTE.forEach((c) => root.appendChild(makeSwatch(c, "radio")));
    root.addEventListener("click", (e) => {
      const btn = e.target.closest(".swatch");
      if (!btn || btn.disabled) return;
      const id = btn.dataset.id;
      state.design.icingTintId = state.design.icingTintId === id ? null : id;
      state.design.tieDyeIcing = false; // tint and tie-dye are mutually exclusive
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
    const extraTxt = extra > 0 ? `+${Pricing.fmt(extra * DB.PRICING.additionalSprinkleColor)} for ${extra} extra` : "no extra charge";
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
    const svg = DonutSVG.render(resolved, { size: 100, decorative: true });
    let html = "";
    for (let i = 0; i < DB.BOX_SIZE; i++) {
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
    const { subtotal } = Pricing.priceBox(state.design);
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
    const { lines, subtotal } = Pricing.priceBox(state.design);
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
    const design = JSON.parse(JSON.stringify(state.design));
    if (state.editingBoxId) {
      const box = state.cart.boxes.find((b) => b.id === state.editingBoxId);
      if (box) box.design = design;
      state.editingBoxId = null;
      toast("Box updated");
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

    const totals = Pricing.priceCart(expandedBoxes());
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
      const price = Pricing.priceBox(b.design).subtotal;
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

  /* ------------------------------- PICKUP -------------------------------- */
  function renderPickupSection() {
    const p = state.pickup;
    const stores = Pickup.sortStoresByDistance(p.location);
    const selected = stores.find((s) => s.id === p.storeId);

    let inner = `
      <div class="locate-row">
        <input class="input" id="locInput" type="text" inputmode="text" placeholder="Zip, city, or address" value="${escapeHtml(p.locationLabel || "")}" aria-label="Search location" />
        <button class="btn btn--ghost" id="locSearch" type="button">Search</button>
      </div>
      <button class="btn btn--ghost btn--block geo-btn" id="geoBtn" type="button" style="margin-bottom:.9rem">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        Use my current location
      </button>`;

    inner += renderMap(selected, p.location);

    // distance to the nearest store for whatever location was entered
    if (p.location && stores.length && stores[0].distance != null) {
      inner += `<p class="field-note" style="margin:0 0 .2rem">Nearest: <strong>${escapeHtml(stores[0].name)}</strong> — ${stores[0].distance.toFixed(1)} mi from ${escapeHtml(p.locationLabel || "your location")}</p>`;
    }

    const pin = `<span class="store-card__pin"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg></span>`;

    // dropdown of nearby stores below the map (scales to any number of stores)
    inner += `
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

    // details for the chosen store
    if (selected) {
      const open = isStoreOpenNow(selected);
      const dist = selected.distance != null ? `${selected.distance.toFixed(1)} mi` : "";
      inner += `
        <div class="store-card store-card--selected" style="margin-top:.7rem">
          ${pin}
          <span style="flex:1">
            <span class="store-card__name">${escapeHtml(selected.name)}</span>
            <span class="store-card__addr">${escapeHtml(selected.address)}</span>
            <span class="store-card__meta">
              <span class="${open.open ? "store-open" : "store-closed"}">${open.label}</span>
              <span>${tzShort(selected.timezone)}</span>
            </span>
          </span>
          ${dist ? `<span class="store-card__dist">${dist}</span>` : ""}
        </div>`;
    }

    // date + time once a store is chosen
    if (selected) {
      inner += renderDateTime(selected);
    }

    return `
      <section class="order-section">
        <h3 class="order-section__title"><span class="order-section__step">2</span> Pickup store &amp; time</h3>
        ${inner}
      </section>`;
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

  // ---- free interactive map (Leaflet + OpenStreetMap tiles) ---------------
  let _storeMap = null;
  function destroyStoreMap() {
    if (_storeMap) { try { _storeMap.remove(); } catch (e) {} _storeMap = null; }
  }
  function initStoreMap() {
    destroyStoreMap();
    const el = document.getElementById("storeMap");
    if (!el || typeof L === "undefined") return;
    const p = state.pickup;
    const stores = Pickup.sortStoresByDistance(p.location);
    const map = L.map(el, { scrollWheelZoom: false });
    _storeMap = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const pts = [];
    stores.forEach((s) => {
      const isSel = s.id === p.storeId;
      const marker = L.marker([s.lat, s.lng], { opacity: isSel ? 1 : 0.82 }).addTo(map);
      const dist = s.distance != null ? ` · ${s.distance.toFixed(1)} mi` : "";
      marker.bindPopup(`<strong>${escapeHtml(s.name)}</strong><br>${escapeHtml(s.address)}${dist}`);
      marker.on("click", () => {
        state.pickup.storeId = s.id;
        state.pickup.dateStr = null;
        state.pickup.slotHm = null;
        renderCheckoutPage();
      });
      if (isSel) marker.openPopup();
      pts.push([s.lat, s.lng]);
    });

    if (p.location) {
      L.circleMarker([p.location.lat, p.location.lng], { radius: 7, weight: 2, color: "#fff", fillColor: "#d6336c", fillOpacity: 1 })
        .addTo(map).bindPopup("Your location");
      pts.push([p.location.lat, p.location.lng]);
    }

    const sel = stores.find((s) => s.id === p.storeId);
    if (sel) map.setView([sel.lat, sel.lng], 13);
    else if (pts.length) map.fitBounds(pts, { padding: [28, 28], maxZoom: 13 });
    else map.setView([40.78, -73.47], 10); // Long Island default
    // the drawer animates in; recompute size once layout has settled
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 90);
  }

  function renderDateTime(store) {
    const p = state.pickup;
    const minDate = Pickup.minSelectableDate(store);
    if (!p.dateStr) p.dateStr = firstOpenDate(store, minDate);

    // day chips for the next 12 days
    let chips = "";
    for (let i = 0; i < 12; i++) {
      const ds = Pickup.addDays(minDate, i);
      const res = Pickup.generateSlots(store, ds);
      const disabled = res.closed || !res.slots.some((s) => s.available);
      const [y, m, d] = ds.split("-").map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      const mon = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
      chips += `<button class="day-chip" type="button" data-date="${ds}" aria-pressed="${ds === p.dateStr}" ${disabled ? "disabled aria-disabled=true" : ""}>
        <span class="day-chip__dow">${dow}</span><span class="day-chip__num">${d}</span><span class="day-chip__mon">${mon}</span>
      </button>`;
    }

    const slotData = Pickup.generateSlots(store, p.dateStr);
    let slotsHtml;
    if (slotData.closed) {
      slotsHtml = `<p class="notice notice--warn">${slotData.reason}</p>`;
    } else if (!slotData.slots.some((s) => s.available)) {
      slotsHtml = `<p class="notice">${slotData.reason || "No remaining pickup times for this day."}</p>`;
    } else {
      slotsHtml = `<div class="slots">` + slotData.slots.map((s) => {
        if (!s.passesLead) return ""; // hide past / too-soon times entirely
        const full = s.remaining <= 0;
        const low = s.remaining > 0 && s.remaining < 5;
        const cap = full ? "Full" : `${s.remaining} left`;
        return `<button class="slot ${low ? "slot--low" : ""}" type="button" data-slot="${s.hm}" aria-pressed="${s.hm === p.slotHm}" ${full ? "disabled aria-disabled=true" : ""}>
          ${s.label}<span class="slot__cap">${cap}</span>
        </button>`;
      }).join("") + `</div>`;
    }

    return `
      <div class="field" style="margin-top:1rem">
        <span class="field-label">Pickup day <span style="font-weight:500;color:var(--ink-faint)">(${tzShort(store.timezone)})</span></span>
        <div class="day-chips">${chips}</div>
      </div>
      <div class="field">
        <span class="field-label">Pickup time · 30-min windows</span>
        ${slotsHtml}
        <p class="field-note" style="margin-top:.5rem">30-min minimum lead time · same-day cutoff &amp; store hours applied · ${DB.SCHEDULING_DEFAULTS.slotCapacityDozen} dozen per slot.</p>
      </div>`;
  }

  function firstOpenDate(store, minDate) {
    for (let i = 0; i < 14; i++) {
      const ds = Pickup.addDays(minDate, i);
      const res = Pickup.generateSlots(store, ds);
      if (!res.closed && res.slots.some((s) => s.available)) return ds;
    }
    return minDate;
  }

  function pickupComplete() {
    const p = state.pickup;
    if (!p.storeId || !p.dateStr || !p.slotHm) return false;
    const store = DB.STORES.find((s) => s.id === p.storeId);
    const res = Pickup.generateSlots(store, p.dateStr);
    const slot = res.slots.find((s) => s.hm === p.slotHm);
    return !!(slot && slot.available);
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
          <input class="input input--full input-dark" id="coCard" inputmode="numeric" placeholder="Card number" style="margin:.6rem 0" />
          <div class="form-grid form-grid--2">
            <input class="input input--full input-dark" id="coExp" inputmode="numeric" placeholder="MM / YY" />
            <input class="input input--full input-dark" id="coCvc" inputmode="numeric" placeholder="CVC" />
          </div>
        </div>

        <label class="consent">
          <input type="checkbox" id="coConsent" ${c.consent ? "checked" : ""} />
          <span>Email + text me my order confirmation and pickup reminders.</span>
        </label>
        <p class="field-error" id="coError" hidden></p>
      </section>`;
  }

  function renderTotalsSection() {
    const totals = Pricing.priceCart(expandedBoxes());
    const ready = pickupComplete();
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
          ${ready ? "Pay " + Pricing.fmt(totals.total) + " & reserve pickup" : "Select pickup to continue"}
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
    const locSearch = $("#locSearch", root);
    if (locSearch) locSearch.addEventListener("click", () => doLocationSearch($("#locInput", root).value));
    const locInput = $("#locInput", root);
    if (locInput) locInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doLocationSearch(locInput.value); } });
    const geoBtn = $("#geoBtn", root);
    if (geoBtn) geoBtn.addEventListener("click", doGeolocate);

    const storeSelect = $("#storeSelect", root);
    if (storeSelect) storeSelect.addEventListener("change", () => {
      state.pickup.storeId = storeSelect.value || null;
      state.pickup.dateStr = null;
      state.pickup.slotHm = null;
      renderCheckoutPage();
    });
    $$(".day-chip", root).forEach((chip) => {
      if (chip.disabled) return;
      chip.addEventListener("click", () => { state.pickup.dateStr = chip.dataset.date; state.pickup.slotHm = null; renderCheckoutPage(); });
    });
    $$(".slot", root).forEach((slot) => {
      if (slot.disabled) return;
      slot.addEventListener("click", () => { state.pickup.slotHm = slot.dataset.slot; renderCheckoutPage(); });
    });

    $$(".seg__btn", root).forEach((b) => b.addEventListener("click", () => { captureCheckoutInputs(); state.checkout.mode = b.dataset.mode; renderCheckoutPage(); }));

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
      renderPickupSection() +
      renderCheckoutSection() +
      renderTotalsSection();
    bindCart(main);
    bindCheckoutControls(main);
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
    renderCheckoutPage();
  }
  function doGeolocate() {
    if (!navigator.geolocation) { toast("Geolocation isn't available — enter a location.", true); return; }
    toast("Locating you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.pickup.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.pickup.locationLabel = "Your current location";
        renderCheckoutPage();
        toast("Sorted by distance from you");
      },
      () => toast("Location blocked — enter a zip or city instead.", true),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  /* ----------------------------- PLACE ORDER ----------------------------- */
  function placeOrder() {
    captureCheckoutInputs();
    const c = state.checkout;
    const body = panelRoot();
    const err = $("#coError", body);
    const problems = [];
    if (!c.name.trim()) problems.push("name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) problems.push("a valid email");
    if (c.phone.replace(/\D/g, "").length < 10) problems.push("a 10-digit mobile number");
    const card = ($("#coCard", body) || {}).value || "";
    if (card.replace(/\D/g, "").length < 15) problems.push("a valid card number");
    if (!c.consent) problems.push("confirmation consent");

    if (problems.length) {
      err.hidden = false;
      err.textContent = "Please add " + problems.join(", ") + ".";
      err.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const store = DB.STORES.find((s) => s.id === state.pickup.storeId);
    const totals = Pricing.priceCart(expandedBoxes());
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

  let toastTimer;
  function toast(msg, warn) {
    const region = $("#toastRegion");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span class="toast__dot" style="${warn ? "background:var(--warn)" : ""}"></span><span>${escapeHtml(msg)}</span>`;
    region.appendChild(el);
    clearTimeout(toastTimer);
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

  function renderFeatured() {
    const root = $("#featuredGrid");
    if (!root) return;
    root.innerHTML = DB.PREMADE_BOXES.map((p) => {
      const design = premadeDesign(p);
      const svg = DonutSVG.render(resolveDesign(design), { size: 134, decorative: true });
      const price = Pricing.priceBox(design).subtotal;
      return `
        <article class="feature-card">
          <div class="feature-card__art">
            <span class="feature-card__badge">${escapeHtml(p.occasion)}</span>
            <div class="feature-card__donut">${svg}</div>
          </div>
          <div class="feature-card__body">
            <h3 class="feature-card__name">${escapeHtml(p.name)}</h3>
            <p class="feature-card__blurb">${escapeHtml(p.blurb)}</p>
            <div class="feature-card__foot">
              <span class="feature-card__price">${Pricing.fmt(price)}<span class="feature-card__per">/ dozen</span></span>
              <div class="feature-card__actions">
                <button class="btn btn--ghost" data-premade-edit="${p.id}">Customize</button>
                <button class="btn btn--primary" data-premade-add="${p.id}">Add to order</button>
              </div>
            </div>
          </div>
        </article>`;
    }).join("");

    $$("[data-premade-add]", root).forEach((b) => b.addEventListener("click", () => addPremade(b.dataset.premadeAdd)));
    $$("[data-premade-edit]", root).forEach((b) => b.addEventListener("click", () => customizePremade(b.dataset.premadeEdit)));
  }

  function addPremade(id) {
    const p = DB.PREMADE_BOXES.find((x) => x.id === id);
    if (!p) return;
    state.cart.boxes.push({ id: nextBoxId++, design: premadeDesign(p), qty: 1 });
    syncCartCount();
    openDrawer();
    renderDrawer();
    toast(`${p.name} box added to your order`);
  }

  function customizePremade(id) {
    const p = DB.PREMADE_BOXES.find((x) => x.id === id);
    if (!p) return;
    state.design = premadeDesign(p);
    state.editingBoxId = null;
    update();
    document.getElementById("builder").scrollIntoView({ behavior: "smooth", block: "start" });
    toast(`Loaded "${p.name}" — make it your own`);
  }

  /* ------------------------------- FOOTER -------------------------------- */
  function renderFooterStores() {
    $("#footerStores").innerHTML = DB.STORES.map((s) => `
      <div class="footer-store">
        <div class="footer-store__name">${s.name.replace("Glaze & Co. — ", "")}</div>
        <div class="footer-store__addr">${s.address}</div>
        <div class="footer-store__addr">${s.phone}</div>
      </div>`).join("");
  }

  /* -------------------------------- INIT --------------------------------- */
  function initBuilder() {
    buildTypeOptions();
    buildFillingOptions();
    buildIcingOptions();
    buildDrizzleOptions();
    buildDrizzleTintOptions();
    buildTintOptions();
    buildSprinkleOptions();
    renderFeatured();
    renderFooterStores();

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

    $("#addToCart").addEventListener("click", addOrUpdateBox);
    $("#cartButton").addEventListener("click", () => { openDrawer(); renderDrawer(); });
    $("#closeDrawer").addEventListener("click", closeDrawer);
    $("#drawerOverlay").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#orderDrawer").hidden) closeDrawer(); });

    update();
    syncCartCount();
  }

  // Checkout page: render the pickup + payment flow from the saved cart.
  function initCheckoutPage() {
    syncCartCount();
    const cb = document.getElementById("cartButton");
    if (cb) cb.addEventListener("click", () => { window.location.href = "index.html"; });
    renderCheckoutPage();
  }

  function init() {
    loadPersisted();
    if (document.getElementById("checkoutMain")) initCheckoutPage();
    else initBuilder();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
