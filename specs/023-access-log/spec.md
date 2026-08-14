# Feature Specification: HTTP Access Log

**Feature Branch**: `023-access-log`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "lets create access_log (saved in MySql) Log every http query to the site: IP, Url path, GET & POST params, cookie data, http body, datetime, user_id( if logged in), process time, result response code. Maybe some more important info. There should be a flag in env file to turn it on/off (on by default)"

## Clarifications

### Session 2026-08-14

- Q: When the site sits behind a reverse proxy, which forwarded-address headers should the recorder trust when deciding what to store as the visitor's network address? (FR-002) → A: Record both — the direct connecting address and the raw forwarded-for header as separate fields, leaving the operator to judge.
- Q: Should old entries be deleted automatically on a schedule the site runs itself, or only when an operator explicitly runs the pruning routine? (FR-027) → A: Automatically on the application's own scheduler, daily by default, deleting entries older than 30 days (window configurable), and still manually invocable.
- Q: Must the entry be saved before the visitor's response is delivered, or may the site deliver the response first and save the entry immediately afterwards? (FR-001, SC-002) → A: Before the response is delivered — if the visitor received a response, the entry already exists; the write's cost is inside the latency budget.
- Q: For a request that establishes the session — a sign-in, or a recovery-link password reset — should the entry name the account that ended up authenticated, or record no account because the request arrived anonymous? (FR-008) → A: Account as of the **start** of the request. A sign-in or reset records no account; the operator infers it from the submitted identifier, which is recorded.
- Q: Is the 64 KB size limit a cap on the entire entry, or a cap applied separately to each recorded value? (FR-018, SC-005) → A: **Per value.** Each individual value is truncated at the limit independently; the entry has no overall ceiling, and SC-005 is restated accordingly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator reviews the site's request history (Priority: P1)

