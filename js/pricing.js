/* =============================================================================
   pricing.js — Price calculation + breakdown.
   One box = one dozen, all 12 sharing the same design. Prices are per box.

   Prices can differ by store: the dashboard writes a per-store override that
   settings.js merges onto `store.pricing`. Pickup is order-level, so one store
   prices the whole cart — pass its id to priceBox/priceCart. Omitting the id
   falls back to the shipped global table in config.js.
   ============================================================================ */
(function () {
  "use strict";
  const BASE = window.DB.PRICING;

  // Which price list applies. Unknown/absent store ⇒ the config.js defaults.
  function tableFor(storeId) {
    if (!storeId) return BASE;
    const store = window.DB.STORES.find((s) => s.id === storeId);
    return (store && store.pricing) || BASE;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // Returns an itemized breakdown for a single box (a dozen of one design).
  function priceBox(design, storeId) {
    const P = tableFor(storeId);
    const type = DB.DONUT_TYPES.find((t) => t.id === design.typeId) || DB.DONUT_TYPES[0];
    const icing = DB.ICINGS.find((i) => i.id === design.icingId);

    const lines = [];
    lines.push({ label: "Base dozen", amount: P.baseDozen });

    const typeMod = P.typeModifier[design.typeId] || 0;
    if (typeMod) lines.push({ label: `${type.name}`, amount: typeMod });

    if (type.fillable && design.fillingId && design.fillingId !== "none") {
      const fMod = P.fillingModifier[design.fillingId] || 0;
      const f = DB.FILLINGS.find((x) => x.id === design.fillingId);
      if (fMod) lines.push({ label: `${f ? f.name : "Filling"} filling`, amount: fMod });
    }

    if (icing) {
      const iMod = P.icingModifier[design.icingId] || 0;
      if (iMod) lines.push({ label: `${icing.name} icing`, amount: iMod });
    }

    // sprinkles: first color free, each extra costs extra.
    // Rainbow/Chocolate are finishes (no per-color charge); only hand-picked
    // custom colors are billed.
    const usingCustomColors =
      !design.noSprinkles && !design.rainbowSprinkles && !design.chocolateSprinkles;
    const colorCount = usingCustomColors ? (design.sprinkleColorIds || []).length : 0;
    const extraColors = Math.max(0, colorCount - 1);
    if (extraColors > 0) {
      lines.push({
        label: `+${extraColors} sprinkle color${extraColors > 1 ? "s" : ""}`,
        amount: extraColors * P.additionalSprinkleColor,
      });
    }

    // icing drizzle (only billed when configured to cost something)
    if (design.drizzleId && P.drizzleCost > 0) {
      const dz = DB.ICINGS.find((i) => i.id === design.drizzleId);
      lines.push({ label: `${dz ? dz.name : "Icing"} drizzle`, amount: P.drizzleCost });
    }

    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    return { lines, subtotal };
  }

  // Cart total across boxes, with tax.
  function priceCart(boxes, storeId) {
    const P = tableFor(storeId);
    const subtotal = round2(
      boxes.reduce((s, b) => s + priceBox(b.design, storeId).subtotal, 0)
    );
    const tax = round2(subtotal * P.taxRate);
    const total = round2(subtotal + tax);
    return { subtotal, tax, total, taxRate: P.taxRate };
  }

  function fmt(n) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: BASE.currency,
    }).format(n);
  }

  window.Pricing = { priceBox, priceCart, fmt, round2, tableFor };
})();
