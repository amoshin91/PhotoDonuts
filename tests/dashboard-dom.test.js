/* =============================================================================
   dashboard-dom.test.js — the dashboard's UI.

   Loads the real pages in jsdom as each role, walks every section, drives real
   clicks, and checks that a saved edit shows up on the storefront.

   Needs jsdom:  npm install     then     node tests/dashboard-dom.test.js
   ============================================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  console.log("\n  ⚠ jsdom is not installed — skipping the DOM suite.");
  console.log("    Run `npm install` in the project root, then re-run this file.");
  console.log("    (tests/settings-auth.test.js needs no dependencies and covers the data layer.)\n");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "\n      " + extra : "")); }
}
function eq(name, a, b) { ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

const pageErrors = [];

function load(page, storage) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => pageErrors.push(`${page}: ${e.message}`));
  vc.on("error", (m) => pageErrors.push(`${page} console.error: ${m}`));

  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, page), "utf8"), {
    url: "http://localhost:8765/" + page,
    runScripts: "dangerously",
    resources: undefined,       // don't fetch fonts/CDN
    pretendToBeVisual: true,
    virtualConsole: vc,
  });

  const w = dom.window;
  // Seed localStorage before the page's scripts run against it.
  if (storage) Object.keys(storage).forEach((k) => w.localStorage.setItem(k, storage[k]));

  // jsdom won't run <script src> without a resource loader, so inject manually
  // in document order.
  const srcs = Array.from(w.document.querySelectorAll("script[src]"))
    .map((s) => s.getAttribute("src"))
    // CDN scripts (Leaflet) aren't fetched — app.js falls back to a static map.
    .filter((src) => !/^https?:/i.test(src));
  srcs.forEach((src) => {
    const code = fs.readFileSync(path.join(ROOT, src), "utf8");
    try { w.eval(code); } catch (e) { pageErrors.push(`${page} ${src}: ${e.message}\n${e.stack}`); }
  });
  // scripts sit at the end of <body>, so DOMContentLoaded has already fired
  // by the time they'd normally run — the modules handle both, but fire it
  // anyway to match the browser.
  w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
  return { dom, w, doc: w.document };
}

function click(w, el) {
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
}
function setChecked(w, el, on) {
  el.checked = on;
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
}
function setValue(w, el, v, type) {
  el.value = v;
  el.dispatchEvent(new w.Event(type || "input", { bubbles: true }));
}

// Sign in through the real login page so the session is produced the same way
// the app produces it.
function signIn(email, password, storage) {
  const { w, doc } = load("login.html", storage);
  doc.getElementById("email").value = email;
  doc.getElementById("password").value = password;
  doc.getElementById("loginForm").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  const out = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    out[k] = w.localStorage.getItem(k);
  }
  return out;
}

/* ------------------------------------------------------------------ */
console.log("\nLOGIN PAGE");
let adminStorage;
{
  const { w, doc } = load("login.html");
  const rows = doc.querySelectorAll(".auth__demo-fill");
  eq("three demo accounts listed", rows.length, 3);
  ok("passwords are not in the visible text", doc.body.textContent.indexOf("donut123") === -1);

  // clicking a demo row fills the form
  click(w, rows[0]);
  eq("demo row fills the email", doc.getElementById("email").value, "admin@glaze.co");

  // wrong password shows an error and no session
  doc.getElementById("password").value = "nope";
  doc.getElementById("loginForm").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  eq("error shown for a bad password", doc.getElementById("loginError").hidden, false);
  eq("no session written", w.localStorage.getItem("glaze_session_v1"), null);

  adminStorage = signIn("admin@glaze.co", "donut123");
  ok("admin session created", !!adminStorage["glaze_session_v1"]);
}

console.log("\nDASHBOARD — admin sees everything");
{
  const { w, doc } = load("dashboard.html", adminStorage);
  const nav = Array.from(doc.querySelectorAll(".dash-nav__item")).map((b) => b.dataset.section);
  eq("all seven sections", nav.join(","), "menu,hours,windows,pricing,boxes,users,tools");
  ok("store dropdown lists every store", doc.getElementById("storeSelect").options.length === 4);
  ok("role badge rendered", doc.querySelector(".role-badge--admin") !== null);
  ok("prototype disclosure present", doc.querySelector(".dash-proto") !== null);

  // walk every section and make sure each renders content without throwing
  const before = pageErrors.length;
  doc.querySelectorAll(".dash-nav__item").forEach((btn) => {
    click(w, btn);
    const body = doc.getElementById("dashContent");
    ok(`section "${btn.dataset.section}" renders`, body.textContent.trim().length > 40 && body.querySelector(".sec-head") !== null);
  });
  eq("no errors while walking sections", pageErrors.length, before);
}

