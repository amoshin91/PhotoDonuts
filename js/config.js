/* =============================================================================
   config.js — All tunable data lives here.
   Pricing, palette, donut catalog, allergens, and store directory.
   Everything a non-developer would want to change is in this one file.
   Exposed globally as window.DB so it works over file:// without a bundler.
   ============================================================================ */
(function () {
  "use strict";

  /* ----------------------------- PRICING ---------------------------------- */
  /* All values are placeholders, expressed PER DOZEN unless noted.
     The whole box of 12 shares one design, so per-dozen is the natural unit. */
  const PRICING = {
    currency: "USD",
    baseDozen: 18.0, // base price for a dozen, before any modifiers
    typeModifier: {
      // surcharge per dozen by donut type
      "classic-ring": 0.0,
      "classic-shell": 2.0,
      "chocolate-ring": 1.5,
      "cake-ring": 1.0,
    },
    fillingModifier: {
      // only applies to Classic Shell
      none: 0.0,
      jelly: 2.0,
      bavarian: 2.5,
      apple: 2.0,
      strawberry: 2.0,
      lemon: 2.0,
    },
    icingModifier: {
      vanilla: 0.0,
      chocolate: 1.0,
      strawberry: 1.0,
    },
    // first sprinkle color is free; each ADDITIONAL color costs this (per dozen).
    // Vanilla's bonus 5th color is billed at this same rate.
    additionalSprinkleColor: 1.5,
    drizzleCost: 0, // icing drizzle add-on (free by default; raise to charge)
    taxRate: 0.0875, // 8.75% — surfaced as its own line
  };

  /* --------------------------- DONUT CATALOG ------------------------------ */
  /* `base` controls the SVG base shape family: "ring" (has a hole) or
     "shell" (solid, fillable). `dough` is the fried-dough fill color. */
  const DONUT_TYPES = [
    {
      id: "classic-ring",
      name: "Classic Ring",
      base: "ring",
      dough: "#E8B873",
      doughShade: "#C98F45",
      blurb: "The original. Light, airy, ring-shaped.",
      allergens: ["wheat", "dairy", "eggs", "soy"],
      fillable: false,
    },
    {
      id: "classic-shell",
      name: "Classic Shell",
      base: "shell",
      dough: "#E8B873",
      doughShade: "#C98F45",
      blurb: "Pillowy and solid — built to hold a filling.",
      allergens: ["wheat", "dairy", "eggs", "soy"],
      fillable: true,
    },
    {
      id: "chocolate-ring",
      name: "Chocolate Ring",
      base: "ring",
      dough: "#6B4A2B",
      doughShade: "#4A3219",
      blurb: "Rich chocolate cake dough in a classic ring.",
      allergens: ["wheat", "dairy", "eggs", "soy"],
      fillable: false,
    },
    {
      id: "cake-ring",
      name: "Cake Ring",
      base: "ring",
      dough: "#D9A85C",
      doughShade: "#B07F36",
      blurb: "Dense, tender cake crumb with crisp edges.",
      allergens: ["wheat", "dairy", "eggs"],
      fillable: false,
    },
  ];

  /* ----------------------------- FILLINGS --------------------------------- */
  /* Only shown when Classic Shell is selected. `color` drives the SVG
     filling indicator. */
  const FILLINGS = [
    { id: "none", name: "None", color: null },
    { id: "jelly", name: "Jelly", color: "#C2185B" },
    { id: "bavarian", name: "Bavarian", color: "#F6E7B2" },
    { id: "apple", name: "Apple", color: "#C97B3C" },
    { id: "strawberry", name: "Strawberry", color: "#E5436A" },
    { id: "lemon", name: "Lemon", color: "#F2D03B" },
  ];

  /* ------------------------------- ICINGS --------------------------------- */
  const ICINGS = [
    // Vanilla unlocks one BONUS sprinkle color slot (max 5 instead of 4); the
    // bonus color is charged like any additional sprinkle color.
    { id: "vanilla", name: "Vanilla", color: "#F4ECD9", bonusSprinkle: true },
    { id: "chocolate", name: "Chocolate", color: "#5A3A22" },
    { id: "strawberry", name: "Strawberry", color: "#F2A5C0" },
    // Custom unlocks a color tint OR a tie-dye swirl (see app.js / donut-svg.js)
    { id: "custom", name: "Custom", color: "#F2ECDB", custom: true },
  ];

  /* --------------------------- SPRINKLE PALETTE --------------------------- */
  /* Each swatch always renders its name beside it — never color alone. */
  const SPRINKLE_PALETTE = [
    { id: "red", name: "Red", hex: "#E03131" },
    { id: "light-pink", name: "Light Pink", hex: "#F7B6CE" },
    { id: "hot-pink", name: "Hot Pink", hex: "#E83E8C" },
    { id: "orange", name: "Orange", hex: "#FD7E14" },
    { id: "yellow", name: "Yellow", hex: "#FFD43B" },
    { id: "blue", name: "Blue", hex: "#1971C2" },
    { id: "light-blue", name: "Light Blue", hex: "#74C0FC" },
    { id: "navy-blue", name: "Navy Blue", hex: "#1A237E" },
    { id: "green", name: "Green", hex: "#2F9E44" },
    { id: "light-green", name: "Light Green", hex: "#8CE99A" },
    { id: "purple", name: "Purple", hex: "#7048E8" },
    { id: "light-purple", name: "Light Purple", hex: "#C5B3F0" },
    { id: "white", name: "White", hex: "#FFFFFF" },
    { id: "black", name: "Black", hex: "#212529" },
  ];

  const MAX_SPRINKLE_COLORS = 4;
  const BOX_SIZE = 12; // one dozen per box, minimum order 1 box

  // Sprinkle style presets / modifiers (no extra charge — they're finishes).
  const RAINBOW_SPRINKLE_IDS = ["hot-pink", "yellow", "blue", "green", "purple", "orange", "red"];
  const CHOCOLATE_SPRINKLE_HEX = "#4A1F0A";
  const SPRINKLE_DENSITY = { normal: 360, heavy: 560 }; // jimmies drawn per donut
  const TIE_DYE_COLORS = ["#F687B3", "#F6D25C", "#5FA8F5", "#56C596", "#A78BFA", "#F6A35C"];

  /* ------------------------- PREMADE / SEASONAL BOXES ---------------------
     Ready-made designs for holidays, game days, and special events. Each one
     is a normal donut design — `design` only lists what differs from the
     defaults; the app fills in the rest. Add/remove freely. */
  const PREMADE_BOXES = [
    {
      id: "july-4th",
      name: "Fourth of July",
      occasion: "Independence Day",
      blurb: "Red, white & blue sprinkles over classic vanilla — built for the cookout.",
      design: { typeId: "classic-ring", icingId: "vanilla", sprinkleColorIds: ["red", "white", "blue"], noSprinkles: false },
    },
    {
      id: "team-usa",
      name: "Team USA",
      occasion: "World Cup",
      blurb: "Red & blue sprinkles with a red drizzle on vanilla. Cheer on the USMNT in style.",
      design: { typeId: "classic-ring", icingId: "vanilla", sprinkleColorIds: ["red", "blue"], noSprinkles: false, drizzleId: "custom", drizzleCustomId: "red" },
    },
    {
      id: "team-mex",
      name: "Team México",
      occasion: "World Cup",
      blurb: "Green icing with a white drizzle and red & white sprinkles. ¡Vamos, México!",
      design: { typeId: "classic-ring", icingId: "custom", icingTintId: "green", sprinkleColorIds: ["red", "white"], noSprinkles: false, drizzleId: "custom", drizzleCustomId: "white" },
    },
  ];

  const ALLERGEN_LABELS = {
    wheat: "Contains Wheat",
    dairy: "Contains Dairy",
    eggs: "Contains Eggs",
    soy: "Contains Soy",
    nuts: "Contains Tree Nuts",
  };

  /* ------------------------------- STORES --------------------------------- */
  /* Each store carries IANA timezone, per-weekday hours + same-day cutoff,
     blackout dates, lead time, slot increment and capacity.
     hours: index 0=Sunday ... 6=Saturday. null = closed that day.
     `cutoff` is the latest local clock time an order may be placed for
     same-day pickup at that store. Times are "HH:MM" 24h in store-local. */
  const SCHEDULING_DEFAULTS = {
    leadTimeMinutes: 30, // earliest pickup is now + 30 min
    slotIncrementMinutes: 30, // 30-minute increments, no fixed slots
    slotCapacityDozen: 20, // per-slot cap (placeholder)
  };

  function week(open, close, cutoff) {
    // helper: same hours Mon–Sat, closed Sunday by default override per store
    return open && close
      ? { open, close, cutoff: cutoff || close }
      : null;
  }

  const STORES = [
    {
      id: "sf-ferry",
      name: "Glaze & Co. — Ferry Building",
      address: "1 Ferry Building, San Francisco, CA 94111",
      lat: 37.7955,
      lng: -122.3937,
      timezone: "America/Los_Angeles",
      phone: "(415) 555-0142",
      hours: [
        { open: "08:00", close: "15:00", cutoff: "14:00" }, // Sun
        { open: "06:30", close: "18:00", cutoff: "17:00" }, // Mon
        { open: "06:30", close: "18:00", cutoff: "17:00" }, // Tue
        { open: "06:30", close: "18:00", cutoff: "17:00" }, // Wed
        { open: "06:30", close: "18:00", cutoff: "17:00" }, // Thu
        { open: "06:30", close: "19:00", cutoff: "18:00" }, // Fri
        { open: "07:00", close: "19:00", cutoff: "18:00" }, // Sat
      ],
      blackoutDates: ["2026-07-04", "2026-12-25", "2026-01-01"],
    },
    {
      id: "sf-mission",
      name: "Glaze & Co. — Mission District",
      address: "2841 Mission St, San Francisco, CA 94110",
      lat: 37.7515,
      lng: -122.4181,
      timezone: "America/Los_Angeles",
      phone: "(415) 555-0188",
      hours: [
        { open: "08:00", close: "14:00", cutoff: "13:00" },
        { open: "07:00", close: "17:00", cutoff: "16:00" },
        { open: "07:00", close: "17:00", cutoff: "16:00" },
        { open: "07:00", close: "17:00", cutoff: "16:00" },
        { open: "07:00", close: "17:00", cutoff: "16:00" },
        { open: "07:00", close: "18:00", cutoff: "17:00" },
        { open: "08:00", close: "18:00", cutoff: "17:00" },
      ],
      blackoutDates: ["2026-07-04", "2026-12-25"],
    },
    {
      id: "oak-temescal",
      name: "Glaze & Co. — Oakland Temescal",
      address: "4905 Telegraph Ave, Oakland, CA 94609",
      lat: 37.8358,
      lng: -122.2636,
      timezone: "America/Los_Angeles",
      phone: "(510) 555-0177",
      hours: [
        null, // closed Sundays
        { open: "07:00", close: "16:00", cutoff: "15:00" },
        { open: "07:00", close: "16:00", cutoff: "15:00" },
        { open: "07:00", close: "16:00", cutoff: "15:00" },
        { open: "07:00", close: "16:00", cutoff: "15:00" },
        { open: "07:00", close: "17:00", cutoff: "16:00" },
        { open: "08:00", close: "17:00", cutoff: "16:00" },
      ],
      blackoutDates: ["2026-07-04", "2026-11-26"],
    },
    {
      id: "nyc-flatiron",
      name: "Glaze & Co. — NYC Flatiron",
      address: "31 W 21st St, New York, NY 10010",
      lat: 40.7411,
      lng: -73.99,
      timezone: "America/New_York",
      phone: "(212) 555-0123",
      hours: [
        { open: "08:00", close: "16:00", cutoff: "15:00" },
        { open: "06:00", close: "19:00", cutoff: "18:00" },
        { open: "06:00", close: "19:00", cutoff: "18:00" },
        { open: "06:00", close: "19:00", cutoff: "18:00" },
        { open: "06:00", close: "19:00", cutoff: "18:00" },
        { open: "06:00", close: "20:00", cutoff: "19:00" },
        { open: "07:00", close: "20:00", cutoff: "19:00" },
      ],
      blackoutDates: ["2026-07-04", "2026-12-25", "2026-01-01"],
    },
    {
      id: "chi-loop",
      name: "Glaze & Co. — Chicago Loop",
      address: "200 N LaSalle St, Chicago, IL 60601",
      lat: 41.8858,
      lng: -87.6324,
      timezone: "America/Chicago",
      phone: "(312) 555-0166",
      hours: [
        null,
        { open: "06:30", close: "17:00", cutoff: "16:00" },
        { open: "06:30", close: "17:00", cutoff: "16:00" },
        { open: "06:30", close: "17:00", cutoff: "16:00" },
        { open: "06:30", close: "17:00", cutoff: "16:00" },
        { open: "06:30", close: "18:00", cutoff: "17:00" },
        { open: "08:00", close: "16:00", cutoff: "15:00" },
      ],
      blackoutDates: ["2026-07-04", "2026-12-25"],
    },
  ];

  /* ----- lightweight demo geocoder (no external key needed) ---------------
     Maps a handful of zips / city names to coordinates so manual entry works
     out of the box. In production, swap resolveLocation() for a real
     geocoding call (Google Geocoding API / Places). */
  const GEO_LOOKUP = {
    "94111": { lat: 37.7955, lng: -122.3937, label: "San Francisco, CA 94111" },
    "94110": { lat: 37.7515, lng: -122.4181, label: "San Francisco, CA 94110" },
    "94609": { lat: 37.8358, lng: -122.2636, label: "Oakland, CA 94609" },
    "10010": { lat: 40.7411, lng: -73.99, label: "New York, NY 10010" },
    "60601": { lat: 41.8858, lng: -87.6324, label: "Chicago, IL 60601" },
    "san francisco": { lat: 37.7749, lng: -122.4194, label: "San Francisco, CA" },
    "oakland": { lat: 37.8044, lng: -122.2712, label: "Oakland, CA" },
    "berkeley": { lat: 37.8715, lng: -122.273, label: "Berkeley, CA" },
    "new york": { lat: 40.7128, lng: -74.006, label: "New York, NY" },
    "brooklyn": { lat: 40.6782, lng: -73.9442, label: "Brooklyn, NY" },
    "chicago": { lat: 41.8781, lng: -87.6298, label: "Chicago, IL" },
  };

  /* Set this to a valid key to enable the live Google Map + markers.
     Left blank by default so the app runs with a graceful static fallback. */
  const GOOGLE_MAPS_API_KEY = "";

  window.DB = {
    PRICING,
    DONUT_TYPES,
    FILLINGS,
    ICINGS,
    SPRINKLE_PALETTE,
    MAX_SPRINKLE_COLORS,
    BOX_SIZE,
    RAINBOW_SPRINKLE_IDS,
    CHOCOLATE_SPRINKLE_HEX,
    SPRINKLE_DENSITY,
    TIE_DYE_COLORS,
    PREMADE_BOXES,
    ALLERGEN_LABELS,
    STORES,
    SCHEDULING_DEFAULTS,
    GEO_LOOKUP,
    GOOGLE_MAPS_API_KEY,
  };
})();
