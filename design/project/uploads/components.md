# Component specs — AI Social Media Management SaaS

Every component below reads from `tokens.css` via the Tailwind mapping
(`bg-surface`, `text-muted`, `ring-focus`). No component hardcodes a hex or a
`dark:` colour — theme follows the token layer. Each spec lists variants,
sizes, states, the tokens it uses, accessibility behaviour, and the PRD
sections / screens it serves.

The product's rule (PRD §14): six primary destinations — **Overview, Content,
Calendar, Automations, Contacts, Settings** — with everything else surfaced
contextually. These primitives are the vocabulary those pages are built from.

Build order note: everything in **Primitives** is built first, in isolation,
on the `/design` route. The **Composites** are assembled from primitives
during `/replica-build`, screen by screen.

---

## Primitives

### Button
    variants  primary, secondary, ghost, danger, danger-ghost
    sizes     sm 32px, md 40px, lg 48px  (icon-only: square at each height)
    states    default, hover, active, focus-visible, disabled, loading
    tokens    primary   bg accent / text on-accent / hover bg accent-hover
              secondary bg bg / text text / border border / hover bg surface
              ghost     transparent / text muted / hover bg surface, text text
              danger    bg danger / text on-danger / hover darken via accent-hover role
              radius md · font sm/600 · gap space-2 to icon · px space-4 (md)
    a11y      real <button type>; focus-visible = 2px ring focus, offset 2px;
              loading sets aria-busy, keeps the label mounted for SR, swaps a
              leading spinner in for the icon; disabled uses [disabled] not just
              styling; icon-only buttons require aria-label
    used on   every screen — Overview quick actions, Content Studio, Calendar,
              publishing queue, Settings

### Icon button
    variants  default, active (toggled)
    sizes     sm 32, md 40
    states    default, hover (bg surface), active (bg accent-subtle, text accent-text),
              focus-visible, disabled
    tokens    text muted · radius md · hover bg surface
    a11y      aria-label required; aria-pressed when it toggles; 40px min hit area

### Text input
    variants  default, with-leading-icon, with-trailing (clear / unit / affix)
    sizes     sm 32, md 40, lg 48
    states    default, hover, focus, filled, disabled, readonly, error, success
    tokens    bg bg · text text · placeholder subtle · border border-input
              focus 2px ring focus + border accent · error border danger + text danger-text
              radius md · px space-4 · font sm
    a11y      <label> always (visible or sr-only), for/id tied; error text in an
              element referenced by aria-describedby and aria-invalid=true; never
              colour-only error — pair with an icon + message
    used on   auth, Client create/edit, Content Studio, Settings, search fields

### Textarea
    same tokens/states as Text input; auto-grow optional; char counter sits
    bottom-right in text-subtle, turns danger-text past the platform limit (ties
    to the §8 character-count validation). a11y: counter has aria-live=polite.

### Select / native dropdown
    sizes     sm 32, md 40
    states    default, hover, focus, open, disabled, error
    tokens    as Text input + chevron in muted
    a11y      prefer native <select> for single-choice; if custom, use a listbox
              pattern (roving focus, aria-activedescendant, type-ahead)

### Combobox (searchable select)
    states    default, focus, open, loading options, no-results, selected
    tokens    popover bg bg / shadow pop / radius lg; option hover bg surface;
              selected bg accent-subtle + text accent-text + check icon
    a11y      role=combobox + aria-expanded; options role=option; arrow keys move
              aria-activedescendant; Esc closes and returns focus to the input
    used on   Client switcher, destination search, campaign picker, timezone

### Checkbox / Radio
    sizes     16, 20
    states    unchecked, checked, indeterminate (checkbox), focus, disabled, error
    tokens    checked bg accent + mark on-accent; border border-input; focus ring focus
    a11y      native input visually-styled (not div); indeterminate set via JS
              property; group radios in a <fieldset><legend>

### Switch / toggle
    sizes     sm (h20 w36), md (h24 w44)
    states    off, on, focus, disabled, loading
    tokens    off track border-input-ish surface-2; on track accent; knob bg;
              transition fast ease
    a11y      role=switch + aria-checked; label describes the ON state; used for
              automation enable/disable (§12), evergreen pause/resume (§11)

