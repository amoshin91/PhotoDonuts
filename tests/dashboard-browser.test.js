/* =============================================================================
   dashboard-browser.test.js — the dashboard in a REAL browser (Chromium).

   The jsdom suite cannot be trusted alone: jsdom diverges from browsers on
   input.selectionStart, focus/blur ordering and layout, and every one of those
   gaps hid a bug that shipped. This drives actual key events against a real
   engine, which is the only way the typing and focus behaviour is meaningful.

     npm install && npm run test:browser      (needs a running server)
   ============================================================================ */
let puppeteer;
try { puppeteer = require("puppeteer"); }
catch (e) {
  console.log("\n  ⚠ puppeteer is not installed — skipping the browser suite.");
  console.log("    npm install, then re-run.\n");
  process.exit(0);
}
const BASE = process.env.BASE_URL || "http://localhost:8765";
let pass=0, fail=0;
const ok=(n,c,x)=>{ c?(pass++,console.log("  ✓ "+n)):(fail++,console.log("  ✗ "+n+(x?"  ["+x+"]":""))); };

(async () => {
  const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
  const p = await b.newPage(); await p.setCacheEnabled(false); await p.setViewport({width:1280,height:1000});
  const errs=[], natives=[];
  p.on("pageerror", e => errs.push(e.message.split("\n")[0]));
  p.on("dialog", async d => { natives.push(d.message()); await d.dismiss(); });

  // Sign in through the real Auth module, then navigate. Clicking the submit
  // button races the navigation it triggers (puppeteer's internal evaluate is
  // torn down mid-call and hangs); the login FORM is covered by the jsdom
  // suite, and what this file exists to exercise is the dashboard itself.
  await p.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
  const signedIn = await p.evaluate(() => Auth.login("admin@photodonuts.co", "donut123").ok);
  if (!signedIn) { console.log("  ✗ could not sign in"); process.exit(1); }
  await p.goto(BASE + "/dashboard.html", { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".dash-nav__item", { timeout: 15000 });
  const wait=(ms=200)=>new Promise(r=>setTimeout(r,ms));
  const val = (id) => p.$eval("#"+id, e=>e.value);
  const text = (sel) => p.$eval(sel, e=>e.textContent.replace(/\s+/g," ").trim());

  // Type character-by-character through real key events, with focus set first.
  const typeInto = async (id, s) => {
    await p.evaluate(id => { const el=document.getElementById(id); el.focus(); el.setSelectionRange(0, el.value.length); }, id);
    for (const ch of s) { await p.keyboard.type(ch); await wait(40); }
  };
  // puppeteer v24's mouse click does an internal evaluate that hangs on this
  // page; dispatch the click directly instead. Typing below still goes through
  // real key events, which is what this suite exists to exercise.
  const clickEl = (sel) => p.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) throw new Error("no element for " + s);
    el.scrollIntoView({ block: "center" });
    el.click();
  }, sel);

  // Scroll the nav item into view first — the sidebar is taller than a short
  // viewport, so lower items can sit off-screen and swallow a raw click.
  const navTo = async (s) => {
    await p.evaluate(s => document.querySelector(`[data-section="${s}"]`).scrollIntoView({block:"center"}), s);
    await clickEl(`[data-section="${s}"]`);
  };
  const blur = (id) => p.evaluate(id => { const el=document.getElementById(id);
    el.dispatchEvent(new Event("change",{bubbles:true})); el.blur(); }, id);

  console.log("\nPICKUP WINDOWS");
  await navTo("windows"); await wait(300);
  ok("section opens", (await text(".sec-head__title")) === "Pickup windows");

  await typeInto("leadHours","12"); await blur("leadHours");
  ok("lead hours = 12", (await val("leadHours")) === "12", await val("leadHours"));
  await typeInto("leadMinutes","0"); await blur("leadMinutes");
  ok("lead minutes = 0", (await val("leadMinutes")) === "0", await val("leadMinutes"));
  ok("readout = 12 hr", (await text("#leadRead")) === "= 12 hr minimum notice", await text("#leadRead"));
  await typeInto("capacity","8"); await blur("capacity");
  ok("capacity = 8", (await val("capacity")) === "8", await val("capacity"));

  await typeInto("capacity","9999"); await blur("capacity");
  ok("out-of-range clamps on blur", (await val("capacity")) === "500", await val("capacity"));
  await typeInto("capacity","8"); await blur("capacity");

  await clickEl(`[data-increment="60"]`); await wait(200);
  ok("60-min selected", (await p.$eval(`[data-increment="60"]`,e=>e.getAttribute("aria-pressed"))) === "true");
  ok("preview rendered", (await p.$$(".preview-slot")).length > 0);

  await clickEl("#saveBtn"); await wait(400);
  const sched = await p.evaluate(()=>JSON.stringify(DB.STORES[0].scheduling));
  ok("saved", sched === '{"leadTimeMinutes":720,"slotIncrementMinutes":60,"slotCapacityDozen":8}', sched);
  ok("save bar hidden after save", await p.$eval("#saveBar",e=>e.hidden));

  console.log("\nPRICING — decimals");
  await navTo("pricing");
  await typeInto("p-baseDozen","23.50"); await blur("p-baseDozen");
  ok("decimal survives typing", (await val("p-baseDozen")) === "23.5", await val("p-baseDozen"));
  await typeInto("p-taxRate","6.25"); await blur("p-taxRate");
  ok("tax decimal survives", (await val("p-taxRate")) === "6.25", await val("p-taxRate"));
  ok("example updates live", (await text("#pricingExample")).includes("23.50"), await text("#pricingExample"));
  await clickEl("#saveBtn"); await wait(400);
  const pr = await p.evaluate(()=>JSON.stringify({b:DB.STORES[0].pricing.baseDozen,t:DB.STORES[0].pricing.taxRate}));
  ok("pricing saved", pr === '{"b":23.5,"t":0.0625}', pr);

  console.log("\nUNSAVED-CHANGES NAV");
  await typeInto("p-baseDozen","19"); await wait(150);
  ok("save bar shows", !(await p.$eval("#saveBar",e=>e.hidden)));
  await navTo("windows"); await wait(250);
  ok("in-page dialog appears", (await p.$(".dlg-overlay")) !== null);
  ok("no native confirm used", natives.length === 0, natives.join("|"));
  ok("stays on Pricing", (await text(".sec-head__title")) === "Pricing");
  await clickEl(`.dlg-overlay [data-act="cancel"]`); await wait(200);
  ok("cancel keeps you put", (await text(".sec-head__title")) === "Pricing");
  await navTo("windows"); await wait(250);
  await clickEl(`.dlg-overlay [data-act="ok"]`); await wait(300);
  ok("discard navigates", (await text(".sec-head__title")) === "Pickup windows");

  console.log("\nCLEAN NAV — every section");
  for (const s of ["menu","hours","windows","pricing","boxes","users","tools"]) {
    await navTo(s); await wait(200);
    ok(`${s} switches`, (await p.$eval(`[data-section="${s}"]`,e=>e.getAttribute("aria-current"))) === "page");
  }

  console.log("\nHOURS — time fields");
  await navTo("hours"); await wait(250);
  await p.evaluate(()=>{ const el=document.querySelector('[data-day-field="open"][data-day="2"]');
    el.focus(); el.value="08:30"; el.dispatchEvent(new Event("change",{bubbles:true})); });
  await wait(250);
  ok("time field accepted", (await p.$eval('[data-day-field="open"][data-day="2"]',e=>e.value)) === "08:30",
     await p.$eval('[data-day-field="open"][data-day="2"]',e=>e.value));
  await clickEl("#saveBtn"); await wait(400);
  ok("hours saved", (await p.evaluate(()=>DB.STORES[0].hours[2].open)) === "08:30");

  console.log("\n  page errors:", errs.length ? errs.length+" × "+errs[0].slice(0,70) : "none");
  if (errs.length) fail += errs.length;
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await b.close();
  process.exit(fail?1:0);
})();
