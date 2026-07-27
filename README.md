# Glaze & Co. — Donut Builder

A premium, conversion-focused donut **customization + in-store pickup** ordering
experience. Customers design one donut that applies to a dozen, preview it live
as layered SVG, add multiple independent boxes to an order, choose a store and a
timezone-correct 30-minute pickup window, and check out (guest or account).

No build step, no dependencies. Plain HTML/CSS/JS so it runs straight from disk.

## Run it

Either open `index.html` directly in a browser, **or** serve the folder (nicer):

```bash
cd "Donut Builder"
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Project structure

```
index.html        Page shell + mount points
css/styles.css    Design system, components, responsive + reduced-motion
js/config.js      ⭐ ALL tunable data (prices, palette, donut types, stores)
js/menu.js        Per-store menu: what a store can make + design validation
js/donut-svg.js   Layered, seeded SVG donut renderer
js/pricing.js     Price + breakdown math
js/pickup.js      Distance, geocode, timezone-aware slot generation
js/app.js         State + UI wiring (builder, cart, pickup, checkout)
```

## Where to change things — everything lives in `js/config.js`

| Want to change…                  | Edit in `config.js`                          |
|----------------------------------|----------------------------------------------|
| Base dozen price / tax           | `PRICING.baseDozen`, `PRICING.taxRate`       |
| Per-type / filling / icing fees  | `PRICING.*Modifier`                          |
| Extra-sprinkle & accent price    | `PRICING.additionalSprinkleColor`, `vanillaAccentColor` |
| Donut types & allergen tags      | `DONUT_TYPES`                                |
| Fillings / Icings                | `FILLINGS`, `ICINGS`                         |
| Sprinkle palette                 | `SPRINKLE_PALETTE`, `MAX_SPRINKLE_COLORS`    |
| Stores, hours, cutoffs, blackouts| `STORES`                                     |
| What a store can make            | `STORES[n].menu`                             |
| Lead time / increment / capacity | `SCHEDULING_DEFAULTS`                        |

All pricing values are **placeholders** chosen to be easy to swap.

### Per-store menus

Stores don't all stock the same icings and sprinkle colors, so **the customer
picks a store before the builder opens** and only sees what that store can make.
Restrict a store by adding a `menu` block:

```js
{
  id: "dunkin-345764",
  // …hours, address, etc…
  menu: {
    icingIds: ["vanilla", "chocolate"],          // subset of ICINGS
    sprinkleColorIds: ["red", "yellow", "blue"], // subset of SPRINKLE_PALETTE
  },
}
```

Omit `menu` (or either key) and the store offers **everything** in that
category — a new store needs no menu config at all. Two effects are *derived*
in `menu.js` rather than configured:

- dropping `"custom"` from `icingIds` also removes the tie-dye / tint controls
  **and** the Custom drizzle option (they share one color station);
- a store missing any `RAINBOW_SPRINKLE_IDS` color loses the Rainbow preset.

Donut types and fillings are the same at every store.

Changing store with boxes already in the cart lists exactly which boxes the new
store can't make and lets the customer remove just those or cancel the switch
(`Menu.checkDesign`). The in-progress builder design is nudged onto the new
menu instead (`Menu.coerceDesign`), and checkout re-validates the whole cart in
case a store's menu changed between visits.

## Google Maps

The app runs with a **graceful static map fallback** out of the box (no key
required). To enable the live embedded map with markers, set:

```js
const GOOGLE_MAPS_API_KEY = "your-key"; // in js/config.js
```

with the **Maps Embed API** enabled. For real-world location search, replace the
demo `GEO_LOOKUP` table / `Pickup.resolveLocation()` with a call to the Google
**Geocoding API**.

## Notable behaviors

- **Live preview** — one design renders to the big hero donut *and* the 4×3 grid.
  Sprinkle placement is seeded (`donut-svg.js`) so it's identical everywhere; only
  colors reassign when the palette changes.
- **Classic Shell** is the only fillable type; the Filling control appears only
  for it and shows an oozing filling indicator in the preview.
- **Vanilla icing** unlocks one bonus **accent color** (rendered as a drizzle),
  priced like an extra sprinkle color.
- **Sprinkles** — up to 4 colors, first free; "No sprinkles" is a mutually
  exclusive toggle. Every swatch shows its name (never color alone → WCAG AA).
- **Pickup is order-level**: all boxes in one order share a store + time. Each box
  keeps its own independent design. Minimum order is 1 dozen.
- **Scheduling** enforces operating hours, per-day same-day cutoffs, a 30-minute
  lead time, blackout days, a 20-dozen/slot capacity cap, and correct store
  timezones (a Pacific user can book a New York pickup and see it in ET).
- **Confirmation** simulates email + SMS; payment is a mock form (wire to Stripe
  Elements / PaymentIntents for production).

## Accessibility

WCAG-AA minded: semantic landmarks, a skip link, labelled controls, ARIA
radiogroups with roving tabindex + arrow-key support, visible focus rings,
AA-contrast text, names paired with every color swatch, and
`prefers-reduced-motion` support.

> All prices, hours, stores, and allergen data are illustrative placeholders for
> demonstration.
