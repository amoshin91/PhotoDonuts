# Photo Donuts — Donut Builder

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
index.html          Builder page — store gate, donut builder, cart drawer
boxes.html          Ready-made boxes
checkout.html       Pickup + payment
dashboard.html      ⭐ Staff dashboard (store settings)
login.html          Staff sign-in

css/styles.css      Design system, components, responsive + reduced-motion
css/dashboard.css   Dashboard-only styles, layered on the same tokens

js/config.js        ⭐ ALL shipped defaults (prices, palette, types, stores)
js/settings.js      ⭐ Per-store overrides saved by the dashboard, merged over config
js/auth.js          Staff accounts, the three roles, session (PROTOTYPE)
js/menu.js          Per-store menu: what a store can make + design validation
js/donut-svg.js     Layered, seeded SVG donut renderer
js/pricing.js       Price + breakdown math (per-store price tables)
js/pickup.js        Distance, geocode, timezone-aware slot generation
js/app.js           Storefront state + UI wiring
js/dashboard.js     Dashboard state + UI wiring
js/login.js         Sign-in page wiring

tests/              node test suites (see "Tests" below)
```

## Where to change things — the shipped defaults live in `js/config.js`

Most per-store values below can also be changed from the [staff
dashboard](#staff-dashboard) without touching code. `config.js` remains the
default every store falls back to.

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
| Map basemap / tile provider      | `MAP_TILES`                                  |
| Demo staff accounts              | `SEED_USERS` in `js/auth.js`                 |
| What each role can edit          | `ROLES` in `js/auth.js`                      |

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

## Staff dashboard

`dashboard.html` lets store staff change all of the above **without editing
code**. Sign in at `login.html` — the page lists three demo accounts, one per
role, and clicking one fills the form.

| Role | Reaches | Also can |
|------|---------|----------|
| **Admin** | every store | manage users, export/import/reset settings |
| **CML** | a group of stores (an owner with several locations) | — |
| **Store Manager** | exactly one store | — |

All three can edit the same things *within* a store they reach:

- **Menu & colors** — which icings and sprinkle colors this store stocks. The
  panel shows the knock-on effects live (custom icing, the Rainbow preset) and
  warns when a change would make a ready-made box unavailable.
- **Hours & closures** — per-weekday open/close, the same-day cutoff, holiday
  closure dates, and a **pause switch** that hides the store from the storefront.
- **Pickup windows** — lead time (hours + minutes), window length, and dozens
  per window, with a live preview of the next bookable times.
- **Pricing** — base dozen, per-type/filling/icing surcharges, extra sprinkle
  color, drizzle, and tax rate, with an example dozen priced live.
- **Ready-made boxes** — switch chain designs off for this store, and build the
  store's own pre-designed dozens with a live donut preview.

Change what a role can edit in the `ROLES` capability table at the top of
`js/auth.js`; the dashboard's navigation and store picker follow it.

### How settings are stored

`js/config.js` holds the **shipped defaults**; the dashboard writes only the
**difference** to `localStorage`, and `js/settings.js` merges the two at page
load into the `DB.STORES` objects the rest of the app already reads:

```
config.js defaults  +  saved overrides  =  what the storefront sees
```

Two consequences worth knowing:

- Anything left at its default keeps following `config.js`, so a chain-wide
  price change in code still reaches every store that never overrode it.
  "Reset" is simply "delete the override".
- Because it's `localStorage`, **settings are per-browser and per-device, and
  the roles are enforced in the UI only** — this is a prototype standing in for
  the backend, not a security boundary. `js/settings.js` ends with a note
  mapping each override onto its Supabase table for the migration.

## Tests

The site still needs no build step; the suites are plain node.

```bash
node tests/settings-auth.test.js   # data layer — no dependencies
npm install && npm test            # adds the jsdom + real-browser suites
```

| Suite | Needs | Covers |
|-------|-------|--------|
| `settings-auth.test.js` | nothing | override merge, per-store pricing & scheduling, pause, premades, persistence/reset/import, auth roles |
| `dashboard-dom.test.js` | jsdom | loads the real pages, signs in as each role, walks every section, asserts saved edits reach the storefront |
| `dashboard-browser.test.js` | puppeteer | **real Chromium** — typing, focus/blur, clamping, the unsaved-changes dialog, section navigation |

**The browser suite is not optional belt-and-braces.** jsdom diverges from real
browsers on `input.selectionStart` (jsdom returns `null`, browsers *throw* on
non-text inputs), on focus/blur ordering, and on layout — and each of those
gaps hid a bug that passed jsdom and broke in Chrome. Anything touching text
input, focus or caret behaviour must be verified in `dashboard-browser.test.js`.

`npm run test:browser` starts its own static server on port 8765 and shuts it
down afterwards, so nothing is left listening.

## Google Maps

The app runs with a **graceful static map fallback** out of the box (no key
required). To enable the live embedded map with markers, set:

```js
const GOOGLE_MAPS_API_KEY = "your-key"; // in js/config.js
```

with the **Maps Embed API** enabled. For real-world location search, replace the
demo `GEO_LOOKUP` table / `Pickup.resolveLocation()` with a call to the Google
**Geocoding API**.

### The no-key map

Without a key the app still shows a full interactive map (Leaflet), styled to
read like Google Maps: the **CARTO Voyager** basemap (muted land, blue water,
white roads with amber highways), red teardrop pins with the selected store
enlarged, a blue "your location" dot, a Google-style info window, and rounded
zoom controls in the bottom-right. Pins are inline SVG, so they stay sharp on
retina and cost no extra image requests.

Change the basemap in `MAP_TILES` (`js/config.js`) — alternatives are listed in
a comment there. **The attribution string is a licence requirement of the tile
providers; keep it.** CARTO basemaps are free with attribution — review
[carto.com/attributions](https://carto.com/attributions) before shipping at
scale, or point `MAP_TILES.url` at your own tile source.

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
- **Scheduling** enforces operating hours, per-day same-day cutoffs, lead time,
  blackout days, a per-slot capacity cap, and correct store timezones (a Pacific
  user can book a New York pickup and see it in ET). Lead time, window length
  and capacity are **per store** and set in the dashboard; the defaults are
  30 min / 30 min / 20 dozen.
- **Paused stores** disappear from the store picker and the map, and can't be
  booked — a persisted pickup at a store that was paused since the last visit
  is dropped rather than left broken.
- **Confirmation** simulates email + SMS; payment is a mock form (wire to Stripe
  Elements / PaymentIntents for production).

## Accessibility

WCAG-AA minded: semantic landmarks, a skip link, labelled controls, ARIA
radiogroups with roving tabindex + arrow-key support, visible focus rings,
AA-contrast text, names paired with every color swatch, and
`prefers-reduced-motion` support.

> All prices, hours, stores, and allergen data are illustrative placeholders for
> demonstration.
