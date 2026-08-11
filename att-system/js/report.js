import { sb } from "./supabaseClient.js";
import { requireRole, fmtDate, fmtDateTime, escapeHtml } from "./utils.js";

let CURRENT_ORDER = null;

init();

async function init() {
  const auth = await requireRole(["employee", "approver", "admin"]);
  if (!auth) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const statusLine = document.getElementById("rt-status");

  if (!id) { statusLine.textContent = "No request specified."; return; }

  const { data: order, error } = await sb
    .from("travel_orders")
    .select("*, employees(full_name, position), official_stations(name)")
    .eq("id", id)
    .maybeSingle();

  if (error || !order) {
    statusLine.textContent = "This request could not be found or you do not have access to it.";
    return;
  }
  CURRENT_ORDER = order;

  const { data: history } = await sb
    .from("approval_history")
    .select("*")
    .eq("travel_order_id", id)
    .order("action_date");

  const levels = await fetchApprovalLevels(order);

  populate(order, history || [], levels);

  statusLine.textContent = order.status === "approved"
    ? `${order.control_no} — Approved · Ready to print`
    : `${order.control_no || "Draft"} — Status: ${order.status.toUpperCase()} (signatures finalize once approved)`;

  document.getElementById("btn-print").addEventListener("click", () => window.print());
  wireDownloadModal();
}

// The role label (e.g. "Assistant Schools Division Superintendent") is a
// fixed part of each Approval Level's configuration in Admin — it should
// always print, whether or not that role has acted on this request yet.
// Only the specific person's name/signature/date depends on an actual
// maintained approver having approved. Prefers a level scoped to this
// request's specific request type over a catch-all (request_type_id null)
// level, same precedence used when routing the request itself.
async function fetchApprovalLevels(order) {
  let query = sb
    .from("approval_levels")
    .select("level_no, approval_type, label, request_type_id")
    .eq("official_station_id", order.official_station_id)
    .eq("status", "active");

  query = order.request_type_id
    ? query.or(`request_type_id.eq.${order.request_type_id},request_type_id.is.null`)
    : query.is("request_type_id", null);

  const { data } = await query.order("level_no");
  return data || [];
}

// Default role titles for this deployment (Schools Division of Nueva
// Vizcaya) — used only when the matching Approval Level has no Label set,
// so the report reads correctly out of the box. Admins can still override
// either by setting the Label field in Admin → Approval Levels.
const DEFAULT_ROLE_LABEL = {
  recommending: "Assistant Schools Division Superintendent",
  approving: "Schools Division Superintendent",
};

function pickLevelLabel(levels, type, requestTypeId) {
  const specific = requestTypeId && levels.find(l => l.approval_type === type && l.request_type_id === requestTypeId);
  const fallback = levels.find(l => l.approval_type === type);
  return (specific || fallback)?.label || DEFAULT_ROLE_LABEL[type] || "";
}

function set(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}
function fmtInclusiveDates(from, to) {
  if (!from) return "";
  if (!to || to === from) return fmtDate(from);
  return `${fmtDate(from)} to ${fmtDate(to)}`;
}
function fundSourceText(fs) {
  if (!fs) return "";
  const parts = [];
  if (fs.local_funds) parts.push("Local Funds");
  if (fs.sub_aro) parts.push(`Sub-ARO${fs.sub_aro_no ? " No. " + fs.sub_aro_no : ""}`);
  if (fs.hrtd) parts.push("HRTD");
  if (fs.others) parts.push(fs.others_text || "Others");
  return parts.join(" / ");
}

function populate(o, history, levels) {
  set("v-employee-name", (o.employees?.full_name || "").toUpperCase());
  set("v-position", o.position || o.employees?.position || "");
  set("v-station", o.official_station || o.official_stations?.name || "");
  set("v-purpose", o.purpose || "");
  set("v-host", o.activity_sponsor || "");
  set("v-dates", fmtInclusiveDates(o.travel_date_from, o.travel_date_to));
  set("v-destination", o.destination || "");
  set("v-fund-source", fundSourceText(o.fund_source));

  // Employee attestation line — name is known, so it's printed; the actual
  // wet signature still happens on the physical/printed copy.
  set("v-employee-sig-name", o.employees?.full_name || "");
  set("v-employee-sig-date", o.filing_date ? fmtDate(o.filing_date) : "\u00A0");

  buildApprovalSections(o, history, levels);
  buildLog(history);

  set("v-generated-date", fmtDateTime(new Date()));
  set("v-page-controlno", o.control_no ? `Control No. ${o.control_no}` : "");
}