console.log("\nDASHBOARD — CML is scoped to its group");
{
  const storage = signIn("cml@glaze.co", "donut123");
  const { doc } = load("dashboard.html", storage);
  const nav = Array.from(doc.querySelectorAll(".dash-nav__item")).map((b) => b.dataset.section);
  eq("no users/tools sections", nav.join(","), "menu,hours,windows,pricing,boxes");
  const opts = Array.from(doc.getElementById("storeSelect").options).map((o) => o.value);
  eq("only its three stores", opts.length, 3);
  ok("cannot reach the manager's store", opts.indexOf("dunkin-345764") === -1);
  ok("role badge is CML", doc.querySelector(".role-badge--cml") !== null);
}

console.log("\nDASHBOARD — manager is locked to one store");
{
  const storage = signIn("manager@glaze.co", "donut123");
  const { doc } = load("dashboard.html", storage);
  const nav = Array.from(doc.querySelectorAll(".dash-nav__item")).map((b) => b.dataset.section);
  eq("store sections only", nav.join(","), "menu,hours,windows,pricing,boxes");
  eq("no store switcher at all", doc.getElementById("storeSelect"), null);
  const badge = doc.querySelector(".store-badge__name");
  eq("its single store is shown", badge.textContent, "Dunkin' #345764");
}

console.log("\nDASHBOARD — editing the menu saves and reaches the storefront");
let editedStorage;
{
  const { w, doc } = load("dashboard.html", adminStorage);
  // focus the manager's store so we can assert on a specific one
  setValue(w, doc.getElementById("storeSelect"), "dunkin-345764", "change");
  click(w, doc.querySelector('[data-section="menu"]'));

  eq("save bar hidden while clean", doc.getElementById("saveBar").hidden, true);

  // this store ships with 6 colors; add navy-blue
  const navy = doc.querySelector('[data-menu-color="navy-blue"]');
  eq("navy starts off", navy.checked, false);
  setChecked(w, navy, true);
  eq("save bar appears when dirty", doc.getElementById("saveBar").hidden, false);
  ok("checkbox reflects the change after re-render", doc.querySelector('[data-menu-color="navy-blue"]').checked);

  click(w, doc.getElementById("saveBtn"));
  eq("save bar hides after saving", doc.getElementById("saveBar").hidden, true);
  const store = w.DB.STORES.find((s) => s.id === "dunkin-345764");
  eq("menu now has 7 colors", store.menu.sprinkleColorIds.length, 7);

  // "Select all" then save collapses the restriction away
  click(w, doc.querySelector('[data-bulk="color-all"]'));
  click(w, doc.querySelector('[data-bulk="icing-all"]'));
  click(w, doc.getElementById("saveBtn"));
  eq("full selection removes the restriction", w.DB.STORES.find((s) => s.id === "dunkin-345764").menu, undefined);

  // put it back to a restricted set so the storefront assertion below is sharp
  click(w, doc.querySelector('[data-bulk="color-rainbow"]'));
  click(w, doc.getElementById("saveBtn"));

  editedStorage = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    editedStorage[k] = w.localStorage.getItem(k);
  }
}

console.log("\nSTOREFRONT — picks up the dashboard's menu edit");
{
  const { w, doc } = load("index.html", editedStorage);
  const store = w.DB.STORES.find((s) => s.id === "dunkin-345764");
  eq("storefront sees the saved menu", store.menu.sprinkleColorIds.length, w.DB.RAINBOW_SPRINKLE_IDS.length);
  const menu = w.Menu.forStore(store);
  eq("rainbow preset is now available", menu.rainbowAvailable, true);
  ok("black is no longer offered", menu.sprinkleIds.indexOf("black") === -1);
  ok("store gate rendered", doc.getElementById("storeStepBody").children.length > 0);
}