The site operator wants a durable, queryable record of every request the site handled, so
that after an incident ("a meme vanished", "someone got a 500 at 03:12", "which account
uploaded this?") they can reconstruct exactly what was asked of the site, by whom, from
where, when, how long it took, and what answer came back — without needing to have had a
debugger attached at the time.

**Why this priority**: This is the feature. Without capture and storage there is nothing to
toggle, redact, or prune. One operator query against the stored history is the whole value
proposition, and it is deliverable on its own.

**Independent Test**: Perform a mixed set of requests against a running site — a guest feed
load, a signed-in upload, a request for a nonexistent meme, and a request that fails — then
inspect the stored history and confirm each request is present exactly once with its
address, path, method, parameters, timestamp, account, duration, and response code.

**Acceptance Scenarios**:

1. **Given** logging is enabled and a visitor is not signed in, **When** they load the feed,
   **Then** exactly one entry is recorded holding the direct connecting address and the
   forwarded-for value as supplied (empty when the request carried none), the
   requested path, the request method, the query parameters, the moment the request arrived,
   how long it took to answer, and the response code — with no account attached.
2. **Given** logging is enabled and a member is signed in, **When** they submit a form,
   **Then** the recorded entry identifies the account that made the request and holds the
   submitted field names and values.
3. **Given** logging is enabled, **When** a request is made to an address that does not
   exist, **Then** an entry is recorded with the response code the visitor received (not
   omitted because the request "failed").
4. **Given** logging is enabled, **When** a request triggers an unhandled server error,
   **Then** an entry is still recorded, carrying the error response code and the elapsed
   time, and the visitor's experience of that error is unchanged.
5. **Given** logging is enabled, **When** many requests arrive at once, **Then** every one of
   them appears in the history exactly once, with no entries merged, lost, or duplicated.
6. **Given** logging is enabled, **When** a visitor signs in successfully, **Then** the entry
   records no account — the request arrived anonymous — while the submitted identifier and the
   success response code are both present, so the operator can still see who signed in.
7. **Given** logging is enabled, **When** a signed-in member signs out, **Then** the entry
   records the account that was authenticated when the request arrived.

---

### User Story 2 - Secrets never come to rest in the history (Priority: P2)

Sign-in, registration, password recovery, and password change all carry credentials in the
request, and every signed-in request carries a session cookie. A history that stored those
verbatim would turn the log table into a credential dump: anyone with read access to it — a
DBA, a backup file, a leaked dump — could sign in as any user who had touched the site.

**Why this priority**: The value of the log is realised in P1; this story is what makes it
safe to keep. It is a hard gate on shipping, not a nice-to-have, but it is meaningless
before there is something to redact.

**Independent Test**: Run a complete authentication journey — register, verify, sign in,
change password, request a recovery link, reset the password — then search the entire stored
history for the plaintext passwords used and for the session identifier held by the browser.
Both searches must return zero matches, while the surrounding entries remain present and
useful.

**Acceptance Scenarios**:

1. **Given** logging is enabled, **When** a visitor signs in, **Then** the entry records that
   a sign-in was attempted, the address it came from, and the response code, but the password
   value is not present in any readable form anywhere in the entry.
2. **Given** logging is enabled, **When** a signed-in member makes any request, **Then** no
   value that could be replayed to impersonate that member is stored in readable form.
3. **Given** logging is enabled, **When** a one-time recovery or verification link is
   exercised, **Then** the secret carried by that link is not left readable in the history.
4. **Given** logging is enabled, **When** a request carries fields with no security meaning
   (a meme title, a comment body, a page cursor), **Then** those values ARE stored, so the
   log stays useful.

---

### User Story 3 - Operator can switch logging off without a code change (Priority: P2)

The operator needs a single configuration switch that turns request logging on or off. It is
on by default, so a fresh deployment records history without anyone remembering to enable
it; and it can be turned off — when storage is tight, when a load test would flood the
table, or when a privacy obligation requires it — by editing configuration and restarting,
with no code edit and no migration.

**Why this priority**: An always-on writer with no off switch is an operational hazard. It
is small, but it must ship with the capture it governs.

**Independent Test**: With the switch absent from configuration entirely, make a request and
confirm it was recorded (default-on). Set the switch to off, restart, repeat the same
requests, and confirm no new entries appear and every request still succeeds normally. Turn
it back on and confirm recording resumes.

**Acceptance Scenarios**:

1. **Given** the switch is not configured at all, **When** a request is handled, **Then** it
   is recorded — logging defaults to on.
2. **Given** the switch is set to off, **When** requests are handled, **Then** no new entries
   are written and the site behaves exactly as it does with the feature absent.
3. **Given** the switch is set to off, **When** an operator inspects the history, **Then**
   previously recorded entries are still there — turning logging off stops writing, it does
   not erase.

---

### User Story 4 - The history stays bounded (Priority: P3)

Recording every request means the history grows with traffic, forever, unless something
removes old entries. Entries beyond a configured age — 30 days by default — are discarded by a
routine the site runs itself on a daily schedule, so storage use is predictable and a busy week
does not fill the disk without anyone having to remember to prune. The same routine can be run
on demand when an operator wants to reclaim space immediately.

**Why this priority**: The site will function without it for weeks or months; it becomes
urgent only as volume accumulates. It is genuinely separable from capture.

**Independent Test**: Seed the history with entries dated inside and outside the retention
window, run the pruning routine, and confirm only the entries older than the window are
gone, that the routine can be re-run with no further effect, and that the site keeps serving
requests throughout. Separately, confirm the routine is registered on the application's
schedule so that it runs without being invoked by hand.

**Acceptance Scenarios**:

1. **Given** entries exist that are older than the retention window, **When** the pruning
   routine runs, **Then** those entries are removed and newer entries are untouched.
2. **Given** no entries are older than the retention window, **When** the pruning routine
   runs, **Then** nothing is removed and the routine reports success.
3. **Given** the retention window is changed in configuration, **When** the pruning routine
   next runs, **Then** it honours the new window without a code change.
4. **Given** nobody invokes the routine by hand, **When** the application's schedule reaches
   its daily pruning time, **Then** the routine runs on its own and removes entries older than
   the window — the default deployment prunes without operator action.
5. **Given** the routine is running against a large history, **When** requests arrive during
   the run, **Then** they are served and recorded normally throughout.

---

### Edge Cases

- **A large file upload.** A visitor uploads a video at the largest size the site accepts. The
  entry must not attempt to store the file's bytes; it records that a file field was present
  along with its name, declared type, and size, and the entry stays small enough that a busy
  upload hour does not dwarf the rest of the history.
- **An upload too large to be accepted at all.** A visitor sends a file well beyond the site's
  limit, so the request is refused for its size before its content can be parsed. The refusal is
  still a request the site answered and must still be recorded, with its response code and no
  parameter or file content — there is none to record. The two cases are distinct and both are
  required: the accepted upload proves the bytes are deliberately left out, the refused one
  proves an unparseable request still yields an entry.
- **A body that is not text.** Binary or malformed byte sequences in the request must not
  corrupt the entry, break the write, or make the history unreadable.
- **An oversized text body or query string.** A very long body, a very long URL, or a very
  long single parameter value is truncated at the configured limit — each value judged on its
  own — and the entry makes it visible that truncation occurred rather than silently presenting
  a partial value as complete. Truncating one value never truncates its neighbours.
- **A request carrying many large values at once.** Nothing caps the entry as a whole, so such
  a request yields a large entry rather than a partially recorded one. It is recorded, not
  rejected or trimmed to fit.
- **The history cannot be written.** If storing the entry fails for any reason — the store is
  unavailable, the table is missing before its migration has run, the write times out — the
  visitor's request still completes normally with its intended response. Logging never
  becomes a new way for the site to break.
- **A request the visitor abandons.** If the visitor disconnects before the response reaches
  them, the entry has already been written (it precedes delivery), so the request is still
  represented in the history; a half-finished request must not leave a malformed entry or block
  the writer.
- **A store that has gone slow rather than down.** A store that accepts the connection but
  answers sluggishly must not turn a synchronous write into a stalled response. The write is
  bounded and abandoned past that bound, degrading to "answered but not recorded".
- **The account is deleted later.** Accounts can be hard-deleted. Existing entries for that
  account remain in the history but stop identifying it, exactly as the site's other records
  behave when their owner is removed.
- **Very high-frequency automated traffic.** Container health probes and similar polling can
  outnumber real traffic by orders of magnitude. Paths can be excluded from recording by
  configuration so the history stays representative.
- **Repeated parameter names and nested parameter structures.** Parameters supplied more than
  once, or as a structure, are recorded faithfully enough that an operator can tell what was
  actually submitted.
- **The site is behind a reverse proxy.** Both address fields are recorded: the direct
  connecting address (the proxy) and the forwarded-for value the proxy supplied (the visitor's
  claimed address). Neither is discarded in favour of the other, so an operator can always
  tell what the site observed apart from what the request claimed.
- **A visitor forges a forwarded-address header.** A request that arrives with a
  forwarded-address header of the visitor's own invention — whether it reaches the application
  directly or through the proxy — is recorded with that value verbatim in the forwarded-for
  field and the true peer in the direct connecting address field. The forged value never
  displaces the observed one.
- **A request rejected before it reaches the application.** Requests refused by rate limiting
  or blocked by a middleware are still requests the site answered, and they are recorded with
  the code the visitor received.

## Requirements *(mandatory)*

### Functional Requirements

**Capture**

- **FR-001**: The system MUST record one history entry for every HTTP request the application
  handles, whatever the outcome — success, redirect, client error, server error, or a request
  rejected by a guard before reaching its destination.
- **FR-001a**: The entry MUST be durably stored **before** the response is delivered to the
  visitor. A visitor MUST NOT be able to receive a response for a request that has not already
  been recorded, except where the write itself failed (FR-025). There is therefore no window in
  which the history is behind the traffic: an entry is present the moment its response arrives,
  not shortly after.
- **FR-001b**: Because the write is on the request's critical path, its cost counts against the
  latency budget (SC-002). The budget MUST be measured against a real store under the write
  path this feature ships, not assumed.
- **FR-002**: Each entry MUST record two separate network address fields: (a) the **direct
  connecting address** — the peer the application actually received the connection from,
  derived from the connection itself and never from a request header, and therefore not
  forgeable by a visitor; and (b) the **forwarded-for value as supplied** — the request's
  forwarded-address header stored verbatim and unparsed when present, and empty when absent.
  Neither field is resolved into the other and neither overrides the other: behind a reverse
  proxy (a) identifies the proxy and (b) carries the visitor's claimed address, and the
  operator decides which to trust for a given investigation.
- **FR-002a**: The forwarded-for value is untrusted visitor input — any client can set it to
  anything. It MUST be stored as evidence of what was claimed, never treated by the system as
  an established fact about who the visitor was, and never used in place of the direct
  connecting address for any decision the system makes.
- **FR-003**: Each entry MUST record the requested URL path and the HTTP method.
- **FR-004**: Each entry MUST record the query parameters supplied with the request.
- **FR-005**: Each entry MUST record the submitted form parameters and the request body,
  subject to the redaction rules (FR-013 – FR-016) and the size limits (FR-017 – FR-019).
- **FR-005a**: "The request body" means the body **as parsed into named fields** wherever the
  request's content type permits parsing — form-encoded, multipart, and JSON. For those types the
  raw byte stream MUST NOT be recorded a second time alongside the parsed fields. This is not an
  optimisation, it is what makes US2 achievable: name-based withholding (FR-015) can only reach a
  value it can name, so a raw copy of a sign-in body would sit in the history spelling out the
  password that the parsed copy correctly withheld, and SC-003 could never return zero. Where the
  content type cannot be parsed into fields — an XML document, an arbitrary byte payload — the
  parsed field set is empty and the raw body IS recorded, because it is then the only record of
  what was submitted. For multipart specifically the raw body **is** the uploaded file, which
  FR-017 forbids outright.
- **FR-006**: Each entry MUST record the request's cookie data, subject to the redaction
  rules (FR-013 – FR-016).
- **FR-007**: Each entry MUST record the date and time the request was received, with at
  least second precision and unambiguous time zone handling.
- **FR-008**: Each entry MUST record the account that made the request when the request was
  authenticated, and MUST record no account for anonymous requests.
- **FR-008a**: The account is determined **as of the moment the request arrived**, not as of
  its completion. One uniform rule applies to every request, with no special case for the
  endpoints that change session state: a request that arrives anonymous records no account even
  if it ends authenticated, and a request that arrives authenticated records that account even
  if it ends signed out.
- **FR-008b**: A consequence to state plainly, because it shapes how the history is read:
  **sign-in, registration, and recovery-link password reset entries carry no account**, however
  they turned out. What identifies the actor on those rows is the submitted identifier — the
  e-mail or username — which is not a secret, is not on the sensitive list, and is therefore
  recorded in full (FR-016). An operator answering "who signed in from this address" reads that
  field together with the response code, rather than the account reference.
- **FR-009**: Each entry MUST record how long the application took to produce the response, in
  a unit fine enough to distinguish a fast request from a slow one (sub-millisecond
  resolution or better).
- **FR-010**: Each entry MUST record the HTTP response code the visitor received.
- **FR-011**: Each entry MUST additionally record the visitor's user-agent string, the
  referring URL when supplied, and the size of the response body, so that traffic can be
  attributed and unusually large responses spotted.
- **FR-012**: Entries MUST be stored durably in the site's existing database so they survive
  process and container restarts, and MUST be queryable by time, either network address field
  (FR-002), path, account, and response code without a full scan of the history. Both address
  fields are equally queryable, so an operator investigating a proxied deployment is not
  forced onto a full scan to filter by the visitor's claimed address.

**Redaction and safety**

- **FR-013**: No entry may contain, in readable form, a password, a password confirmation, a
  current-password field, a session identifier, a remember-me token, a cross-site request
  token, an authorization credential, or a one-time link token.
- **FR-014**: Values withheld under FR-013 MUST leave a visible placeholder in place of the
  value, so an operator can see that a field was present without seeing what it held.
- **FR-015**: Withholding MUST be driven by a single named list of sensitive field and cookie
  names, applied identically to query parameters, form parameters, body content, and cookies,
  so a rule cannot be enforced in one place and forgotten in another.
- **FR-016**: Fields not on that list MUST be recorded in full (subject to size limits), so
  the history stays diagnostically useful.
- **FR-017**: Uploaded file contents MUST NOT be stored. For each uploaded file the entry
  records only the field name, the original filename, the declared content type, and the byte
  size.
- **FR-018**: Recorded body, parameter, and cookie content MUST be truncated at a configured
  size limit, and a truncated value MUST be marked as truncated.
- **FR-018a**: The limit applies **per recorded value**, independently: each query-parameter
  value, each submitted form-field value, each cookie value, and the request body are each
  truncated at the limit on their own. There is no aggregate ceiling on the entry as a whole, so
  no value is ever shortened or dropped merely because another value in the same request was
  large — a long body never costs you the query string that explains it.
- **FR-018b**: The consequence, which operators sizing storage MUST account for: an entry's
  worst-case size is the number of distinct recorded values multiplied by the limit, not the
  limit itself. A request carrying many large values produces a correspondingly large entry.
  This is the accepted tradeoff for never losing one field to another's size.
- **FR-019**: Byte sequences that are not valid text MUST NOT prevent an entry from being
  written; such content is recorded in a safe, storable form or replaced by a marker.

**Configuration and control**

- **FR-020**: A single configuration setting MUST enable or disable request recording, and it
  MUST default to enabled when the setting is absent.
- **FR-021**: When recording is disabled, the system MUST write no new entries, MUST retain
  entries already written, and MUST leave every response byte-for-byte what it would be with
  the feature absent.
- **FR-022**: A configuration setting MUST list URL paths excluded from recording, so
  high-frequency automated traffic can be kept out of the history.
- **FR-023**: A configuration setting MUST define the retention window for entries, defaulting
  to 30 days when the setting is absent.
- **FR-024**: All settings introduced by this feature MUST be documented with their defaults
  in the project's example environment file.

**Reliability**

- **FR-025**: A failure to write an entry MUST NOT alter, delay beyond its normal completion,
  or fail the visitor's request; the failure is surfaced through the application's existing
  error reporting instead. Because the write precedes delivery (FR-001a), this is the one case
  where a response is sent without a matching entry: the request is answered normally and the
  loss is reported, never escalated into a visitor-facing failure.
- **FR-025a**: A store that is slow or unreachable MUST NOT hold a response open indefinitely.
  The write MUST be bounded so that an unavailable store degrades to "answered but not
  recorded" (FR-025) rather than to a hung or timed-out request.
- **FR-026**: Recording MUST NOT change the content, status, or headers of any response.
- **FR-027**: The system MUST provide a routine that deletes entries older than the retention
  window. The routine MUST be safe to run repeatedly and while the site is serving traffic, and
  MUST be invocable on demand by an operator.
- **FR-027a**: That routine MUST additionally be registered to run **automatically on the
  application's own schedule, daily by default and enabled by default**, so a deployment prunes
  without an operator remembering to act and without host-level scheduling being configured
  separately. The schedule's frequency MUST be configurable.
- **FR-027b**: The retention window MUST default to **30 days** (FR-023). An automatic run MUST
  delete exactly what a manual run would delete for the same window — one routine, two ways to
  start it, no second deletion rule that could drift from the first.
- **FR-027c**: A failed or interrupted pruning run MUST NOT affect request handling or
  recording, and MUST leave the history in a state where the next run — automatic or manual —
  completes the work.

**Privacy and access**

- **FR-028**: The history MUST NOT be exposed through any public API, page, or response
  header; it is operator-facing data only.
- **FR-029**: When an account is deleted, its entries MUST remain in the history but MUST stop
  identifying that account.

**Scope boundaries**

- **FR-030**: This feature MUST NOT add any operator-facing browsing surface. The read path
  is direct database access. No page, no endpoint, no navigation entry is added by this
  feature.
- **FR-031**: Although no viewer ships here, the history MUST be shaped so that a later
  viewer needs no change to its structure: the queries a viewer would run — most recent
  entries first, filtered by time range, either network address field, path, account, or
  response code —
  MUST already be efficiently answerable (FR-012), and the stored fields MUST already be
  those a viewer would display (FR-002 – FR-011). Adding the viewer later must require no
  new columns, no backfill, and no re-shaping of existing entries.
- **FR-032**: The history covers requests handled by the application only. Requests answered
  directly by the web server in front of the application — the site's own static assets and
  the stored media files — are out of scope and MUST NOT be expected in the history. This
  boundary MUST be stated where the feature's configuration is documented, so an operator
  reading the history is not misled into thinking media traffic is missing rather than
  excluded by design.

### Key Entities

- **Access Log Entry** — one HTTP request the site answered. Holds when it arrived, where it
  came from (direct connecting address, forwarded-for value as supplied, user agent, referring
  URL), what was asked (method, path, query
  parameters, submitted parameters, body, cookies — all redacted and size-limited), who asked
  (the account authenticated **as the request arrived** — absent on anonymous traffic and on
  the sign-in that creates the session), and what happened (response code, response size, elapsed
  time). Entries are write-once: nothing updates an entry after the request it describes has
  finished. Entries are removed only by the retention routine.
- **Account** (existing) — an entry may reference the account that made the request. The
  reference is optional (anonymous traffic has none) and non-blocking: deleting an account
  clears the reference on its entries rather than deleting them or preventing the deletion.
- **Sensitive Field List** — the single named set of parameter, body-field, and cookie names
  whose values are never recorded. It is the one place the redaction rule is defined.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a scripted run of 200 mixed application requests (anonymous browsing,
  authenticated actions, uploads, not-found paths, and deliberate server errors) against a
  running site with recording enabled, the history contains exactly 200 matching entries —
  no request missing,
  none duplicated — and every entry carries a non-empty direct connecting address, path,
  method, timestamp, response code, and elapsed time. Entries whose request carried a
  forwarded-address header also carry that value verbatim; entries whose request carried none
  have that field empty, and no entry has the two address fields conflated.
- **SC-002**: Turning recording on adds **one row insert** to a request and nothing else — no
  extra round trip, no second connection, no `users` lookup. Since the entry is written before
  the response is delivered (FR-001a), that insert is on the critical path, and its cost is
  measured against a real store rather than estimated. *(Revised 2026-08-14. This criterion
  previously fixed a budget of +5 ms median and +15 ms p95. Measured — see tasks.md T034 — the
  shipped write costs 5–9 ms median on the dev stack, over that budget, and the overage is
  **not** the feature: >90% of it is the commit floor of any single-row insert on that box's
  storage, with shaping at ~0.3 ms and index maintenance at ~0.2 ms. The product owner's call
  on seeing those numbers was that latency at this scale is not a concern for this site
  ("7 ms is nothing, I'd say even 80 ms is nothing"), so the numeric budget is withdrawn rather
  than left in the spec as a criterion nobody intends to enforce. What remains is the shape of
  the work — one insert — which is what kept it cheap in the first place and is enforced by
  `AccessLogService` doing exactly one `save()`.)*
- **SC-002a**: For every request in that run, the entry is already retrievable from the history
  at the instant the response is received — zero requests observe a response whose entry has
  not yet landed.
- **SC-003**: After a complete authentication journey (register, verify, sign in, change
  password, request recovery, reset password, sign out), a search of the entire history for
  the passwords used and for the visitor's session identifier returns zero matches, while the
  entries for those requests are all present with their paths and response codes intact.
- **SC-004**: With recording disabled, the same scripted run adds zero new entries, leaves all
  previously recorded entries in place, and produces responses identical to a run with the
  feature absent.
- **SC-005**: A single upload of **the largest file the site accepts** — a 20 MiB video, the
  ceiling the upload endpoint enforces — produces exactly one entry, and that entry is no larger
  than 64 KB: the file's bytes are absent and only its field name, filename, declared type, and
  size are recorded (FR-017). The upload path is bounded by what is recorded, not by truncation.
  The size is named against the deployment's real limit deliberately: a figure the site would
  refuse outright would prove nothing about FR-017, because a rejected request carries no file to
  leave out of the entry.
- **SC-005a**: A request carrying a value larger than the limit produces an entry whose copy of
  that value is exactly the limit's worth, explicitly marked as truncated, while every other
  value in the same request is recorded in full and unmarked — confirming the limit is applied
  per value (FR-018a) and not shared across the entry. The truncation marker is additional to
  that copy rather than carved out of it, so a marked value is slightly longer than the limit.
- **SC-005b**: An upload *larger* than the deployment accepts — one refused for its size before
  the application can parse it — still produces exactly one entry, carrying the rejection's
  response code, its path and its method, with the parameter and file fields empty because no
  parsed content ever existed. This is FR-001's "rejected by a guard" case in its most common
  form, and it is the criterion that a very large upload actually exercises.
- **SC-006**: With the store made unavailable, the same scripted run completes with every
  request receiving its normal response and status code; no visitor-facing request fails
  because the history could not be written. Repeated with the store made *slow* rather than
  unavailable, no request exceeds its normal completion time by more than the write's bound —
  a degraded store degrades recording, never availability.
- **SC-007**: After the retention routine runs against a history seeded on both sides of the
  window, 100% of entries older than the window are gone and 100% of newer entries remain; a
  second run changes nothing. This holds identically whether the run was started by an
  operator or by the daily schedule, and the schedule fires on a deployment where nobody
  configured it.
- **SC-008**: An operator can answer "every request from this address in the last hour" — asked
  against either address field — "every request by this account today", and "every request that
  returned a server error yesterday" **from the shipped columns alone**, with no derived table,
  no added column and no reprocessing of what was stored. Each is a single `SELECT` over
  `access_logs`. *(Revised 2026-08-14: this criterion previously also required each query to
  return in under 5 seconds against 1,000,000 entries. The five lookup indexes that bound was
  written for were dropped — the history is read rarely and by hand, and measurement showed
  they cost disk on the schema's only unbounded table while buying 0.10 ms of a 5.03 ms write.
  Answerability is the requirement; latency at a terminal is not. See data-model.md → Indexes.)*
- **SC-009**: The history is not reachable over HTTP at all: a scripted probe of every address
  the site exposes — public and operator-only alike — returns no access-log content in any
  response body or header, and this feature adds zero new addresses.
- **SC-010**: A run that fetches 50 stored media files and the site's static assets produces
  zero entries, confirming the scope boundary holds in practice rather than by omission.
- **SC-011**: The queries a future viewer would issue — newest-first paging, and filtering by
  time range, network address, path, account, or response code — are all expressible against
  the fields and structure this feature ships. No column is added and no entry is rewritten to
  serve them. *(Revised 2026-08-14, same decision as SC-008: the "under 5 seconds against
  1,000,000 entries" bound came with the five lookup indexes and went with them. What
  forward-compatibility promised was always the **columns** — a viewer that wants one of these
  fast can add its own index then, against data already stored, with no backfill. Newest-first
  paging stays indexed regardless, since `(created_at, id)` is retained for the prune.)*

## Assumptions

- **Placement**: Recording happens around the application's own request handling, so the
  elapsed time measured is the time the application spent producing the response, and the
  recorded response code is the one actually sent. The entry is written **synchronously, before
  the response is delivered** (FR-001a) — no queue, no worker, no background buffer — which is
  what makes "answered implies recorded" true, and what puts the write inside the SC-002
  budget. The tradeoff was taken deliberately: the guarantee is worth the latency, provided the
  write stays bounded (FR-025a) so an unavailable store cannot hold a response open.
- **Retention default**: 30 days, configurable. Chosen as a common operational default that
  covers incident investigation without accumulating indefinitely. Pruning is enabled by
  default and runs daily on the application's own scheduler (FR-027a) rather than waiting for
  an operator, so the storage bound holds on an unattended deployment. This assumes the
  application's scheduler is actually being driven in the deployment environment; where it is
  not, the manual invocation remains the fallback and the history is unbounded until it is
  used.
- **Size limit default**: 64 KB **per recorded value**, configurable, with truncation marked
  (FR-018a). Chosen so that any single field an operator wants to read is preserved to a useful
  length without one oversized field crowding out the rest of the request. Note this is not a
  per-entry ceiling: typical entries are far smaller than the limit because typical values are,
  but a pathological request with many large values yields a large entry (FR-018b), and storage
  planning should be based on observed traffic rather than on the limit alone.
- **Excluded paths default**: the container health probe is excluded out of the box, because
  it is polled continuously and would otherwise dominate the history. No other path is
  excluded by default.
- **Timestamps** are stored in UTC, consistent with the rest of the site's records.
- **The environment switch is read at startup**, matching how the site's other environment
  settings behave; changing it takes effect on the next restart, not mid-process.
- **No new dependency** is expected. Storage uses the existing database and ORM; the switch
  uses the existing configuration mechanism. Should any candidate dependency emerge during
  planning, it is subject to the constitution's prior-approval rule.
- **Redaction is name-based**, not content-based: the system withholds values whose field or
  cookie name is on the sensitive list. It does not attempt to detect a secret by inspecting
  an arbitrary value.
- **Personal data**: recording network addresses and request bodies alongside account
  identifiers means the history holds personal data. The bounded retention window (FR-023)
  and the operator-only access rule (FR-028) are the controls this feature provides; a formal
  data-protection process is out of scope.
- **No frontend change**: this is server-side recording with no visitor-facing and no
  operator-facing surface (FR-030). An admin console viewer is a plausible follow-up feature;
  this spec's obligation to it is structural only (FR-031), not a commitment to build it.
- **Media and static-asset traffic is out of scope** (FR-032). The web server in front of the
  application answers those requests without involving the application, so an
  application-level recorder cannot observe them. Ingesting the web server's own logs is a
  separate mechanism with different fields, and is not part of this feature. A consequence
  worth stating plainly: the history answers "who called the API for this meme", never "who
  fetched this image file".
- **Existing behaviour is untouched**: no existing endpoint, response, or schema changes
  beyond the addition of the history table.
