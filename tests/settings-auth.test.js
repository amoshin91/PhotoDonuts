/* =============================================================================
   settings-auth.test.js — the dashboard's data layer.

   Loads the real browser scripts into a stubbed window (localStorage + a vm
   context) and asserts that a dashboard edit actually changes what the
   storefront computes. No dependencies — plain node.

     node tests/settings-auth.test.js
   ============================================================================ */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "\n      " + extra : "")); }
}
function eq(name, a, b) { ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

function boot() {
  const localStorage = makeStore();
  const sandbox = { localStorage, console, Intl, Date, Math, JSON, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ["config.js", "settings.js", "auth.js", "menu.js", "pricing.js", "pickup.js"].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), sandbox, { filename: f });
  });
  return sandbox;
}

/* ------------------------------------------------------------------ */
console.log("\nSETTINGS — defaults are untouched before any edit");
{
  const w = boot();
  const flagship = w.DB.STORES.find((s) => s.id === "dunkin-342238");
  eq("flagship still carries the full catalog", flagship.menu, undefined);
  eq("active defaults to true", flagship.active, true);
  eq("scheduling falls back to config defaults", flagship.scheduling.slotCapacityDozen, 20);
  eq("lead time default", flagship.scheduling.leadTimeMinutes, 30);
  eq("pricing falls back to the global table", flagship.pricing.baseDozen, 18);
  eq("nothing is marked customized", w.Settings.isCustomized("dunkin-342238"), false);
  eq("restricted store keeps its config menu", w.DB.STORES.find((s) => s.id === "dunkin-345764").menu.icingIds.length, 2);
}

console.log("\nSETTINGS — a menu edit reaches the storefront's Menu module");
{
  const w = boot();
  const id = "dunkin-342238";
  w.Settings.setMenu(id, { icingIds: ["vanilla"], sprinkleColorIds: ["red", "blue"] });
  const store = w.DB.STORES.find((s) => s.id === id);
  eq("DB.STORES reflects the new menu", store.menu.icingIds.join(), "vanilla");
  const menu = w.Menu.forStore(store);
  eq("Menu.forStore offers only the saved icings", menu.icings.length, 1);
  eq("custom icing derived off", menu.hasCustomIcing, false);
  eq("rainbow derived off", menu.rainbowAvailable, false);
  const check = w.Menu.checkDesign({ icingId: "chocolate", sprinkleColorIds: ["green"], noSprinkles: false }, store);
  ok("a now-unmakeable design is rejected", !check.ok && check.problems.length === 2, JSON.stringify(check.problems));
  eq("store is flagged customized", w.Settings.isCustomized(id), true);
}

console.log("\nSETTINGS — a full selection collapses back to 'unrestricted'");
{
  const w = boot();
  const id = "dunkin-345764"; // ships restricted
  w.Settings.setMenu(id, {
    icingIds: w.DB.ICINGS.map((i) => i.id),
    sprinkleColorIds: w.DB.SPRINKLE_PALETTE.map((c) => c.id),
  });
  const store = w.DB.STORES.find((s) => s.id === id);
  eq("menu restriction removed entirely", store.menu, undefined);
  eq("store now offers every icing", w.Menu.forStore(store).icings.length, w.DB.ICINGS.length);
}

console.log("\nSETTINGS — per-store pricing flows into Pricing");
{
  const w = boot();
  const a = "dunkin-342238", b = "dunkin-346976";
  w.Settings.setPricing(a, { baseDozen: 24, additionalSprinkleColor: 3, drizzleCost: 0, taxRate: 0.1 });
  const design = { typeId: "classic-ring", fillingId: "none", icingId: "vanilla", noSprinkles: false, sprinkleColorIds: ["red", "blue", "green"] };
  const priceA = w.Pricing.priceBox(design, a).subtotal;
  const priceB = w.Pricing.priceBox(design, b).subtotal;
  eq("edited store uses its own base + sprinkle price", priceA, 24 + 2 * 3);
  eq("other store still on the shipped price", priceB, 18 + 2 * 1.5);
  eq("no storeId falls back to the global table", w.Pricing.priceBox(design).subtotal, 18 + 2 * 1.5);
  const cart = [{ design, qty: 1 }];
  eq("cart tax uses the store's rate", w.Pricing.priceCart(cart, a).taxRate, 0.1);
  eq("untouched modifiers survive a partial override", w.DB.STORES.find((s) => s.id === a).pricing.typeModifier["classic-shell"], 2);
}

console.log("\nSETTINGS — pricing reset drops back to config defaults");
{
  const w = boot();
  const id = "dunkin-342238";
  w.Settings.setPricing(id, { baseDozen: 30, additionalSprinkleColor: 1.5, drizzleCost: 0, taxRate: 0.0875 });
  eq("override applied", w.DB.STORES.find((s) => s.id === id).pricing.baseDozen, 30);
  w.Settings.setPricing(id, { baseDozen: 18, additionalSprinkleColor: 1.5, drizzleCost: 0, taxRate: 0.0875 });
  eq("matching the default stores no override", w.Settings.isCustomized(id), false);
}

console.log("\nSCHEDULING — lead time and capacity are honoured per store");
{
  const w = boot();
  const id = "dunkin-342238";
  w.Settings.setScheduling(id, { leadTimeMinutes: 48 * 60, slotIncrementMinutes: 60, slotCapacityDozen: 5 });
  const store = w.DB.STORES.find((s) => s.id === id);
  eq("scheduling merged onto the store", store.scheduling.slotCapacityDozen, 5);
  eq("Pickup.schedulingFor reads it", w.Pickup.schedulingFor(store).leadTimeMinutes, 2880);

  const today = w.Pickup.minSelectableDate(store);
  const todaySlots = w.Pickup.generateSlots(store, today);
  ok("48h lead time leaves nothing bookable today", !todaySlots.slots.some((s) => s.available));

  const day3 = w.Pickup.addDays(today, 3);
  const res = w.Pickup.generateSlots(store, day3);
  ok("a day past the lead time has slots", res.slots.length > 0, `${res.slots.length} slots`);
  const gap = w.Pickup.hmToMinutes(res.slots[1].hm) - w.Pickup.hmToMinutes(res.slots[0].hm);
  eq("60-minute windows", gap, 60);
  ok("capacity caps remaining at 5", res.slots.every((s) => s.remaining <= 5), JSON.stringify(res.slots.map((s) => s.remaining)));

  const other = w.DB.STORES.find((s) => s.id === "dunkin-346976");
  eq("an unedited store keeps the 30-min default", w.Pickup.schedulingFor(other).leadTimeMinutes, 30);
  eq("duration formatting", w.Pickup.formatDuration(150), "2 hr 30 min");
  eq("duration formatting, minutes only", w.Pickup.formatDuration(45), "45 min");
}

console.log("\nHOURS — edits and closures change slot generation");
{
  const w = boot();
  const id = "dunkin-342238";
  const hours = new Array(7).fill(null).map(() => ({ open: "09:00", close: "11:00", cutoff: "11:00" }));
  const store0 = w.DB.STORES.find((s) => s.id === id);
  const today = w.Pickup.minSelectableDate(store0);
  const soon = w.Pickup.addDays(today, 2);
  w.Settings.setHours(id, hours, [soon]);
  const store = w.DB.STORES.find((s) => s.id === id);
  eq("hours saved", store.hours[3].open, "09:00");
  const blackedOut = w.Pickup.generateSlots(store, soon);
  ok("blackout day is closed", blackedOut.closed, blackedOut.reason);
  const open = w.Pickup.generateSlots(store, w.Pickup.addDays(today, 3));
  eq("09:00–11:00 at 30 min = 4 windows", open.slots.length, 4);

  // a closed weekday
  const withClosed = hours.slice();
  withClosed[1] = null;
  w.Settings.setHours(id, withClosed, []);
  const store2 = w.DB.STORES.find((s) => s.id === id);
  let mondayFound = false;
  for (let i = 0; i < 8; i++) {
    const ds = w.Pickup.addDays(today, i);
    if (w.Pickup.weekdayOf(ds) === 1) {
      const r = w.Pickup.generateSlots(store2, ds);
      ok("Monday reads as closed", r.closed, r.reason);
      mondayFound = true;
      break;
    }
  }
  ok("found a Monday to test", mondayFound);
}