console.log("\nDASHBOARD — pickup windows edit reaches the storefront copy");
let windowStorage;
{
  const { w, doc } = load("dashboard.html", editedStorage);
  setValue(w, doc.getElementById("storeSelect"), "dunkin-345764", "change");
  click(w, doc.querySelector('[data-section="windows"]'));

  // The store starts on the 30-minute default, so clear the minutes field too.
  // Each edit re-renders the section, so re-query between interactions.
  setValue(w, doc.getElementById("leadHours"), "3");
  setValue(w, doc.getElementById("leadMinutes"), "0");
  setValue(w, doc.getElementById("capacity"), "8");
  click(w, doc.querySelector('[data-increment="60"]'));
  eq("reads back as 3 hr", doc.querySelector(".dur-row__read").textContent.replace(/\s+/g, " ").trim(),
     "= 3 hr minimum notice");
  ok("preview renders slots", doc.querySelector(".preview-slot") !== null);

  click(w, doc.getElementById("saveBtn"));
  const store = w.DB.STORES.find((s) => s.id === "dunkin-345764");
  eq("lead time saved as minutes", store.scheduling.leadTimeMinutes, 180);
  eq("capacity saved", store.scheduling.slotCapacityDozen, 8);
  eq("increment saved", store.scheduling.slotIncrementMinutes, 60);

  windowStorage = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    windowStorage[k] = w.localStorage.getItem(k);
  }
}

console.log("\nSTOREFRONT — checkout copy reflects the new windows");
{
  // put a box in the cart and select the edited store, then render checkout
  const cart = JSON.stringify({
    boxes: [{ id: 1, design: { typeId: "classic-ring", fillingId: "none", icingId: "vanilla", tieDyeIcing: false, icingTintId: null, drizzleId: null, drizzleCustomId: null, sprinkleColorIds: [], noSprinkles: true, rainbowSprinkles: false, chocolateSprinkles: false, heavySprinkles: false, halfSprinkles: false }, qty: 1 }],
    nextBoxId: 2,
    pickup: { location: null, locationLabel: "", storeId: "dunkin-345764", dateStr: null, slotHm: null },
    checkout: { mode: "guest", name: "", email: "", phone: "", consent: false },
  });
  const storage = Object.assign({}, windowStorage, { glaze_order_v1: cart });
  const { doc } = load("checkout.html", storage);
  const text = doc.getElementById("checkoutMain").textContent;
  ok("60-min windows in the label", text.indexOf("60-min windows") !== -1);
  ok("3 hr lead time in the note", text.indexOf("3 hr minimum lead time") !== -1);
  ok("8 dozen per slot in the note", text.indexOf("8 dozen per slot") !== -1);
}

console.log("\nDASHBOARD — hours, pause and pricing");
let pausedStorage;
{
  const { w, doc } = load("dashboard.html", windowStorage);
  setValue(w, doc.getElementById("storeSelect"), "dunkin-345764", "change");

  // --- hours
  click(w, doc.querySelector('[data-section="hours"]'));
  setChecked(w, doc.querySelector('[data-day-open="1"]'), false); // close Monday
  ok("Monday row shows as closed", doc.querySelector('[data-day-open="1"]').closest("tr").className.indexOf("is-closed") !== -1);
  setValue(w, doc.querySelector('[data-day-field="open"][data-day="2"]'), "08:30", "change");
  click(w, doc.getElementById("saveBtn"));
  let store = w.DB.STORES.find((s) => s.id === "dunkin-345764");
  eq("Monday saved as closed", store.hours[1], null);
  eq("Tuesday opening saved", store.hours[2].open, "08:30");

  // invalid hours are refused
  setValue(w, doc.querySelector('[data-day-field="close"][data-day="2"]'), "07:00", "change");
  ok("validation message shown", doc.querySelector(".field-error") !== null);
  click(w, doc.getElementById("saveBtn"));
  eq("bad hours not saved", w.DB.STORES.find((s) => s.id === "dunkin-345764").hours[2].close, "21:00");

  // --- pause
  click(w, doc.getElementById("discardBtn"));
  click(w, doc.querySelector('[data-section="hours"]'));
  setChecked(w, doc.querySelector("[data-active]"), false);
  click(w, doc.getElementById("saveBtn"));
  eq("store paused", w.DB.STORES.find((s) => s.id === "dunkin-345764").active, false);
  eq("dropped from orderable stores", w.Settings.orderableStores().some((s) => s.id === "dunkin-345764"), false);

  // --- pricing
  click(w, doc.querySelector('[data-section="pricing"]'));
  setValue(w, doc.getElementById("p-baseDozen"), "23.5");
  setValue(w, doc.getElementById("p-taxRate"), "6");
  click(w, doc.getElementById("saveBtn"));
  store = w.DB.STORES.find((s) => s.id === "dunkin-345764");
  eq("base dozen saved", store.pricing.baseDozen, 23.5);
  eq("tax converted from percent", store.pricing.taxRate, 0.06);
  eq("other store keeps the default price", w.DB.STORES.find((s) => s.id === "dunkin-342238").pricing.baseDozen, 18);
  ok("reset link appears once changed", doc.querySelector('[data-price-reset="baseDozen"]') !== null);
  click(w, doc.querySelector('[data-price-reset="baseDozen"]'));
  click(w, doc.getElementById("saveBtn"));
  eq("reset restores the default", w.DB.STORES.find((s) => s.id === "dunkin-345764").pricing.baseDozen, 18);

  pausedStorage = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    pausedStorage[k] = w.localStorage.getItem(k);
  }
}

