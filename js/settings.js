/* =============================================================================
   settings.js — Per-store settings overrides (the dashboard's data layer).

   config.js holds the DEFAULTS that ship with the code. This module holds the
   per-store EDITS that store staff make in the dashboard, and merges the two
   into one effective view that the whole storefront reads.

     config.js defaults  +  saved overrides  =  DB.STORES[n] (effective)

   apply() writes the merged result straight back onto DB.STORES / DB.PRICING
   consumers, so menu.js, pickup.js, pricing.js and app.js keep reading the
   same shapes they always did — a store just carries three new fields:

     store.active      false = ordering paused at this location
     store.scheduling  { leadTimeMinutes, slotIncrementMinutes, slotCapacityDozen }
     store.pricing     full PRICING table for this store

   WHERE IT'S STORED
   -----------------
   localStorage, per browser (key below). That is deliberate for this
   prototype: there is no server yet. It means edits are per-device and are
   NOT a security boundary — see the migration note at the bottom of this file
   for how each piece maps onto the Supabase schema in PROJECT_STATUS.md.

   Exposed globally as window.Settings (plain script, no bundler).
   ============================================================================ */
(function () {
  "use strict";

  const LS_KEY = "glaze_store_settings_v1";
  const VERSION = 1;

  /* Pristine snapshot of what config.js shipped, taken before anything is
     merged in. Every effective value is rebuilt from this, so applying twice
     (dashboard saves, then re-renders) can never compound an earlier merge. */
  const DEFAULTS = deepClone({
    stores: window.DB.STORES,
    pricing: window.DB.PRICING,
    scheduling: window.DB.SCHEDULING_DEFAULTS,
    premades: window.DB.PREMADE_BOXES,
  });

  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  /* ------------------------------ RAW STATE ------------------------------- */
  /* Only what staff actually CHANGED is stored. An absent key means "still on
     the config default", so a later change to config.js flows through to every
     store that never overrode it. */
  let overrides = { version: VERSION, stores: {}, updatedAt: null };

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      // Future versions migrate here. An unknown (newer) version is ignored
      // rather than half-read, so a downgraded tab can't corrupt the data.
      if (parsed.version !== VERSION) return;
      if (parsed.stores && typeof parsed.stores === "object") {
        overrides = { version: VERSION, stores: parsed.stores, updatedAt: parsed.updatedAt || null };
      }
    } catch (e) {
      /* private mode / quota / corrupt JSON — fall back to config defaults */
    }
  }

  function save() {
    overrides.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(overrides));
      return true;
    } catch (e) {
      return false;
    }
  }

  function rawFor(storeId) {
    if (!overrides.stores[storeId]) overrides.stores[storeId] = {};
    return overrides.stores[storeId];
  }

  /* ------------------------------ MERGING --------------------------------- */
  function defaultStore(storeId) {
    return DEFAULTS.stores.find((s) => s.id === storeId) || null;
  }

  /* One store's effective settings: config defaults with its overrides on top.
     Returned fresh each call — callers may mutate it without touching state. */
  function effectiveStore(storeId) {
    const base = defaultStore(storeId);
    if (!base) return null;
    const o = overrides.stores[storeId] || {};
    const store = deepClone(base);

    store.active = o.active !== false; // stores ship active; only an explicit false pauses
    if (o.hours) store.hours = deepClone(o.hours);
    if (o.blackoutDates) store.blackoutDates = deepClone(o.blackoutDates);
    // `menu` is all-or-nothing per category: an absent list means "everything",
    // which is exactly what menu.js already understands.
    if (o.menu) store.menu = deepClone(o.menu);
    else if (o.menu === null) delete store.menu; // explicitly reset to full catalog

    store.scheduling = Object.assign({}, DEFAULTS.scheduling, o.scheduling || {});
    store.pricing = mergePricing(o.pricing);
    return store;
  }

  /* Pricing merges one level deeper than the rest: the modifier tables are
     objects keyed by option id, and a store overriding `baseDozen` alone must
     not wipe the shipped modifiers. */
  function mergePricing(o) {
    const p = deepClone(DEFAULTS.pricing);
    if (!o) return p;
    Object.keys(o).forEach((k) => {
      const v = o[k];
      if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(p[k] || (p[k] = {}), v);
      else if (v !== undefined && v !== null) p[k] = v;
    });
    return p;
  }

  /* Ready-made boxes offered at a store: the shipped catalog filtered by what
     the store switched off, plus any designs the store authored itself. */
  function premadesFor(storeId) {
    const o = overrides.stores[storeId] || {};
    const disabled = o.disabledPremadeIds || [];
    const catalog = DEFAULTS.premades.filter((p) => disabled.indexOf(p.id) === -1);
    return deepClone(catalog.concat(o.customPremades || []));
  }

  /* Push the merged result onto DB so every existing consumer sees it.
     Called once at boot by each page, and again whenever the dashboard saves. */
  function apply() {
    window.DB.STORES.length = 0;
    DEFAULTS.stores.forEach((base) => window.DB.STORES.push(effectiveStore(base.id)));
    return window.DB.STORES;
  }

  /* Stores a customer may order from. Paused stores stay in DB.STORES (the
     dashboard still has to list them) but are hidden from the storefront. */
  function orderableStores() {
    return window.DB.STORES.filter((s) => s.active !== false);
  }

  /* ------------------------------ WRITE API ------------------------------- */
  /* Each setter takes the value the dashboard is showing and stores it only if
     it actually differs from the config default — so "reset to default" is
     just "clear the override", and the stored blob stays small and readable. */

  function setActive(storeId, active) {
    const r = rawFor(storeId);
    if (active) delete r.active; else r.active = false;
    return save() && !!apply();
  }

  function setMenu(storeId, menu) {
    const r = rawFor(storeId);
    // A category listing every id is the same as no restriction — store it as
    // "unrestricted" so adding a new color to config.js reaches this store too.
    const clean = {};
    if (Array.isArray(menu.icingIds) && menu.icingIds.length < window.DB.ICINGS.length) {
      clean.icingIds = menu.icingIds.slice();
    }
    if (Array.isArray(menu.sprinkleColorIds) && menu.sprinkleColorIds.length < window.DB.SPRINKLE_PALETTE.length) {
      clean.sprinkleColorIds = menu.sprinkleColorIds.slice();
    }
    if (Object.keys(clean).length) r.menu = clean; else r.menu = null;
    return save() && !!apply();
  }

  function setScheduling(storeId, sched) {
    rawFor(storeId).scheduling = {
      leadTimeMinutes: clampInt(sched.leadTimeMinutes, 0, 60 * 24 * 14, DEFAULTS.scheduling.leadTimeMinutes),
      slotIncrementMinutes: clampInt(sched.slotIncrementMinutes, 5, 240, DEFAULTS.scheduling.slotIncrementMinutes),
      slotCapacityDozen: clampInt(sched.slotCapacityDozen, 1, 10000, DEFAULTS.scheduling.slotCapacityDozen),
    };
    return save() && !!apply();
  }

  function setHours(storeId, hours, blackoutDates) {
    const r = rawFor(storeId);
    r.hours = hours.map((h) => (h && h.open && h.close ? { open: h.open, close: h.close, cutoff: h.cutoff || h.close } : null));
    if (Array.isArray(blackoutDates)) {
      r.blackoutDates = blackoutDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    }
    return save() && !!apply();
  }

  function setPricing(storeId, pricing) {
    const base = DEFAULTS.pricing;
    const clean = {};
    ["baseDozen", "additionalSprinkleColor", "drizzleCost", "taxRate"].forEach((k) => {
      const v = Number(pricing[k]);
      if (isFinite(v) && v >= 0 && v !== base[k]) clean[k] = round4(v);
    });
    ["typeModifier", "fillingModifier", "icingModifier"].forEach((table) => {
      if (!pricing[table]) return;
      const diff = {};
      Object.keys(pricing[table]).forEach((id) => {
        const v = Number(pricing[table][id]);
        // An id config.js never priced (e.g. Custom icing) defaults to 0, so
        // leaving it at 0 must not count as an override worth storing.
        if (isFinite(v) && v !== ((base[table] || {})[id] || 0)) diff[id] = round4(v);
      });
      if (Object.keys(diff).length) clean[table] = diff;
    });
    const r = rawFor(storeId);
    if (Object.keys(clean).length) r.pricing = clean; else delete r.pricing;
    return save() && !!apply();
  }

  function setPremades(storeId, disabledIds, customPremades) {
    const r = rawFor(storeId);
    if (Array.isArray(disabledIds) && disabledIds.length) r.disabledPremadeIds = disabledIds.slice();
    else delete r.disabledPremadeIds;
    if (Array.isArray(customPremades) && customPremades.length) r.customPremades = deepClone(customPremades);
    else delete r.customPremades;
    return save();
  }

  /* Drop every edit for one store — it goes back to exactly what config.js
     ships, including any changes made to config.js since the edit. */
  function resetStore(storeId) {
    delete overrides.stores[storeId];
    return save() && !!apply();
  }

  function resetAll() {
    overrides = { version: VERSION, stores: {}, updatedAt: null };
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    apply();
  }

  /* Is this store still on the shipped defaults, or has staff changed it? */
  function isCustomized(storeId) {
    const o = overrides.stores[storeId];
    return !!(o && Object.keys(o).length);
  }

  function exportJson() { return JSON.stringify(overrides, null, 2); }

  function importJson(text) {
    const parsed = JSON.parse(text); // caller catches
    if (!parsed || parsed.version !== VERSION || typeof parsed.stores !== "object") {
      throw new Error("Not a Glaze & Co. settings file (version " + VERSION + ").");
    }
    overrides = { version: VERSION, stores: parsed.stores, updatedAt: parsed.updatedAt || null };
    save();
    apply();
  }

  /* ------------------------------- HELPERS -------------------------------- */
  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function round4(n) { return Math.round(n * 10000) / 10000; }

  function defaults() { return deepClone(DEFAULTS); }

  load();
  apply();

  window.Settings = {
    apply, load, save,
    effectiveStore, premadesFor, orderableStores, defaults,
    setActive, setMenu, setScheduling, setHours, setPricing, setPremades,
    resetStore, resetAll, isCustomized,
    exportJson, importJson,
    STORAGE_KEY: LS_KEY,
  };

  /* ---------------------------------------------------------------------------
     MIGRATION NOTE (see PROJECT_STATUS.md § Backend migration plan)
     Each override maps 1:1 onto a table, so the dashboard's UI survives the
     move — only this file's read/write internals get swapped for fetch():
       overrides.stores[id].hours         → store_hours
       overrides.stores[id].blackoutDates → store_blackouts
       overrides.stores[id].scheduling    → store_settings
       overrides.stores[id].menu          → store_menu_icings / store_menu_colors
       overrides.stores[id].pricing       → pricing (per-store row)
       overrides.stores[id].active        → stores.active
       overrides.stores[id].customPremades→ premade_boxes (store_id not null)
     On the server these become authoritative; the browser copy becomes a cache.
     -------------------------------------------------------------------------- */
})();
