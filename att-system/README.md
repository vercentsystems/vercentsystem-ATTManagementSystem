# Authority to Travel Management System — MVP Prototype

A responsive, role-based web app for filing, routing, approving, and printing
official Authority to Travel (ATT) requests, built with plain HTML/CSS/JS and
Supabase (Postgres + Auth + Storage). No build step required.

## 1. Project structure

```
att-system/
├── index.html          Login / sign-up
├── employee.html        Employee: create/save/submit/track requests
├── approver.html         Approver: review, approve/reject/return, e-sign
├── admin.html            Admin: official stations, employees, approvers,
│                         approval
│                         levels, e-signatures, dashboard, monitoring
├── report.html            FIXED official print/PDF template
├── css/
│   ├── style.css         Responsive app UI (sidebar/tablet/mobile)
│   └── report.css        Fixed official document layout (Letter paper size)
├── js/
│   ├── config.js         Supabase URL/anon key (edit this)
│   ├── supabaseClient.js Shared Supabase client
│   ├── utils.js           Shared helpers (auth guard, shell, toasts, modals)
│   ├── attachments.js    Shared upload/list/delete/signed-URL helpers
│   ├── auth.js, employee.js, approver.js, admin.js, report.js
├── assets/                Seal/logo placeholders — replace with real images
└── sql/
    ├── schema.sql          Full Postgres schema, RLS policies, storage bucket
    ├── migration_division_to_official_station.sql
    │                       Run ONCE if you already deployed the earlier
    │                       "Division"-based schema — see Section 2.
    ├── migration_add_approval_type.sql
    │                       Run ONCE if you deployed before Approval Type
    │                       (Recommending Approval / Approving Authority)
    │                       existed — see Section 2.
    ├── migration_fund_source_and_new_fields.sql
    │                       Run ONCE if your travel_orders table predates
    │                       the DepEd-form field redesign — see Section 2.
    └── migration_add_attachments.sql
                            Run ONCE if you deployed before attachments
                            existed — see Section 2.
```

Everything is modular vanilla JS (ES modules) so the same data model, workflow,
and business logic documented here can be ported to a production framework
(React/Vue/Angular + a server API) later without changing the underlying
Supabase schema.

## 2. Set up Supabase

