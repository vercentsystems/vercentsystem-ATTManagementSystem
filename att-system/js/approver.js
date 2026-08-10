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
let MY_APPROVER_ROWS = [];   // rows in `approvers` for this person (one per division/level/type)
let PENDING = [];
let HISTORY = [];
let CURRENT_ORDER = null;
let PENDING_ACTION = null;

init();

async function init() {
  const auth = await requireRole(["approver", "admin"]);
  if (!auth) return;
  PROFILE = auth.profile;

  renderShell({
    profile: PROFILE,
    brandSub: "Approver",
    links: [
      { href: "approver.html", icon: "✅", label: "Approvals", active: true },
      ...(PROFILE.role === "admin" ? [{ href: "admin.html", icon: "🛠", label: "Admin Console", active: false }] : []),
    ],
  });

  wireTabs();
  wireModalDismiss("overlay-review");
  wireModalDismiss("overlay-remarks");
  document.getElementById("review-close").addEventListener("click", () => closeModal("overlay-review"));
  document.getElementById("remarks-close").addEventListener("click", () => closeModal("overlay-remarks"));
  document.getElementById("remarks-cancel").addEventListener("click", () => closeModal("overlay-remarks"));
  document.getElementById("btn-approve").addEventListener("click", () => askRemarks("approved", false));
  document.getElementById("btn-reject").addEventListener("click", () => askRemarks("rejected", true));
  document.getElementById("btn-return").addEventListener("click", () => askRemarks("returned", true));
  document.getElementById("remarks-confirm").addEventListener("click", confirmDecision);

  await loadApproverAssignments();
  await loadPending();
  await loadHistory();
}

function wireTabs() {
  qsa(".tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      qsa(".tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("panel-pending").style.display = tab === "pending" ? "block" : "none";
      document.getElementById("panel-history").style.display = tab === "history" ? "block" : "none";
    });
  });
}

async function loadApproverAssignments() {
  const { data, error } = await sb
    .from("approvers")
    .select("*, divisions(name)")
    .eq("employee_id", PROFILE.id)
    .eq("status", "active");
  if (error) { toast("Failed to load your approver assignments: " + error.message, "bad"); return; }
  MY_APPROVER_ROWS = data || [];
  if (!MY_APPROVER_ROWS.length) {
    toast("You have no active approver assignment yet. Contact your administrator.", "bad");
  }
}

async function loadPending() {
  const tbody = qs("#tbl-pending tbody");
  if (!MY_APPROVER_ROWS.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No approver assignment configured.</td></tr>`;
    document.getElementById("st-pending").textContent = 0;
    return;
  }

  const divisionIds = [...new Set(MY_APPROVER_ROWS.map(a => a.division_id))];
  const { data, error } = await sb
    .from("travel_orders")
    .select("*, employees(full_name), divisions(name)")
    .in("division_id", divisionIds)
    .in("status", ["submitted", "pending"])
    .order("submitted_at", { ascending: true });

  if (error) { toast("Failed to load pending requests: " + error.message, "bad"); return; }

  // Keep only orders whose current_level matches one of my assignments for that division/type
  PENDING = (data || []).filter(o => matchesMyAssignment(o));

  document.getElementById("st-pending").textContent = PENDING.length;

  if (!PENDING.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Nothing pending your action right now.</td></tr>`;
    return;
  }

  tbody.innerHTML = PENDING.map(o => `
    <tr>
      <td data-label="Control No.">${o.control_no}</td>
      <td data-label="Employee">${escapeHtml(o.employees?.full_name || "—")}</td>
      <td data-label="Division">${escapeHtml(o.divisions?.name || "—")}</td>
      <td data-label="Destination">${escapeHtml(o.destination)}</td>
      <td data-label="Travel Dates">${fmtDate(o.travel_date_from)} – ${fmtDate(o.travel_date_to)}</td>
      <td data-label="Level">Level ${o.current_level} of ${o.max_level}</td>
      <td data-label="Actions" class="actions">
        <button class="btn btn-primary btn-sm" data-review="${o.id}">Review</button>
      </td>
    </tr>
  `).join("");

  qsa("[data-review]", tbody).forEach(b => b.addEventListener("click", () => openReview(b.dataset.review)));
}