### Badge / status indicator  ← core to this product
    variants  draft, scheduled, published, failed, pending   (post lifecycle, §9)
              plus neutral, info, success, warning, danger for general use
    sizes     sm (dot + sm text), md
    states    static; optional leading dot or icon
    tokens    draft     text status-draft-text / bg status-draft-bg
              scheduled text status-scheduled-text / bg status-scheduled-bg
              published text status-published-text / bg status-published-bg
              failed    text status-failed-text / bg status-failed-bg
              pending   text status-pending-text / bg status-pending-bg
              radius pill · font xs/500 · px space-3
    a11y      status is never conveyed by colour alone — the label text IS the
              status; `failed` badge is also a button/links to the retry flow
    used on   Overview cards, Calendar entries, publishing history, bulk-import
              rows, per-destination result (§4, §23)

### Tag / chip (removable)
    variants  static, removable, selectable
    states    default, hover, selected, focus, disabled
    tokens    bg surface-2 / text text; selected bg accent-subtle + text accent-text;
              remove × in muted, hover danger-text; radius sm
    a11y      remove control is a real button with aria-label "Remove {name}";
              selectable chips use aria-pressed
    used on   hashtags (§6), selected destinations (§5), contact tags (§13),
              content categories

### Avatar
    variants  image, initials, icon (platform/client)
    sizes     xs 20, sm 24, md 32, lg 40
    tokens    fallback bg surface-2 / text muted; platform avatars carry an
              open-source platform glyph badge bottom-right
    a11y      alt = account / person name; decorative platform badge aria-hidden

### Card
    variants  plain, interactive (clickable), stat (Overview metric)
    states    default, hover (interactive: shadow pop + border accent-subtle),
              focus-visible, selected
    tokens    bg bg · border border · radius lg · shadow card · pad space-7
              stat number: text 2xl; label: text muted sm; delta: success/danger-text
    a11y      an interactive card is one focusable control (wrap the heading link,
              not nested tab stops); whole card clickable, link is the accessible name
    used on   Overview (connected accounts, scheduled, published, failed, pending
              approvals, active automations — all clickable → filtered views §14.1)

### Tabs
    variants  underline (default), segmented (for Calendar month/week/day)
    states    default, hover, active, focus, disabled
    tokens    active text text + 2px underline accent; inactive text muted;
              segmented active bg bg + shadow xs inside surface-2 track
    a11y      role=tablist/tab/tabpanel; arrow-key navigation; active tab
              aria-selected; panel aria-labelledby its tab

### Tooltip
    states    hidden, visible (hover + focus), delay in motion-fast
    tokens    bg text (inverted) / text bg / radius sm / shadow pop / font xs
    a11y      describes, never the only source of an action's name; shows on
              keyboard focus too; aria-describedby wiring; Esc dismisses

### Toast / notification
    variants  info, success, warning, danger
    states    enter, visible, exiting (auto-dismiss ~5s, pause on hover/focus)
    tokens    bg bg / border border / shadow pop / leading icon in role colour /
              radius lg; action link in accent-text
    a11y      region role=status (info/success) or role=alert (danger); never
              auto-dismiss a danger toast that needs action; dismiss button labelled
    used on   publish success/fail, import complete, token re-auth warnings (§16)

### Modal / dialog
    sizes     sm 420, md 560, lg 720
    states    open, closing; with optional loading / destructive confirm variant
    tokens    panel bg bg / radius xl / shadow pop; overlay rgba scrim; pad space-8
    a11y      role=dialog aria-modal; focus trapped; focus returns to the opener;
              Esc closes (except irreversible in-progress); labelled by its title;
              destructive confirm requires an explicit danger button

### Drawer / side panel
    variants  right (detail / edit), left (filters on mobile)
    states    open, closing
    tokens    as modal, full-height, width 420–520
    a11y      same trap/return/Esc rules as modal
    used on   post detail & edit (Calendar), destination detail, contact detail

### Dropdown menu
    states    closed, open, item hover/active/focus, disabled item, danger item
    tokens    popover bg bg / shadow pop / radius lg; item hover bg surface;
              danger item text danger-text
    a11y      role=menu/menuitem; arrow keys; Home/End; type-ahead; Esc returns focus

