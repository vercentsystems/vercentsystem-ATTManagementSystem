import { sb } from "./supabaseClient.js";
import { SIGNATURES_BUCKET } from "./config.js";
import {
  requireRole, renderShell, toast, fmtDate, escapeHtml,
  statusBadge, openModal, closeModal, wireModalDismiss, qs, qsa,
} from "./utils.js";

function legalBasisText(lb) {
  if (!lb) return "—";
  const parts = [];
  if (lb.deped_memo) parts.push("DepEd Memo");
  if (lb.deped_advisory) parts.push("DepEd Advisory");
  if (lb.invitation_letter) parts.push("Invitation Letter");
  if (lb.others) parts.push(`Others${lb.others_text ? ": " + lb.others_text : ""}`);
  return parts.length ? parts.join(" · ") : "—";
}
function fundSourceText(fs) {
  if (!fs) return "—";
  const parts = [];
  if (fs.local_funds) parts.push("Local Funds");
  if (fs.sub_aro) parts.push(`Sub-ARO${fs.sub_aro_no ? " No. " + fs.sub_aro_no : ""}`);
  if (fs.hrtd) parts.push("HRTD");
  if (fs.others) parts.push(`Others${fs.others_text ? ": " + fs.others_text : ""}`);
  return parts.length ? parts.join(" · ") : "—";
}

let PROFILE = null;
let DIVISIONS = [];
let TYPES = [];
let EMPLOYEES = [];
let LEVELS = [];
let APPROVERS = [];
let ALL_ORDERS = [];
let SIG_FILE = null;

const SECTIONS = [
  { id: "dashboard", icon: "📊", label: "Dashboard", title: "Dashboard", sub: "Overview of travel activity across the organization." },
  { id: "requests", icon: "🧾", label: "All Requests", title: "All Requests", sub: "Monitor every Authority to Travel request and its approval status." },
  { id: "divisions", icon: "🏢", label: "Divisions", title: "Divisions", sub: "Manage organizational divisions." },
  { id: "types", icon: "🗂", label: "Request Types", title: "Request Types", sub: "Manage travel request categories." },
  { id: "levels", icon: "🪜", label: "Approval Levels", title: "Approval Levels", sub: "Configure how many approvals a division/type requires, in order." },
  { id: "employees", icon: "👤", label: "Employees", title: "Employees", sub: "Manage employee profiles, divisions, and roles." },
  { id: "approvers", icon: "✍️", label: "Approvers", title: "Approvers & E-Signatures", sub: "Assign approvers per division/level and maintain their e-signatures." },
];

init();

async function init() {
  const auth = await requireRole(["admin"]);
  if (!auth) return;
  PROFILE = auth.profile;

  // Admins who are ALSO assigned as an approver (a row in `approvers` with
  // their employee_id) get a shortcut into the Approvals dashboard — that
  // page's own access check (requireRole(["approver","admin"])) already
  // allows admins in, this just surfaces the link.
  const { count: approverAssignments } = await sb
    .from("approvers")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", PROFILE.id)
    .eq("status", "active");

  const navLinks = SECTIONS.map((s, i) => ({ href: `#${s.id}`, icon: s.icon, label: s.label, active: i === 0 }));
  if (approverAssignments > 0) {
    navLinks.push({ href: "approver.html", icon: "✅", label: "My Approvals", active: false });
  }

  renderShell({
    profile: PROFILE,
    brandSub: "Administrator",
    links: navLinks,
  });
  wireNav();
  wireModals();

  await Promise.all([loadDivisions(), loadTypes(), loadEmployees()]);
  await loadLevels();
  await loadApprovers();
  await loadAllOrders();
  renderDashboard();
}

