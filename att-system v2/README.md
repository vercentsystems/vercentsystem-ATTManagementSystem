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
│   └── report.css        Fixed official document layout (Legal paper size)
├── js/
│   ├── config.js         Supabase URL/anon key (edit this)
│   ├── supabaseClient.js Shared Supabase client
│   ├── utils.js           Shared helpers (auth guard, shell, toasts, modals)
│   ├── auth.js, employee.js, approver.js, admin.js, report.js
└── sql/
    ├── schema.sql          Full Postgres schema, RLS policies, storage bucket
    └── migration_division_to_official_station.sql
                            Run ONCE if you already deployed the earlier
                            "Division"-based schema — see Section 2.
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
   request type), define how many sequential approvals are required and what
   each level is called (e.g. Level 1 = "School Head", Level 2 = "District
   Supervisor"). If a station has no levels configured, requests route
   through a single Level 1 approval.
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

`report.html` + `css/report.css` reproduce the agency's actual **Authority to
Travel** form (DepEd Region II – Cagayan Valley, Schools Division of Nueva
Vizcaya, Dupax Del Sur District) field-for-field: the letterhead block, the
Name / Position / Signature table (with two blank companion rows, matching
the paper form), Official Station, Destination, Date of travel, Purpose,
Activity organized/sponsored by, the "Travel is on" checkboxes, Legal basis
checkboxes, Expenses covered, Fund source checkboxes, the Government
Vehicle / Registration Fee checkboxes, and the two-column Recommending
Approval / Approved signature block — same labels, same order, same borders.

`js/report.js` only ever writes into elements with `id="v-*"`; it never
restructures the markup. Mapping to the brief's variables:

| Variable | Element id |
|---|---|
| `{{date_filing}}` | `v-filing-date` |
| `{{employee_name}}` | `v-employee-name` |
| `{{position}}` | `v-position` |
| `{{official_station}}` | `v-official-station` |
| `{{destination}}` | `v-destination` |
| `{{travel_date}}` | `v-travel-date` |
| `{{purpose}}` | `v-purpose` |
| `{{activity_sponsor}}` | `v-activity` |
| `{{approver_name}}` / `{{approver_position}}` / `{{approver_signature}}` / `{{approval_date}}` | built into `v-recommend-cell` (Level 1) and `v-approved-cell` (final level) |

**Checkboxes** (`☐` → `☒`) are driven by real data instead of free text:
`travel_on`, `legal_basis` (deped_memo / deped_advisory / invitation_letter /
others+text), `fund_source` (local_funds / sub_aro+no / hrtd / others+text),
`with_government_vehicle`, `with_registration_fee`.

**Two official signature slots, any number of approval levels.** The paper
form only has two signature boxes ("Recommending Approval" and "Approved"),
so that's exactly what prints: Level 1's approval fills the left box, and
whichever level is configured as the station's final level fills the right
box. If an official station is configured with 3+ approval levels, every level's
action is still fully recorded (with its own signature snapshot) in the
"Approval History (system record)" table appended below the official face —
nothing is lost, but the two-box layout itself is never altered.

The template is fixed at **Letter size (8.5in × 11in)**, matching the
official form, and print CSS hides the on-screen toolbar automatically.

**Letterhead & branding — one-time edits, not per-request variables:**
- Agency name, Region, Division (as in the DepEd org name, e.g. "Schools
  Division of Nueva Vizcaya" — this is letterhead text, unrelated to the
  app's Official Station routing concept), District, and address/telephone/
  email are
  written directly in `report.html` / near the bottom of the same file.
  Edit them once for your office.
- `assets/agency-seal.svg` (top, 64×64 rendered) and `assets/office-logo.svg`
  (footer, 54×54 rendered) are placeholders — replace those two files with
  your actual seal/logo images (PNG or SVG, same filenames, or update the
  `src` in `report.html`).
- The header currently uses the Google Fonts "UnifrakturCook" typeface for
  "Department of Education" to approximate the blackletter/Old-English style
  on the sample form, and "IM Fell English SC" for "Republic of the
  Philippines". Requires internet access when printing; swap the `<link>` in
  `report.html`'s `<head>` for a self-hosted font if offline printing is
  required.

## 7. Companions field

The official form has two blank rows under the primary requester for
additional travelers on the same authority. The employee request form lets
you add up to two companions (name + position); they print into those exact
rows on the report.

## 8. Responsive behavior

- **Desktop (>1080px):** persistent sidebar + content area.
- **Tablet (860–1080px):** narrower sidebar, 2-column forms.
- **Mobile (<860px):** sidebar collapses behind a hamburger menu; data tables
  (class `data cards`) automatically re-flow into stacked label/value cards;
  forms stack to one column; all buttons keep a 40px+ touch target.
- The report/print template intentionally ignores these breakpoints — it
  always renders at its fixed paper size, since it's meant for printing/PDF,
  not for on-screen mobile reading.

## 9. Known MVP limitations / next steps for production

- No password-reset UI wired up (Supabase Auth supports it; add a page).
- No email notifications on submit/approve/reject/return (add Supabase Edge
  Functions + an email provider, or a webhook to your agency's mail system).
- No file attachments (e.g. invitation letters) — could be added as another
  Storage bucket + a `travel_order_attachments` table.
- No pagination on list views (fine for MVP volumes; add server-side paging
  for production).
- The control-number sequence (`next_control_no()`) is global; if your agency
  numbers per-station or per-year-and-station, adjust the SQL function.
- The report's agency seal (`assets/agency-seal.svg`) and office logo
  (`assets/office-logo.svg`) are still placeholder graphics — drop in your
  real image files (see Section 6) before printing for real use.
- The official form only shows 2 signature boxes; official stations with 3+ approval
  levels still get every action logged in the system-record table below the
  form, but only Level 1 and the final level get a dedicated printed
  signature box (see Section 6).