console.log("\nPAUSE — a paused store leaves the customer-facing lists");
{
  const w = boot();
  const id = "dunkin-342238";
  const before = w.Pickup.sortStoresByDistance(null).length;
  w.Settings.setActive(id, false);
  const store = w.DB.STORES.find((s) => s.id === id);
  eq("still present in DB for the dashboard", !!store, true);
  eq("marked inactive", store.active, false);
  eq("dropped from the customer store list", w.Pickup.sortStoresByDistance(null).length, before - 1);
  eq("orderableStores agrees", w.Settings.orderableStores().length, before - 1);
  const res = w.Pickup.generateSlots(store, w.Pickup.minSelectableDate(store));
  ok("no slots are generated while paused", res.closed && res.slots.length === 0, res.reason);
  w.Settings.setActive(id, true);
  eq("un-pausing restores it", w.Pickup.sortStoresByDistance(null).length, before);
  eq("un-pausing clears the override", w.Settings.isCustomized(id), false);
}

console.log("\nPREMADES — per-store ready-made boxes");
{
  const w = boot();
  const id = "dunkin-342238";
  const shipped = w.DB.PREMADE_BOXES.length;
  eq("all shipped boxes offered by default", w.Settings.premadesFor(id).length, shipped);
  w.Settings.setPremades(id, ["july-4th"], [
    { id: "store-abc", name: "Homecoming", occasion: "Local", blurb: "", design: { icingId: "vanilla" } },
  ]);
  const list = w.Settings.premadesFor(id);
  eq("one hidden, one added", list.length, shipped);
  ok("the disabled box is gone", !list.some((p) => p.id === "july-4th"));
  ok("the store's own design is present", list.some((p) => p.id === "store-abc"));
  eq("another store is unaffected", w.Settings.premadesFor("dunkin-346976").length, shipped);
}

console.log("\nSETTINGS — persistence, reset and export/import");
{
  const w = boot();
  w.Settings.setScheduling("dunkin-342238", { leadTimeMinutes: 120, slotIncrementMinutes: 30, slotCapacityDozen: 9 });
  const raw = w.localStorage.getItem("glaze_store_settings_v1");
  ok("written to localStorage", !!raw && raw.indexOf("120") !== -1);
  const exported = w.Settings.exportJson();

  // reload from the same storage — the edit must survive
  const w2 = boot();
  w2.localStorage.setItem("glaze_store_settings_v1", raw);
  w2.Settings.load();
  w2.Settings.apply();
  eq("survives a reload", w2.DB.STORES.find((s) => s.id === "dunkin-342238").scheduling.slotCapacityDozen, 9);

  w2.Settings.resetStore("dunkin-342238");
  eq("resetStore reverts to config", w2.DB.STORES.find((s) => s.id === "dunkin-342238").scheduling.slotCapacityDozen, 20);

  const w3 = boot();
  w3.Settings.importJson(exported);
  eq("import restores the edit", w3.DB.STORES.find((s) => s.id === "dunkin-342238").scheduling.slotCapacityDozen, 9);
  w3.Settings.resetAll();
  eq("resetAll clears everything", w3.Settings.isCustomized("dunkin-342238"), false);

  const w4 = boot();
  w4.localStorage.setItem("glaze_store_settings_v1", "{ not json");
  w4.Settings.load();
  ok("corrupt storage falls back to defaults instead of throwing", w4.DB.STORES.length === 4);
}

console.log("\nSETTINGS — applying twice cannot compound");
{
  const w = boot();
  w.Settings.setPricing("dunkin-342238", { baseDozen: 25, additionalSprinkleColor: 1.5, drizzleCost: 0, taxRate: 0.0875 });
  w.Settings.apply(); w.Settings.apply(); w.Settings.apply();
  eq("still 25 after repeated applies", w.DB.STORES.find((s) => s.id === "dunkin-342238").pricing.baseDozen, 25);
  eq("store count unchanged", w.DB.STORES.length, 4);
}