function matchesMyAssignment(order) {
  return MY_APPROVER_ROWS.some(a =>
    a.division_id === order.division_id &&
    a.level_no === order.current_level &&
    (a.request_type_id === null || a.request_type_id === order.request_type_id)
  );
}

function myAssignmentFor(order) {
  return MY_APPROVER_ROWS.find(a =>
    a.division_id === order.division_id &&
    a.level_no === order.current_level &&
    (a.request_type_id === null || a.request_type_id === order.request_type_id)
  );
}

async function loadHistory() {
  const approverIds = MY_APPROVER_ROWS.map(a => a.id);
  const tbody = qs("#tbl-history tbody");
  if (!approverIds.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No activity yet.</td></tr>`;
    return;
  }
  const { data, error } = await sb
    .from("approval_history")
    .select("*, travel_orders(control_no, employees(full_name))")
    .in("approver_id", approverIds)
    .order("action_date", { ascending: false })
    .limit(100);

  if (error) { tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Failed to load.</td></tr>`; return; }
  HISTORY = data || [];

  document.getElementById("st-approved").textContent = HISTORY.filter(h => h.action === "approved").length;
  document.getElementById("st-rejected").textContent = HISTORY.filter(h => h.action === "rejected").length;
  document.getElementById("st-returned").textContent = HISTORY.filter(h => h.action === "returned").length;

  if (!HISTORY.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No activity yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = HISTORY.map(h => `
    <tr>
      <td data-label="Control No.">${h.travel_orders?.control_no || "—"}</td>
      <td data-label="Employee">${escapeHtml(h.travel_orders?.employees?.full_name || "—")}</td>
      <td data-label="Action">${statusBadge(h.action === "approved" ? "approved" : h.action === "rejected" ? "rejected" : "returned")}</td>
      <td data-label="Level">${h.level_no}</td>
      <td data-label="Date">${fmtDate(h.action_date)}</td>
      <td data-label="Remarks">${escapeHtml(h.remarks || "—")}</td>
    </tr>
  `).join("");
}

/* ------------------------------- Review modal --------------------------- */
async function openReview(id) {
  CURRENT_ORDER = PENDING.find(o => o.id === id);
  if (!CURRENT_ORDER) return;
  openModal("overlay-review");
  document.getElementById("review-title").textContent = `${CURRENT_ORDER.control_no} — Level ${CURRENT_ORDER.current_level} Review`;

  const o = CURRENT_ORDER;
  const { data: history } = await sb.from("approval_history").select("*").eq("travel_order_id", id).order("action_date");

  const companions = (o.companions || []).map(c => `${escapeHtml(c.name)}${c.position ? " (" + escapeHtml(c.position) + ")" : ""}`).join(", ");

  document.getElementById("review-body").innerHTML = `
    <div class="form-grid">
      <div class="field"><label>Employee</label><div>${escapeHtml(o.employees?.full_name || "—")}</div></div>
      <div class="field"><label>Division</label><div>${escapeHtml(o.divisions?.name || "—")}</div></div>
      <div class="field"><label>Position</label><div>${escapeHtml(o.position)}</div></div>
      <div class="field"><label>Official Station</label><div>${escapeHtml(o.official_station)}</div></div>
      <div class="field full"><label>Destination</label><div>${escapeHtml(o.destination)}</div></div>
      <div class="field"><label>Travel Dates</label><div>${fmtDate(o.travel_date_from)} – ${fmtDate(o.travel_date_to)}</div></div>
      <div class="field"><label>Travel Is On</label><div>${o.travel_on === "official_time" ? "Official Time" : "Official Business"}</div></div>
      <div class="field full"><label>Purpose</label><div>${escapeHtml(o.purpose)}</div></div>
      <div class="field full"><label>Activity / Sponsor</label><div>${escapeHtml(o.activity_sponsor || "—")}</div></div>
      <div class="field full"><label>Companions</label><div>${companions || "—"}</div></div>
      <div class="field full"><label>Expenses Covered</label><div>${escapeHtml(o.expenses_covered || "—")}</div></div>
      <div class="field full"><label>Legal Basis</label><div>${legalBasisText(o.legal_basis)}</div></div>
      <div class="field full"><label>Fund Source</label><div>${fundSourceText(o.fund_source)}</div></div>
      <div class="field full"><label>Other Details</label><div>${
        [o.with_government_vehicle ? "With Government Vehicle" : null, o.with_registration_fee ? "With Registration Fee" : null].filter(Boolean).join(" · ") || "—"
      }</div></div>
    </div>
    <h4 style="margin-top:14px">Prior Approval History</h4>
    ${(history && history.length) ? `<ul class="timeline">${history.map(h => `
      <li><div class="tl-dot ${h.action}">${h.action === "approved" ? "✓" : h.action === "rejected" ? "✕" : "↺"}</div>
        <div class="tl-body"><strong>${escapeHtml(h.approver_name_snapshot)} — ${escapeHtml(h.approver_position_snapshot)}</strong>
        <div class="meta">Level ${h.level_no} · ${h.action.toUpperCase()} · ${fmtDate(h.action_date)}</div>
        ${h.remarks ? `<div class="remarks">${escapeHtml(h.remarks)}</div>` : ""}</div></li>`).join("")}</ul>`
      : `<p class="muted">This is the first approval action on this request.</p>`}
  `;
}

function askRemarks(action, required) {
  if (!CURRENT_ORDER) return;
  PENDING_ACTION = action;
  const titles = { approved: "Approve Request", rejected: "Reject Request", returned: "Return for Correction" };
  document.getElementById("remarks-title").textContent = titles[action];
  document.getElementById("remarks-label").textContent = required ? "Remarks (required)" : "Remarks (optional)";
  document.getElementById("remarks-text").value = "";
  document.getElementById("remarks-text").dataset.required = required ? "1" : "0";
  closeModal("overlay-review");
  openModal("overlay-remarks");
}

async function confirmDecision() {
  const textEl = document.getElementById("remarks-text");
  const remarks = textEl.value.trim();
  if (textEl.dataset.required === "1" && !remarks) {
    toast("Please provide remarks for this decision.", "bad");
    return;
  }
  const btn = document.getElementById("remarks-confirm");
  btn.disabled = true;
  try {
    await applyDecision(CURRENT_ORDER, PENDING_ACTION, remarks);
    closeModal("overlay-remarks");
    toast(`Request ${PENDING_ACTION}.`, PENDING_ACTION === "approved" ? "ok" : "");
    await loadPending();
    await loadHistory();
  } catch (err) {
    toast("Action failed: " + err.message, "bad");
  } finally {
    btn.disabled = false;
  }
}

async function applyDecision(order, action, remarks) {
  const assignment = myAssignmentFor(order);
  if (!assignment) throw new Error("Your approver assignment for this level could not be found.");

  // 1. Write immutable approval_history record with a SNAPSHOT of the signature
  //    (so future signature updates never alter past documents).
  const { error: histErr } = await sb.from("approval_history").insert({
    travel_order_id: order.id,
    approver_id: assignment.id,
    level_no: order.current_level,
    action,
    remarks,
    approver_name_snapshot: PROFILE.full_name,
    approver_position_snapshot: assignment.position_title || PROFILE.position || "",
    signature_snapshot_url: assignment.signature_url || null,
  });
  if (histErr) throw histErr;

  // 2. Advance / close the workflow
  let update = {};
  if (action === "rejected") {
    update = { status: "rejected", decided_at: new Date().toISOString() };
  } else if (action === "returned") {
    update = { status: "returned", decided_at: new Date().toISOString() };
  } else if (action === "approved") {
    if (order.current_level >= order.max_level) {
      update = { status: "approved", decided_at: new Date().toISOString() };
    } else {
      update = { status: "pending", current_level: order.current_level + 1 };
    }
  }
  const { error: upErr } = await sb.from("travel_orders").update(update).eq("id", order.id);
  if (upErr) throw upErr;
}
