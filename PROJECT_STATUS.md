# Glaze & Co. — Donut Builder · Project Status & Roadmap

Last updated: 2026-06-25

This document tracks what has been built and what remains to take the site from a
working front-end prototype to a fully functional, live, production service.

Stack today: vanilla HTML/CSS/JS, no build step, no backend. All data is in
`js/config.js`. Everything below marked "placeholder/mock" is wired to look and
behave correctly in the UI but is not yet connected to a real service.

Legend:  [x] done   [~] partial / mocked   [ ] not started


================================================================================
## ✅ DONE — what currently works
================================================================================

### Donut customization (builder)
- [x] Donut Type — single-select, required: Classic Ring, Classic Shell,
      Chocolate Ring, Cake Ring. Each option card shows a live thumbnail + its
      allergen tags.
- [x] Filling — single-select, shown ONLY for Classic Shell: None, Jelly,
      Bavarian, Apple, Strawberry, Lemon. Renders a little jelly peeking out from
      behind the top-right rim (drawn under the donut so it looks like it's
      squeezing out the side).
- [x] Icing — single-select, required: Vanilla, Chocolate, Strawberry, Custom.
- [x] Vanilla bonus — selecting Vanilla unlocks a 5th sprinkle color slot (max 5
      instead of 4); the bonus color is billed like any additional sprinkle color.
      A live counter pill (X/4, or X/5 on Vanilla) sits at the section's top-right.
- [x] Custom icing — tie-dye swirl effect OR a single custom color tint.
- [x] Drizzle ("icing lines on top") — optional, single-select: None / Vanilla /
      Chocolate / Strawberry (same flavors/colors as the icing) / Custom (any
      palette color via a picker). Rendered as seeded diagonal piped lines, clipped
      to the icing so they run to the edge and skip the ring hole, drawn BELOW the
      sprinkles. Free by default.
- [x] Sprinkles — up to 4 colors (5 with Vanilla), first free, each extra charged.
      Full 14-color palette; every swatch is labelled with its name and a circular
      checkbox. "No Sprinkles" toggle (the default on first load) is mutually
      exclusive with color selection — clicking a color simply re-enables sprinkles.
- [x] Sprinkle presets & finishes — Rainbow and Chocolate preset modes (free), plus
      "Extra Heavy" density and "Half Top" finish toggles.
- [x] Layered SVG renderer (shadow → filling peek → dough → icing/tie-dye → drizzle
      → sprinkles → sheen), recolored dynamically via fill.
- [x] Seeded, STRATIFIED sprinkle scatter with AREA-PROPORTIONAL density, so
      coverage is even everywhere — including the solid Classic Shell (no centre
      clumping). Fixed seed → placement identical in the large preview and every
      grid cell; only colors reassign on change.
- [x] Sprinkle color chips shown on cart / order-summary line items.
- [x] Large live hero preview (no idle bounce) + 4×3 grid of all 12 identical donuts.
- [x] Real-time price with an always-visible itemized breakdown.
- [x] No "Randomize / Surprise Me" button (per spec).
- [x] Allergen disclosure tags on each donut type + a summary line under preview.

### Ready-made / seasonal boxes
- [x] "Boxes for the occasion" section of one-tap premade designs, data-driven in
      `PREMADE_BOXES`: Fourth of July (red/white/blue sprinkles), Team USA (red/blue
      sprinkles + red drizzle), Team México (green custom icing + white drizzle +
      red/white sprinkles).
- [x] Each card: occasion badge, live preview, per-dozen price, "Add to order"
      (drops the dozen into the cart) and "Customize" (loads it into the builder).

### Cart & order
- [x] "Add box to order" opens a full order summary drawer.
- [x] Multiple boxes per order, each with its own independent design.
- [x] Per-box quantity stepper, Edit, Duplicate, Remove.
- [x] Minimum order of 1 dozen enforced.
- [x] Order subtotal, tax line, and grand total.

