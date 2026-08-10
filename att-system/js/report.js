import { sb } from "./supabaseClient.js";
import { requireRole, fmtDate, fmtDateTime, escapeHtml } from "./utils.js";

const CHECKED = "&#9746;"; // ☒
const UNCHECKED = "&#9744;"; // ☐

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

  populate(order, history || []);

  statusLine.textContent = order.status === "approved"
    ? `${order.control_no} — Approved · Ready to print`
    : `${order.control_no || "Draft"} — Status: ${order.status.toUpperCase()} (signatures finalize once approved)`;

  document.getElementById("btn-print").addEventListener("click", () => window.print());
  wireDownloadModal();
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

// Renders the fixed report layout to an image (html2canvas), then embeds it
// into a Letter-size PDF using jsPDF's built-in encryption — the resulting
// file requires the given password to open. This is a client-side, best-
// effort protection (no backend in this app to do it server-side); the
// underlying PDF encryption strength depends on the loaded jsPDF version,
// so test opening the downloaded file in your target PDF reader.
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

  // Letter page = 612 x 792 pt; canvas already matches the page's aspect
  // ratio since it's a snapshot of the fixed 8.5in x 11in .paper element.
  doc.addImage(imgData, "PNG", 0, 0, 612, 792);
  doc.save(`${order.control_no || "ATT-draft"}.pdf`);
}

function set(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}
function setChk(id, on) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = on ? CHECKED : UNCHECKED;
}
function fmtTravelDate(from, to) {
  if (!from) return "";
  if (!to || to === from) return fmtDate(from);
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

function populate(o, history) {
  set("v-filing-date", fmtDate(o.filing_date));
  set("v-employee-name", (o.employees?.full_name || "").toUpperCase());
  set("v-position", o.position || o.employees?.position || "");
  set("v-emp-remarks", "");

  const companions = Array.isArray(o.companions) ? o.companions : [];
  set("v-comp1-name", companions[0]?.name ? companions[0].name.toUpperCase() : "");
  set("v-comp1-position", companions[0]?.position || "");
  set("v-comp2-name", companions[1]?.name ? companions[1].name.toUpperCase() : "");
  set("v-comp2-position", companions[1]?.position || "");

  set("v-official-station", (o.official_station || o.official_stations?.name || "").toUpperCase());
  set("v-destination", (o.destination || "").toUpperCase());
  set("v-travel-date", fmtTravelDate(o.travel_date_from, o.travel_date_to).toUpperCase());
  set("v-purpose", o.purpose || "");
  set("v-activity", o.activity_sponsor || "");

  setChk("v-chk-business", o.travel_on === "official_business");
  setChk("v-chk-official-time", o.travel_on === "official_time");

  const lb = o.legal_basis || {};
  setChk("v-chk-deped-memo", !!lb.deped_memo);
  setChk("v-chk-deped-advisory", !!lb.deped_advisory);
  setChk("v-chk-invitation", !!lb.invitation_letter);
  setChk("v-chk-legal-others", !!lb.others);
  set("v-legal-others-text", lb.others_text || "");

  set("v-expenses-covered", o.expenses_covered || "");

  const fs = o.fund_source || {};
  setChk("v-chk-local-funds", !!fs.local_funds);
  setChk("v-chk-sub-aro", !!fs.sub_aro);
  set("v-sub-aro-no", fs.sub_aro_no || "");
  setChk("v-chk-hrtd", !!fs.hrtd);
  setChk("v-chk-fund-others", !!fs.others);
  set("v-fund-others-text", fs.others_text || "");

  setChk("v-chk-gov-vehicle", !!o.with_government_vehicle);
  setChk("v-chk-reg-fee", !!o.with_registration_fee);

  buildApprovalCells(o, history);
  buildLog(history);

  set("v-generated-date", fmtDateTime(new Date()));
  set("v-page-controlno", o.control_no ? `Control No. ${o.control_no}` : "");
}

// Official form has exactly two signature slots: "Recommending Approval"
// (Immediate Supervisor / Department Head) and "Approved" (Approving
// Authority — Division Head / Director / Executive / Authorized Official).
// Each approval_history row carries its own approval_type snapshot, taken
// at the moment it was recorded, so this never depends on level numbering
// or on the current approval_levels configuration.
function buildApprovalCells(o, history) {
  const approvals = history.filter(h => h.action === "approved");
  const latestOfType = (type) => [...approvals].reverse().find(h => h.approval_type === type);

  document.getElementById("v-recommend-cell").innerHTML = signatureCellHtml(latestOfType("recommending"));
  document.getElementById("v-approved-cell").innerHTML = signatureCellHtml(latestOfType("approving"));
}

// The caption labels — "(name, position, and signature)" and "Date:" — are
// fixed parts of the official form and always print, exactly as they do on
// the blank paper form. Only the actual value (name, signature image, date)
// is optional: it's filled in when that role has been maintained and acted
// on, and left blank otherwise. No value is ever "required" to print the box.
function signatureCellHtml(rec) {
  return `
    <div class="sig-img-wrap">${rec?.signature_snapshot_url ? `<img src="${rec.signature_snapshot_url}" alt="signature">` : ""}</div>
    <div class="sig-line">
      ${rec ? `<div class="sig-name">${escapeHtml(rec.approver_name_snapshot)}, ${escapeHtml(rec.approver_position_snapshot)}</div>` : ""}
      <div class="sig-hint">(name, position, and signature)</div>
    </div>
    <div class="sig-date">Date: <span class="fill-blank">${rec ? fmtDate(rec.action_date) : "&nbsp;"}</span></div>
  `;
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