### Table / data grid
    parts     header (sortable), row, cell, selection checkbox, row actions,
              sticky header, zebra optional
    states    default, row hover (bg surface), selected row (bg accent-subtle),
              sorted column, loading (skeleton rows), empty, error
    tokens    header text muted xs/600; border border between rows; row pad space-4
    a11y      real <table> semantics; sortable headers are buttons with
              aria-sort; row selection announced; horizontal scroll container
              gets tabindex and a label
    used on   Contacts (§13), bulk-import preview (§10), publishing history,
              connected accounts (§16)

### Pagination
    states    default, current page, disabled prev/next, loading
    tokens    current bg accent-subtle + text accent-text; others ghost
    a11y      nav landmark labelled "Pagination"; current has aria-current=page

### Progress / usage meter
    variants  linear bar, radial (optional), segmented quota
    states    normal, near-limit (warning past ~80%), over-limit (danger)
    tokens    track surface-2; fill accent; warning fill warning; danger fill danger
    a11y      role=progressbar with aria-valuenow/min/max; limit state also in text
    used on   AI generation quota / cost (§19), import progress, queue depth

### File dropzone / upload
    states    idle, drag-over, uploading (progress), success, error, disabled
    tokens    idle border dashed border-input / bg surface; drag-over border accent
              + bg accent-subtle; error border danger
    a11y      real <input type=file> behind it; keyboard-openable; announces
              selected files; lists accepted types + max size as text
    used on   CSV/Excel import (§10), media library upload (§7)

### Stepper / wizard
    parts     step list (numbered), current, complete, upcoming, error step
    states    per step: upcoming, current, complete, error; nav: back/next/finish
    tokens    complete bg success + check; current ring accent; upcoming border border
    a11y      ordered list; current step aria-current=step; errors summarised and
              focus moved to the first error on a blocked Next
    used on   automation builder (§12 — 8-step flow), bulk-import wizard (§10)

### Skeleton / loading
    tokens    shimmer between surface and surface-2; respects reduced-motion (no
              shimmer, static surface-2)
    a11y      container aria-busy=true; decorative shimmer aria-hidden

### Empty state
    parts     open-source illustration or icon, heading, one-line body, primary action
    tokens    icon/illus in muted; heading text lg; body text muted; action = primary button
    a11y      heading is a real heading; action is the primary next step (connect an
              account, create first client, import content)
    used on   every list/table/calendar before data exists (PRD: real empty states,
              never fake stats §14.1)

### Inline error state
    parts     icon, message, retry action
    tokens    text danger-text; retry = secondary button; container border danger-subtle
    a11y      role=alert on appearance; retry is a real button
    used on   failed data loads, failed publish rows (§23)

---

## Composites (assembled from the primitives during build)

### App shell
    parts     left Sidebar (6 nav items + client switcher), Topbar (header),
              content region (max-width content, responsive gutters 16px)
    responsive sidebar fixed ≥ lg (264px); collapses to icons at md
              (sidebar-collapsed 72px); off-canvas drawer < md with a menu button
    tokens    sidebar bg surface / border border; header bg bg / border-bottom border;
              height header
    a11y      <nav> landmarks labelled; skip-to-content link; current item
              aria-current=page; one <main>

### Sidebar nav item
    states    default, hover (bg surface-2), active (bg accent-subtle + text
              accent-text + 2px left bar accent), focus, with-count-badge
    a11y      link with aria-current=page when active; count badge has sr text

### Client switcher
    built from Combobox + Avatar + Badge
    behaviour quick switch between clients without re-auth (§4.2); shows account
              count per client; "All clients" option for the agency workspace view
    states    collapsed trigger, open search, recent clients, create-client action
    a11y      combobox pattern; announces the newly selected client via aria-live