> **Already have this project deployed with a `divisions` table?** Approval
> routing was renamed from "Division" to **"Official Station"** (a specific
> school/office, since that's what your approvers are actually assigned by).
> Run `sql/migration_division_to_official_station.sql` once in the SQL
> Editor instead of `schema.sql` — it renames your existing table/columns in
> place without losing data. Afterward, rename your existing station records
> in **Admin → Official Stations** to real school names, and double-check
> **Admin → Approval Levels** and **Admin → Approvers**, since both now key
> off Official Station instead of Division.

> **Already deployed and just need the Approval Type update?** Run
> `sql/migration_add_approval_type.sql` once in the SQL Editor. It adds an
> explicit **Approval Type** field to each Approval Level — **Recommending
> Approval** (Immediate Supervisor / Department Head) vs **Approving
> Authority** (Division Head / Director / Executive / Authorized Official) —
> which decides which signature box the report prints an approval into. It
> auto-backfills a best-effort guess for existing levels/history (highest
> level number per station → Approving Authority, everything else →
> Recommending Approval); review and correct those in **Admin → Approval
> Levels** afterward.

> **Seeing blank/wrong Fund Source or Legal Basis on the report, or a "Save
> failed: Could not find the '...' column" error?** Your `travel_orders`
> table predates the request-form redesign to match the official DepEd
> form. Run `sql/migration_fund_source_and_new_fields.sql` once in the SQL
> Editor — it drops the old `travel_classification` / `expenses` /
> `transportation` columns, converts `fund_source` and `legal_basis` from
> TEXT to JSONB (checkbox data), and adds `companions`, `travel_on`,
> `expenses_covered`, `with_government_vehicle`, and
> `with_registration_fee`. Any existing draft/pending requests will need to
> be re-opened and re-saved afterward to populate the new fields — their
> old Fund Source/Legal Basis text values don't carry over automatically
> since the shape changed.

> **Already deployed and just need attachments?** Run
> `sql/migration_add_attachments.sql` once in the SQL Editor. It adds the
> `travel_order_attachments` table and a private `attachments` Storage
> bucket with RLS. See Section 8.


1. Create a project at https://supabase.com.
2. Open **SQL Editor** and run the entire contents of `sql/schema.sql` once.
   This creates all tables, RLS policies, the `signatures` storage bucket, and
   seed request types.
3. Open **Project Settings → API** and copy your **Project URL** and **anon
   public key** into `js/config.js`.
4. Serve the folder with any static file server (it must be served over
   http/https, not `file://`, for ES modules and fetch to work), e.g.:
   ```
   npx serve att-system
   ```

## 3. Create your first administrator

1. Open the app and use **Create Account** to sign up with your own email.
2. In Supabase's SQL editor, promote yourself:
   ```sql
   update employees set role = 'admin' where email = 'you@agency.gov.ph';
   ```
3. Sign out and back in — you'll land on the Admin Console.

## 4. Configure the organization (as Admin)

Do this once, in order:

1. **Official Stations** — add every school/office requests will be filed
   from (e.g. "Banila Elementary School"). This is what approval routing is
   keyed on.
2. **Request Types** — Local Travel, Foreign Travel, Seminar/Training, etc.
   (a few are seeded already).
3. **Approval Levels** — for each Official Station (and optionally per
   request type), define how many sequential approvals are required, what
   each level is called (e.g. Level 1 = "School Head", Level 2 = "District
   Supervisor"), and its **Approval Type**:
   - **Recommending Approval** — typically the Immediate Supervisor /
     Department Head. Prints in the report's "Recommending Approval" box.
   - **Approving Authority** — typically the Division Head / Director /
     Executive / other Authorized Official. Prints in the report's
     "Approved" box. This should be the *final* level for that station.
   If a station has no levels configured, requests route through a single
   Level 1 approval (defaults to Recommending Approval type).
4. **Employees** — after each person signs up, assign their Official
   Station, Position, and Role (Employee / Approver / Admin). Their Official
   Station is what routes their own requests to the right approver.
5. **Approvers** — assign a specific employee to an Official Station +
   (optional) Request Type + Level number, set the position title as it
   should appear on the printed report, and upload their e-signature image
   (PNG recommended). This is the single source of truth for routing —
   nothing is hard-coded.

## 5. Workflow logic (implemented)

```
Employee fills form → Save Draft (editable) or Submit
  → System reads the employee's Official Station
  → System resolves active Approval Levels for that Official Station/Request Type
  → Request enters status "pending" at current_level = 1
  → The matching active Approver(s) for (official station, level, type) see it in
    their Approvals queue
  → Approver: Approve → if current_level < max_level, advance to next level
                        (status stays "pending")
                      → if current_level == max_level, status → "approved"
             Reject   → status → "rejected" (terminal)
             Return   → status → "returned" (employee can edit & resubmit,
                        which resets current_level to 1)
  → Every action writes an immutable row to approval_history, including a
    SNAPSHOT of the approver's signature URL at that moment — so if an
    approver later updates their signature, previously approved documents
    are unaffected.
```

Row Level Security enforces all of this server-side (see `sql/schema.sql`):
employees can only touch their own draft/returned requests; approvers can
only see/act on requests currently sitting at their assigned level/official station;
admins have full access.

## 6. The official report (`report.html`)

`report.html` + `css/report.css` reproduce the Schools Division of Nueva
Vizcaya's **"Travel Authority for Official Travel"** form field-for-field:
the letterhead (Republic of the Philippines / Department of Education /
Region II – Cagayan Valley / Schools Division of Nueva Vizcaya), the single
field table (Name, Position/Designation, Permanent Station, Purpose of
Travel, Host of Activity, Inclusive Dates, Destination, Fund Source), and
the three stacked attestation/certification/approval blocks — same wording,
same order, same borders.

`js/report.js` only ever writes into elements with `id="v-*"`; it never
restructures the markup. Mapping to the brief's variables:

| Variable | Element id |
|---|---|
| `{{employee_name}}` | `v-employee-name` |
| `{{position}}` | `v-position` |
| `{{official_station}}` | `v-station` ("Permanent Station" on this template) |
| `{{destination}}` | `v-destination` |
| `{{travel_date}}` | `v-dates` ("Inclusive Dates") |
| `{{purpose}}` | `v-purpose` |
| `{{activity_sponsor}}` | `v-host` ("Host of Activity") |
| — (new field) | `v-fund-source` — plain text, summarized from the `fund_source` data collected on the request |
| `{{approver_name}}` / `{{approver_position}}` / `{{approver_signature}}` / `{{approval_date}}` | built into the "certify" block (`v-recommend-*`) and "APPROVED" block (`v-approved-*`) |

**Three signature blocks, not two side-by-side boxes.** This template
stacks them vertically instead:
1. **Employee attestation** — an italic "I hereby attest…" paragraph, then
   the employee's name (auto-filled — we know it) on the signature line.
   The actual wet signature still happens on the printed copy; this system
   doesn't collect employee e-signatures, only approver e-signatures.
2. **Certification / Recommending Approval** — the "This is to certify…"
   paragraph, then whichever approver is configured with Approval Type
   `recommending` for that station prints their name, position, signature
   image, and decision date directly (not behind a blank captioned line —
   these are standing roles, same as how the real template has the
   Assistant Schools Division Superintendent's name pre-typed).
3. **APPROVED** — same idea, for whichever approver has Approval Type
   `approving`.

Same rule as before: neither block is required. If a station only has one
role configured, the other simply stays blank — no misleading "pending"
state once the request is fully decided. If you want an approver's name to
print with credentials exactly like the sample (e.g. "ADONIS C. CEPEREZ
EdD, CESE"), just include that in their **Full Name** field in Admin →
Employees — the report prints whatever's there.

The template is fixed at **Letter size (8.5in × 11in)**, and print CSS hides
the on-screen toolbar automatically.

**Letterhead & branding — one-time edits, not per-request variables:**
- Agency name, Region, Division, and the footer address/cellphone/email/
  website are written directly in `report.html`. Edit them once for your
  office.
- `assets/agency-seal.svg` (header, and reused as the third footer logo),
  `assets/deped-logo.svg`, and `assets/bagong-pilipinas-logo.svg` are
  placeholders — replace those three files with your actual seal/logo
  images (PNG or SVG, same filenames, or update the `src` attributes in
  `report.html`).

**Password-protected PDF download.** Next to "Print / Save as PDF" is a
**"Download PDF (password-protected)"** button. Clicking it asks you to set
a password (min. 6 characters) required to open the resulting file, then
generates it entirely in the browser — a snapshot of the report is rendered
via `html2canvas`, embedded into a Letter-size PDF via `jsPDF`, and encrypted
using jsPDF's built-in password support (both the "open" and "owner"
passwords are set to what you enter; print permission is allowed, editing is
not). There's no backend involved, so:
- The password is never sent anywhere or stored — share it with the
  recipient through a separate channel (e.g. verbally, SMS), not in the same
  email as the PDF.
- This depends on `jsPDF`'s encryption feature (loaded via CDN,
  `jspdf@2.5.1`), which is a comparatively newer part of that library. Test
  opening a downloaded file with your actual PDF reader (Adobe Reader,
  Preview, browser PDF viewer, etc.) before relying on it for sensitive
  documents in production — if your reader doesn't prompt for a password,
  pin a different `jspdf` version or swap in a server-side PDF encryption
  step (e.g. `qpdf --encrypt` in a small backend function) for guaranteed
  compatibility.


## 7. Companions field

The official form has two blank rows under the primary requester for
additional travelers on the same authority. The employee request form lets
you add up to two companions (name + position); they print into those exact
rows on the report.

## 8. Attachments (supporting documents)

The official form requires Purpose of Travel to be "supported by
attachments." Employees can attach files (PDF, JPG/PNG, DOC/DOCX, XLS/XLSX,
max 10MB each) to their own request:

- **Filing a new request**: the Attachments section unlocks after the first
  Save Draft — the form stays open (doesn't close) so you can attach files
  immediately without reopening it.
- **Editing an existing draft/returned request**: attachments are available
  as soon as you open it.
- Files live in a **private** Storage bucket (`attachments`, not public like
  `signatures`) — every view/download goes through a short-lived signed URL,
  and Row Level Security decides who can even request one.

**Who can see what**, enforced by RLS (mirrors exactly who can already see
the request itself — nothing new to configure):
- The employee who filed the request — full access (view, add, remove,
  while it's still Draft or Returned).
- Whichever approver is currently assigned to act on it — view only.
- Admins — view only (uploading/removing is the employee's job, matching
  how the rest of the system treats request ownership).

**Where attachments show up:**
- Employee's own "View" detail modal (view-only)
- Approver's review modal (view-only, alongside the request details they're
  deciding on)
- Admin's request-view modal (view-only)
- **`report.html`** — shown directly on the report page below the official
  form (images and PDFs get an inline preview; other file types get a
  view/download link), so opening the report shows both the ATT form and
  its supporting documents together, per the form's own requirement.

**Downloading:** the report page has two independent download buttons —
**"Download PDF (password-protected)"** for the ATT form itself (as
before), and **"Download Attachments"** which downloads every attached
file individually (each browser download fires ~400ms apart to avoid
pop-up/download blockers). Click both for "give me everything." Note that
image attachments are also visually captured *inside* the encrypted PDF
itself (since the html2canvas snapshot includes the whole page), so a
single password-protected PDF download already includes inline images —
non-image attachments (PDFs, Office docs) still need the separate
"Download Attachments" button for full-fidelity originals.

## 9. Responsive behavior

- **Desktop (>1080px):** persistent sidebar + content area.
- **Tablet (860–1080px):** narrower sidebar, 2-column forms.
- **Mobile (<860px):** sidebar collapses behind a hamburger menu; data tables
  (class `data cards`) automatically re-flow into stacked label/value cards;
  forms stack to one column; all buttons keep a 40px+ touch target.
- The report/print template intentionally ignores these breakpoints — it
  always renders at its fixed paper size, since it's meant for printing/PDF,
  not for on-screen mobile reading.

## 10. Known MVP limitations / next steps for production

- No password-reset UI wired up (Supabase Auth supports it; add a page).
- No email notifications on submit/approve/reject/return (add Supabase Edge
  Functions + an email provider, or a webhook to your agency's mail system).
- No file attachments (e.g. invitation letters) — could be added as another
  Storage bucket + a `travel_order_attachments` table.
- No pagination on list views (fine for MVP volumes; add server-side paging
  for production).
- The control-number sequence (`next_control_no()`) is global; if your agency
  numbers per-station or per-year-and-station, adjust the SQL function.
- The report's seal/logo images (`assets/agency-seal.svg`,
  `assets/deped-logo.svg`, `assets/bagong-pilipinas-logo.svg`) are still
  placeholder graphics — drop in your real image files (see Section 6)
  before printing for real use.
- The template only shows 2 named-approver blocks (Recommending Approval,
  Approved); stations with 3+ approval levels still get every action logged
  in the system-record table below the form, but only the `recommending`-
  and `approving`-typed levels get a dedicated printed block (see Section 6).
