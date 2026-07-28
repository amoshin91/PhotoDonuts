/* =============================================================================
   dashboard.js — Staff dashboard UI.

   Depends on: config.js (DB), settings.js (Settings), auth.js (Auth),
               menu.js (Menu), donut-svg.js (DonutSVG), pricing.js (Pricing),
               pickup.js (Pickup).

   SHAPE
   -----
   One store is in focus at a time (`state.storeId`), chosen from whatever the
   signed-in user's role lets them reach. Each section renders a form into a
   `draft` object; edits mark the page dirty and raise the save bar; Save hands
   the draft to the matching Settings.set*() writer, which merges it over the
   config.js defaults and re-applies it to DB so the storefront picks it up.

   Sections are declared in SECTIONS below — each one is
   { id, label, cap, render(store), collect() } — so adding a settings area is
   a matter of adding one entry, not touching the shell.
   ============================================================================ */
(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const state = {
    user: null,
    storeId: null,
    sectionId: "menu",
    draft: null,   // section-local working copy; null when the section is clean
    dirty: false,
  };

  /* ------------------------------- HELPERS -------------------------------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toast(msg, warn) {
    const region = $("#toastRegion");
    if (!region) return;
    const el = document.createElement("div");
    el.className = "toast" + (warn ? " toast--warn" : "");
    el.innerHTML = `<span class="toast__dot"></span><span>${escapeHtml(msg)}</span>`;
    region.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 320);
    }, 3200);
  }

  function currentStore() {
    return DB.STORES.find((s) => s.id === state.storeId) || null;
  }

  // Deep copy — drafts must never alias the merged objects hanging off DB.
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function money(n) { return Pricing.fmt(Number(n) || 0); }

  function markDirty() {
    state.dirty = true;
    syncSaveBar();
  }

  function syncSaveBar() {
    const bar = $("#saveBar");
    bar.hidden = !state.dirty;
    document.body.classList.toggle("has-save-bar", state.dirty);
  }

  /* Guard every navigation that would throw away edits. */
  function confirmLeave() {
    if (!state.dirty) return true;
    const ok = window.confirm("You have unsaved changes on this page. Discard them?");
    if (ok) { state.dirty = false; syncSaveBar(); }
    return ok;
  }

  /* Turn a design (partial or complete) into what DonutSVG expects.
     A trimmed twin of app.js's resolveDesign — the two files share no module
     system, and the dashboard only needs the read-only rendering half. */
  function fullDesign(partial) {
    return Object.assign({
      typeId: "classic-ring", fillingId: "none", icingId: "vanilla",
      tieDyeIcing: false, icingTintId: null, drizzleId: null, drizzleCustomId: null,
      sprinkleColorIds: [], noSprinkles: true, rainbowSprinkles: false,
      chocolateSprinkles: false, heavySprinkles: false, halfSprinkles: false,
    }, clone(partial || {}));
  }

  function paletteById(id) { return DB.SPRINKLE_PALETTE.find((c) => c.id === id); }

  function resolveDesign(d) {
    const icing = DB.ICINGS.find((i) => i.id === d.icingId);
    let icingHex = null, tieDye = false;
    if (icing && icing.custom) {
      if (d.tieDyeIcing) tieDye = true;
      else if (d.icingTintId) { const t = paletteById(d.icingTintId); icingHex = t ? t.hex : null; }
    }

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
        const cols = (d.sprinkleColorIds || []).map(paletteById).filter(Boolean);
        sprinkleHexes = cols.map((c) => c.hex);
        sprinkleNames = cols.map((c) => c.name);
      }
    }

    let drizzleHex = null, drizzleName = null;
    if (d.drizzleId === "custom") {
      const c = paletteById(d.drizzleCustomId);
      if (c) { drizzleHex = c.hex; drizzleName = c.name; }
    } else if (d.drizzleId) {
      const dz = DB.ICINGS.find((i) => i.id === d.drizzleId);
      if (dz) { drizzleHex = dz.color; drizzleName = dz.name; }
    }

    return {
      typeId: d.typeId, fillingId: d.fillingId, icingId: d.icingId,
      icingHex, tieDye, drizzleHex, drizzleName,
      sprinkleHexes, sprinkleNames, rainbowColors,
      heavySprinkles: d.heavySprinkles, halfSprinkles: d.halfSprinkles, noSprinkles: d.noSprinkles,
    };
  }

  /* =========================================================================
     SECTION 1 — MENU (icings + sprinkle colors)
     ========================================================================= */
  const menuSection = {
    id: "menu",
    label: "Menu & colors",
    cap: "menu",
    hint: "What this store can make",

    init(store) {
      const m = store.menu || {};
      return {
        // A draft always holds an explicit list; Settings.setMenu collapses a
        // full list back to "unrestricted" when it saves.
        icingIds: Array.isArray(m.icingIds) ? m.icingIds.slice() : DB.ICINGS.map((i) => i.id),
        sprinkleColorIds: Array.isArray(m.sprinkleColorIds) ? m.sprinkleColorIds.slice() : DB.SPRINKLE_PALETTE.map((c) => c.id),
      };
    },

    render(store) {
      const d = state.draft;
      // Derived effects are computed by the same code the storefront uses, so
      // what staff see here is exactly what the builder will offer.
      const preview = Menu.forStore({ id: store.id, menu: { icingIds: d.icingIds, sprinkleColorIds: d.sprinkleColorIds } });

      const icings = DB.ICINGS.map((i) => {
        const on = d.icingIds.indexOf(i.id) !== -1;
        return `
          <label class="opt-tile${on ? " is-on" : ""}">
            <input type="checkbox" data-menu-icing="${i.id}" ${on ? "checked" : ""} />
            <span class="opt-tile__swatch" style="background:${i.color}"></span>
            <span class="opt-tile__name">${escapeHtml(i.name)}</span>
            ${i.custom ? `<span class="opt-tile__tag">unlocks tie-dye &amp; tints</span>` : ""}
            ${i.bonusSprinkle ? `<span class="opt-tile__tag">unlocks a 5th color</span>` : ""}
          </label>`;
      }).join("");

      const colors = DB.SPRINKLE_PALETTE.map((c) => {
        const on = d.sprinkleColorIds.indexOf(c.id) !== -1;
        const rainbow = DB.RAINBOW_SPRINKLE_IDS.indexOf(c.id) !== -1;
        return `
          <label class="opt-tile">
            <input type="checkbox" data-menu-color="${c.id}" ${on ? "checked" : ""} />
            <span class="opt-tile__swatch" style="background:${c.hex}"></span>
            <span class="opt-tile__name">${escapeHtml(c.name)}</span>
            ${rainbow ? `<span class="opt-tile__tag">rainbow mix</span>` : ""}
          </label>`;
      }).join("");

      const effects = [];
      effects.push(preview.hasCustomIcing
        ? `<li class="fx fx--on">Custom icing on — tie-dye swirl, single-color tints and custom drizzle are all offered.</li>`
        : `<li class="fx fx--off">No custom icing — tie-dye, tints and custom-color drizzle are hidden from the builder.</li>`);
      effects.push(preview.rainbowAvailable
        ? `<li class="fx fx--on">Rainbow preset on — all ${DB.RAINBOW_SPRINKLE_IDS.length} mix colors are stocked.</li>`
        : `<li class="fx fx--off">Rainbow preset hidden — missing ${escapeHtml(DB.RAINBOW_SPRINKLE_IDS.filter((id) => d.sprinkleColorIds.indexOf(id) === -1).map((id) => (paletteById(id) || {}).name).join(", "))}.</li>`);
      if (!d.sprinkleColorIds.length) {
        effects.push(`<li class="fx fx--warn">No sprinkle colors — customers can only order plain or chocolate-sprinkled dozens.</li>`);
      }

      // Ready-made boxes this menu would make impossible.
      const broken = Settings.premadesFor(store.id)
        .map((p) => ({ p, res: Menu.checkDesign(fullDesign(p.design), { id: store.id, menu: { icingIds: d.icingIds, sprinkleColorIds: d.sprinkleColorIds } }) }))
        .filter((x) => !x.res.ok);
      const brokenHtml = broken.length ? `
        <div class="notice notice--warn" style="margin-top:1rem">
          <strong>Heads up:</strong> with these colors, ${broken.length === 1 ? "this ready-made box can" : "these ready-made boxes can"}'t be made here —
          ${broken.map((x) => `${escapeHtml(x.p.name)} <span class="dim">(needs ${escapeHtml(x.res.problems.join(", "))})</span>`).join("; ")}.
          They'll show as unavailable to customers.
        </div>` : "";

      return `
        ${sectionHead("Menu & colors", "Only what you tick here appears in the customer's donut builder. Donut types and fillings are the same at every store.")}

        <section class="card">
          <div class="card__head">
            <h3 class="card__title">Icings <span class="card__count">${d.icingIds.length} of ${DB.ICINGS.length}</span></h3>
            <div class="card__actions">
              <button class="link-btn" type="button" data-bulk="icing-all">Select all</button>
              <button class="link-btn" type="button" data-bulk="icing-none">Clear</button>
            </div>
          </div>
          <div class="opt-grid">${icings}</div>
          <p class="field-error" id="icingError" ${d.icingIds.length ? "hidden" : ""}>Pick at least one icing — a store with none can't take custom orders.</p>
        </section>

        <section class="card">
          <div class="card__head">
            <h3 class="card__title">Sprinkle colors <span class="card__count">${d.sprinkleColorIds.length} of ${DB.SPRINKLE_PALETTE.length}</span></h3>
            <div class="card__actions">
              <button class="link-btn" type="button" data-bulk="color-all">Select all</button>
              <button class="link-btn" type="button" data-bulk="color-rainbow">Rainbow set</button>
              <button class="link-btn" type="button" data-bulk="color-none">Clear</button>
            </div>
          </div>
          <div class="opt-grid opt-grid--colors">${colors}</div>
        </section>

        <section class="card card--quiet">
          <h3 class="card__title">What this means for customers</h3>
          <ul class="fx-list">${effects.join("")}</ul>
          ${brokenHtml}
        </section>`;
    },

    on: {
      change(e) {
        const icing = e.target.closest("[data-menu-icing]");
        if (icing) { toggleId(state.draft.icingIds, icing.dataset.menuIcing, icing.checked); rerenderSection(); markDirty(); return; }
        const color = e.target.closest("[data-menu-color]");
        if (color) { toggleId(state.draft.sprinkleColorIds, color.dataset.menuColor, color.checked); rerenderSection(); markDirty(); }
      },
      click(e) {
        const btn = e.target.closest("[data-bulk]");
        if (!btn) return;
        const d = state.draft;
        switch (btn.dataset.bulk) {
          case "icing-all": d.icingIds = DB.ICINGS.map((i) => i.id); break;
          case "icing-none": d.icingIds = []; break;
          case "color-all": d.sprinkleColorIds = DB.SPRINKLE_PALETTE.map((c) => c.id); break;
          case "color-rainbow": d.sprinkleColorIds = DB.RAINBOW_SPRINKLE_IDS.slice(); break;
          case "color-none": d.sprinkleColorIds = []; break;
        }
        rerenderSection();
        markDirty();
      },
    },

    save(store) {
      if (!state.draft.icingIds.length) return { ok: false, error: "Pick at least one icing before saving." };
      Settings.setMenu(store.id, state.draft);
      return { ok: true, message: "Menu updated — the builder now offers exactly these options." };
    },
  };

  function toggleId(list, id, on) {
    const i = list.indexOf(id);
    if (on && i === -1) list.push(id);
    if (!on && i !== -1) list.splice(i, 1);
  }

  /* =========================================================================
     SECTION 2 — HOURS, CUTOFFS, BLACKOUTS, PAUSE
     ========================================================================= */
  const hoursSection = {
    id: "hours",
    label: "Hours & closures",
    cap: "hours",
    hint: "Open times, cutoffs, holidays",

    init(store) {
      return {
        active: store.active !== false,
        hours: clone(store.hours),
        blackoutDates: (store.blackoutDates || []).slice(),
        newBlackout: "",
      };
    },

    render(store) {
      const d = state.draft;

      const rows = WEEKDAYS.map((name, i) => {
        const h = d.hours[i];
        const open = !!h;
        return `
          <tr class="hours-row${open ? "" : " is-closed"}">
            <th scope="row" class="hours-row__day">${name}</th>
            <td>
              <label class="switch">
                <input type="checkbox" data-day-open="${i}" ${open ? "checked" : ""} />
                <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
                <span class="switch__text">${open ? "Open" : "Closed"}</span>
              </label>
            </td>
            <td><input class="input input--time" type="time" data-day-field="open" data-day="${i}" value="${open ? h.open : ""}" ${open ? "" : "disabled"} aria-label="${name} opening time" /></td>
            <td><input class="input input--time" type="time" data-day-field="close" data-day="${i}" value="${open ? h.close : ""}" ${open ? "" : "disabled"} aria-label="${name} closing time" /></td>
            <td><input class="input input--time" type="time" data-day-field="cutoff" data-day="${i}" value="${open ? (h.cutoff || h.close) : ""}" ${open ? "" : "disabled"} aria-label="${name} same-day order cutoff" /></td>
          </tr>`;
      }).join("");

      const problems = validateHours(d.hours);
      const problemHtml = problems.length
        ? `<p class="field-error">${problems.map(escapeHtml).join(" ")}</p>` : "";

      const today = Pickup.minSelectableDate(store);
      const blackouts = d.blackoutDates.length
        ? d.blackoutDates.map((date) => `
            <li class="chip-tag${date < today ? " chip-tag--past" : ""}">
              <span>${formatDate(date)}</span>
              <button class="chip-tag__x" type="button" data-remove-blackout="${date}" aria-label="Remove ${formatDate(date)}">
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </li>`).join("")
        : `<li class="dim">No closure dates set.</li>`;

      return `
        ${sectionHead("Hours & closures", "Pickup times are generated from these hours in the store's local timezone (" + escapeHtml(store.timezone) + ").")}

        <section class="card ${d.active ? "" : "card--paused"}">
          <div class="pause-row">
            <div>
              <h3 class="card__title">Online ordering</h3>
              <p class="card__sub">${d.active
                ? "Customers can find this store and place orders."
                : "Paused — this store is hidden from the store picker and can't take new orders. Existing orders are unaffected."}</p>
            </div>
            <label class="switch switch--lg">
              <input type="checkbox" data-active ${d.active ? "checked" : ""} />
              <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
              <span class="switch__text">${d.active ? "Accepting orders" : "Paused"}</span>
            </label>
          </div>
        </section>

        <section class="card">
          <h3 class="card__title">Weekly hours</h3>
          <p class="card__sub">The <strong>cutoff</strong> is the latest local time an order can still be placed for <em>same-day</em> pickup. Leave it equal to closing to allow same-day orders right up to close.</p>
          <div class="table-scroll">
            <table class="hours-table">
              <thead><tr><th scope="col">Day</th><th scope="col">Status</th><th scope="col">Opens</th><th scope="col">Closes</th><th scope="col">Same-day cutoff</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${problemHtml}
          <div class="card__actions card__actions--end">
            <button class="link-btn" type="button" data-hours-copy>Copy Monday to every open day</button>
          </div>
        </section>

        <section class="card">
          <h3 class="card__title">Closure dates <span class="card__count">${d.blackoutDates.length}</span></h3>
          <p class="card__sub">Holidays and one-off closures. No pickup times are offered on these days.</p>
          <ul class="chip-tags">${blackouts}</ul>
          <div class="inline-form">
            <input class="input" type="date" id="newBlackout" min="${today}" value="${escapeHtml(d.newBlackout)}" aria-label="New closure date" />
            <button class="btn btn--ghost" type="button" data-add-blackout>Add closure date</button>
          </div>
        </section>`;
    },

    on: {
      change(e) {
        const d = state.draft;

        const active = e.target.closest("[data-active]");
        if (active) { d.active = active.checked; rerenderSection(); markDirty(); return; }

        const dayOpen = e.target.closest("[data-day-open]");
        if (dayOpen) {
          const i = Number(dayOpen.dataset.dayOpen);
          // Re-opening a closed day starts from the store's most common hours
          // rather than an empty pair of time fields.
          d.hours[i] = dayOpen.checked ? (templateDay(d.hours) || { open: "07:00", close: "19:00", cutoff: "19:00" }) : null;
          rerenderSection();
          markDirty();
          return;
        }

        const field = e.target.closest("[data-day-field]");
        if (field) {
          const i = Number(field.dataset.day);
          if (!d.hours[i]) return;
          d.hours[i][field.dataset.dayField] = field.value;
          // Keep cutoff sane when closing time moves in front of it.
          if (field.dataset.dayField === "close" && d.hours[i].cutoff > field.value) d.hours[i].cutoff = field.value;
          rerenderSection();
          markDirty();
          return;
        }

        const nb = e.target.closest("#newBlackout");
        if (nb) d.newBlackout = nb.value;
      },

      click(e) {
        const d = state.draft;

        if (e.target.closest("[data-hours-copy]")) {
          const src = d.hours[1]; // Monday
          if (!src) { toast("Monday is closed — nothing to copy.", true); return; }
          d.hours = d.hours.map((h) => (h ? clone(src) : null));
          rerenderSection();
          markDirty();
          return;
        }

        const add = e.target.closest("[data-add-blackout]");
        if (add) {
          const input = $("#newBlackout");
          const date = input && input.value;
          if (!date) { toast("Pick a date first.", true); return; }
          if (d.blackoutDates.indexOf(date) !== -1) { toast("That date is already closed.", true); return; }
          d.blackoutDates.push(date);
          d.blackoutDates.sort();
          d.newBlackout = "";
          rerenderSection();
          markDirty();
          return;
        }

        const rm = e.target.closest("[data-remove-blackout]");
        if (rm) {
          d.blackoutDates = d.blackoutDates.filter((x) => x !== rm.dataset.removeBlackout);
          rerenderSection();
          markDirty();
        }
      },
    },

    save(store) {
      const d = state.draft;
      const problems = validateHours(d.hours);
      if (problems.length) return { ok: false, error: problems[0] };
      if (!d.hours.some(Boolean)) return { ok: false, error: "A store needs at least one open day." };
      Settings.setHours(store.id, d.hours, d.blackoutDates);
      Settings.setActive(store.id, d.active);
      return { ok: true, message: d.active ? "Hours saved." : "Hours saved — online ordering is paused for this store." };
    },
  };

  // Most-used open day, so re-opening a day doesn't start blank.
  function templateDay(hours) {
    const open = hours.filter(Boolean);
    return open.length ? clone(open[0]) : null;
  }

  function validateHours(hours) {
    const problems = [];
    hours.forEach((h, i) => {
      if (!h) return;
      if (!h.open || !h.close) { problems.push(`${WEEKDAYS[i]} needs both an opening and a closing time.`); return; }
      if (h.close <= h.open) { problems.push(`${WEEKDAYS[i]} closes before it opens.`); return; }
      const cutoff = h.cutoff || h.close;
      if (cutoff < h.open || cutoff > h.close) {
        problems.push(`${WEEKDAYS[i]}'s cutoff must fall between opening and closing.`);
      }
    });
    return problems;
  }

  function formatDate(ds) {
    const [y, m, d] = ds.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  }

  /* =========================================================================
     SECTION 3 — PICKUP WINDOWS (lead time, window length, capacity)
     ========================================================================= */
  const windowsSection = {
    id: "windows",
    label: "Pickup windows",
    cap: "windows",
    hint: "Lead time & capacity",

    init(store) {
      const s = Pickup.schedulingFor(store);
      return {
        leadHours: Math.floor(s.leadTimeMinutes / 60),
        leadMinutes: s.leadTimeMinutes % 60,
        slotIncrementMinutes: s.slotIncrementMinutes,
        slotCapacityDozen: s.slotCapacityDozen,
      };
    },

    render(store) {
      const d = state.draft;
      const leadTotal = d.leadHours * 60 + d.leadMinutes;
      const defaults = Settings.defaults().scheduling;

      // Preview against a store carrying the DRAFT rules, so staff see the
      // effect of a change before committing it.
      const probe = Object.assign(clone(store), {
        scheduling: {
          leadTimeMinutes: leadTotal,
          slotIncrementMinutes: d.slotIncrementMinutes,
          slotCapacityDozen: d.slotCapacityDozen,
        },
        active: true, // preview the schedule even while ordering is paused
      });
      const previewHtml = renderSlotPreview(probe);

      const increments = [10, 15, 20, 30, 45, 60, 90, 120];

      return `
        ${sectionHead("Pickup windows", "How far ahead customers must order, how long each pickup window is, and how much this store can produce per window.")}

        <section class="card">
          <h3 class="card__title">Lead time</h3>
          <p class="card__sub">The earliest a customer can pick up, counted from the moment they order. Anything sooner is hidden from the time picker.</p>
          <div class="dur-row">
            <div class="field field--inline">
              <label class="field-label" for="leadHours">Hours</label>
              <input class="input input--num" id="leadHours" type="number" min="0" max="336" step="1" value="${d.leadHours}" />
            </div>
            <div class="field field--inline">
              <label class="field-label" for="leadMinutes">Minutes</label>
              <input class="input input--num" id="leadMinutes" type="number" min="0" max="59" step="5" value="${d.leadMinutes}" />
            </div>
            <p class="dur-row__read">= <strong>${escapeHtml(Pickup.formatDuration(leadTotal))}</strong> minimum notice
              ${leadTotal === defaults.leadTimeMinutes ? `<span class="dim">(default)</span>` : ""}</p>
          </div>
          ${leadTotal >= 1440 ? `<p class="notice" style="margin-top:.8rem">That's ${Math.floor(leadTotal / 1440)} day${leadTotal >= 2880 ? "s" : ""} of notice — customers won't see any same-day times.</p>` : ""}
        </section>

        <section class="card">
          <h3 class="card__title">Window length</h3>
          <p class="card__sub">Pickup times are offered on this cadence, from opening to closing.</p>
          <div class="seg seg--wrap" role="group" aria-label="Window length">
            ${increments.map((n) => `<button class="seg__btn" type="button" data-increment="${n}" aria-pressed="${n === d.slotIncrementMinutes}">${n} min</button>`).join("")}
          </div>
        </section>

        <section class="card">
          <h3 class="card__title">Capacity per window</h3>
          <p class="card__sub">The most this store can produce for any single pickup window. An order is only offered a window with room for <em>all</em> of its dozens, so a 6-dozen order needs 6 free.</p>
          <div class="field field--inline">
            <label class="field-label" for="capacity">Dozens per window</label>
            <input class="input input--num" id="capacity" type="number" min="1" max="500" step="1" value="${d.slotCapacityDozen}" />
          </div>
          <p class="field-note">At ${d.slotIncrementMinutes}-minute windows that's up to
            <strong>${d.slotCapacityDozen * Math.floor(60 / Math.max(1, d.slotIncrementMinutes)) || d.slotCapacityDozen}</strong>
            dozen per hour at full booking.</p>
        </section>

        <section class="card card--quiet">
          <h3 class="card__title">Preview — next available pickups</h3>
          <p class="card__sub">Generated with the settings above, in ${escapeHtml(store.timezone)}. Remaining counts are placeholder booking data until the orders database exists.</p>
          ${previewHtml}
        </section>`;
    },

    on: {
      input(e) {
        const d = state.draft;
        const id = e.target.id;
        if (id !== "leadHours" && id !== "leadMinutes" && id !== "capacity") return;
        // Let the field go empty while typing — clamping mid-keystroke would
        // rewrite "" to "0" and fight the person entering a two-digit number.
        if (e.target.value === "") return;
        if (id === "leadHours") d.leadHours = clampNum(e.target.value, 0, 336);
        else if (id === "leadMinutes") d.leadMinutes = clampNum(e.target.value, 0, 59);
        else d.slotCapacityDozen = clampNum(e.target.value, 1, 500);
        rerenderSection({ keepFocus: id });
        markDirty();
      },
      click(e) {
        const btn = e.target.closest("[data-increment]");
        if (!btn) return;
        state.draft.slotIncrementMinutes = Number(btn.dataset.increment);
        rerenderSection();
        markDirty();
      },
    },

    save(store) {
      const d = state.draft;
      Settings.setScheduling(store.id, {
        leadTimeMinutes: d.leadHours * 60 + d.leadMinutes,
        slotIncrementMinutes: d.slotIncrementMinutes,
        slotCapacityDozen: d.slotCapacityDozen,
      });
      return { ok: true, message: "Pickup windows saved." };
    },
  };

  function clampNum(v, min, max) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /* Next few bookable windows, scanning forward past closed/blacked-out days. */
  function renderSlotPreview(probe) {
    const start = Pickup.minSelectableDate(probe);
    const days = [];
    for (let i = 0; i < 14 && days.length < 2; i++) {
      const ds = Pickup.addDays(start, i);
      const res = Pickup.generateSlots(probe, ds);
      const open = res.slots.filter((s) => s.available);
      if (res.closed || !open.length) continue;
      days.push({ ds, slots: open.slice(0, 8), more: Math.max(0, open.length - 8) });
    }
    if (!days.length) {
      return `<p class="notice notice--warn">No pickup times are bookable in the next 14 days with these settings — check the lead time and weekly hours.</p>`;
    }
    return days.map((day) => `
      <div class="preview-day">
        <p class="preview-day__label">${formatDate(day.ds)}</p>
        <div class="preview-slots">
          ${day.slots.map((s) => `<span class="preview-slot">${escapeHtml(s.label)}<span class="preview-slot__cap">${s.remaining} left</span></span>`).join("")}
          ${day.more ? `<span class="preview-slot preview-slot--more">+${day.more} more</span>` : ""}
        </div>
      </div>`).join("");
  }

  /* =========================================================================
     SECTION 4 — PRICING
     ========================================================================= */
  const pricingSection = {
    id: "pricing",
    label: "Pricing",
    cap: "pricing",
    hint: "Per-store prices & tax",

    init(store) {
      const p = clone(store.pricing);
      // Make sure every option has a key, so the form can render a field for
      // each one even where config.js never set a modifier.
      DB.DONUT_TYPES.forEach((t) => { if (p.typeModifier[t.id] == null) p.typeModifier[t.id] = 0; });
      DB.FILLINGS.forEach((f) => { if (p.fillingModifier[f.id] == null) p.fillingModifier[f.id] = 0; });
      DB.ICINGS.forEach((i) => { if (p.icingModifier[i.id] == null) p.icingModifier[i.id] = 0; });
      return p;
    },

    render(store) {
      const d = state.draft;
      const base = Settings.defaults().pricing;

      // A representative dozen, priced with the draft, so a change is legible
      // in dollars rather than in fields.
      const example = fullDesign({ typeId: "classic-shell", fillingId: "jelly", icingId: "chocolate", noSprinkles: false, sprinkleColorIds: ["red", "yellow", "blue"] });
      const exLines = examplePrice(example, d);

      const modRows = (table, items, labelKey) => items.map((it) => {
        const val = d[table][it.id];
        const def = (base[table] || {})[it.id] || 0;
        return `
          <div class="price-row">
            <label class="price-row__label" for="p-${table}-${it.id}">${escapeHtml(it[labelKey])}</label>
            <div class="money-input">
              <span class="money-input__sym">+$</span>
              <input class="input input--num" id="p-${table}-${it.id}" type="number" min="0" step="0.25" value="${val}" data-price-table="${table}" data-price-id="${it.id}" />
            </div>
            ${val !== def ? `<button class="link-btn price-row__reset" type="button" data-price-reset="${table}:${it.id}">reset to ${money(def)}</button>` : `<span class="price-row__def dim">default</span>`}
          </div>`;
      }).join("");

      return `
        ${sectionHead("Pricing", "Prices for this store only. Anything left at its default follows the chain-wide price automatically if that ever changes.")}

        <section class="card">
          <h3 class="card__title">Core prices</h3>
          <div class="price-grid">
            <div class="price-row">
              <label class="price-row__label" for="p-baseDozen">Base dozen</label>
              <div class="money-input"><span class="money-input__sym">$</span>
                <input class="input input--num" id="p-baseDozen" type="number" min="0" step="0.25" value="${d.baseDozen}" data-price-key="baseDozen" /></div>
              ${d.baseDozen !== base.baseDozen ? `<button class="link-btn price-row__reset" type="button" data-price-reset="baseDozen">reset to ${money(base.baseDozen)}</button>` : `<span class="price-row__def dim">default</span>`}
            </div>
            <div class="price-row">
              <label class="price-row__label" for="p-additionalSprinkleColor">Each extra sprinkle color <span class="dim">(first is free)</span></label>
              <div class="money-input"><span class="money-input__sym">$</span>
                <input class="input input--num" id="p-additionalSprinkleColor" type="number" min="0" step="0.25" value="${d.additionalSprinkleColor}" data-price-key="additionalSprinkleColor" /></div>
              ${d.additionalSprinkleColor !== base.additionalSprinkleColor ? `<button class="link-btn price-row__reset" type="button" data-price-reset="additionalSprinkleColor">reset to ${money(base.additionalSprinkleColor)}</button>` : `<span class="price-row__def dim">default</span>`}
            </div>
            <div class="price-row">
              <label class="price-row__label" for="p-drizzleCost">Drizzle <span class="dim">(0 = free)</span></label>
              <div class="money-input"><span class="money-input__sym">$</span>
                <input class="input input--num" id="p-drizzleCost" type="number" min="0" step="0.25" value="${d.drizzleCost}" data-price-key="drizzleCost" /></div>
              ${d.drizzleCost !== base.drizzleCost ? `<button class="link-btn price-row__reset" type="button" data-price-reset="drizzleCost">reset to ${money(base.drizzleCost)}</button>` : `<span class="price-row__def dim">default</span>`}
            </div>
            <div class="price-row">
              <label class="price-row__label" for="p-taxRate">Sales tax</label>
              <div class="money-input">
                <input class="input input--num" id="p-taxRate" type="number" min="0" max="25" step="0.01" value="${round2(d.taxRate * 100)}" data-price-pct="taxRate" />
                <span class="money-input__sym">%</span>
              </div>
              ${d.taxRate !== base.taxRate ? `<button class="link-btn price-row__reset" type="button" data-price-reset="taxRate">reset to ${round2(base.taxRate * 100)}%</button>` : `<span class="price-row__def dim">default</span>`}
            </div>
          </div>
          <p class="field-note">Tax is a single flat rate here. Real jurisdiction-aware tax comes with the payments backend — see PROJECT_STATUS.md § 2.</p>
        </section>

        <section class="card">
          <h3 class="card__title">Donut type surcharges</h3>
          <div class="price-grid">${modRows("typeModifier", DB.DONUT_TYPES, "name")}</div>
        </section>

        <section class="card">
          <h3 class="card__title">Filling surcharges <span class="dim">(Classic Shell only)</span></h3>
          <div class="price-grid">${modRows("fillingModifier", DB.FILLINGS.filter((f) => f.id !== "none"), "name")}</div>
        </section>

        <section class="card">
          <h3 class="card__title">Icing surcharges</h3>
          <div class="price-grid">${modRows("icingModifier", DB.ICINGS, "name")}</div>
        </section>

        <section class="card card--quiet">
          <h3 class="card__title">Example dozen</h3>
          <p class="card__sub">Classic Shell · jelly filling · chocolate icing · 3 sprinkle colors.</p>
          <div class="breakdown breakdown--dash">
            ${exLines.lines.map((l) => `<div class="breakdown__row"><span>${escapeHtml(l.label)}</span><span>${money(l.amount)}</span></div>`).join("")}
            <div class="breakdown__row breakdown__row--total"><span>Box subtotal (12)</span><span>${money(exLines.subtotal)}</span></div>
            <div class="breakdown__row"><span>Tax (${round2(d.taxRate * 100)}%)</span><span>${money(exLines.subtotal * d.taxRate)}</span></div>
            <div class="breakdown__row breakdown__row--total"><span>Customer pays</span><span>${money(exLines.subtotal * (1 + d.taxRate))}</span></div>
          </div>
        </section>`;
    },

    on: {
      input(e) {
        const d = state.draft;
        if (e.target.value === "") return; // mid-edit empty field; wait for a value
        const key = e.target.dataset.priceKey;
        if (key) { d[key] = Math.max(0, Number(e.target.value) || 0); rerenderSection({ keepFocus: e.target.id }); markDirty(); return; }
        const pct = e.target.dataset.pricePct;
        if (pct) { d[pct] = Math.max(0, (Number(e.target.value) || 0) / 100); rerenderSection({ keepFocus: e.target.id }); markDirty(); return; }
        const table = e.target.dataset.priceTable;
        if (table) {
          d[table][e.target.dataset.priceId] = Math.max(0, Number(e.target.value) || 0);
          rerenderSection({ keepFocus: e.target.id });
          markDirty();
        }
      },
      click(e) {
        const btn = e.target.closest("[data-price-reset]");
        if (!btn) return;
        const base = Settings.defaults().pricing;
        const target = btn.dataset.priceReset;
        if (target.indexOf(":") !== -1) {
          const [table, id] = target.split(":");
          state.draft[table][id] = (base[table] || {})[id] || 0;
        } else {
          state.draft[target] = base[target];
        }
        rerenderSection();
        markDirty();
      },
    },

    save(store) {
      Settings.setPricing(store.id, state.draft);
      return { ok: true, message: "Pricing saved for this store." };
    },
  };

  function round2(n) { return Math.round(n * 100) / 100; }

  /* Price one design against a draft price table (not yet saved anywhere). */
  function examplePrice(design, P) {
    const type = DB.DONUT_TYPES.find((t) => t.id === design.typeId);
    const icing = DB.ICINGS.find((i) => i.id === design.icingId);
    const lines = [{ label: "Base dozen", amount: P.baseDozen }];
    if (P.typeModifier[design.typeId]) lines.push({ label: type.name, amount: P.typeModifier[design.typeId] });
    if (type.fillable && design.fillingId !== "none" && P.fillingModifier[design.fillingId]) {
      const f = DB.FILLINGS.find((x) => x.id === design.fillingId);
      lines.push({ label: `${f.name} filling`, amount: P.fillingModifier[design.fillingId] });
    }
    if (icing && P.icingModifier[design.icingId]) lines.push({ label: `${icing.name} icing`, amount: P.icingModifier[design.icingId] });
    const extra = Math.max(0, design.sprinkleColorIds.length - 1);
    if (extra > 0) lines.push({ label: `+${extra} sprinkle colors`, amount: extra * P.additionalSprinkleColor });
    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    return { lines, subtotal };
  }

  /* =========================================================================
     SECTION 5 — READY-MADE BOXES (pre-designed donuts)
     ========================================================================= */
  const boxesSection = {
    id: "boxes",
    label: "Ready-made boxes",
    cap: "boxes",
    hint: "Pre-designed dozens",

    init(store) {
      const raw = Settings.defaults();
      const offered = Settings.premadesFor(store.id).map((p) => p.id);
      return {
        catalog: raw.premades,
        disabledIds: raw.premades.filter((p) => offered.indexOf(p.id) === -1).map((p) => p.id),
        customPremades: Settings.premadesFor(store.id).filter((p) => !raw.premades.some((c) => c.id === p.id)),
        editing: null, // a custom box being added/edited
      };
    },

    render(store) {
      const d = state.draft;
      if (d.editing) return renderBoxEditor(store, d.editing);

      const card = (p, isCustom) => {
        const design = fullDesign(p.design);
        const svg = DonutSVG.render(resolveDesign(design), { size: 108, decorative: true });
        const check = Menu.checkDesign(design, store);
        const off = d.disabledIds.indexOf(p.id) !== -1;
        const price = money(Pricing.priceBox(design, store.id).subtotal);
        return `
          <article class="box-card${off ? " is-off" : ""}${check.ok ? "" : " is-broken"}">
            <div class="box-card__art">${svg}</div>
            <div class="box-card__body">
              <p class="box-card__occasion">${escapeHtml(p.occasion || "Ready-made")}</p>
              <h4 class="box-card__name">${escapeHtml(p.name)}</h4>
              <p class="box-card__blurb">${escapeHtml(p.blurb || "")}</p>
              ${check.ok ? "" : `<p class="box-card__warn">Can't be made here — your menu is missing ${escapeHtml(check.problems.join(", "))}.</p>`}
              <div class="box-card__foot">
                <span class="box-card__price">${price} <span class="dim">/ dozen</span></span>
                ${isCustom ? `
                  <span class="box-card__actions">
                    <button class="link-btn" type="button" data-edit-box="${escapeHtml(p.id)}">Edit</button>
                    <button class="link-btn link-btn--danger" type="button" data-delete-box="${escapeHtml(p.id)}">Delete</button>
                  </span>`
                : `
                  <label class="switch switch--sm">
                    <input type="checkbox" data-box-toggle="${escapeHtml(p.id)}" ${off ? "" : "checked"} ${check.ok ? "" : "disabled"} />
                    <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
                    <span class="switch__text">${off ? "Hidden" : "Offered"}</span>
                  </label>`}
              </div>
            </div>
          </article>`;
      };

      return `
        ${sectionHead("Ready-made boxes", "One-tap dozens customers can order as-is or open in the builder. Switch off any this store doesn't want to run, and add designs of your own.")}

        <section class="card">
          <h3 class="card__title">Chain designs <span class="card__count">${d.catalog.length - d.disabledIds.length} of ${d.catalog.length} offered</span></h3>
          <p class="card__sub">These ship with the site. Switching one off hides it from this store only.</p>
          <div class="box-grid">${d.catalog.map((p) => card(p, false)).join("")}</div>
        </section>

        <section class="card">
          <div class="card__head">
            <h3 class="card__title">This store's own designs <span class="card__count">${d.customPremades.length}</span></h3>
            <button class="btn btn--primary btn--sm" type="button" data-new-box>+ New design</button>
          </div>
          ${d.customPremades.length
            ? `<div class="box-grid">${d.customPremades.map((p) => card(p, true)).join("")}</div>`
            : `<p class="empty">No store designs yet. Build a seasonal or local favorite and it appears on the Boxes page for this store.</p>`}
        </section>`;
    },

    on: {
      change(e) {
        const d = state.draft;

        const toggle = e.target.closest("[data-box-toggle]");
        if (toggle) {
          toggleId(d.disabledIds, toggle.dataset.boxToggle, !toggle.checked);
          rerenderSection();
          markDirty();
          return;
        }
        if (d.editing) { editorChange(e, d.editing); }
      },

      click(e) {
        const d = state.draft;

        if (e.target.closest("[data-new-box]")) {
          d.editing = {
            isNew: true,
            id: "store-" + Math.random().toString(36).slice(2, 8),
            name: "", occasion: "", blurb: "",
            design: fullDesign({ icingId: firstIcingId(currentStore()) }),
          };
          rerenderSection();
          return;
        }

        const edit = e.target.closest("[data-edit-box]");
        if (edit) {
          const p = d.customPremades.find((x) => x.id === edit.dataset.editBox);
          if (p) { d.editing = Object.assign({ isNew: false }, clone(p), { design: fullDesign(p.design) }); rerenderSection(); }
          return;
        }

        const del = e.target.closest("[data-delete-box]");
        if (del) {
          const p = d.customPremades.find((x) => x.id === del.dataset.deleteBox);
          if (p && window.confirm(`Delete "${p.name}"? Customers will no longer see it.`)) {
            d.customPremades = d.customPremades.filter((x) => x.id !== p.id);
            rerenderSection();
            markDirty();
          }
          return;
        }

        if (d.editing) editorClick(e, d.editing);
      },

      input(e) {
        if (state.draft.editing) editorInput(e, state.draft.editing);
      },
    },

    save(store) {
      const d = state.draft;
      if (d.editing) return { ok: false, error: "Finish or cancel the design you're editing first." };
      Settings.setPremades(store.id, d.disabledIds, d.customPremades.map((p) => ({
        id: p.id, name: p.name, occasion: p.occasion, blurb: p.blurb, design: p.design,
      })));
      return { ok: true, message: "Ready-made boxes saved." };
    },
  };

  function firstIcingId(store) {
    const m = Menu.forStore(store);
    const plain = m.icings.find((i) => !i.custom) || m.icings[0];
    return plain ? plain.id : "vanilla";
  }

  /* ---- the mini design editor for a store's own ready-made box ------------ */
  function renderBoxEditor(store, ed) {
    const menu = Menu.forStore(store);
    const design = ed.design;
    const svg = DonutSVG.render(resolveDesign(design), { size: 190, decorative: true });
    const check = Menu.checkDesign(design, store);
    const chosenIcing = DB.ICINGS.find((i) => i.id === design.icingId);
    // Vanilla unlocks a bonus color slot, same as it does in the builder.
    const max = DB.MAX_SPRINKLE_COLORS + (chosenIcing && chosenIcing.bonusSprinkle ? 1 : 0);

    const drizzleOptions = [{ id: "", name: "None" }]
      .concat(menu.icings.filter((i) => !i.custom).map((i) => ({ id: i.id, name: i.name })))
      .concat(menu.hasCustomIcing ? [{ id: "custom", name: "Custom color" }] : []);

    return `
      ${sectionHead(ed.isNew ? "New store design" : "Edit design", "Built from what this store stocks — the color choices below are exactly what its customers see.")}

      <div class="editor">
        <section class="card editor__form">
          <div class="field">
            <label class="field-label" for="boxName">Name</label>
            <input class="input input--full" id="boxName" type="text" maxlength="48" value="${escapeHtml(ed.name)}" placeholder="Homecoming Weekend" />
          </div>
          <div class="field">
            <label class="field-label" for="boxOccasion">Occasion badge</label>
            <input class="input input--full" id="boxOccasion" type="text" maxlength="28" value="${escapeHtml(ed.occasion)}" placeholder="Local · Game day" />
          </div>
          <div class="field">
            <label class="field-label" for="boxBlurb">Short description</label>
            <textarea class="input input--full" id="boxBlurb" rows="2" maxlength="160" placeholder="Blue and gold sprinkles over vanilla — go team.">${escapeHtml(ed.blurb)}</textarea>
          </div>

          <div class="field">
            <label class="field-label" for="boxType">Donut type</label>
            <select class="input input--full select" id="boxType">
              ${DB.DONUT_TYPES.map((t) => `<option value="${t.id}"${t.id === design.typeId ? " selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
            </select>
          </div>

          ${(DB.DONUT_TYPES.find((t) => t.id === design.typeId) || {}).fillable ? `
          <div class="field">
            <label class="field-label" for="boxFilling">Filling</label>
            <select class="input input--full select" id="boxFilling">
              ${DB.FILLINGS.map((f) => `<option value="${f.id}"${f.id === design.fillingId ? " selected" : ""}>${escapeHtml(f.name)}</option>`).join("")}
            </select>
          </div>` : ""}

          <div class="field">
            <label class="field-label" for="boxIcing">Icing</label>
            <select class="input input--full select" id="boxIcing">
              ${menu.icings.map((i) => `<option value="${i.id}"${i.id === design.icingId ? " selected" : ""}>${escapeHtml(i.name)}</option>`).join("")}
            </select>
          </div>

          ${(DB.ICINGS.find((i) => i.id === design.icingId) || {}).custom ? `
          <div class="field">
            <span class="field-label">Custom icing</span>
            <label class="switch switch--sm" style="margin-bottom:.5rem">
              <input type="checkbox" id="boxTieDye" ${design.tieDyeIcing ? "checked" : ""} />
              <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
              <span class="switch__text">Tie-dye swirl</span>
            </label>
            ${design.tieDyeIcing ? "" : `
            <select class="input input--full select" id="boxTint">
              <option value="">Pick a tint color…</option>
              ${menu.sprinkles.map((c) => `<option value="${c.id}"${c.id === design.icingTintId ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
            </select>`}
          </div>` : ""}

          <div class="field">
            <label class="field-label" for="boxDrizzle">Drizzle</label>
            <select class="input input--full select" id="boxDrizzle">
              ${drizzleOptions.map((o) => `<option value="${o.id}"${o.id === (design.drizzleId || "") ? " selected" : ""}>${escapeHtml(o.name)}</option>`).join("")}
            </select>
            ${design.drizzleId === "custom" ? `
            <select class="input input--full select" id="boxDrizzleColor" style="margin-top:.5rem">
              <option value="">Pick a drizzle color…</option>
              ${menu.sprinkles.map((c) => `<option value="${c.id}"${c.id === design.drizzleCustomId ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
            </select>` : ""}
          </div>

          <div class="field">
            <span class="field-label">Sprinkles <span class="dim">(up to ${max})</span></span>
            <div class="seg seg--wrap" role="group" aria-label="Sprinkle mode">
              <button class="seg__btn" type="button" data-spr-mode="none" aria-pressed="${design.noSprinkles}">None</button>
              ${menu.rainbowAvailable ? `<button class="seg__btn" type="button" data-spr-mode="rainbow" aria-pressed="${!!design.rainbowSprinkles}">Rainbow</button>` : ""}
              <button class="seg__btn" type="button" data-spr-mode="chocolate" aria-pressed="${!!design.chocolateSprinkles}">Chocolate</button>
              <button class="seg__btn" type="button" data-spr-mode="custom" aria-pressed="${!design.noSprinkles && !design.rainbowSprinkles && !design.chocolateSprinkles}">Pick colors</button>
            </div>
            ${!design.noSprinkles && !design.rainbowSprinkles && !design.chocolateSprinkles ? `
            <div class="opt-grid opt-grid--colors" style="margin-top:.7rem">
              ${menu.sprinkles.map((c) => {
                const on = design.sprinkleColorIds.indexOf(c.id) !== -1;
                return `
                  <label class="opt-tile">
                    <input type="checkbox" data-spr-color="${c.id}" ${on ? "checked" : ""} ${!on && design.sprinkleColorIds.length >= max ? "disabled" : ""} />
                    <span class="opt-tile__swatch" style="background:${c.hex}"></span>
                    <span class="opt-tile__name">${escapeHtml(c.name)}</span>
                  </label>`;
              }).join("")}
            </div>` : ""}
          </div>

          <div class="field">
            <span class="field-label">Finish</span>
            <div class="seg seg--wrap" role="group" aria-label="Sprinkle finish">
              <button class="seg__btn" type="button" data-spr-finish="heavy" aria-pressed="${!!design.heavySprinkles}">Extra heavy</button>
              <button class="seg__btn" type="button" data-spr-finish="half" aria-pressed="${!!design.halfSprinkles}">Half top</button>
            </div>
          </div>

          <p class="field-error" id="boxEditorError" hidden></p>
          <div class="editor__actions">
            <button class="btn btn--ghost" type="button" data-box-cancel>Cancel</button>
            <button class="btn btn--primary" type="button" data-box-done>${ed.isNew ? "Add design" : "Update design"}</button>
          </div>
        </section>

        <aside class="card card--quiet editor__preview">
          <h3 class="card__title">Preview</h3>
          <div class="editor__donut">${svg}</div>
          <p class="editor__label">${escapeHtml(DonutSVG.label(resolveDesign(design)))}</p>
          <p class="editor__price">${money(Pricing.priceBox(design, store.id).subtotal)} <span class="dim">/ dozen at this store</span></p>
          ${check.ok
            ? `<p class="fx fx--on">This store can make it.</p>`
            : `<p class="fx fx--warn">Needs ${escapeHtml(check.problems.join(", "))} — add those to the menu first.</p>`}
        </aside>
      </div>`;
  }

  function editorInput(e, ed) {
    if (e.target.id === "boxName") { ed.name = e.target.value; return; }
    if (e.target.id === "boxOccasion") { ed.occasion = e.target.value; return; }
    if (e.target.id === "boxBlurb") { ed.blurb = e.target.value; }
  }

  function editorChange(e, ed) {
    const d = ed.design;
    const id = e.target.id;
    if (id === "boxType") { d.typeId = e.target.value; rerenderSection(); return; }
    if (id === "boxFilling") { d.fillingId = e.target.value; rerenderSection(); return; }
    if (id === "boxIcing") {
      d.icingId = e.target.value;
      const icing = DB.ICINGS.find((i) => i.id === d.icingId);
      if (!icing || !icing.custom) { d.tieDyeIcing = false; d.icingTintId = null; }
      rerenderSection();
      return;
    }
    if (id === "boxTieDye") { d.tieDyeIcing = e.target.checked; if (d.tieDyeIcing) d.icingTintId = null; rerenderSection(); return; }
    if (id === "boxTint") { d.icingTintId = e.target.value || null; rerenderSection(); return; }
    if (id === "boxDrizzle") {
      d.drizzleId = e.target.value || null;
      if (d.drizzleId !== "custom") d.drizzleCustomId = null;
      rerenderSection();
      return;
    }
    if (id === "boxDrizzleColor") { d.drizzleCustomId = e.target.value || null; rerenderSection(); return; }

    const color = e.target.closest("[data-spr-color]");
    if (color) { toggleId(d.sprinkleColorIds, color.dataset.sprColor, color.checked); rerenderSection(); }
  }

  function editorClick(e, ed) {
    const d = ed.design;

    const mode = e.target.closest("[data-spr-mode]");
    if (mode) {
      const m = mode.dataset.sprMode;
      d.noSprinkles = m === "none";
      d.rainbowSprinkles = m === "rainbow";
      d.chocolateSprinkles = m === "chocolate";
      rerenderSection();
      return;
    }

    const finish = e.target.closest("[data-spr-finish]");
    if (finish) {
      const key = finish.dataset.sprFinish === "heavy" ? "heavySprinkles" : "halfSprinkles";
      d[key] = !d[key];
      rerenderSection();
      return;
    }

    if (e.target.closest("[data-box-cancel]")) {
      state.draft.editing = null;
      rerenderSection();
      return;
    }

    if (e.target.closest("[data-box-done]")) {
      const err = $("#boxEditorError");
      if (!ed.name.trim()) { err.hidden = false; err.textContent = "Give the design a name."; return; }
      const check = Menu.checkDesign(d, currentStore());
      if (!check.ok) { err.hidden = false; err.textContent = "This store can't make that design yet — it needs " + check.problems.join(", ") + "."; return; }
      const record = { id: ed.id, name: ed.name.trim(), occasion: ed.occasion.trim() || "Store special", blurb: ed.blurb.trim(), design: clone(d) };
      const list = state.draft.customPremades;
      const at = list.findIndex((x) => x.id === ed.id);
      if (at === -1) list.push(record); else list[at] = record;
      state.draft.editing = null;
      rerenderSection();
      markDirty();
    }
  }

  /* =========================================================================
     SECTION 6 — USERS (admin only)
     ========================================================================= */
  const usersSection = {
    id: "users",
    label: "Users & roles",
    cap: "users",
    hint: "Who can manage what",

    init() { return { editing: null, error: "" }; },

    render() {
      const d = state.draft;
      const users = Auth.listUsers();

      if (d.editing) return renderUserEditor(d.editing, d.error);

      const rows = users.map((u) => {
        const role = Auth.ROLES[u.role];
        const scope = role.scope === "all"
          ? `<span class="pill pill--all">Every store</span>`
          : u.storeIds.map((id) => {
              const s = DB.STORES.find((x) => x.id === id);
              return `<span class="pill">${escapeHtml(s ? s.name : id)}</span>`;
            }).join(" ") || `<span class="pill pill--warn">No store assigned</span>`;
        const isMe = state.user.id === u.id;
        return `
          <tr>
            <td>
              <span class="user-name">${escapeHtml(u.name)}${isMe ? ` <span class="dim">(you)</span>` : ""}</span>
              <span class="user-email">${escapeHtml(u.email)}</span>
            </td>
            <td><span class="role-badge role-badge--${u.role}">${escapeHtml(role.label)}</span></td>
            <td class="user-scope">${scope}</td>
            <td class="user-actions">
              <button class="link-btn" type="button" data-edit-user="${u.id}">Edit</button>
              ${isMe ? "" : `<button class="link-btn link-btn--danger" type="button" data-delete-user="${u.id}">Delete</button>`}
            </td>
          </tr>`;
      }).join("");

      return `
        ${sectionHead("Users & roles", "Who can sign in, and which stores they control.")}

        <section class="card">
          <div class="card__head">
            <h3 class="card__title">Accounts <span class="card__count">${users.length}</span></h3>
            <button class="btn btn--primary btn--sm" type="button" data-new-user>+ Add user</button>
          </div>
          <div class="table-scroll">
            <table class="user-table">
              <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Stores</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>

        <section class="card card--quiet">
          <h3 class="card__title">What each role can do</h3>
          <ul class="role-list">
            ${Object.keys(Auth.ROLES).map((k) => {
              const r = Auth.ROLES[k];
              const can = Object.keys(r.can).filter((c) => r.can[c]);
              return `
                <li class="role-list__item">
                  <span class="role-badge role-badge--${k}">${escapeHtml(r.label)}</span>
                  <div>
                    <p class="role-list__blurb">${escapeHtml(r.blurb)}</p>
                    <p class="role-list__caps dim">Can edit: ${can.map((c) => escapeHtml(capLabel(c))).join(" · ")}</p>
                  </div>
                </li>`;
            }).join("")}
          </ul>
          <p class="field-note">Change the capability table in <code>js/auth.js</code> to adjust what a role reaches. Roles become server-enforced when Supabase row-level security lands.</p>
        </section>`;
    },

    on: {
      click(e) {
        const d = state.draft;

        if (e.target.closest("[data-new-user]")) {
          d.editing = { isNew: true, id: null, name: "", email: "", role: "manager", storeIds: [], password: "" };
          d.error = "";
          rerenderSection();
          return;
        }

        const edit = e.target.closest("[data-edit-user]");
        if (edit) {
          const u = Auth.listUsers().find((x) => x.id === edit.dataset.editUser);
          if (u) { d.editing = Object.assign({ isNew: false, password: "" }, clone(u)); d.error = ""; rerenderSection(); }
          return;
        }

        const del = e.target.closest("[data-delete-user]");
        if (del) {
          const u = Auth.listUsers().find((x) => x.id === del.dataset.deleteUser);
          if (u && window.confirm(`Delete ${u.name}'s account? They'll lose dashboard access immediately.`)) {
            const res = Auth.deleteUser(u.id);
            toast(res.ok ? `${u.name}'s account deleted.` : res.error, !res.ok);
            rerenderSection();
          }
          return;
        }

        if (e.target.closest("[data-user-cancel]")) { d.editing = null; d.error = ""; rerenderSection(); return; }

        if (e.target.closest("[data-user-save]")) {
          const res = Auth.saveUser(d.editing);
          if (!res.ok) { d.error = res.error; rerenderSection(); return; }
          toast(d.editing.isNew ? "Account created." : "Account updated.");
          d.editing = null;
          d.error = "";
          rerenderSection();
        }
      },

      input(e) {
        const ed = state.draft.editing;
        if (!ed) return;
        if (e.target.id === "uName") ed.name = e.target.value;
        else if (e.target.id === "uEmail") ed.email = e.target.value;
        else if (e.target.id === "uPass") ed.password = e.target.value;
      },

      change(e) {
        const ed = state.draft.editing;
        if (!ed) return;
        if (e.target.id === "uRole") {
          ed.role = e.target.value;
          if (Auth.ROLES[ed.role].scope === "one") ed.storeIds = ed.storeIds.slice(0, 1);
          if (Auth.ROLES[ed.role].scope === "all") ed.storeIds = [];
          rerenderSection();
          return;
        }
        const store = e.target.closest("[data-user-store]");
        if (store) {
          const id = store.dataset.userStore;
          if (Auth.ROLES[ed.role].scope === "one") ed.storeIds = store.checked ? [id] : [];
          else toggleId(ed.storeIds, id, store.checked);
          rerenderSection();
        }
      },
    },

    // Users save immediately (each action is atomic), so there's nothing pending.
    save() { return { ok: true, message: "", silent: true }; },
  };

  function capLabel(c) {
    return { menu: "menu & colors", hours: "hours & closures", windows: "pickup windows", pricing: "pricing", boxes: "ready-made boxes", users: "users", tools: "data tools" }[c] || c;
  }

  function renderUserEditor(ed, error) {
    const role = Auth.ROLES[ed.role];
    const single = role.scope === "one";
    const storesHtml = role.scope === "all"
      ? `<p class="notice">Admins reach every store automatically — no assignment needed.</p>`
      : `<div class="opt-grid opt-grid--stores">
          ${DB.STORES.map((s) => {
            const on = ed.storeIds.indexOf(s.id) !== -1;
            return `
              <label class="opt-tile${on ? " is-on" : ""}">
                <input type="${single ? "radio" : "checkbox"}" name="userStore" data-user-store="${s.id}" ${on ? "checked" : ""} />
                <span class="opt-tile__name">${escapeHtml(s.name)}</span>
                <span class="opt-tile__tag">${escapeHtml(s.address)}</span>
              </label>`;
          }).join("")}
        </div>`;

    return `
      ${sectionHead(ed.isNew ? "Add user" : "Edit user", "Role decides what they can change; the stores below decide where.")}
      <section class="card" style="max-width:640px">
        <div class="field">
          <label class="field-label" for="uName">Name</label>
          <input class="input input--full" id="uName" type="text" value="${escapeHtml(ed.name)}" placeholder="Robin Ortiz" />
        </div>
        <div class="field">
          <label class="field-label" for="uEmail">Email</label>
          <input class="input input--full" id="uEmail" type="email" value="${escapeHtml(ed.email)}" placeholder="robin@glaze.co" />
        </div>
        <div class="field">
          <label class="field-label" for="uRole">Role</label>
          <select class="input input--full select" id="uRole">
            ${Object.keys(Auth.ROLES).map((k) => `<option value="${k}"${k === ed.role ? " selected" : ""}>${escapeHtml(Auth.ROLES[k].label)} — ${escapeHtml(Auth.ROLES[k].blurb)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <span class="field-label">${single ? "Store" : "Stores"}</span>
          ${storesHtml}
        </div>
        <div class="field">
          <label class="field-label" for="uPass">${ed.isNew ? "Password" : "New password"}</label>
          <input class="input input--full" id="uPass" type="password" autocomplete="new-password" value="${escapeHtml(ed.password)}" placeholder="${ed.isNew ? "At least 6 characters" : "Leave blank to keep the current one"}" />
        </div>
        ${error ? `<p class="field-error">${escapeHtml(error)}</p>` : ""}
        <div class="editor__actions">
          <button class="btn btn--ghost" type="button" data-user-cancel>Cancel</button>
          <button class="btn btn--primary" type="button" data-user-save>${ed.isNew ? "Create account" : "Save changes"}</button>
        </div>
      </section>`;
  }

  /* =========================================================================
     SECTION 7 — DATA TOOLS (admin only)
     ========================================================================= */
  const toolsSection = {
    id: "tools",
    label: "Data & reset",
    cap: "tools",
    hint: "Export, import, reset",

    init() { return {}; },

    render() {
      const customized = DB.STORES.filter((s) => Settings.isCustomized(s.id));
      return `
        ${sectionHead("Data & reset", "Settings live in this browser's localStorage. Export to move them to another machine, or reset to go back to what config.js ships.")}

        <section class="card">
          <h3 class="card__title">Stores with saved changes <span class="card__count">${customized.length} of ${DB.STORES.length}</span></h3>
          ${customized.length
            ? `<ul class="chip-tags">${customized.map((s) => `
                <li class="chip-tag">
                  <span>${escapeHtml(s.name)}</span>
                  <button class="chip-tag__x" type="button" data-reset-store="${s.id}" aria-label="Reset ${escapeHtml(s.name)} to defaults">
                    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
                  </button>
                </li>`).join("")}</ul>
               <p class="field-note">Removing a store here reverts it to the values in <code>js/config.js</code>.</p>`
            : `<p class="empty">Every store is still on its shipped defaults.</p>`}
        </section>

        <section class="card">
          <h3 class="card__title">Export &amp; import</h3>
          <p class="card__sub">A JSON file holding only what's been changed from the defaults.</p>
          <div class="tool-row">
            <button class="btn btn--ghost" type="button" data-export>Download settings JSON</button>
            <label class="btn btn--ghost" for="importFile">Import settings JSON</label>
            <input type="file" id="importFile" accept="application/json,.json" class="sr-only" />
          </div>
        </section>

        <section class="card card--danger">
          <h3 class="card__title">Reset</h3>
          <p class="card__sub">Both actions are immediate and can't be undone.</p>
          <div class="tool-row">
            <button class="btn btn--ghost" type="button" data-reset-settings>Reset all store settings</button>
            <button class="btn btn--ghost" type="button" data-reset-users>Reset accounts to demo users</button>
          </div>
        </section>`;
    },

    on: {
      click(e) {
        const rs = e.target.closest("[data-reset-store]");
        if (rs) {
          const store = DB.STORES.find((s) => s.id === rs.dataset.resetStore);
          if (store && window.confirm(`Reset ${store.name} to the shipped defaults? Its saved menu, hours, windows, pricing and boxes are discarded.`)) {
            Settings.resetStore(store.id);
            toast(`${store.name} is back on the default settings.`);
            render();
          }
          return;
        }

        if (e.target.closest("[data-export]")) {
          const blob = new Blob([Settings.exportJson()], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "glaze-store-settings.json";
          // Safari ignores click() on a link that isn't in the document.
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          return;
        }

        if (e.target.closest("[data-reset-settings]")) {
          if (window.confirm("Reset EVERY store to the shipped defaults? All saved menus, hours, windows, pricing and store designs are discarded.")) {
            Settings.resetAll();
            toast("All store settings reset to defaults.");
            render();
          }
          return;
        }

        if (e.target.closest("[data-reset-users]")) {
          if (window.confirm("Reset all accounts back to the three demo users? You'll be signed out.")) {
            Auth.resetUsers();
            location.href = "login.html";
          }
        }
      },

      change(e) {
        if (e.target.id !== "importFile" || !e.target.files || !e.target.files[0]) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            Settings.importJson(String(reader.result));
            toast("Settings imported.");
            render();
          } catch (err) {
            toast("That file couldn't be read: " + err.message, true);
          }
        };
        reader.readAsText(e.target.files[0]);
      },
    },

    save() { return { ok: true, silent: true }; },
  };

  /* =========================================================================
     SHELL
     ========================================================================= */
  const SECTIONS = [menuSection, hoursSection, windowsSection, pricingSection, boxesSection, usersSection, toolsSection];

  function visibleSections() {
    return SECTIONS.filter((s) => Auth.can(state.user, s.cap));
  }

  // Sections keyed to a store vs. account-wide ones (users, tools).
  function isStoreSection(section) {
    return section.cap !== "users" && section.cap !== "tools";
  }

  function sectionHead(title, sub) {
    return `
      <div class="sec-head">
        <h2 class="sec-head__title">${escapeHtml(title)}</h2>
        <p class="sec-head__sub">${sub}</p>
      </div>`;
  }

  function activeSection() {
    const list = visibleSections();
    return list.find((s) => s.id === state.sectionId) || list[0];
  }

  function renderUserChip() {
    const u = state.user;
    const role = Auth.roleOf(u);
    $("#dashUser").innerHTML = `
      <div class="dash-user__who">
        <span class="dash-user__name">${escapeHtml(u.name)}</span>
        <span class="role-badge role-badge--${u.role}">${escapeHtml(role.label)}</span>
      </div>
      <button class="link-btn" type="button" id="signOut">Sign out</button>`;
    $("#signOut").addEventListener("click", () => {
      if (!confirmLeave()) return;
      Auth.logout();
      location.href = "login.html";
    });
  }

  function renderStorePicker() {
    const el = $("#storePicker");
    const stores = Auth.storesFor(state.user);
    const section = activeSection();

    if (!isStoreSection(section)) {
      el.innerHTML = `<p class="dash-side__note">This section applies to every store.</p>`;
      return;
    }
    if (stores.length === 1) {
      const s = stores[0];
      el.innerHTML = `
        <div class="store-badge">
          <span class="store-badge__name">${escapeHtml(s.name)}</span>
          <span class="store-badge__addr">${escapeHtml(s.address)}</span>
          ${s.active === false ? `<span class="store-badge__paused">Ordering paused</span>` : ""}
        </div>`;
      return;
    }
    el.innerHTML = `
      <select class="input input--full select" id="storeSelect" aria-labelledby="storePickerLabel">
        ${stores.map((s) => `<option value="${s.id}"${s.id === state.storeId ? " selected" : ""}>${escapeHtml(s.name)}${s.active === false ? " — paused" : ""}</option>`).join("")}
      </select>
      <p class="dash-side__note">${stores.length} stores in your group.</p>`;
    $("#storeSelect").addEventListener("change", (e) => {
      if (!confirmLeave()) { e.target.value = state.storeId; return; }
      state.storeId = e.target.value;
      render();
    });
  }

  // Paint only — the click handler is bound once in init(), because #dashNav
  // itself survives every render.
  function renderNav() {
    $("#dashNav").innerHTML = visibleSections().map((s) => `
      <button class="dash-nav__item" type="button" data-section="${s.id}" aria-current="${s.id === state.sectionId ? "page" : "false"}">
        <span class="dash-nav__label">${escapeHtml(s.label)}</span>
        <span class="dash-nav__hint">${escapeHtml(s.hint)}</span>
      </button>`).join("");
  }

  /* Full render: nav + store picker + section body, from scratch. */
  function render() {
    const section = activeSection();
    state.sectionId = section.id;
    state.dirty = false;
    syncSaveBar();

    renderStorePicker();
    renderNav();

    const store = currentStore();
    if (isStoreSection(section) && !store) {
      $("#dashContent").innerHTML = `<div class="card"><p class="empty">No store is assigned to your account. Ask an admin to assign one.</p></div>`;
      return;
    }

    state.draft = section.init(store);
    paintSection();
  }

  /* Input types whose selectionStart/setSelectionRange are usable. Reading
     .selectionStart on any OTHER type (number, date, email, …) throws
     InvalidStateError in real browsers — jsdom returns null instead, so this
     divergence has to be handled explicitly rather than discovered in a test. */
  const SELECTABLE = { text: 1, search: 1, url: 1, tel: 1, password: 1, textarea: 1 };

  function caretOf(el) {
    if (!el || !SELECTABLE[el.type]) return null;
    try {
      return typeof el.selectionStart === "number" ? el.selectionStart : null;
    } catch (e) {
      return null; // belt and braces — never let this kill the caller
    }
  }

  /* Re-render only the section body, keeping the draft as-is. */
  function rerenderSection(opts) {
    const active = document.activeElement;
    const focusId = (opts && opts.keepFocus) || (active && active.id) || null;
    const caret = caretOf(active);

    paintSection();

    if (focusId) {
      const next = document.getElementById(focusId);
      if (next && next.focus) {
        next.focus();
        // Text inputs lose the caret when innerHTML is replaced; put it back.
        if (caret != null && typeof next.setSelectionRange === "function" && SELECTABLE[next.type]) {
          try { next.setSelectionRange(caret, caret); } catch (e) {}
        }
      }
    }
  }

  function paintSection() {
    $("#dashContent").innerHTML = activeSection().render(currentStore());
  }

  /* One delegated listener per event type on the container, forwarding to
     whichever section is active. Sections therefore never attach (or need to
     detach) their own listeners, and re-rendering the body can't leak them. */
  function bindDelegation() {
    const root = $("#dashContent");
    ["click", "change", "input"].forEach((type) => {
      root.addEventListener(type, (e) => {
        const handlers = activeSection().on;
        if (handlers && handlers[type]) handlers[type](e);
      });
    });
  }

  function doSave() {
    const section = activeSection();
    const res = section.save(currentStore());
    if (!res.ok) { toast(res.error, true); return; }
    state.dirty = false;
    syncSaveBar();
    if (!res.silent) toast(res.message);
    // Re-init from the freshly merged data so the form reflects what was stored
    // (Settings normalizes some values on the way in).
    state.draft = section.init(currentStore());
    paintSection();
    renderStorePicker();
  }

  /* --------------------------------- INIT --------------------------------- */
  function init() {
    const user = Auth.requireUser("login.html");
    if (!user) return;
    state.user = user;

    const stores = Auth.storesFor(user);
    state.storeId = stores.length ? stores[0].id : null;

    const first = visibleSections()[0];
    state.sectionId = first ? first.id : "menu";

    renderUserChip();
    bindDelegation();
    render();

    $("#dashNav").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-section]");
      if (!btn || btn.dataset.section === state.sectionId) return;
      if (!confirmLeave()) return;
      state.sectionId = btn.dataset.section;
      render();
    });

    $("#saveBtn").addEventListener("click", doSave);
    $("#discardBtn").addEventListener("click", () => {
      state.dirty = false;
      syncSaveBar();
      render();
    });

    // Cmd/Ctrl+S saves, since this is a settings screen people will live in.
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (state.dirty) doSave();
      }
    });

    window.addEventListener("beforeunload", (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
