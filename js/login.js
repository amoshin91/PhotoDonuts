/* =============================================================================
   login.js — Sign-in page wiring for the staff dashboard.
   Thin: all of the actual role/session logic lives in auth.js.
   ============================================================================ */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // Only ever return to a page inside this app — never to an attacker-supplied
  // absolute URL sitting in ?next=.
  function safeNext() {
    const raw = new URLSearchParams(location.search).get("next") || "dashboard.html";
    const decoded = decodeURIComponent(raw);
    if (/^[a-z0-9._-]+\.html(\?[^#]*)?$/i.test(decoded)) return decoded;
    return "dashboard.html";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* Demo credential list. Reads the seed rather than hardcoding it twice, so
     editing SEED_USERS in auth.js keeps this panel honest. */
  function renderDemoAccounts() {
    const el = $("#demoAccounts");
    if (!el) return;
    el.innerHTML = Auth.SEED_USERS.map((u) => {
      const role = Auth.ROLES[u.role];
      const scope = role.scope === "all"
        ? "every store"
        : u.storeIds.length + (u.storeIds.length === 1 ? " store" : " stores");
      return `
        <li>
          <button type="button" class="auth__demo-fill" data-email="${escapeHtml(u.email)}" data-pass="${escapeHtml(u.password)}">
            <span class="auth__demo-role">${escapeHtml(role.label)}</span>
            <span class="auth__demo-email">${escapeHtml(u.email)}</span>
            <span class="auth__demo-scope">${escapeHtml(scope)}</span>
          </button>
        </li>`;
    }).join("");

    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-email]");
      if (!btn) return;
      $("#email").value = btn.dataset.email;
      $("#password").value = btn.dataset.pass;
      $("#password").focus();
    });
  }

  function init() {
    // Already signed in? Skip the form.
    if (Auth.currentUser()) { location.replace(safeNext()); return; }

    renderDemoAccounts();

    $("#loginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const err = $("#loginError");
      const res = Auth.login($("#email").value, $("#password").value);
      if (!res.ok) {
        err.hidden = false;
        err.textContent = res.error;
        $("#password").focus();
        $("#password").select();
        return;
      }
      err.hidden = true;
      location.href = safeNext();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