### Unified destination picker  ← the reusable core (PRD §5)
    layers    Client → Platform → Connected account → Page/Profile/Location/Board
    parts     client select, platform filter chips, searchable destination list
              with multi-select checkboxes + per-row platform avatar + connection
              badge, select-all / deselect-all, selected-count summary, recently-used,
              saved destination groups
    states    loading destinations, empty (no connected accounts → connect CTA),
              some disconnected (badge + disabled with reason), platform-unsupported
              (row disabled with an explaining note, never a fake-enabled control),
              selected
    tokens    selected row bg accent-subtle + text accent-text + check; disabled
              row text subtle + tooltip reason; count summary in a sticky footer bar
    a11y      grouped checkbox list (group per platform with a legend); select-all
              reflects indeterminate; count summary aria-live=polite; disabled rows
              keep an explanation readable by SR (not just a tooltip)
    reused on Content Studio, bulk import, scheduling, automation targeting

### Stat / metric card row (Overview)
    built from Card(stat) × up to 8 clickable metrics (§14.1): connected accounts,
              active clients, scheduled, published, failed, pending approvals,
              active automations, recent activity
    states    loading (skeleton), empty (dashes + "no data yet", never fake numbers),
              populated, each card → its filtered view
    a11y      each card one link; delta direction stated in text not colour alone

### Content composer (AI Content Studio, §6)
    parts     topic/brief input, generate button (loading → streaming variants),
              per-platform tabs with platform-specific preview, caption textarea +
              char counter, hashtag chips, CTA field, variation switcher,
              image slot (opens Image Studio), validation checklist (§8),
              draft/approve/schedule actions
    states    empty brief, generating, variants ready, editing, validation-pass,
              validation-blocked, saved draft, pending approval, scheduled
    a11y      streaming region aria-live=polite but not spammy; each platform tab
              is a tabpanel; validation checklist items say pass/attention/blocking
              in text + icon

### Validation checklist (§8)
    parts     per-rule row: state icon + rule + value/limit; grouped valid /
              needs-attention / blocking
    tokens    valid success-text; attention warning-text; blocking danger-text
    a11y      list with per-item status in text; blocking count summarised; never
              promises rankings/engagement — compliance + quality only (PRD §8)

### Calendar (§9)
    variants  month, week, day (segmented Tabs)
    parts     grid, post entries as status Badges, drag-and-drop reschedule,
              client/platform/account filters, timezone indicator, create slot
    states    loading, empty, populated, dragging, drop-target, conflict/duplicate
              warning, failed entry (→ retry)
    a11y      drag-drop has a keyboard alternative (move via menu / arrow keys);
              entries are buttons opening the detail drawer; filter state announced;
              month grid uses a grid/row/cell pattern with dates as headers

### Connected-account manager (§16, Settings)
    built from Table + Badge + Avatar + Dropdown menu
    columns   account, platform, client, authorized destinations, status,
              last sync, actions (refresh destinations / reconnect / disconnect)
    states    connected, needs-reauth (warning badge + impact note), disconnected
              (danger badge + list of affected scheduled jobs), syncing
    a11y      status in text; destructive disconnect behind a confirm modal that
              names the affected jobs

### Contacts table (§13)
    built from Table + Tag + Badge + Combobox filters
    columns   contact, source platform, client, campaign, tags, lead status, last
              interaction; row → contact detail drawer
    states    loading, empty, populated, filtered, duplicate-flagged
    a11y      standard data-table semantics; bulk actions announced

---

## Cross-cutting rules

- **Focus** is one system-wide 2px `focus` ring at 2px offset on every
  interactive element (defined in tokens.css `:focus-visible`). Never removed.
- **Status is never colour-only.** Every status/validation/delta carries text
  or an icon as well — enforced in Badge, validation checklist, metric deltas.
- **Every list has four states** beyond populated: loading (skeleton),
  empty (real empty state + next action), error (retry), and — where the PRD
  demands it — a *partial* state (some destinations failed, §23) that never
  reports a whole job as failed because one destination failed.
- **No fake data.** Loading shows skeletons; empty shows dashes and a CTA; a
  feature a platform API does not support shows a disabled control with an
  explanation, never an enabled-looking fake (PRD §3, §14.1, §27).
- **Open assets only.** Icons from an MIT/ISC open set (Lucide / Phosphor /
  Tabler); Inter for UI type; platform glyphs used only to label a connected
  account, never re-coloured into a logo of ours.
- **Reduced motion** disables shimmer and transitions via the media query in
  tokens.css.
