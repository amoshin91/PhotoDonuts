/* =============================================================================
   auth.js — Dashboard accounts, roles, and session (PROTOTYPE).

   ⚠️  THIS IS NOT A SECURITY BOUNDARY.
   Users, passwords and the session all live in localStorage, which the person
   using the browser can read and rewrite at will. It exists so the dashboard's
   role behaviour can be designed, demoed and tested before the real backend
   lands. Everything here is replaced by Supabase Auth + row-level security
   (see PROJECT_STATUS.md § Backend migration plan); the *shape* of the API
   below is what survives, so dashboard.js won't need rewriting.

   THREE ROLES
   -----------
     admin    every store, plus user management and global tools
     cml      a GROUP of stores (e.g. an owner with several locations)
     manager  exactly one store

   Roles differ in SCOPE (which stores) and in the admin-only capabilities;
   within a store they can edit the same things. The capability table below is
   the single place to change that.

   Exposed globally as window.Auth (plain script, no bundler).
   ============================================================================ */
(function () {
  "use strict";

  /* Deliberately NOT migrated from the old glaze_* keys at the rename.
     The seeded addresses moved to @photodonuts.co, and login.html advertises
     them; carrying the old records over would leave the page listing accounts
     that don't exist. Bumping the key re-seeds cleanly instead. The cost is
     that any hand-made accounts in a browser are lost and everyone is signed
     out once — acceptable for demo credentials, and it does not touch store
     settings or carts, which DO migrate (see settings.js / app.js). */
  const USERS_KEY = "photodonuts_users_v1";
  const SESSION_KEY = "photodonuts_session_v1";

  /* -------------------------------- ROLES --------------------------------- */
  /* `scope` decides which stores a user reaches:
       all  → every store in DB.STORES (storeIds ignored)
       many → the stores listed in user.storeIds
       one  → the single store in user.storeIds[0]                            */
  const ROLES = {
    admin: {
      id: "admin",
      label: "Admin",
      blurb: "Full control of every store, plus user management.",
      scope: "all",
      can: { menu: true, hours: true, windows: true, pricing: true, boxes: true, users: true, tools: true },
    },
    cml: {
      id: "cml",
      label: "CML",
      blurb: "Manages a group of stores — for an owner with several locations.",
      scope: "many",
      can: { menu: true, hours: true, windows: true, pricing: true, boxes: true, users: false, tools: false },
    },
    manager: {
      id: "manager",
      label: "Store Manager",
      blurb: "Manages a single store.",
      scope: "one",
      can: { menu: true, hours: true, windows: true, pricing: true, boxes: true, users: false, tools: false },
    },
  };

  /* --------------------------- SEEDED DEMO USERS --------------------------- */
  /* Written to localStorage on first run so the dashboard is usable straight
     away. Passwords are shown on the sign-in page on purpose — this is a demo,
     not a deployment. Change or empty this list freely. */
  const SEED_USERS = [
    {
      id: "u-admin",
      name: "Avery Cole",
      email: "admin@photodonuts.co",
      password: "donut123",
      role: "admin",
      storeIds: [],
    },
    {
      id: "u-cml",
      name: "Chris Vitale",
      email: "cml@photodonuts.co",
      password: "donut123",
      role: "cml",
      // an owner with three Long Island locations
      storeIds: ["dunkin-342238", "dunkin-346976", "dunkin-302334"],
    },
    {
      id: "u-manager",
      name: "Robin Ortiz",
      email: "manager@photodonuts.co",
      password: "donut123",
      role: "manager",
      storeIds: ["dunkin-345764"],
    },
  ];

  /* ------------------------------ PASSWORDS -------------------------------
     Obfuscation, NOT cryptography — a deliberately simple synchronous hash so
     the app still runs from file:// (crypto.subtle needs a secure context).
     It only stops a plaintext password sitting in localStorage; it stops
     nothing else. Real hashing (argon2/bcrypt) happens server-side later. */
  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
    }
    return (h1 >>> 0).toString(36) + "." + (h2 >>> 0).toString(36);
  }

  /* ------------------------------- STORAGE -------------------------------- */
  let users = [];

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function loadUsers() {
    const stored = readJson(USERS_KEY);
    if (Array.isArray(stored) && stored.length) { users = stored; return; }
    users = SEED_USERS.map((u) => ({
      id: u.id, name: u.name, email: u.email.toLowerCase(),
      role: u.role, storeIds: u.storeIds.slice(), pass: hash(u.password),
    }));
    writeJson(USERS_KEY, users);
  }

  function saveUsers() { return writeJson(USERS_KEY, users); }

  /* ------------------------------- SESSION -------------------------------- */
  function currentUser() {
    const s = readJson(SESSION_KEY);
    if (!s || !s.userId) return null;
    return users.find((u) => u.id === s.userId) || null; // deleted user ⇒ signed out
  }

  function login(email, password) {
    const e = String(email || "").trim().toLowerCase();
    const user = users.find((u) => u.email === e);
    // Same message either way — don't leak which addresses exist.
    if (!user || user.pass !== hash(String(password || ""))) {
      return { ok: false, error: "That email and password don't match an account." };
    }
    if (!storeIdsFor(user).length && user.role !== "admin") {
      return { ok: false, error: "This account isn't assigned to a store yet. Ask an admin to assign one." };
    }
    writeJson(SESSION_KEY, { userId: user.id, at: new Date().toISOString() });
    return { ok: true, user };
  }

  function logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* Send anyone without a session to the sign-in page. Returns the user so
     callers can do `const me = Auth.requireUser(); if (!me) return;` */
  function requireUser(loginUrl) {
    const user = currentUser();
    if (!user) {
      const back = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      location.replace((loginUrl || "login.html") + "?next=" + back);
      return null;
    }
    return user;
  }

  /* -------------------------------- SCOPE --------------------------------- */
  function roleOf(user) { return (user && ROLES[user.role]) || ROLES.manager; }

  /* Which store ids can this user manage? Always filtered against the stores
     that actually exist, so a deleted store can't strand a manager on an
     empty dashboard. */
  function storeIdsFor(user) {
    if (!user) return [];
    const live = window.DB.STORES.map((s) => s.id);
    const role = roleOf(user);
    if (role.scope === "all") return live;
    const assigned = (user.storeIds || []).filter((id) => live.indexOf(id) !== -1);
    return role.scope === "one" ? assigned.slice(0, 1) : assigned;
  }

  function storesFor(user) {
    const ids = storeIdsFor(user);
    return window.DB.STORES.filter((s) => ids.indexOf(s.id) !== -1);
  }

  function canManage(user, storeId) {
    return storeIdsFor(user).indexOf(storeId) !== -1;
  }

  /* Capability check — `Auth.can(me, "pricing")`. Unknown names are denied. */
  function can(user, capability) {
    return roleOf(user).can[capability] === true;
  }

  /* ---------------------------- USER MANAGEMENT ---------------------------
     Admin-only at the UI level; the caller is responsible for checking
     can(user, "users") first. Enforced properly server-side later. */
  function listUsers() {
    return users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, storeIds: (u.storeIds || []).slice() }));
  }

  function saveUser(input) {
    const email = String(input.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
    if (!String(input.name || "").trim()) return { ok: false, error: "Enter a name." };
    if (!ROLES[input.role]) return { ok: false, error: "Pick a role." };

    const clash = users.find((u) => u.email === email && u.id !== input.id);
    if (clash) return { ok: false, error: "Another account already uses that email." };

    const role = ROLES[input.role];
    let storeIds = (input.storeIds || []).filter((id) => window.DB.STORES.some((s) => s.id === id));
    if (role.scope === "all") storeIds = [];
    if (role.scope === "one") storeIds = storeIds.slice(0, 1);
    if (role.scope !== "all" && !storeIds.length) {
      return { ok: false, error: role.scope === "one" ? "Pick the store this manager runs." : "Pick at least one store." };
    }

    const existing = users.find((u) => u.id === input.id);
    if (existing) {
      // Never let the last admin be demoted — that would lock everyone out of
      // user management with no way back short of clearing storage.
      if (existing.role === "admin" && input.role !== "admin" && adminCount() < 2) {
        return { ok: false, error: "This is the only admin — promote someone else first." };
      }
      existing.name = String(input.name).trim();
      existing.email = email;
      existing.role = input.role;
      existing.storeIds = storeIds;
      if (input.password) existing.pass = hash(input.password);
    } else {
      if (!input.password || String(input.password).length < 6) {
        return { ok: false, error: "Set a password of at least 6 characters." };
      }
      users.push({
        id: "u-" + Math.random().toString(36).slice(2, 10),
        name: String(input.name).trim(),
        email, role: input.role, storeIds, pass: hash(input.password),
      });
    }
    saveUsers();
    return { ok: true };
  }

  function deleteUser(id) {
    const user = users.find((u) => u.id === id);
    if (!user) return { ok: false, error: "That account no longer exists." };
    if (user.role === "admin" && adminCount() < 2) {
      return { ok: false, error: "You can't delete the only admin account." };
    }
    const me = currentUser();
    if (me && me.id === id) return { ok: false, error: "You can't delete the account you're signed in with." };
    users = users.filter((u) => u.id !== id);
    saveUsers();
    return { ok: true };
  }

  function adminCount() { return users.filter((u) => u.role === "admin").length; }

  /* Wipe accounts back to the seeded demo set (dashboard "reset demo data"). */
  function resetUsers() {
    try { localStorage.removeItem(USERS_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) {}
    loadUsers();
  }

  loadUsers();

  window.Auth = {
    ROLES, SEED_USERS,
    login, logout, currentUser, requireUser,
    roleOf, storeIdsFor, storesFor, canManage, can,
    listUsers, saveUser, deleteUser, resetUsers,
  };
})();