console.log("\nAUTH — roles, scope and capabilities");
{
  const w = boot();
  const bad = w.Auth.login("admin@glaze.co", "wrong");
  ok("wrong password rejected", !bad.ok);
  ok("no session after a failed login", w.Auth.currentUser() === null);

  const admin = w.Auth.login("admin@glaze.co", "donut123");
  ok("admin signs in", admin.ok);
  eq("session persists", w.Auth.currentUser().email, "admin@glaze.co");
  eq("admin reaches every store", w.Auth.storeIdsFor(admin.user).length, 4);
  eq("admin can manage users", w.Auth.can(admin.user, "users"), true);
  eq("admin can edit pricing", w.Auth.can(admin.user, "pricing"), true);

  const cmlUser = w.Auth.listUsers().find((u) => u.role === "cml");
  const cml = { id: cmlUser.id, role: "cml", storeIds: cmlUser.storeIds };
  eq("CML reaches its group", w.Auth.storeIdsFor(cml).length, 3);
  eq("CML can manage its own store", w.Auth.canManage(cml, "dunkin-342238"), true);
  eq("CML cannot manage a store outside the group", w.Auth.canManage(cml, "dunkin-345764"), false);
  eq("CML cannot manage users", w.Auth.can(cml, "users"), false);
  eq("CML can edit hours", w.Auth.can(cml, "hours"), true);

  const mgrUser = w.Auth.listUsers().find((u) => u.role === "manager");
  eq("manager is capped at one store", w.Auth.storeIdsFor(mgrUser).length, 1);
  eq("manager's store", w.Auth.storeIdsFor(mgrUser)[0], "dunkin-345764");
  eq("manager cannot manage users", w.Auth.can(mgrUser, "users"), false);
  eq("manager cannot reach data tools", w.Auth.can(mgrUser, "tools"), false);
  eq("manager can edit its own menu", w.Auth.can(mgrUser, "menu"), true);
  eq("unknown capability denied", w.Auth.can(mgrUser, "nonsense"), false);

  w.Auth.logout();
  ok("logout clears the session", w.Auth.currentUser() === null);
}

console.log("\nAUTH — user management guards");
{
  const w = boot();
  w.Auth.login("admin@glaze.co", "donut123");

  let r = w.Auth.saveUser({ isNew: true, name: "Test", email: "nope", role: "manager", storeIds: ["dunkin-342238"], password: "secret1" });
  ok("invalid email rejected", !r.ok, r.error);
  r = w.Auth.saveUser({ isNew: true, name: "Test", email: "t@glaze.co", role: "manager", storeIds: [], password: "secret1" });
  ok("manager with no store rejected", !r.ok, r.error);
  r = w.Auth.saveUser({ isNew: true, name: "Test", email: "t@glaze.co", role: "manager", storeIds: ["dunkin-342238"], password: "abc" });
  ok("short password rejected", !r.ok, r.error);
  r = w.Auth.saveUser({ isNew: true, name: "Test", email: "admin@glaze.co", role: "manager", storeIds: ["dunkin-342238"], password: "secret1" });
  ok("duplicate email rejected", !r.ok, r.error);

  r = w.Auth.saveUser({ isNew: true, name: "Test", email: "t@glaze.co", role: "manager", storeIds: ["dunkin-342238", "dunkin-346976"], password: "secret1" });
  ok("valid manager created", r.ok, r.error);
  const created = w.Auth.listUsers().find((u) => u.email === "t@glaze.co");
  eq("manager trimmed to a single store", created.storeIds.length, 1);
  ok("new user can sign in", w.Auth.login("t@glaze.co", "secret1").ok);

  w.Auth.login("admin@glaze.co", "donut123");
  const adminId = w.Auth.listUsers().find((u) => u.role === "admin").id;
  r = w.Auth.saveUser({ id: adminId, name: "Avery Cole", email: "admin@glaze.co", role: "manager", storeIds: ["dunkin-342238"] });
  ok("the only admin cannot be demoted", !r.ok, r.error);
  r = w.Auth.deleteUser(adminId);
  ok("cannot delete the account you're signed in with", !r.ok, r.error);

  r = w.Auth.saveUser({ isNew: true, name: "Second", email: "admin2@glaze.co", role: "admin", storeIds: [], password: "secret1" });
  ok("second admin created", r.ok, r.error);
  const second = w.Auth.listUsers().find((u) => u.email === "admin2@glaze.co");
  ok("with two admins one can be deleted", w.Auth.deleteUser(second.id).ok);

  // CML assigned to a store that no longer exists
  const ghost = { id: "x", role: "cml", storeIds: ["dunkin-342238", "does-not-exist"] };
  eq("dead store ids are filtered out of scope", w.Auth.storeIdsFor(ghost).length, 1);
}

console.log("\nAUTH — passwords are not stored in the clear");
{
  const w = boot();
  const raw = w.localStorage.getItem("glaze_users_v1");
  ok("seed password absent from storage", raw.indexOf("donut123") === -1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
