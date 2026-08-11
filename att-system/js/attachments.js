import { sb } from "./supabaseClient.js";
import { escapeHtml } from "./utils.js";

const BUCKET = "attachments";

export async function listAttachments(travelOrderId) {
  const { data, error } = await sb
    .from("travel_order_attachments")
    .select("*")
    .eq("travel_order_id", travelOrderId)
    .order("created_at");
  if (error) throw error;
  return data || [];
}

export async function uploadAttachment(travelOrderId, file, uploaderId) {
  const path = `${travelOrderId}/${crypto.randomUUID()}-${file.name.replace(/\s+/g, "_")}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file);
  if (upErr) throw upErr;

  const { error: dbErr } = await sb.from("travel_order_attachments").insert({
    travel_order_id: travelOrderId,
    file_name: file.name,
    file_path: path,
    file_type: file.type || "",
    file_size: file.size || 0,
    uploaded_by: uploaderId,
  });
  if (dbErr) {
    // Roll back the uploaded object if the metadata insert failed, so we
    // don't leave an orphaned file with no corresponding record.
    await sb.storage.from(BUCKET).remove([path]);
    throw dbErr;
  }
}

export async function deleteAttachment(attachment) {
  await sb.storage.from(BUCKET).remove([attachment.file_path]);
  const { error } = await sb.from("travel_order_attachments").delete().eq("id", attachment.id);
  if (error) throw error;
}

export async function getSignedUrl(filePath, expiresIn = 3600) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(filePath, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export function isImageType(mimeType) {
  return (mimeType || "").startsWith("image/");
}
export function isPdfType(mimeType) {
  return mimeType === "application/pdf";
}

export function fmtFileSize(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType) {
  if (isImageType(mimeType)) return "🖼";
  if (isPdfType(mimeType)) return "📄";
  if ((mimeType || "").includes("word")) return "📝";
  if ((mimeType || "").includes("sheet") || (mimeType || "").includes("excel")) return "📊";
  return "📎";
}

// Renders a simple attachment list. Each row resolves its own signed URL
// on click (rather than eagerly for every row) to avoid generating a pile
// of short-lived signed URLs that are never used.
export function renderAttachmentsList(containerEl, attachments, { editable = false, onDelete = null } = {}) {
  if (!attachments.length) {
    containerEl.innerHTML = `<p class="muted" style="margin:6px 0">No attachments.</p>`;
    return;
  }
  containerEl.innerHTML = `<div class="attachment-list">${attachments.map(a => `
    <div class="attachment-row" data-id="${a.id}">
      <span class="att-icon">${fileIcon(a.file_type)}</span>
      <span class="att-name" title="${escapeHtml(a.file_name)}">${escapeHtml(a.file_name)}</span>
      <span class="att-size">${fmtFileSize(a.file_size)}</span>
      <button type="button" class="btn btn-ghost btn-sm att-view" data-path="${escapeHtml(a.file_path)}">View</button>
      ${editable ? `<button type="button" class="btn btn-bad btn-sm att-del" data-id="${a.id}">Remove</button>` : ""}
    </div>
  `).join("")}</div>`;

  containerEl.querySelectorAll(".att-view").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const url = await getSignedUrl(btn.dataset.path);
        window.open(url, "_blank", "noopener");
      } finally {
        btn.disabled = false;
      }
    });
  });

  if (editable && onDelete) {
    containerEl.querySelectorAll(".att-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const attachment = attachments.find(a => a.id === btn.dataset.id);
        if (attachment) onDelete(attachment);
      });
    });
  }
}