/* ------------------------------- Navigation ------------------------------ */
function wireNav() {
  qsa("#sidebar .nav-link").forEach(link => {
    const href = link.getAttribute("href");
    if (!href.startsWith("#")) return; // real page link (e.g. approver.html) — let it navigate normally
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const id = href.replace("#", "");
      showSection(id);
      qsa("#sidebar .nav-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      document.getElementById("sidebar").classList.remove("open");
      document.getElementById("sidebar-backdrop").classList.remove("show");
    });
  });
}
function showSection(id) {
  SECTIONS.forEach(s => { document.getElementById(`sec-${s.id}`).style.display = s.id === id ? "block" : "none"; });
  const meta = SECTIONS.find(s => s.id === id);
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-sub").textContent = meta.sub;
}

function wireModals() {
  ["overlay-simple", "overlay-employee", "overlay-approver", "overlay-request"].forEach(wireModalDismiss);
  document.getElementById("simple-close").addEventListener("click", () => closeModal("overlay-simple"));
  document.getElementById("simple-cancel").addEventListener("click", () => closeModal("overlay-simple"));
  document.getElementById("employee-close").addEventListener("click", () => closeModal("overlay-employee"));
  document.getElementById("employee-cancel").addEventListener("click", () => closeModal("overlay-employee"));
  document.getElementById("approver-close").addEventListener("click", () => closeModal("overlay-approver"));
  document.getElementById("approver-cancel").addEventListener("click", () => closeModal("overlay-approver"));
  document.getElementById("rq-close").addEventListener("click", () => closeModal("overlay-request"));

  document.getElementById("btn-add-division").addEventListener("click", () => openDivisionForm());
  document.getElementById("btn-add-type").addEventListener("click", () => openTypeForm());
  document.getElementById("btn-add-level").addEventListener("click", () => openLevelForm());
  document.getElementById("btn-add-approver").addEventListener("click", () => openApproverForm());
  document.getElementById("employee-save").addEventListener("click", saveEmployee);
  document.getElementById("approver-save").addEventListener("click", saveApprover);
  document.getElementById("ap-sig-file").addEventListener("change", previewSigFile);
  document.getElementById("rq-filter-status").addEventListener("change", renderAllOrders);
  document.getElementById("rq-filter-division").addEventListener("change", renderAllOrders);
}

/* =========================================================================
   DASHBOARD
   ========================================================================= */
function renderDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const active = ALL_ORDERS.filter(o => o.status === "approved" && o.travel_date_from <= today && o.travel_date_to >= today).length;
  const upcoming = ALL_ORDERS.filter(o => o.status === "approved" && o.travel_date_from > today).length;
  const pending = ALL_ORDERS.filter(o => ["submitted", "pending"].includes(o.status)).length;
  const approved = ALL_ORDERS.filter(o => o.status === "approved").length;
  const rejected = ALL_ORDERS.filter(o => o.status === "rejected").length;

  document.getElementById("d-active").textContent = active;
  document.getElementById("d-upcoming").textContent = upcoming;
  document.getElementById("d-pending").textContent = pending;
  document.getElementById("d-approved").textContent = approved;
  document.getElementById("d-rejected").textContent = rejected;

  const byDiv = {};
  ALL_ORDERS.filter(o => ["submitted", "pending"].includes(o.status)).forEach(o => {
    const name = DIVISIONS.find(d => d.id === o.division_id)?.name || "Unassigned";
    byDiv[name] = (byDiv[name] || 0) + 1;
  });
  const divRows = Object.entries(byDiv).sort((a, b) => b[1] - a[1]);
  qs("#tbl-div-pending tbody").innerHTML = divRows.length
    ? divRows.map(([name, n]) => `<tr><td data-label="Division">${escapeHtml(name)}</td><td data-label="Pending">${n}</td></tr>`).join("")
    : `<tr class="empty-row"><td colspan="2">No pending requests.</td></tr>`;

  loadApproverActivitySummary();
}

