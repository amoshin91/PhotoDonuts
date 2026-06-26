/* =============================================================================
   pickup.js — Store finding + timezone-aware pickup scheduling.

   Rules enforced when generating time slots:
     • store operating hours (per weekday)
     • blackout days (store closed entirely)
     • per-day same-day cutoff (can't order for today after the cutoff clock time)
     • 30-minute minimum lead time (earliest pickup = now + 30 min)
     • 30-minute increments, no fixed slots
     • per-slot capacity cap (placeholder 20 dozen/slot)
     • correct store timezone (a SF user can schedule an NYC pickup correctly)

   No third-party date library: timezone math is done with Intl.DateTimeFormat.
   ============================================================================ */
(function () {
  "use strict";

  const D = window.DB;

  // ---- distance (Haversine, miles) -----------------------------------------
  function distanceMiles(a, b) {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 3958.8;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(h));
  }

  function sortStoresByDistance(loc) {
    return D.STORES.map((s) => ({
      ...s,
      distance: loc ? distanceMiles(loc, s) : null,
    })).sort((a, b) => {
      if (a.distance == null) return 0;
      return a.distance - b.distance;
    });
  }

  // ---- demo geocoder (swap for a real Geocoding API in production) ---------
  function resolveLocation(raw) {
    if (!raw) return null;
    const q = raw.trim().toLowerCase();
    // exact zip
    const zip = q.match(/\b(\d{5})\b/);
    if (zip && D.GEO_LOOKUP[zip[1]]) return D.GEO_LOOKUP[zip[1]];
    // city, state -> take the city token
    const city = q.split(",")[0].trim();
    if (D.GEO_LOOKUP[city]) return D.GEO_LOOKUP[city];
    // loose contains match
    for (const key in D.GEO_LOOKUP) {
      if (!/^\d+$/.test(key) && q.indexOf(key) !== -1) return D.GEO_LOOKUP[key];
    }
    return null;
  }

  // Build a short, friendly label from a Nominatim result.
  function shortLabel(r) {
    const a = r.address || {};
    const place = a.city || a.town || a.village || a.hamlet || a.suburb || a.county;
    const bits = [place, a.state].filter(Boolean);
    return bits.length ? bits.join(", ") : (r.display_name || "").split(",").slice(0, 2).join(", ").trim();
  }

  // Resolve ANY zip / city / address to coordinates. Tries the instant local
  // table first (offline-friendly), then OpenStreetMap Nominatim (free, no key).
  // Returns { lat, lng, label } or null. Async because it may hit the network.
  async function geocode(raw) {
    const q = (raw || "").trim();
    if (!q) return null;
    const local = resolveLocation(q);
    if (local) return local;
    try {
      const url =
        "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=us&q=" +
        encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.length) return null;
      const r = data[0];
      const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
      if (isNaN(lat) || isNaN(lng)) return null;
      return { lat, lng, label: shortLabel(r) };
    } catch (e) {
      return null;
    }
  }

  // ---- timezone helpers -----------------------------------------------------
  // Wall-clock parts for an instant in a given IANA tz.
  function partsInZone(tz, instant) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    const p = {};
    for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
    return {
      year: +p.year,
      month: +p.month,
      day: +p.day,
      hour: p.hour === "24" ? 0 : +p.hour,
      minute: +p.minute,
      second: +p.second,
      weekdayName: p.weekday,
    };
  }

  // tz offset (minutes) at a given UTC instant
  function tzOffsetMinutes(tz, instant) {
    const p = partsInZone(tz, instant);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return (asUTC - instant.getTime()) / 60000;
  }

  // Convert a wall-clock time IN a tz to an absolute instant (Date).
  function wallTimeToInstant(tz, y, m, d, h, min) {
    const guess = Date.UTC(y, m - 1, d, h, min);
    const offset = tzOffsetMinutes(tz, new Date(guess));
    return new Date(guess - offset * 60000);
  }

  function storeLocalToday(tz) {
    const p = partsInZone(tz, new Date());
    return { y: p.year, m: p.month, d: p.day, minutes: p.hour * 60 + p.minute };
  }

  function ymd(y, m, d) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function parseYmd(str) {
    const [y, m, d] = str.split("-").map(Number);
    return { y, m, d };
  }

  function hmToMinutes(hm) {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
  }

  function minutesToHm(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function formatClock(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  function weekdayOf(dateStr) {
    const { y, m, d } = parseYmd(dateStr);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  }

  // deterministic mock "already booked" count for a slot
  function bookedDozen(storeId, dateStr, hm, cap) {
    let h = 0;
    const s = storeId + dateStr + hm;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    h = h >>> 0;
    // produce 0..~cap*1.15 so a few slots read as full
    return Math.floor((h % 1000) / 1000 * (cap * 1.15));
  }

  /**
   * Generate pickup slots for one store on one date (store-local YYYY-MM-DD).
   * Returns { closed, reason, slots: [{ hm, label, instant, available, remaining }] }
   */
  function generateSlots(store, dateStr) {
    const sched = D.SCHEDULING_DEFAULTS;
    const weekday = weekdayOf(dateStr);
    const hours = store.hours[weekday];

    if ((store.blackoutDates || []).indexOf(dateStr) !== -1) {
      return { closed: true, reason: "Closed — holiday / blackout day", slots: [] };
    }
    if (!hours) {
      return { closed: true, reason: "Closed on this day", slots: [] };
    }

    const today = storeLocalToday(store.timezone);
    const isToday = ymd(today.y, today.m, today.d) === dateStr;

    // same-day cutoff
    if (isToday && hours.cutoff && today.minutes >= hmToMinutes(hours.cutoff)) {
      return {
        closed: true,
        reason: `Past today's ${formatClock(hmToMinutes(hours.cutoff))} cutoff — pick another day`,
        slots: [],
      };
    }

    const openMin = hmToMinutes(hours.open);
    const closeMin = hmToMinutes(hours.close);
    const { y, m, d } = parseYmd(dateStr);
    const earliestInstant = Date.now() + sched.leadTimeMinutes * 60000;

    const slots = [];
    for (let t = openMin; t < closeMin; t += sched.slotIncrementMinutes) {
      const instant = wallTimeToInstant(store.timezone, y, m, d, Math.floor(t / 60), t % 60);
      const passesLead = instant.getTime() >= earliestInstant;
      const booked = bookedDozen(store.id, dateStr, minutesToHm(t), sched.slotCapacityDozen);
      const remaining = Math.max(0, sched.slotCapacityDozen - booked);
      slots.push({
        hm: minutesToHm(t),
        label: formatClock(t),
        instant,
        passesLead,
        remaining,
        capacity: sched.slotCapacityDozen,
        available: passesLead && remaining > 0,
      });
    }

    const anyAvailable = slots.some((s) => s.available);
    return {
      closed: false,
      reason: anyAvailable ? null : "No remaining times for this day",
      isToday,
      slots,
    };
  }

  function formatPickupWhen(store, dateStr, hm) {
    const { y, m, d } = parseYmd(dateStr);
    const [hh, mm] = hm.split(":").map(Number);
    const instant = wallTimeToInstant(store.timezone, y, m, d, hh, mm);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: store.timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return fmt.format(instant);
  }

  // earliest store-local date a customer can select (today in store tz)
  function minSelectableDate(store) {
    const t = storeLocalToday(store.timezone);
    return ymd(t.y, t.m, t.d);
  }

  function addDays(dateStr, n) {
    const { y, m, d } = parseYmd(dateStr);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  window.Pickup = {
    distanceMiles,
    sortStoresByDistance,
    resolveLocation,
    geocode,
    generateSlots,
    formatPickupWhen,
    minSelectableDate,
    addDays,
    weekdayOf,
    formatClock,
    hmToMinutes,
  };
})();