### Pickup
- [x] Store finder via geolocation OR manual entry (zip / city / address).
- [x] "Nearby stores" dropdown below the map (sorted nearest-first via Haversine,
      distance shown), plus a detail card for the chosen store (address, open/closed,
      timezone). Scales to any number of stores.
- [x] Date picker (next 12 days) + time in 30-minute increments (no fixed slots).
- [x] Scheduling rules enforced: store operating hours, per-day same-day cutoff,
      30-minute minimum lead time, blackout days, and per-slot capacity cap
      (placeholder 20 dozen/slot).
- [x] Correct store timezones (e.g., a Pacific user booking a NY pickup sees ET).
- [x] Pickup is order-level (one store + time for the whole order). NOTE: this was
      an interpretation of the brief — revisit if per-box pickup is wanted.

### Checkout
- [x] Guest checkout and "create account" toggle.
- [x] Contact + payment form with validation.
- [x] Order confirmation screen with order number, pickup details, and totals.
- [x] Email + SMS confirmation shown (simulated).

### Pricing (all placeholder values, centralized in js/config.js)
- [x] Base dozen price, per-type / filling / icing modifiers, per-additional-
      sprinkle-color cost (incl. the Vanilla bonus 5th color), drizzle cost (free by
      default), tax rate.
- [x] Clear, always-visible price breakdown surfaced in UI.

### Quality
- [x] Fully responsive — verified the 4×3 grid + large preview reflow on mobile.
- [x] WCAG-AA minded: skip link, semantic landmarks, labelled controls, ARIA
      radiogroups with roving tabindex + arrow keys, visible focus, AA-contrast
      text, color swatches always paired with names, prefers-reduced-motion.
- [x] Verified by running in a headless browser; logic covered by 41 passing tests
      (pricing, distance, timezone scheduling, SVG determinism + even density).
- [x] README.md documents how to run and where to change values.


================================================================================
## 🔧 TO DO — to make it fully functional and live
================================================================================
These are the gaps between today's front-end prototype and a real, transactable
service. Roughly ordered by what blocks "going live."

### 1. Backend & data model  [ ]
- [ ] Stand up an API/server (e.g., Node/Express, Next.js API routes, or a
      serverless backend) — the app is currently 100% client-side.
- [ ] Database for: stores, products/pricing, orders, customers, and per-slot
      capacity/inventory. Move `js/config.js` data into it.
- [ ] Server-authoritative pricing — never trust prices computed in the browser;
      recompute and validate every order total on the server.
- [ ] Order persistence + unique, non-guessable order IDs (current IDs are random
      client-side only).

### 2. Payments (currently a MOCK form)  [~]
- [ ] Integrate a real PSP — Stripe recommended (Payment Element / PaymentIntents).
- [ ] Create PaymentIntent server-side from the validated cart total.
- [ ] PCI compliance — use Stripe Elements/hosted fields so raw card data never
      touches our servers. Remove the demo card inputs in `app.js`.
- [ ] Handle 3-D Secure / SCA, declines, retries, and refunds.
- [ ] Apply tax correctly (Stripe Tax or a tax service) — current 8.75% is a
      flat placeholder and not jurisdiction-aware.
- [ ] Payment webhooks to confirm capture before marking an order paid.

### 3. Notifications (currently SIMULATED)  [~]
- [ ] Transactional email (e.g., SendGrid / Postmark / SES) — real confirmation,
      receipt, and pickup-reminder templates.
- [ ] SMS (e.g., Twilio) — confirmation + reminder; respect opt-in/opt-out (STOP),
      and only send after the consent checkbox.
- [ ] Trigger on verified payment, not on button click.

### 4. Maps & location (currently STATIC fallback + demo geocoder)  [~]
- [ ] Add a Google Maps API key (`GOOGLE_MAPS_API_KEY` in config) and enable the
      Maps Embed/JS API to show the live map with store markers.
- [ ] Replace the demo `GEO_LOOKUP` / `Pickup.resolveLocation()` with the Google
      Geocoding API (and ideally Places Autocomplete on the address field).
- [ ] Restrict/secure the API key (HTTP referrer + API restrictions, usage quotas).
- [ ] Consider Distance Matrix for driving distance/ETA instead of straight-line.

### 5. Accounts & auth (toggle exists, no real auth)  [~]
- [ ] Real authentication (email/password + social, or a provider like Auth0 /
      Clerk / Firebase Auth).
- [ ] Account area: saved designs, order history, reorder, saved payment methods.
- [ ] Password reset, email verification, session management.

### 6. Inventory, capacity & store ops  [~]
- [ ] Real per-slot capacity backed by the DB (current "X left" is deterministic
      mock data). Decrement on order, prevent overbooking with atomic checks.
- [ ] Concurrency: two customers grabbing the last slot must not both succeed.
- [ ] Admin/store dashboard: view & manage orders, mark fulfilled, adjust hours,
      add blackout dates, set capacity, pause ordering.
- [ ] Product/menu management UI so staff can change prices/options without code.
- [ ] Lead-time/cutoff config per store editable by ops.

### 7. Order lifecycle & fulfillment  [ ]
- [ ] States: placed → paid → in production → ready → picked up → (canceled/refunded).
- [ ] Customer-facing order status page (and/or links in the email/SMS).
- [ ] "Order ready" notification when staff mark it ready.
- [ ] Cancellation / modification windows + refund flow.

### 8. Legal, compliance & trust  [ ]
- [ ] Verified, lawyer/ops-approved allergen data per product (current tags are
      illustrative). Add a standard allergen disclaimer.
- [ ] Privacy Policy, Terms of Service, and cookie/consent handling.
- [ ] SMS/marketing consent records (TCPA) and email CAN-SPAM compliance.
- [ ] Accessibility audit against WCAG 2.1 AA with assistive tech (built to AA,
      but needs a formal audit + screen-reader pass before launch).

### 9. Hosting, deployment & ops  [ ]
- [ ] Hosting + custom domain + HTTPS/SSL.
- [ ] CI/CD pipeline; staging + production environments; secret management for
      API keys (Stripe, Google, Twilio, SendGrid).
- [ ] Error monitoring (Sentry) + uptime monitoring + structured logging.
- [ ] Rate limiting / bot protection on order and geocode endpoints.
- [ ] Backups for the orders database.

### 10. Analytics & conversion  [ ]
- [ ] Analytics (GA4 / Plausible) + funnel events (design → add → pickup → pay).
- [ ] Conversion experiments (A/B), abandoned-cart recovery.

### 11. Performance, SEO & assets  [ ]
- [ ] Move from CDN Google Fonts to self-hosted/subset for performance & privacy;
      confirm font licensing (Fraunces & Inter are OFL — OK, but verify usage).
- [ ] Optimize: bundle/minify, cache headers, lazy-load below-the-fold.
- [ ] SEO: meta/OpenGraph tags, sitemap, structured data, favicon set / PWA icons.
- [ ] Real food photography / brand assets (logo currently inline SVG placeholder).
- [ ] Final brand copy review (hero, how-it-works, store details are placeholders).

### 12. Testing & QA  [~]
- [ ] Expand the existing logic tests into an automated suite in-repo.
- [ ] End-to-end tests (Playwright/Cypress) for the full order flow.
- [ ] Cross-browser/device matrix; real-device testing.
- [ ] Load test slot booking & checkout for concurrency.


