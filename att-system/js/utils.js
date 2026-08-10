// ============================================================================
// Shared utilities
// ============================================================================
import { sb } from "./supabaseClient.js";

/* ---------------------------- Toasts ---------------------------------- */
export function toast(message, kind = "") {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    document.body.appendChild(stack);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* ---------------------------- Formatting -------------------------------- */
export function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}
export function fmtDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleString("en-PH", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export function fmtMoney(n) {
  const v = Number(n || 0);
  return "₱" + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
export function initials(name) {
  return String(name || "?").trim().split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();
}

export const STATUS_LABEL = {
  draft: "Draft", submitted: "Submitted", pending: "Pending",
  returned: "Returned", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled",
};
export function statusBadge(status) {
  const label = STATUS_LABEL[status] || status;
  return `<span class="badge badge-${status}">${label}</span>`;
}

/* ---------------------------- Auth guard -------------------------------- */
// Ensures a session exists and the profile row has one of `allowedRoles`.
// Redirects to index.html (or the role's proper home) otherwise.
// Returns { user, profile }.
export async function requireRole(allowedRoles) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  let { data: profile, error } = await sb
    .from("employees")
    .select("*, divisions(name, code)")
    .eq("id", session.user.id)
    .maybeSingle();

  // Self-heal: a session exists (so auth.uid() now resolves correctly) but
  // no profile row was found — most likely the signup trigger hasn't run
  // yet, or this account predates it. Create the row now rather than
  // bouncing the user back to the login screen.
  if (!error && !profile) {
    const meta = session.user.user_metadata || {};
    const { error: healErr } = await sb.from("employees").insert({
      id: session.user.id,
      employee_no: meta.employee_no || null,
      full_name: meta.full_name || session.user.email,
      email: session.user.email,
      role: "employee",
      status: "active",
    });
    if (!healErr) {
      ({ data: profile, error } = await sb
        .from("employees")
        .select("*, divisions(name, code)")
        .eq("id", session.user.id)
        .maybeSingle());
    }
  }

  if (error || !profile) {
    toast("We couldn't load your profile. Please sign in again.", "bad");
    await sb.auth.signOut();
    window.location.href = "index.html";
    return null;
  }
  if (profile.status !== "active") {
    toast("Your account is inactive. Contact your administrator.", "bad");
    await sb.auth.signOut();
    window.location.href = "index.html";
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    window.location.href = homeForRole(profile.role);
    return null;
  }
  return { user: session.user, profile };
}

export function homeForRole(role) {
  if (role === "admin") return "admin.html";
  if (role === "approver") return "approver.html";
  return "employee.html";
}

export async function signOut() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}

/* ---------------------------- Shell (sidebar/topbar) --------------------- */
// Renders the sidebar + mobile topbar into #shell-sidebar / #shell-topbar
// placeholders. `links` = [{href, icon, label, active}]
export function renderShell({ profile, brandSub, links }) {
  const sidebarHtml = `
    <div class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-mark">AT</div>
        <div class="brand-text"><strong>Authority to Travel</strong><span>${escapeHtml(brandSub)}</span></div>
      </div>
      <nav>
        ${links.map(l => `
          <a class="nav-link ${l.active ? "active" : ""}" href="${l.href}">
            <span class="ic">${l.icon}</span> ${escapeHtml(l.label)}
          </a>`).join("")}
      </nav>
      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="user-avatar">${initials(profile.full_name)}</div>
          <div class="user-meta">
            <strong title="${escapeHtml(profile.full_name)}">${escapeHtml(profile.full_name)}</strong>
            <span>${escapeHtml(profile.position || profile.role)}</span>
          </div>
        </div>
        <button class="btn-signout" id="btn-signout">Sign out</button>
      </div>
    </div>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
  `;
  const topbarHtml = `
    <div class="mobile-topbar">
      <button class="hamburger" id="btn-hamburger" aria-label="Open menu">☰</button>
      <strong>Authority to Travel</strong>
    </div>
  `;
  document.getElementById("shell-sidebar").innerHTML = sidebarHtml;
  document.getElementById("shell-topbar").innerHTML = topbarHtml;

  document.getElementById("btn-signout").addEventListener("click", signOut);
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  document.getElementById("btn-hamburger").addEventListener("click", () => {
    sidebar.classList.add("open");
    backdrop.classList.add("show");
  });
  backdrop.addEventListener("click", () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("show");
  });
}

/* ---------------------------- Modal helpers ------------------------------ */
export function openModal(id) { document.getElementById(id).classList.add("show"); }
export function closeModal(id) { document.getElementById(id).classList.remove("show"); }
export function wireModalDismiss(overlayId) {
  const overlay = document.getElementById(overlayId);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(overlayId); });
}

/* ---------------------------- Misc ---------------------------------------- */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }
