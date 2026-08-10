import { sb } from "./supabaseClient.js";
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
let REQUEST_TYPES = [];
let ORDERS = [];

init();

async function init() {
  const auth = await requireRole(["employee", "approver", "admin"]);
  if (!auth) return;
  PROFILE = auth.profile;

  renderShell({
    profile: PROFILE,
    brandSub: "Employee",
    links: [
      { href: "employee.html", icon: "🧾", label: "My Requests", active: true },
    ],
  });

  wireModalDismiss("overlay-form");
  wireModalDismiss("overlay-detail");
  document.getElementById("form-close").addEventListener("click", () => closeModal("overlay-form"));
  document.getElementById("btn-cancel").addEventListener("click", () => closeModal("overlay-form"));
  document.getElementById("detail-close").addEventListener("click", () => closeModal("overlay-detail"));
  document.getElementById("btn-new").addEventListener("click", openNewForm);
  document.getElementById("btn-add-companion").addEventListener("click", () => addCompanionRow());
  document.getElementById("btn-save-draft").addEventListener("click", () => saveRequest("draft"));
  document.getElementById("btn-submit-req").addEventListener("click", () => saveRequest("submitted"));
  document.getElementById("filter-status").addEventListener("change", renderTable);

  await loadRequestTypes();
  await loadOrders();
}

async function loadRequestTypes() {
  const { data } = await sb.from("request_types").select("*").eq("status", "active").order("name");
  REQUEST_TYPES = data || [];
  const sel = document.getElementById("f-request-type");
  sel.innerHTML = REQUEST_TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
}

async function loadOrders() {
  const { data, error } = await sb
    .from("travel_orders")
    .select("*")
    .eq("employee_id", PROFILE.id)
    .order("created_at", { ascending: false });

  if (error) { toast("Failed to load requests: " + error.message, "bad"); return; }
  ORDERS = data || [];
  renderStats();
  renderTable();
}

function renderStats() {
  const count = (pred) => ORDERS.filter(pred).length;
  document.getElementById("st-draft").textContent = count(o => o.status === "draft");
  document.getElementById("st-pending").textContent = count(o => ["submitted", "pending"].includes(o.status));
  document.getElementById("st-approved").textContent = count(o => o.status === "approved");
  document.getElementById("st-rejected").textContent = count(o => ["rejected", "returned"].includes(o.status));
}

function renderTable() {
  const filter = document.getElementById("filter-status").value;
  const rows = ORDERS.filter(o => !filter || o.status === filter);
  const tbody = qs("#tbl-requests tbody");

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No requests yet. Click “+ New Request” to file one.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(o => `
    <tr>
      <td data-label="Control No.">${o.control_no || "<span class='muted'>Draft</span>"}</td>
      <td data-label="Filed">${fmtDate(o.filing_date)}</td>
      <td data-label="Destination">${escapeHtml(o.destination)}</td>
      <td data-label="Travel Dates">${fmtDate(o.travel_date_from)} – ${fmtDate(o.travel_date_to)}</td>
      <td data-label="Status">${statusBadge(o.status)}</td>
      <td data-label="Level">${o.status === "approved" ? "Complete" : (o.current_level ? `Level ${o.current_level} of ${o.max_level}` : "—")}</td>
      <td data-label="Actions" class="actions">
        <button class="btn btn-ghost btn-sm" data-view="${o.id}">View</button>
        ${["draft", "returned"].includes(o.status) ? `<button class="btn btn-primary btn-sm" data-edit="${o.id}">Edit</button>` : ""}
        ${o.status === "approved" ? `<a class="btn btn-gold btn-sm" href="report.html?id=${o.id}" target="_blank">Print</a>` : ""}
      </td>
    </tr>
  `).join("");

  qsa("[data-view]", tbody).forEach(b => b.addEventListener("click", () => viewDetail(b.dataset.view)));
  qsa("[data-edit]", tbody).forEach(b => b.addEventListener("click", () => openEditForm(b.dataset.edit)));
}