async function loadApproverActivitySummary() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data, error } = await sb
    .from("approval_history")
    .select("approver_name_snapshot, action")
    .gte("action_date", since);
  const tbody = qs("#tbl-approver-activity tbody");
  if (error || !data || !data.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">No recent approver activity.</td></tr>`;
    return;
  }
  const byApprover = {};
  data.forEach(h => {
    byApprover[h.approver_name_snapshot] ??= { approved: 0, rejected: 0, returned: 0 };
    if (byApprover[h.approver_name_snapshot][h.action] !== undefined) byApprover[h.approver_name_snapshot][h.action]++;
  });
  tbody.innerHTML = Object.entries(byApprover).map(([name, c]) => `
    <tr><td data-label="Approver">${escapeHtml(name)}</td><td data-label="Approved">${c.approved}</td>
      <td data-label="Rejected">${c.rejected}</td><td data-label="Returned">${c.returned}</td></tr>
  `).join("");
}

/* =========================================================================
   ALL REQUESTS (monitor)
   ========================================================================= */
async function loadAllOrders() {
  const { data, error } = await sb
    .from("travel_orders")
    .select("*, employees(full_name), divisions(name)")
    .order("created_at", { ascending: false });
  if (error) { toast("Failed to load requests: " + error.message, "bad"); return; }
  ALL_ORDERS = data || [];

  const divSel = document.getElementById("rq-filter-division");
  divSel.innerHTML = `<option value="">All divisions</option>` + DIVISIONS.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");

  renderAllOrders();
}

function renderAllOrders() {
  const status = document.getElementById("rq-filter-status").value;
  const division = document.getElementById("rq-filter-division").value;
  const rows = ALL_ORDERS.filter(o => (!status || o.status === status) && (!division || o.division_id === division));
  const tbody = qs("#tbl-all-requests tbody");

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No matching requests.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(o => `
    <tr>
      <td data-label="Control No.">${o.control_no || "<span class='muted'>Draft</span>"}</td>
      <td data-label="Employee">${escapeHtml(o.employees?.full_name || "—")}</td>
      <td data-label="Division">${escapeHtml(o.divisions?.name || "—")}</td>
      <td data-label="Destination">${escapeHtml(o.destination)}</td>
      <td data-label="Dates">${fmtDate(o.travel_date_from)} – ${fmtDate(o.travel_date_to)}</td>
      <td data-label="Status">${statusBadge(o.status)}</td>
      <td data-label="Level">${o.status === "approved" ? "Complete" : (o.current_level ? `L${o.current_level}/${o.max_level}` : "—")}</td>
      <td data-label="Actions" class="actions">
        <button class="btn btn-ghost btn-sm" data-view="${o.id}">View</button>
        ${o.status === "approved" ? `<a class="btn btn-gold btn-sm" href="report.html?id=${o.id}" target="_blank">Print</a>` : ""}
      </td>
    </tr>
  `).join("");
  qsa("[data-view]", tbody).forEach(b => b.addEventListener("click", () => viewRequest(b.dataset.view)));
}