================================================================================
## 🧩 KNOWN PLACEHOLDERS TO REPLACE (quick reference)
================================================================================
- Prices, tax rate, modifiers ............. js/config.js → PRICING
- Drizzle add-on cost (free by default) ... js/config.js → PRICING.drizzleCost
- Premade / seasonal boxes ................ js/config.js → PREMADE_BOXES
- Stores, hours, cutoffs, blackouts ....... js/config.js → STORES
- Slot capacity / lead time / increment ... js/config.js → SCHEDULING_DEFAULTS
- Google Maps key (empty = static map) .... js/config.js → GOOGLE_MAPS_API_KEY
- Manual-location geocoder (demo lookup) .. js/config.js → GEO_LOOKUP + Pickup.resolveLocation()
- Allergen tags (illustrative) ............ js/config.js → DONUT_TYPES[].allergens
- Per-slot "X left" capacity (mock) ....... js/pickup.js → bookedDozen()
- Payment fields (mock, non-PCI) .......... js/app.js → renderCheckoutSection()
- Email/SMS confirmation (simulated) ...... js/app.js → placeOrder()/renderConfirmation()


================================================================================
## 🗺️ SUGGESTED PHASING
================================================================================
- Phase 1 (transactable): backend + DB, server-side pricing, Stripe payments,
  real email/SMS, real capacity with atomic booking. → can take real orders.
- Phase 2 (operable): admin/store dashboard, order lifecycle + status page,
  accounts/order history, real Google Maps + geocoding.
- Phase 3 (launch-ready): legal/compliance, accessibility audit, analytics,
  performance/SEO, photography & final copy, monitoring, E2E tests, deploy.


================================================================================
## ❓ OPEN QUESTIONS / DECISIONS TO CONFIRM
================================================================================
- Pickup scope: order-level (current) vs. per-box pickup store/time?
- Delivery ever needed, or pickup-only?
- Tipping at checkout? Promo/discount codes? Loyalty?
- Real store list, hours, and the true menu/pricing.
- Tax handling: single rate vs. per-jurisdiction (likely the latter).
- Brand: final logo, fonts, photography, voice.


================================================================================
## 🏗️ BACKEND MIGRATION PLAN (concrete — accounts, DB, payments)
================================================================================
The site is static today. To become a real, transactable app (user accounts, a
database of locations, online payments) it needs a host that runs server code +
a database. GitHub stays the source-of-truth + collaboration hub; the deploy
target changes from GitHub Pages (static only) to a backend-capable platform.

### Recommended stack
- Host + serverless functions: **Vercel** (auto-deploys from GitHub on push).
- Database + auth: **Supabase** (managed Postgres + Auth + row-level security).
- Payments: **Stripe** (Checkout/Elements on the client, PaymentIntents + webhook
  on the server).
- Email/SMS: **SendGrid/Postmark** + **Twilio**.
- All free tiers to build on; secrets live in host env vars, never in the repo.

The donut renderer (donut-svg.js), pricing math (pricing.js), and scheduling
(pickup.js) are plain JS and port over as-is for DISPLAY. The server re-validates
pricing, capacity, and timezones authoritatively.

### Database schema (Postgres / Supabase)  — prices stored in CENTS
- users ......... id, email, name, phone, role(user|admin), created_at
                  (or Supabase auth.users + a `profiles` table)
- stores ........ id, name, address, lat, lng, timezone, phone, active
- store_hours ... id, store_id→stores, weekday(0-6), open, close, cutoff
- store_blackouts id, store_id→stores, date
- store_settings  store_id, lead_time_min, slot_increment_min, slot_capacity_dozen
- donut_types ... id, slug, name, shape(ring|shell), dough_color, dough_shade,
                  blurb, allergens(text[]), active
- fillings ...... id, slug, name, active
- icings ........ id, slug, name, color, bonus_sprinkle(bool), is_custom(bool), active
- sprinkle_colors id, slug, name, hex, active
- pricing ....... base_dozen, additional_sprinkle_color, drizzle_cost, tax_rate,
                  type_modifiers(jsonb), filling_modifiers(jsonb), icing_modifiers(jsonb)
                  (one row, or per-store if prices vary by location)
- premade_boxes . id, name, occasion, blurb, design(jsonb), active, sort
- orders ........ id, user_id→users (nullable for guest), store_id→stores,
                  pickup_at(timestamptz), status(pending|paid|in_production|ready|
                  picked_up|canceled|refunded), subtotal_cents, tax_cents,
                  total_cents, stripe_payment_intent, contact_name, email, phone,
                  created_at
- order_boxes ... id, order_id→orders, design(jsonb), qty, unit_price_cents
- slot_bookings . id, store_id→stores, slot_start(timestamptz), dozen_count,
                  order_id→orders  (aggregate per slot to enforce capacity)

Capacity is enforced in a TRANSACTION: SELECT current dozen for (store, slot)
FOR UPDATE, reject if + new dozen > capacity, else insert. Prevents the
"two customers grab the last slot" race.

### Where today's js/config.js data goes
- PRICING ................ → `pricing` (convert dollars → cents)
- STORES (+ hours/cutoffs) → `stores` / `store_hours` / `store_blackouts`
- SCHEDULING_DEFAULTS .... → `store_settings`
- DONUT_TYPES ............ → `donut_types`
- FILLINGS / ICINGS ...... → `fillings` / `icings`
- SPRINKLE_PALETTE ....... → `sprinkle_colors`
- PREMADE_BOXES .......... → `premade_boxes`
- GEO_LOOKUP / resolveLocation → real geocoding API (Google/Mapbox), server-side
- bookedDozen() (mock) ... → real query against `slot_bookings`
The frontend fetches all of the above via `GET /api/menu` and renders from it
instead of the hardcoded config.

### API endpoints (Vercel serverless / Next.js API routes)
- GET  /api/menu ............ active stores, types, fillings, icings, sprinkles,
                             premades, pricing (public, cached)
- POST /api/slots .......... available 30-min times for {storeId, date}; server
                             applies hours, cutoff, lead time, blackout, capacity,
                             timezone (authoritative)
- POST /api/quote .......... recompute cart totals from DB pricing; never trust
                             client numbers
- POST /api/checkout ....... re-validate + reserve slot capacity (txn) + create
                             Stripe PaymentIntent(amount from server); returns
                             client_secret
- POST /api/stripe/webhook . verify signature; on payment_intent.succeeded →
                             finalize order (status=paid), commit slot booking,
                             fire email + SMS; on failure → release reservation
- GET  /api/orders ......... current user's orders (auth required)
- /admin/* ................. order management, menu CRUD (admin role only)

### Stripe checkout flow (server-authoritative; PCI-safe)
1. Client builds cart + pickup → POST /api/quote → server returns validated totals.
2. Client "Pay" → POST /api/checkout → server reserves the slot + creates a
   PaymentIntent for the server-computed amount → returns client_secret.
3. Client confirms with Stripe.js (card entered in Stripe Elements/Checkout — card
   data never touches our server).
4. Stripe → POST /api/stripe/webhook (signature-verified) → create/confirm the
   order as PAID, commit the slot booking, send confirmation email + SMS.
5. If capacity was lost between reserve and confirm, void/refund and notify.

### Secrets (host env vars — NOT in the repo)
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, SENDGRID_API_KEY (or POSTMARK), TWILIO_*,
GOOGLE_MAPS_API_KEY.

### Build order (refines the phasing above)
1. Supabase project → create schema → seed from config.js → ship GET /api/menu;
   point the frontend at it.
2. Auth (Supabase) + orders/order_boxes persistence + /api/orders.
3. Stripe: /api/quote, /api/checkout (with capacity reservation), webhook.
4. Email + SMS from the webhook; admin dashboard; real geocoding + live Google Map.
5. Hardening: rate limiting, monitoring, legal pages, a11y audit, custom domain.

> Decision to make early: keep the vanilla frontend and add serverless functions
> beneath it (lowest rewrite), OR migrate the frontend to Next.js/React (unifies
> frontend + API, first-class on Vercel, richest auth/Stripe ecosystem). The
> existing JS logic moves over either way.
