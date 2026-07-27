/* =============================================================================
   menu.js — What a given store can actually make.

   Stores don't all stock the same icings and sprinkle colors (see the `menu`
   block in config.js). This module is the single place that turns that config
   into (a) the option lists the builder renders and (b) a yes/no answer about
   whether an existing design can be made at a store.

   Everything degrades open: a store with no `menu` block offers the whole
   catalog, so adding a store requires no menu config.

   Exposed globally as window.Menu (plain script, no bundler).
   ============================================================================ */
(function () {
  "use strict";

  function storeById(id) {
    if (!id) return null;
    return DB.STORES.find((s) => s.id === id) || null;
  }

  // Subset helper: an absent/!Array list means "everything in `all`".
  function allow(all, ids) {
    if (!Array.isArray(ids)) return all.slice();
    return all.filter((item) => ids.indexOf(item.id) !== -1);
  }

  /* Resolve a store's menu into ready-to-render option lists.
     Passing null (no store chosen yet) yields the full catalog, which keeps
     callers simple — the builder is gated on store selection separately. */
  function forStore(store) {
    const m = (store && store.menu) || {};
    const icings = allow(DB.ICINGS, m.icingIds);
    const sprinkles = allow(DB.SPRINKLE_PALETTE, m.sprinkleColorIds);
    const sprinkleIds = sprinkles.map((s) => s.id);
    return {
      store: store || null,
      icings,
      sprinkles,
      icingIds: icings.map((i) => i.id),
      sprinkleIds,
      // Custom icing drives the tie-dye + tint controls; both use the sprinkle
      // palette for their color choices, so they need colors available too.
      hasCustomIcing: icings.some((i) => i.custom) && sprinkles.length > 0,
      // Rainbow is a fixed 7-color mix — offer it only if all 7 are stocked.
      rainbowAvailable: DB.RAINBOW_SPRINKLE_IDS.every((id) => sprinkleIds.indexOf(id) !== -1),
      // Chocolate sprinkles are their own product (not a palette color), so
      // every store can finish with them.
      chocolateAvailable: true,
      isFull: icings.length === DB.ICINGS.length && sprinkles.length === DB.SPRINKLE_PALETTE.length,
    };
  }

  function icingName(id) {
    const i = DB.ICINGS.find((x) => x.id === id);
    return i ? i.name : id;
  }
  function colorName(id) {
    const c = DB.SPRINKLE_PALETTE.find((x) => x.id === id);
    return c ? c.name : id;
  }

  /* Can `design` be made at `store`?
     Returns { ok, problems: [...] } where each problem is a short human phrase
     ("Strawberry icing", "Navy Blue sprinkles") suitable for a warning list. */
  function checkDesign(design, store) {
    const menu = forStore(store);
    const problems = [];
    if (!design) return { ok: true, problems };

    if (menu.icingIds.indexOf(design.icingId) === -1) {
      problems.push(icingName(design.icingId) + " icing");
    }
    // custom icing extras — only meaningful while custom icing itself is offered
    if (design.icingTintId && menu.sprinkleIds.indexOf(design.icingTintId) === -1) {
      problems.push(colorName(design.icingTintId) + " icing tint");
    }
    if (design.tieDyeIcing && !menu.hasCustomIcing) {
      problems.push("Tie-dye icing");
    }

    // drizzle reuses the icing flavors, or a palette color when custom
    if (design.drizzleId === "custom") {
      // a custom-color drizzle needs the same color station as custom icing
      if (!menu.hasCustomIcing) {
        problems.push("Custom drizzle");
      } else if (design.drizzleCustomId && menu.sprinkleIds.indexOf(design.drizzleCustomId) === -1) {
        problems.push(colorName(design.drizzleCustomId) + " drizzle");
      }
    } else if (design.drizzleId && menu.icingIds.indexOf(design.drizzleId) === -1) {
      problems.push(icingName(design.drizzleId) + " drizzle");
    }

    if (!design.noSprinkles) {
      if (design.rainbowSprinkles) {
        if (!menu.rainbowAvailable) problems.push("Rainbow sprinkles");
      } else if (!design.chocolateSprinkles) {
        (design.sprinkleColorIds || []).forEach((id) => {
          if (menu.sprinkleIds.indexOf(id) === -1) problems.push(colorName(id) + " sprinkles");
        });
      }
    }

    return { ok: problems.length === 0, problems };
  }

  /* Nudge a design onto a store's menu, changing as little as possible.
     Used when the builder's in-progress design would otherwise sit on options
     the newly chosen store can't make. Returns the list of what changed. */
  function coerceDesign(design, store) {
    const menu = forStore(store);
    const changed = [];

    if (menu.icingIds.indexOf(design.icingId) === -1) {
      const from = icingName(design.icingId);
      // prefer a plain flavor over Custom as the fallback
      const fallback = menu.icings.find((i) => !i.custom) || menu.icings[0];
      design.icingId = fallback ? fallback.id : design.icingId;
      design.tieDyeIcing = false;
      design.icingTintId = null;
      changed.push(from + " icing → " + icingName(design.icingId));
    }
    if (!menu.hasCustomIcing) { design.tieDyeIcing = false; design.icingTintId = null; }
    if (design.icingTintId && menu.sprinkleIds.indexOf(design.icingTintId) === -1) {
      changed.push(colorName(design.icingTintId) + " icing tint removed");
      design.icingTintId = null;
    }

    if (design.drizzleId === "custom") {
      if (design.drizzleCustomId && menu.sprinkleIds.indexOf(design.drizzleCustomId) === -1) {
        changed.push(colorName(design.drizzleCustomId) + " drizzle removed");
        design.drizzleCustomId = null;
      }
      if (!menu.hasCustomIcing) { design.drizzleId = null; design.drizzleCustomId = null; }
    } else if (design.drizzleId && menu.icingIds.indexOf(design.drizzleId) === -1) {
      changed.push(icingName(design.drizzleId) + " drizzle removed");
      design.drizzleId = null;
    }

    if (design.rainbowSprinkles && !menu.rainbowAvailable) {
      design.rainbowSprinkles = false;
      design.noSprinkles = true;
      changed.push("Rainbow sprinkles removed");
    }
    const kept = (design.sprinkleColorIds || []).filter((id) => menu.sprinkleIds.indexOf(id) !== -1);
    if (kept.length !== (design.sprinkleColorIds || []).length) {
      const dropped = design.sprinkleColorIds.filter((id) => kept.indexOf(id) === -1).map(colorName);
      design.sprinkleColorIds = kept;
      if (!kept.length && !design.chocolateSprinkles) design.noSprinkles = true;
      changed.push(dropped.join(", ") + " sprinkles removed");
    }

    return changed;
  }

  window.Menu = { storeById, forStore, checkDesign, coerceDesign };
})();