// The template's two approval roles — Recommending (the certification
// paragraph) and Approved — each print the maintained approver's name,
// signature image, position, and decision date directly (these officials
// are standing roles, so their name is expected to already be legible on
// the template, not hidden behind a blank captioned line the way the
// employee's signature is). Neither is required: if a role was never
// maintained/configured for this station, its block simply stays blank.
function buildApprovalSections(o, history, levels) {
  const approvals = history.filter(h => h.action === "approved");
  const latestOfType = (type) => [...approvals].reverse().find(h => h.approval_type === type);

  fillApprovalBlock("recommend", latestOfType("recommending"), pickLevelLabel(levels, "recommending", o.request_type_id));
  fillApprovalBlock("approved", latestOfType("approving"), pickLevelLabel(levels, "approving", o.request_type_id));
}

function fillApprovalBlock(prefix, rec, roleLabel) {
  const imgWrap = document.getElementById(`v-${prefix}-sig-img`);
  const nameEl = document.getElementById(`v-${prefix}-name`);
  const roleEl = document.getElementById(`v-${prefix}-role`);
  const dateEl = document.getElementById(`v-${prefix}-date`);

  // Role label is always the configured Approval Level label — not
  // required to have anyone maintained yet.
  roleEl.textContent = roleLabel || "";

  if (rec) {
    imgWrap.innerHTML = rec.signature_snapshot_url ? `<img src="${rec.signature_snapshot_url}" alt="signature">` : "";
    nameEl.textContent = rec.approver_name_snapshot.toUpperCase();
    dateEl.textContent = fmtDate(rec.action_date);
  } else {
    imgWrap.innerHTML = "";
    nameEl.innerHTML = "&nbsp;";
    dateEl.innerHTML = "&nbsp;";
  }
}

function buildLog(history) {
  const body = document.getElementById("v-log-body");
  body.innerHTML = history.length
    ? history.map(h => `
      <tr>
        <td>${h.level_no}</td>
        <td>${escapeHtml(h.approver_name_snapshot)}</td>
        <td>${escapeHtml(h.approver_position_snapshot)}</td>
        <td>${h.action.toUpperCase()}</td>
        <td>${fmtDate(h.action_date)}</td>
        <td>${escapeHtml(h.remarks || "—")}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" style="text-align:center;color:#555">No approval activity yet</td></tr>`;
}

/* ------------------------- Password-protected download ------------------ */
function wireDownloadModal() {
  const overlay = document.getElementById("dl-overlay");
  const passwordInput = document.getElementById("dl-password");
  const confirmInput = document.getElementById("dl-password-confirm");
  const errorEl = document.getElementById("dl-error");

  document.getElementById("btn-download").addEventListener("click", () => {
    passwordInput.value = "";
    confirmInput.value = "";
    errorEl.textContent = "";
    overlay.classList.add("show");
    passwordInput.focus();
  });
  document.getElementById("dl-cancel").addEventListener("click", () => overlay.classList.remove("show"));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("show"); });

  document.getElementById("dl-confirm").addEventListener("click", async () => {
    const pw = passwordInput.value;
    const pw2 = confirmInput.value;
    if (pw.length < 6) { errorEl.textContent = "Password must be at least 6 characters."; return; }
    if (pw !== pw2) { errorEl.textContent = "Passwords do not match."; return; }
    errorEl.textContent = "";

    const btn = document.getElementById("dl-confirm");
    btn.disabled = true; btn.textContent = "Generating…";
    try {
      await generateEncryptedPdf(CURRENT_ORDER, pw);
      overlay.classList.remove("show");
    } catch (err) {
      errorEl.textContent = "Could not generate PDF: " + err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Download";
    }
  });
}

async function generateEncryptedPdf(order, password) {
  if (!window.html2canvas || !window.jspdf) {
    throw new Error("PDF library failed to load — check your internet connection and try again.");
  }

  const paper = document.getElementById("paper");
  const canvas = await window.html2canvas(paper, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
    encryption: {
      userPassword: password,
      ownerPassword: password,
      userPermissions: ["print"],
    },
  });

  doc.addImage(imgData, "PNG", 0, 0, 612, 792);
  doc.save(`${order.control_no || "ATT-draft"}.pdf`);
}
