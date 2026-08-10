import { sb } from "./supabaseClient.js";
import { requireRole, fmtDate, fmtDateTime, escapeHtml } from "./utils.js";

const CHECKED = "&#9746;"; // ☒
const UNCHECKED = "&#9744;"; // ☐

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
    .select("*, employees(full_name, position, official_station), divisions(name)")
    .eq("id", id)
    .maybeSingle();

  if (error || !order) {
    statusLine.textContent = "This request could not be found or you do not have access to it.";
    return;
  }

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

  set("v-official-station", (o.official_station || o.employees?.official_station || "").toUpperCase());
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
// (Level 1) and "Approved" (the final configured level). Any intermediate
// levels are still recorded in full in the Approval History table below.
function buildApprovalCells(o, history) {
  const approvals = history.filter(h => h.action === "approved").sort((a, b) => a.level_no - b.level_no);
  const level1 = approvals.find(h => h.level_no === 1);
  const finalLevel = o.max_level || (approvals.length ? Math.max(...approvals.map(a => a.level_no)) : 1);
  const finalRec = approvals.find(h => h.level_no === finalLevel);

  document.getElementById("v-recommend-cell").innerHTML = signatureCellHtml(level1);
  document.getElementById("v-approved-cell").innerHTML = signatureCellHtml(finalRec);
}

function signatureCellHtml(rec) {
  if (rec) {
    return `
      <div class="sig-img-wrap">${rec.signature_snapshot_url ? `<img src="${rec.signature_snapshot_url}" alt="signature">` : ""}</div>
      <div class="sig-line">
        <div class="sig-name">${escapeHtml(rec.approver_name_snapshot)}, ${escapeHtml(rec.approver_position_snapshot)}</div>
        <div class="sig-hint">(name, position, and signature)</div>
      </div>
      <div class="sig-date">Date: <span class="fill-blank">${fmtDate(rec.action_date)}</span></div>
    `;
  }
  return `
    <div class="sig-img-wrap"></div>
    <div class="sig-line">
      <div class="sig-hint">(name, position, and signature)</div>
    </div>
    <div class="sig-date">Date: <span class="fill-blank">&nbsp;</span></div>
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