/* ------------------------------- Form -------------------------------- */
function resetForm() {
  document.getElementById("att-form").reset();
  document.getElementById("f-id").value = "";
  document.getElementById("f-filing-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("f-employee-name").value = PROFILE.full_name;
  document.getElementById("f-position").value = PROFILE.position || "";
  document.getElementById("f-station").value = PROFILE.official_station || "";
  document.getElementById("f-companions").innerHTML = "";
  document.querySelector('input[name="f-travel-on"][value="official_business"]').checked = true;
}

function openNewForm() {
  resetForm();
  document.getElementById("form-title").textContent = "New Authority to Travel Request";
  openModal("overlay-form");
}

function openEditForm(id) {
  const o = ORDERS.find(x => x.id === id);
  if (!o) return;
  resetForm();
  document.getElementById("form-title").textContent = "Edit Authority to Travel Request";
  document.getElementById("f-id").value = o.id;
  document.getElementById("f-filing-date").value = o.filing_date;
  document.getElementById("f-position").value = o.position;
  document.getElementById("f-station").value = o.official_station;
  document.getElementById("f-destination").value = o.destination;
  document.getElementById("f-date-from").value = o.travel_date_from;
  document.getElementById("f-date-to").value = o.travel_date_to;
  document.getElementById("f-purpose").value = o.purpose;
  document.getElementById("f-activity").value = o.activity_sponsor || "";
  document.getElementById("f-request-type").value = o.request_type_id || "";

  document.querySelector(`input[name="f-travel-on"][value="${o.travel_on || "official_business"}"]`).checked = true;

  const lb = o.legal_basis || {};
  document.getElementById("f-lb-memo").checked = !!lb.deped_memo;
  document.getElementById("f-lb-advisory").checked = !!lb.deped_advisory;
  document.getElementById("f-lb-invitation").checked = !!lb.invitation_letter;
  document.getElementById("f-lb-others").checked = !!lb.others;
  document.getElementById("f-lb-others-text").value = lb.others_text || "";

  document.getElementById("f-expenses-covered").value = o.expenses_covered || "";

  const fs = o.fund_source || {};
  document.getElementById("f-fs-local").checked = !!fs.local_funds;
  document.getElementById("f-fs-subaro").checked = !!fs.sub_aro;
  document.getElementById("f-fs-subaro-text").value = fs.sub_aro_no || "";
  document.getElementById("f-fs-hrtd").checked = !!fs.hrtd;
  document.getElementById("f-fs-others").checked = !!fs.others;
  document.getElementById("f-fs-others-text").value = fs.others_text || "";

  document.getElementById("f-gov-vehicle").checked = !!o.with_government_vehicle;
  document.getElementById("f-reg-fee").checked = !!o.with_registration_fee;

  document.getElementById("f-companions").innerHTML = "";
  (o.companions || []).forEach(c => addCompanionRow(c.name, c.position));

  openModal("overlay-form");
}

function addCompanionRow(name = "", position = "") {
  const wrap = document.getElementById("f-companions");
  if (wrap.children.length >= 2) { toast("The official form provides space for up to 2 companions.", "bad"); return; }
  const row = document.createElement("div");
  row.className = "repeat-row";
  row.innerHTML = `
    <input type="text" placeholder="Companion name" class="comp-name" value="${escapeHtml(name)}">
    <input type="text" placeholder="Position/Designation" class="comp-position" value="${escapeHtml(position)}">
    <button type="button" class="del" title="Remove">&times;</button>
  `;
  row.querySelector(".del").addEventListener("click", () => row.remove());
  wrap.appendChild(row);
}

function collectCompanions() {
  return qsa("#f-companions .repeat-row").map(r => ({
    name: r.querySelector(".comp-name").value.trim(),
    position: r.querySelector(".comp-position").value.trim(),
  })).filter(c => c.name);
}

function validateForm() {
  const required = ["f-filing-date", "f-position", "f-station", "f-destination", "f-date-from", "f-date-to", "f-purpose"];
  for (const id of required) {
    const el = document.getElementById(id);
    if (!el.value) { el.focus(); toast("Please complete all required fields.", "bad"); return false; }
  }
  if (document.getElementById("f-date-to").value < document.getElementById("f-date-from").value) {
    toast("Travel end date cannot be before the start date.", "bad");
    return false;
  }
  return true;
}

async function saveRequest(targetStatus) {
  if (!validateForm()) return;

  const id = document.getElementById("f-id").value || null;

  const payload = {
    employee_id: PROFILE.id,
    division_id: PROFILE.division_id,
    request_type_id: document.getElementById("f-request-type").value || null,
    filing_date: document.getElementById("f-filing-date").value,
    position: document.getElementById("f-position").value.trim(),
    official_station: document.getElementById("f-station").value.trim(),
    destination: document.getElementById("f-destination").value.trim(),
    travel_date_from: document.getElementById("f-date-from").value,
    travel_date_to: document.getElementById("f-date-to").value,
    purpose: document.getElementById("f-purpose").value.trim(),
    activity_sponsor: document.getElementById("f-activity").value.trim(),
    companions: collectCompanions(),
    travel_on: document.querySelector('input[name="f-travel-on"]:checked').value,
    legal_basis: {
      deped_memo: document.getElementById("f-lb-memo").checked,
      deped_advisory: document.getElementById("f-lb-advisory").checked,
      invitation_letter: document.getElementById("f-lb-invitation").checked,
      others: document.getElementById("f-lb-others").checked,
      others_text: document.getElementById("f-lb-others-text").value.trim(),
    },
    expenses_covered: document.getElementById("f-expenses-covered").value.trim(),
    fund_source: {
      local_funds: document.getElementById("f-fs-local").checked,
      sub_aro: document.getElementById("f-fs-subaro").checked,
      sub_aro_no: document.getElementById("f-fs-subaro-text").value.trim(),
      hrtd: document.getElementById("f-fs-hrtd").checked,
      others: document.getElementById("f-fs-others").checked,
      others_text: document.getElementById("f-fs-others-text").value.trim(),
    },
    with_government_vehicle: document.getElementById("f-gov-vehicle").checked,
    with_registration_fee: document.getElementById("f-reg-fee").checked,
  };

  if (!payload.division_id) {
    toast("Your account has no division assigned yet. Contact your administrator.", "bad");
    return;
  }

  const btn = targetStatus === "submitted" ? document.getElementById("btn-submit-req") : document.getElementById("btn-save-draft");
  btn.disabled = true;

  try {
    let orderId = id;
    if (id) {
      const { error } = await sb.from("travel_orders").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      payload.status = "draft";
      const { data, error } = await sb.from("travel_orders").insert(payload).select("id").single();
      if (error) throw error;
      orderId = data.id;
    }

    if (targetStatus === "submitted") {
      await submitForApproval(orderId);
    } else {
      toast("Draft saved.", "ok");
    }

    closeModal("overlay-form");
    await loadOrders();
  } catch (err) {
    toast("Save failed: " + err.message, "bad");
  } finally {
    btn.disabled = false;
  }
}

// Identifies division -> resolves approval levels -> assigns level 1 approver -> marks submitted/pending
async function submitForApproval(orderId) {
  const { data: order, error: oErr } = await sb.from("travel_orders").select("*").eq("id", orderId).single();
  if (oErr) throw oErr;

  const { data: levels, error: lErr } = await sb
    .from("approval_levels")
    .select("*")
    .eq("division_id", order.division_id)
    .eq("status", "active")
    .or(`request_type_id.eq.${order.request_type_id},request_type_id.is.null`)
    .order("level_no");
  if (lErr) throw lErr;

  const maxLevel = levels && levels.length ? Math.max(...levels.map(l => l.level_no)) : 1;

  const control_no = order.control_no || (await genControlNo());

  const { error: upErr } = await sb.from("travel_orders").update({
    status: "pending",
    current_level: 1,
    max_level: maxLevel,
    control_no,
    submitted_at: new Date().toISOString(),
  }).eq("id", orderId);
  if (upErr) throw upErr;

  toast(`Request submitted (${control_no}). Routed to Level 1 approver.`, "ok");
}

async function genControlNo() {
  const { data, error } = await sb.rpc("next_control_no");
  if (error || !data) {
    // Fallback client-side control number if RPC unavailable
    return "ATT-" + new Date().getFullYear() + "-" + Math.floor(Math.random() * 90000 + 10000);
  }
  return data;
}

/* ------------------------------- Detail / Track ------------------------ */
async function viewDetail(id) {
  openModal("overlay-detail");
  const body = document.getElementById("detail-body");
  const foot = document.getElementById("detail-foot");
  body.innerHTML = "Loading…";
  foot.innerHTML = "";

  const o = ORDERS.find(x => x.id === id);
  if (!o) { body.innerHTML = "Not found."; return; }
  document.getElementById("detail-title").textContent = o.control_no || "Draft Request";

  const { data: history } = await sb
    .from("approval_history")
    .select("*")
    .eq("travel_order_id", id)
    .order("action_date");

  body.innerHTML = `
    <div class="form-grid">
      <div class="field"><label>Status</label><div>${statusBadge(o.status)}</div></div>
      <div class="field"><label>Filing Date</label><div>${fmtDate(o.filing_date)}</div></div>
      <div class="field"><label>Position</label><div>${escapeHtml(o.position)}</div></div>
      <div class="field"><label>Official Station</label><div>${escapeHtml(o.official_station)}</div></div>
      <div class="field full"><label>Destination</label><div>${escapeHtml(o.destination)}</div></div>
      <div class="field"><label>Travel Dates</label><div>${fmtDate(o.travel_date_from)} – ${fmtDate(o.travel_date_to)}</div></div>
      <div class="field"><label>Travel Is On</label><div>${o.travel_on === "official_time" ? "Official Time" : "Official Business"}</div></div>
      <div class="field full"><label>Purpose</label><div>${escapeHtml(o.purpose)}</div></div>
      <div class="field full"><label>Activity / Sponsor</label><div>${escapeHtml(o.activity_sponsor || "—")}</div></div>
      <div class="field full"><label>Expenses Covered</label><div>${escapeHtml(o.expenses_covered || "—")}</div></div>
      <div class="field full"><label>Legal Basis</label><div>${legalBasisText(o.legal_basis)}</div></div>
      <div class="field full"><label>Fund Source</label><div>${fundSourceText(o.fund_source)}</div></div>
      <div class="field full"><label>Other Details</label><div>${
        [o.with_government_vehicle ? "With Government Vehicle" : null, o.with_registration_fee ? "With Registration Fee" : null].filter(Boolean).join(" · ") || "—"
      }</div></div>
    </div>

    <h4 style="margin-top:16px">Approval History</h4>
    ${renderTimeline(history || [])}
  `;

  foot.innerHTML = o.status === "approved"
    ? `<a class="btn btn-gold" href="report.html?id=${o.id}" target="_blank">View / Print Official Report</a>`
    : `<span class="muted" style="align-self:center">Report available once fully approved.</span>`;
}

function renderTimeline(history) {
  if (!history.length) return `<p class="muted">No approval activity yet.</p>`;
  return `<ul class="timeline">
    ${history.map(h => `
      <li>
        <div class="tl-dot ${h.action}">${h.action === "approved" ? "✓" : h.action === "rejected" ? "✕" : h.action === "returned" ? "↺" : "•"}</div>
        <div class="tl-body">
          <strong>${escapeHtml(h.approver_name_snapshot)} — ${escapeHtml(h.approver_position_snapshot)}</strong>
          <div class="meta">Level ${h.level_no} · ${h.action.toUpperCase()} · ${fmtDate(h.action_date)}</div>
          ${h.remarks ? `<div class="remarks">${escapeHtml(h.remarks)}</div>` : ""}
        </div>
      </li>
    `).join("")}
  </ul>`;
}