async function viewRequest(id) {
  openModal("overlay-request");
  const body = document.getElementById("rq-body");
  const foot = document.getElementById("rq-foot");
  body.innerHTML = "Loading…"; foot.innerHTML = "";
  const o = ALL_ORDERS.find(x => x.id === id);
  if (!o) { body.innerHTML = "Not found."; return; }
  document.getElementById("rq-title").textContent = o.control_no || "Draft Request";

  const { data: history } = await sb.from("approval_history").select("*").eq("travel_order_id", id).order("action_date");

  body.innerHTML = `
    <div class="form-grid">
      <div class="field"><label>Employee</label><div>${escapeHtml(o.employees?.full_name || "—")}</div></div>
      <div class="field"><label>Division</label><div>${escapeHtml(o.divisions?.name || "—")}</div></div>
      <div class="field"><label>Status</label><div>${statusBadge(o.status)}</div></div>
      <div class="field"><label>Filing Date</label><div>${fmtDate(o.filing_date)}</div></div>
      <div class="field full"><label>Destination</label><div>${escapeHtml(o.destination)}</div></div>
      <div class="field"><label>Travel Dates</label><div>${fmtDate(o.travel_date_from)} – ${fmtDate(o.travel_date_to)}</div></div>
      <div class="field full"><label>Purpose</label><div>${escapeHtml(o.purpose)}</div></div>
      <div class="field full"><label>Expenses Covered</label><div>${escapeHtml(o.expenses_covered || "—")}</div></div>
      <div class="field full"><label>Legal Basis</label><div>${legalBasisText(o.legal_basis)}</div></div>
      <div class="field full"><label>Fund Source</label><div>${fundSourceText(o.fund_source)}</div></div>
    </div>
    <h4 style="margin-top:14px">Approval History</h4>
    ${(history && history.length) ? `<ul class="timeline">${history.map(h => `
      <li><div class="tl-dot ${h.action}">${h.action === "approved" ? "✓" : h.action === "rejected" ? "✕" : "↺"}</div>
        <div class="tl-body"><strong>${escapeHtml(h.approver_name_snapshot)} — ${escapeHtml(h.approver_position_snapshot)}</strong>
        <div class="meta">Level ${h.level_no} · ${h.action.toUpperCase()} · ${fmtDate(h.action_date)}</div>
        ${h.remarks ? `<div class="remarks">${escapeHtml(h.remarks)}</div>` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">No approval activity yet.</p>`}
  `;
  foot.innerHTML = o.status === "approved" ? `<a class="btn btn-gold" href="report.html?id=${o.id}" target="_blank">View / Print Official Report</a>` : "";
}

/* =========================================================================
   DIVISIONS
   ========================================================================= */
async function loadDivisions() {
  const { data, error } = await sb.from("divisions").select("*").order("name");
  if (error) { toast("Failed to load divisions: " + error.message, "bad"); return; }
  DIVISIONS = data || [];
  renderDivisions();
  fillDivisionSelects();
}
function renderDivisions() {
  const tbody = qs("#tbl-divisions tbody");
  tbody.innerHTML = DIVISIONS.length ? DIVISIONS.map(d => `
    <tr>
      <td data-label="Code">${escapeHtml(d.code)}</td>
      <td data-label="Name">${escapeHtml(d.name)}</td>
      <td data-label="Status">${d.status === "active" ? "<span class='badge badge-approved'>Active</span>" : "<span class='badge badge-cancelled'>Inactive</span>"}</td>
      <td data-label="Actions" class="actions"><button class="btn btn-ghost btn-sm" data-edit="${d.id}">Edit</button></td>
    </tr>`).join("") : `<tr class="empty-row"><td colspan="4">No divisions yet.</td></tr>`;
  qsa("[data-edit]", tbody).forEach(b => b.addEventListener("click", () => openDivisionForm(b.dataset.edit)));
}
function fillDivisionSelects() {
  const opts = DIVISIONS.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
  const emDiv = document.getElementById("em-division"); if (emDiv) emDiv.innerHTML = opts;
  const apDiv = document.getElementById("ap-division"); if (apDiv) apDiv.innerHTML = opts;
}

function openDivisionForm(id) {
  const d = DIVISIONS.find(x => x.id === id);
  document.getElementById("simple-title").textContent = d ? "Edit Division" : "Add Division";
  document.getElementById("simple-body").innerHTML = `
    <input type="hidden" id="sv-id" value="${d?.id || ""}">
    <div class="field" style="margin-bottom:12px"><label>Code</label><input type="text" id="sv-code" value="${escapeHtml(d?.code || "")}" placeholder="e.g. FIN"></div>
    <div class="field" style="margin-bottom:12px"><label>Name</label><input type="text" id="sv-name" value="${escapeHtml(d?.name || "")}" placeholder="e.g. Finance Division"></div>
    <div class="field"><label>Status</label>
      <select id="sv-status"><option value="active" ${(!d || d.status === "active") ? "selected" : ""}>Active</option><option value="inactive" ${d?.status === "inactive" ? "selected" : ""}>Inactive</option></select>
    </div>`;
  bindSimpleSave(async () => {
    const payload = {
      code: document.getElementById("sv-code").value.trim(),
      name: document.getElementById("sv-name").value.trim(),
      status: document.getElementById("sv-status").value,
    };
    if (!payload.code || !payload.name) throw new Error("Code and name are required.");
    const id2 = document.getElementById("sv-id").value;
    if (id2) { const { error } = await sb.from("divisions").update(payload).eq("id", id2); if (error) throw error; }
    else { const { error } = await sb.from("divisions").insert(payload); if (error) throw error; }
    await loadDivisions();
    await loadLevels(); await loadApprovers(); await loadAllOrders(); renderDashboard();
  });
  openModal("overlay-simple");
}

/* =========================================================================
   REQUEST TYPES
   ========================================================================= */
async function loadTypes() {
  const { data, error } = await sb.from("request_types").select("*").order("name");
  if (error) { toast("Failed to load request types: " + error.message, "bad"); return; }
  TYPES = data || [];
  renderTypes();
  fillTypeSelects();
}
function renderTypes() {
  const tbody = qs("#tbl-types tbody");
  tbody.innerHTML = TYPES.length ? TYPES.map(t => `
    <tr>
      <td data-label="Code">${escapeHtml(t.code)}</td>
      <td data-label="Name">${escapeHtml(t.name)}</td>
      <td data-label="Status">${t.status === "active" ? "<span class='badge badge-approved'>Active</span>" : "<span class='badge badge-cancelled'>Inactive</span>"}</td>
      <td data-label="Actions" class="actions"><button class="btn btn-ghost btn-sm" data-edit="${t.id}">Edit</button></td>
    </tr>`).join("") : `<tr class="empty-row"><td colspan="4">No request types yet.</td></tr>`;
  qsa("[data-edit]", tbody).forEach(b => b.addEventListener("click", () => openTypeForm(b.dataset.edit)));
}
function fillTypeSelects() {
  const opts = `<option value="">All types</option>` + TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  const lvType = document.getElementById("lv-type"); if (lvType) lvType.innerHTML = opts;
  const apType = document.getElementById("ap-type"); if (apType) apType.innerHTML = opts;
}

function openTypeForm(id) {
  const t = TYPES.find(x => x.id === id);
  document.getElementById("simple-title").textContent = t ? "Edit Request Type" : "Add Request Type";
  document.getElementById("simple-body").innerHTML = `
    <input type="hidden" id="sv-id" value="${t?.id || ""}">
    <div class="field" style="margin-bottom:12px"><label>Code</label><input type="text" id="sv-code" value="${escapeHtml(t?.code || "")}" placeholder="e.g. LOCAL"></div>
    <div class="field" style="margin-bottom:12px"><label>Name</label><input type="text" id="sv-name" value="${escapeHtml(t?.name || "")}" placeholder="e.g. Local Travel"></div>
    <div class="field"><label>Status</label>
      <select id="sv-status"><option value="active" ${(!t || t.status === "active") ? "selected" : ""}>Active</option><option value="inactive" ${t?.status === "inactive" ? "selected" : ""}>Inactive</option></select>
    </div>`;
  bindSimpleSave(async () => {
    const payload = {
      code: document.getElementById("sv-code").value.trim(),
      name: document.getElementById("sv-name").value.trim(),
      status: document.getElementById("sv-status").value,
    };
    if (!payload.code || !payload.name) throw new Error("Code and name are required.");
    const id2 = document.getElementById("sv-id").value;
    if (id2) { const { error } = await sb.from("request_types").update(payload).eq("id", id2); if (error) throw error; }
    else { const { error } = await sb.from("request_types").insert(payload); if (error) throw error; }
    await loadTypes();
  });
  openModal("overlay-simple");
}

/* =========================================================================
   APPROVAL LEVELS
   ========================================================================= */
async function loadLevels() {
  const { data, error } = await sb.from("approval_levels").select("*, divisions(name), request_types(name)").order("division_id").order("level_no");
  if (error) { toast("Failed to load approval levels: " + error.message, "bad"); return; }
  LEVELS = data || [];
  renderLevels();
}
function renderLevels() {
  const tbody = qs("#tbl-levels tbody");
  tbody.innerHTML = LEVELS.length ? LEVELS.map(l => `
    <tr>
      <td data-label="Division">${escapeHtml(l.divisions?.name || "—")}</td>
      <td data-label="Request Type">${escapeHtml(l.request_types?.name || "All types")}</td>
      <td data-label="Level">${l.level_no}</td>
      <td data-label="Label">${escapeHtml(l.label)}</td>
      <td data-label="Effective">${fmtDate(l.effective_date)}</td>
      <td data-label="Status">${l.status === "active" ? "<span class='badge badge-approved'>Active</span>" : "<span class='badge badge-cancelled'>Inactive</span>"}</td>
      <td data-label="Actions" class="actions"><button class="btn btn-ghost btn-sm" data-edit="${l.id}">Edit</button></td>
    </tr>`).join("") : `<tr class="empty-row"><td colspan="7">No approval levels configured yet.</td></tr>`;
  qsa("[data-edit]", tbody).forEach(b => b.addEventListener("click", () => openLevelForm(b.dataset.edit)));
}

function openLevelForm(id) {
  const l = LEVELS.find(x => x.id === id);
  document.getElementById("simple-title").textContent = l ? "Edit Approval Level" : "Add Approval Level";
  document.getElementById("simple-body").innerHTML = `
    <input type="hidden" id="sv-id" value="${l?.id || ""}">
    <div class="field" style="margin-bottom:12px"><label>Division</label><select id="lv-division">${DIVISIONS.map(d => `<option value="${d.id}" ${l?.division_id === d.id ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}</select></div>
    <div class="field" style="margin-bottom:12px"><label>Request Type</label><select id="lv-type"></select></div>
    <div class="field" style="margin-bottom:12px"><label>Level No.</label><input type="number" id="sv-level" min="1" value="${l?.level_no || 1}"></div>
    <div class="field" style="margin-bottom:12px"><label>Label</label><input type="text" id="sv-label" value="${escapeHtml(l?.label || "")}" placeholder="e.g. Division Chief"></div>
    <div class="field" style="margin-bottom:12px"><label>Effective Date</label><input type="date" id="sv-effective" value="${l?.effective_date || new Date().toISOString().slice(0, 10)}"></div>
    <div class="field"><label>Status</label>
      <select id="sv-status"><option value="active" ${(!l || l.status === "active") ? "selected" : ""}>Active</option><option value="inactive" ${l?.status === "inactive" ? "selected" : ""}>Inactive</option></select>
    </div>`;
  fillTypeSelects();
  if (l?.request_type_id) document.getElementById("lv-type").value = l.request_type_id;

  bindSimpleSave(async () => {
    const payload = {
      division_id: document.getElementById("lv-division").value,
      request_type_id: document.getElementById("lv-type").value || null,
      level_no: parseInt(document.getElementById("sv-level").value, 10),
      label: document.getElementById("sv-label").value.trim(),
      effective_date: document.getElementById("sv-effective").value,
      status: document.getElementById("sv-status").value,
    };
    if (!payload.division_id || !payload.level_no || !payload.label) throw new Error("Division, level number, and label are required.");
    const id2 = document.getElementById("sv-id").value;
    if (id2) { const { error } = await sb.from("approval_levels").update(payload).eq("id", id2); if (error) throw error; }
    else { const { error } = await sb.from("approval_levels").insert(payload); if (error) throw error; }
    await loadLevels();
  });
  openModal("overlay-simple");
}

function bindSimpleSave(handler) {
  const btn = document.getElementById("simple-save");
  const clone = btn.cloneNode(true); // clear previous listeners
  btn.parentNode.replaceChild(clone, btn);
  clone.addEventListener("click", async () => {
    clone.disabled = true;
    try {
      await handler();
      closeModal("overlay-simple");
      toast("Saved.", "ok");
    } catch (err) {
      toast("Save failed: " + err.message, "bad");
    } finally {
      clone.disabled = false;
    }
  });
}

/* =========================================================================
   EMPLOYEES
   ========================================================================= */
async function loadEmployees() {
  const { data, error } = await sb.from("employees").select("*, divisions(name)").order("full_name");
  if (error) { toast("Failed to load employees: " + error.message, "bad"); return; }
  EMPLOYEES = data || [];
  renderEmployees();
  fillEmployeeSelect();
}
function renderEmployees() {
  const tbody = qs("#tbl-employees tbody");
  tbody.innerHTML = EMPLOYEES.length ? EMPLOYEES.map(e => `
    <tr>
      <td data-label="Name">${escapeHtml(e.full_name)}</td>
      <td data-label="Employee No.">${escapeHtml(e.employee_no || "—")}</td>
      <td data-label="Division">${escapeHtml(e.divisions?.name || "Unassigned")}</td>
      <td data-label="Role">${escapeHtml(e.role)}</td>
      <td data-label="Status">${e.status === "active" ? "<span class='badge badge-approved'>Active</span>" : "<span class='badge badge-cancelled'>Inactive</span>"}</td>
      <td data-label="Actions" class="actions"><button class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button></td>
    </tr>`).join("") : `<tr class="empty-row"><td colspan="6">No employees yet.</td></tr>`;
  qsa("[data-edit]", tbody).forEach(b => b.addEventListener("click", () => openEmployeeForm(b.dataset.edit)));
}
function fillEmployeeSelect() {
  const sel = document.getElementById("ap-employee");
  if (sel) sel.innerHTML = EMPLOYEES.map(e => `<option value="${e.id}">${escapeHtml(e.full_name)} — ${escapeHtml(e.position || e.role)}</option>`).join("");
}

function openEmployeeForm(id) {
  const e = EMPLOYEES.find(x => x.id === id);
  if (!e) return;
  document.getElementById("em-id").value = e.id;
  document.getElementById("em-name").value = e.full_name;
  document.getElementById("em-empno").value = e.employee_no || "";
  document.getElementById("em-position").value = e.position || "";
  document.getElementById("em-station").value = e.official_station || "";
  document.getElementById("em-division").value = e.division_id || "";
  document.getElementById("em-role").value = e.role;
  document.getElementById("em-status").value = e.status;
  openModal("overlay-employee");
}

async function saveEmployee() {
  const id = document.getElementById("em-id").value;
  const payload = {
    employee_no: document.getElementById("em-empno").value.trim() || null,
    position: document.getElementById("em-position").value.trim(),
    official_station: document.getElementById("em-station").value.trim(),
    division_id: document.getElementById("em-division").value || null,
    role: document.getElementById("em-role").value,
    status: document.getElementById("em-status").value,
  };
  const btn = document.getElementById("employee-save");
  btn.disabled = true;
  const { error } = await sb.from("employees").update(payload).eq("id", id);
  btn.disabled = false;
  if (error) { toast("Save failed: " + error.message, "bad"); return; }
  toast("Employee updated.", "ok");
  closeModal("overlay-employee");
  await loadEmployees();
}

/* =========================================================================
   APPROVERS + E-SIGNATURES
   ========================================================================= */
async function loadApprovers() {
  const { data, error } = await sb.from("approvers").select("*, employees(full_name), divisions(name), request_types(name)").order("division_id").order("level_no");
  if (error) { toast("Failed to load approvers: " + error.message, "bad"); return; }
  APPROVERS = data || [];
  renderApprovers();
}
function renderApprovers() {
  const tbody = qs("#tbl-approvers tbody");
  tbody.innerHTML = APPROVERS.length ? APPROVERS.map(a => `
    <tr>
      <td data-label="Approver">${escapeHtml(a.employees?.full_name || "—")}</td>
      <td data-label="Division">${escapeHtml(a.divisions?.name || "—")}</td>
      <td data-label="Type">${escapeHtml(a.request_types?.name || "All types")}</td>
      <td data-label="Level">${a.level_no}</td>
      <td data-label="Position">${escapeHtml(a.position_title || "—")}</td>
      <td data-label="Signature">${a.signature_url ? `<img src="${a.signature_url}" alt="signature" style="height:26px">` : "<span class='muted'>None</span>"}</td>
      <td data-label="Status">${a.status === "active" ? "<span class='badge badge-approved'>Active</span>" : "<span class='badge badge-cancelled'>Inactive</span>"}</td>
      <td data-label="Actions" class="actions"><button class="btn btn-ghost btn-sm" data-edit="${a.id}">Edit</button></td>
    </tr>`).join("") : `<tr class="empty-row"><td colspan="8">No approvers assigned yet.</td></tr>`;
  qsa("[data-edit]", tbody).forEach(b => b.addEventListener("click", () => openApproverForm(b.dataset.edit)));
}

function openApproverForm(id) {
  const a = APPROVERS.find(x => x.id === id);
  document.getElementById("approver-title").textContent = a ? "Edit Approver Assignment" : "Assign Approver";
  document.getElementById("ap-id").value = a?.id || "";
  fillEmployeeSelect();
  fillDivisionSelects();
  fillTypeSelects();
  document.getElementById("ap-employee").value = a?.employee_id || "";
  document.getElementById("ap-division").value = a?.division_id || "";
  document.getElementById("ap-type").value = a?.request_type_id || "";
  document.getElementById("ap-level").value = a?.level_no || 1;
  document.getElementById("ap-position").value = a?.position_title || "";
  document.getElementById("ap-effective").value = a?.effective_date || new Date().toISOString().slice(0, 10);
  document.getElementById("ap-status").value = a?.status || "active";

  SIG_FILE = null;
  document.getElementById("ap-sig-file").value = "";
  const preview = document.getElementById("ap-sig-preview");
  if (a?.signature_url) { preview.className = "sig-preview"; preview.innerHTML = `<img src="${a.signature_url}" alt="signature">`; }
  else { preview.className = "sig-preview empty"; preview.textContent = "No signature uploaded"; }

  openModal("overlay-approver");
}

function previewSigFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  SIG_FILE = file;
  const preview = document.getElementById("ap-sig-preview");
  preview.className = "sig-preview";
  preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="signature preview">`;
}

async function saveApprover() {
  const id = document.getElementById("ap-id").value;
  const payload = {
    employee_id: document.getElementById("ap-employee").value,
    division_id: document.getElementById("ap-division").value,
    request_type_id: document.getElementById("ap-type").value || null,
    level_no: parseInt(document.getElementById("ap-level").value, 10),
    position_title: document.getElementById("ap-position").value.trim(),
    effective_date: document.getElementById("ap-effective").value,
    status: document.getElementById("ap-status").value,
  };
  if (!payload.employee_id || !payload.division_id || !payload.level_no) {
    toast("Employee, division, and level number are required.", "bad");
    return;
  }

  const btn = document.getElementById("approver-save");
  btn.disabled = true;
  try {
    if (SIG_FILE) {
      const path = `${payload.employee_id}/${Date.now()}-${SIG_FILE.name.replace(/\s+/g, "_")}`;
      const { error: upErr } = await sb.storage.from(SIGNATURES_BUCKET).upload(path, SIG_FILE, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from(SIGNATURES_BUCKET).getPublicUrl(path);
      payload.signature_url = pub.publicUrl;
    }

    if (id) {
      const { error } = await sb.from("approvers").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await sb.from("approvers").insert(payload);
      if (error) throw error;
    }
    toast("Approver saved.", "ok");
    closeModal("overlay-approver");
    await loadApprovers();
  } catch (err) {
    toast("Save failed: " + err.message, "bad");
  } finally {
    btn.disabled = false;
  }
}

// default to dashboard section on load
showSection("dashboard");