console.log("\nSTOREFRONT — a paused store disappears");
{
  const { w, doc } = load("index.html", pausedStorage);
  const select = doc.getElementById("storeSelect");
  const ids = select ? Array.from(select.options).map((o) => o.value) : [];
  ok("paused store not in the picker", ids.indexOf("dunkin-345764") === -1, ids.join(","));
  eq("the other three are", ids.filter(Boolean).length, 3);
}

console.log("\nDASHBOARD — ready-made boxes");
let boxStorage;
{
  const { w, doc } = load("dashboard.html", pausedStorage);
  setValue(w, doc.getElementById("storeSelect"), "dunkin-342238", "change");
  click(w, doc.querySelector('[data-section="boxes"]'));

  eq("all shipped boxes shown", doc.querySelectorAll("[data-box-toggle]").length, w.DB.PREMADE_BOXES.length);
  ok("donut previews rendered", doc.querySelectorAll(".box-card__art svg").length >= 3);

  // hide one
  const toggle = doc.querySelector('[data-box-toggle="july-4th"]');
  setChecked(w, toggle, false);
  click(w, doc.getElementById("saveBtn"));
  ok("box hidden for this store", !w.Settings.premadesFor("dunkin-342238").some((p) => p.id === "july-4th"));
  ok("other store unaffected", w.Settings.premadesFor("dunkin-346976").some((p) => p.id === "july-4th"));

  // author a new one
  click(w, doc.querySelector("[data-new-box]"));
  ok("editor opened", doc.querySelector("#boxName") !== null);
  ok("live preview donut", doc.querySelector(".editor__donut svg") !== null);

  // saving without a name is refused
  click(w, doc.querySelector("[data-box-done]"));
  eq("name required", doc.getElementById("boxEditorError").hidden, false);

  setValue(w, doc.getElementById("boxName"), "Homecoming");
  setValue(w, doc.getElementById("boxOccasion"), "Local");
  setValue(w, doc.getElementById("boxBlurb"), "Blue and gold.");
  click(w, doc.querySelector('[data-spr-mode="custom"]'));
  setChecked(w, doc.querySelector('[data-spr-color="blue"]'), true);
  setChecked(w, doc.querySelector('[data-spr-color="yellow"]'), true);
  click(w, doc.querySelector("[data-box-done]"));
  ok("editor closed on success", doc.querySelector("#boxName") === null);
  eq("card added to the list", doc.querySelectorAll("[data-edit-box]").length, 1);

  click(w, doc.getElementById("saveBtn"));
  const list = w.Settings.premadesFor("dunkin-342238");
  const mine = list.find((p) => p.name === "Homecoming");
  ok("store design persisted", !!mine);
  eq("design kept its colors", mine.design.sprinkleColorIds.join(), "blue,yellow");

  boxStorage = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    boxStorage[k] = w.localStorage.getItem(k);
  }
}

console.log("\nSTOREFRONT — the boxes page shows the store's own design");
{
  const cart = JSON.stringify({
    boxes: [], nextBoxId: 1,
    pickup: { location: null, locationLabel: "", storeId: "dunkin-342238", dateStr: null, slotHm: null },
    checkout: { mode: "guest", name: "", email: "", phone: "", consent: false },
  });
  const { doc } = load("boxes.html", Object.assign({}, boxStorage, { glaze_order_v1: cart }));
  const text = doc.getElementById("featuredGrid").textContent;
  ok("store design listed", text.indexOf("Homecoming") !== -1);
  ok("hidden chain box is gone", text.indexOf("Fourth of July") === -1);
  ok("other chain boxes remain", text.indexOf("Team USA") !== -1);
}

console.log("\nDASHBOARD — user management");
{
  const { w, doc } = load("dashboard.html", boxStorage);
  click(w, doc.querySelector('[data-section="users"]'));
  eq("three accounts listed", doc.querySelectorAll("[data-edit-user]").length, 3);
  ok("signed-in admin has no delete button", doc.querySelectorAll("[data-delete-user]").length === 2);

  click(w, doc.querySelector("[data-new-user]"));
  setValue(w, doc.getElementById("uName"), "Sam Reed");
  setValue(w, doc.getElementById("uEmail"), "sam@glaze.co");
  setValue(w, doc.getElementById("uPass"), "secret123");
  setValue(w, doc.getElementById("uRole"), "cml", "change");
  eq("CML gets checkboxes for every store", doc.querySelectorAll("[data-user-store]").length, 4);
  // Ticking a store re-renders the form, so grab a fresh node each time.
  setChecked(w, doc.querySelectorAll("[data-user-store]")[0], true);
  setChecked(w, doc.querySelectorAll("[data-user-store]")[1], true);
  click(w, doc.querySelector("[data-user-save]"));
  eq("account created", doc.querySelectorAll("[data-edit-user]").length, 4);
  const sam = w.Auth.listUsers().find((u) => u.email === "sam@glaze.co");
  eq("saved with two stores", sam.storeIds.length, 2);
  eq("saved as CML", sam.role, "cml");

  // switching a role to manager narrows to a single store
  click(w, doc.querySelector(`[data-edit-user="${sam.id}"]`));
  setValue(w, doc.getElementById("uRole"), "manager", "change");
  eq("manager gets radios", doc.querySelectorAll('input[type="radio"][data-user-store]').length, 4);
  click(w, doc.querySelector("[data-user-save]"));
  eq("narrowed to one store", w.Auth.listUsers().find((u) => u.id === sam.id).storeIds.length, 1);

  // admin scope shows the explanatory notice instead of a picker
  click(w, doc.querySelector(`[data-edit-user="${sam.id}"]`));
  setValue(w, doc.getElementById("uRole"), "admin", "change");
  eq("no store picker for admins", doc.querySelectorAll("[data-user-store]").length, 0);
}

console.log("\nDASHBOARD — data tools");
{
  const { w, doc } = load("dashboard.html", boxStorage);
  click(w, doc.querySelector('[data-section="tools"]'));
  ok("customized stores listed", doc.querySelectorAll("[data-reset-store]").length >= 1);
  ok("export button present", doc.querySelector("[data-export]") !== null);
  ok("import input present", doc.getElementById("importFile") !== null);
}

console.log("\nACCESS — an unauthenticated visit is turned away");
{
  // jsdom can't actually navigate, so assert on the observable effects:
  // requireUser() bails before rendering, and it attempted a redirect.
  const before = pageErrors.length;
  const { doc } = load("dashboard.html"); // no session
  // Each mount point still holds only the untouched HTML placeholder.
  const untouched = (id) => doc.getElementById(id).children.length === 0;
  ok("no nav rendered", untouched("dashNav"));
  ok("no settings rendered", untouched("dashContent"));
  ok("no user chip rendered", untouched("dashUser"));
  ok("a redirect was attempted",
     pageErrors.slice(before).some((e) => /navigation to another Document/.test(e)));
}

console.log("\nSTOREFRONT — still renders for a plain visitor with no settings");
{
  const { doc } = load("index.html");
  ok("builder present", doc.getElementById("controls") !== null);
  ok("store gate rendered", doc.getElementById("storeStepBody").children.length > 0);
  ok("footer stores listed", doc.querySelectorAll(".footer-store").length === 4);
  ok("staff link present", doc.querySelector(".site-footer__staff") !== null);
}

// jsdom implements no navigation, so every location.href/replace the app does
// surfaces as a jsdomError. Those are expected; anything else is not.
const realErrors = pageErrors.filter((e) => !/navigation to another Document/.test(e));
if (realErrors.length) {
  console.log("\nPAGE ERRORS:");
  realErrors.forEach((e) => console.log("  ! " + e));
  fail += realErrors.length;
} else {
  console.log(`\n(${pageErrors.length} expected jsdom navigation notices ignored)`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
