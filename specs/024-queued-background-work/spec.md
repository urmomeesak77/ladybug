# Feature Specification: Queued Background Work

**Feature Branch**: `024-queued-background-work`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Queued background processing for slow work. Today php-fpm runs only
3 workers on a 1 vCPU / 960 MiB VPS, and slow synchronous work inside requests ties them up so the
whole site (including every page load, which renders the SPA shell through PHP) stalls: (1)
outgoing mail — the email-verification message (registration, resend) and the password-recovery
message are sent over SMTP inside the request, which also makes /api/password/forgot slower for
real accounts than unknown ones (timing oracle); (2) upload media processing — image size variants
via GD/gifsicle/ImageMagick, video remux + poster extraction via ffmpeg, and the YouTube thumbnail
download, all inline in POST /api/posts. Move this work to a database-backed queue processed by a
dedicated queue worker service in the production compose stack (with a memory limit,
max-jobs/max-time recycling, and a job timeout so a hung ffmpeg/convert is killed), so web
requests return promptly. Uploads: the request validates (including the existing MaxPixels and
ffprobe checks), stores the raw upload, creates the post row and answers immediately; the post
becomes viewable (and, for trusted uploaders, auto-activated) only once processing succeeds. While
processing, the uploader landing on the post's permalink sees a clear, accessible 'processing'
state that updates by itself when the media is ready; a processing failure leaves the uploader a
clear failed state and removes partial files, and never leaves a half-processed post public. Mail:
the same messages, sent from the queue, with the forgot-password response time no longer depending
on whether the account exists. Failed jobs are retained for the operator. No new Composer/npm
dependencies."

## Overview

The site answers every request — every page load included — from a pool of three application
workers on a single small server. Two kinds of slow work currently run *inside* those requests:
sending e-mail, and turning an upload into the media the feed serves (resized image variants, a
re-packaged video and its still frame, a YouTube still). While a worker does that, it answers
nobody else. Three uploads at once, or a slow mail server, and the whole site stops answering
for everyone until they finish.

The mail path has a second problem: "send me a recovery link" takes visibly longer for an address
that has an account (a message is actually sent) than for one that does not, so the response
time tells an observer which addresses are registered — exactly what the identical response text
was designed to hide.

This feature moves that slow work off the request path. A request records what needs doing and
answers at once; a separate, resource-capped background worker does the work. For uploads, that
means a new post exists the moment the request returns, but stays out of public view until its
media is ready; the uploader sees it being prepared, then ready, without reloading.

Nothing about what is uploaded, what is validated, what e-mails say, moderation, ratings, or who
may see what changes. Only *when* the slow part happens, and on which worker.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The site stays responsive while uploads are being processed (Priority: P1)

A visitor browsing the feed or opening a meme gets their page at normal speed even while several
other members are uploading large images or videos at the same moment.

**Why this priority**: This is the outage the feature exists to end. Today a handful of
concurrent uploads makes the whole site unresponsive for every visitor.

**Independent Test**: Start several maximum-size uploads at once and, while they are being
processed, load the home page and a permalink repeatedly; every load answers at its normal speed.

**Acceptance Scenarios**:

1. **Given** three members each submit a maximum-size video at the same moment, **When** a
   visitor loads the home page during their processing, **Then** the page answers in its normal
   time.
2. **Given** an upload is submitted, **When** the upload request completes, **Then** it answered
   without waiting for any resizing, re-packaging, frame extraction or thumbnail download.
3. **Given** the background worker is processing an upload, **When** that processing exhausts its
   own memory or time allowance, **Then** only that job fails; the site's page and API answers are
   unaffected.

---

### User Story 2 - The uploader follows their upload from "processing" to ready (Priority: P1)

After submitting, the uploader lands on their new post's page as today. If the media is not ready
yet, the page clearly says it is being prepared, and turns into the finished post by itself when
processing completes — or into a clear "processing failed" message if it cannot be completed.

**Why this priority**: Moving processing off the request is only acceptable if the uploader is
never left looking at a broken or empty post with no explanation.

**Independent Test**: Upload an image, land on the permalink before processing finishes, observe
the processing state, wait, and observe the finished post appear without reloading; repeat with a
file that fails processing and observe the failed state.

**Acceptance Scenarios**:

1. **Given** a member has just uploaded, **When** they land on the post's page before processing
   finishes, **Then** they see a processing state that is announced to assistive technology and
   identifiable without relying on colour.
2. **Given** the uploader is viewing the processing state, **When** processing completes,
   **Then** the page shows the finished post without the uploader reloading, within a few seconds.
3. **Given** processing fails, **When** the uploader views the post's page, **Then** they see that
   processing failed and that they may try uploading again, and no partial media for that post
   remains stored.
4. **Given** the uploader refreshes, leaves and comes back, or shares the address while the post
   is processing, **Then** the same processing state is shown to the uploader, and anyone else
   sees the same "not found" any non-public post shows today.

---

### User Story 3 - A post is never public before its media is ready (Priority: P1)

The public feed, a post's public page, the sitemap, the crawlable page body and link previews
never show a post whose media is still being prepared or whose preparation failed. A trusted
uploader's post goes live automatically, but only once its media is ready; anyone else's waits
for a moderator exactly as today, and the moderator never approves a post whose media is not
ready.

**Why this priority**: A half-processed post in public is a broken feed entry for every visitor,
and a moderation decision about media that does not exist yet.

**Independent Test**: Upload as a trusted member and as an ordinary member; during processing
check the feed, permalink (as a visitor), sitemap and preview image; after processing check that
the trusted post is live and the ordinary one is waiting for a moderator.

**Acceptance Scenarios**:

1. **Given** a trusted member's upload is processing, **When** a visitor views the feed, the
   sitemap or the post's address, **Then** the post is absent exactly as any non-public post is.
2. **Given** a trusted member's upload finishes processing successfully, **Then** it goes live and
   the uploader receives the same rating credit as today, once.
3. **Given** a trusted member's upload fails processing, **Then** it never goes live and no rating
   credit is given.
4. **Given** an ordinary member's upload is processing, **When** a moderator opens the moderation
   console, **Then** the post is shown as processing and cannot be activated until processing
   succeeds.
5. **Given** a failed upload, **When** a moderator views it, **Then** it is shown as failed and can
   be deleted or purged like any other post.

---

### User Story 4 - E-mail no longer holds up the request, or betrays which addresses exist (Priority: P2)

Registering, asking for a new verification message, and asking for a password-recovery link all
answer promptly regardless of how slow or unreachable the mail server is. The recovery request
takes the same time whether or not the address belongs to an account. The messages themselves —
recipients, wording, links, expiry — are exactly what they are today.

**Why this priority**: It closes an existing account-enumeration side channel and removes the
second source of worker starvation, but uploads cause the larger outages.

**Independent Test**: With the mail server delayed or unreachable, register and request a
recovery link; both answer promptly. Time recovery requests for a registered and an unregistered
address; the distributions are indistinguishable. Once the mail server is reachable, the messages
arrive and their links work.

**Acceptance Scenarios**:

1. **Given** the mail server takes 10 seconds to accept a message, **When** a visitor registers,
   **Then** registration answers without waiting for it and the verification message is still
   delivered.
2. **Given** an address with an account and one without, **When** recovery is requested for each,
   **Then** the response time does not reveal which one has an account.
3. **Given** the mail server is unreachable when a message is due, **Then** sending is retried,
   and a message that ultimately cannot be sent is kept on record for the operator.
4. **Given** a verification or recovery message is delivered after a delay, **Then** its link is
   valid for its full lifetime as measured from when it was issued, exactly as today.

---

### User Story 5 - The operator can see and recover failed background work (Priority: P3)

When background work fails for good — an upload that could not be processed, a message that could
not be sent — the operator can see what failed and why, and can retry it once the cause is fixed.
The background worker restarts itself after crashes and periodically recycles itself so it cannot
slowly leak memory.

**Why this priority**: Without it, failures are silent; but the feature delivers its main value
without operator tooling beyond what the framework already offers.

**Independent Test**: Make a mail send fail permanently, confirm it is listed as failed with its
reason, fix the cause, retry it, and confirm delivery.

**Acceptance Scenarios**:

1. **Given** a job failed permanently, **Then** it is retained with its failure reason until the
   operator retries or discards it.
2. **Given** the worker process is killed, **Then** it is restarted automatically and resumes
   pending work without losing any.
3. **Given** the worker is down while uploads keep arriving, **Then** uploads are still accepted,
   the posts stay in the processing state, and they are processed once the worker returns.

---

### Edge Cases

- The worker is unavailable for a long time: uploads are accepted and remain "processing"; nothing
  is lost; they complete when it returns.
- A job is interrupted mid-way (worker killed, server restarted): it is run again from the start
  and its result is the same as one uninterrupted run — no duplicate files, no second rating
  credit, no double activation.
- A file passes the request-time checks but fails during processing (a codec quirk, a resource
  limit): the post ends in the failed state, its partial files are removed, the uploaded original
  is discarded, and the uploader is told.
- A moderator deletes or purges a post while it is still processing: processing stops affecting
  it — a purged post leaves no files behind, and a deleted post does not come back to life.
- The uploader's account is disabled or deleted while their upload is processing: processing
  completes or fails as normal; the post's visibility follows the existing rules for that state.
- A YouTube post: there is nothing to resize, but its still is downloaded in the background; a
  failed still download does not fail the post (as today, the still is best-effort).
- An e-mail address changes, or an account is deleted, between the request and the send: the
  message is not sent to an account that no longer exists.
- Two verification messages are requested in quick succession: the existing rate limits still
  apply at request time, and each message carries a valid link as today.
- The server's temporary space fills up while uploads are queued: new uploads are refused with a
  clear message rather than accepted and silently lost.

## Requirements *(mandatory)*

### Functional Requirements

**Request path**

- **FR-001**: An upload request MUST complete all existing validation (title, exactly-one-of
  image/video/YouTube, type, size, pixel area, decodable video, valid YouTube link) before
  answering, and MUST answer without performing any resizing, re-packaging, frame extraction or
  remote download.
- **FR-002**: A successful upload request MUST create the post (with its public identifier) and
  durably keep the submitted file so the background work can use it, and MUST return the post's
  identifier so the uploader can be taken to its page as today.
- **FR-003**: Registration, verification resend and password-recovery requests MUST answer without
  waiting for any message to be handed to the mail server.
- **FR-004**: The password-recovery request's response time MUST NOT depend on whether the
  submitted address belongs to an account, a disabled account, or no account.

**Processing states**

- **FR-005**: Every uploaded post MUST carry a processing state: *processing*, *ready*, or
  *failed*. Posts that existed before this feature are *ready*.
- **FR-006**: A post MUST NOT be publicly visible — feed, public permalink, crawlable page body,
  sitemap, link-preview image — unless it is *ready* and activated. This is in addition to every
  existing visibility rule.
- **FR-007**: When a trusted uploader's post becomes *ready*, it MUST be activated and the uploader
  credited exactly as an upload is today; the trust decision MUST use the uploader's standing at
  the moment of upload, as today. A *failed* post MUST never be activated or credited.
- **FR-008**: A moderator MUST NOT be able to activate a post that is not *ready*; the moderation
  console MUST show each post's processing state (as text, not colour alone).
- **FR-009**: The uploader (and admins) MUST be able to open a *processing* or *failed* post's
  page; everyone else MUST get the same not-found answer any non-public post gives today.

**Uploader experience**

- **FR-010**: While a post is *processing*, its page MUST show the uploader a processing state
  that is announced to assistive technology and does not rely on colour alone.
- **FR-011**: The processing state MUST turn into the finished post, or into the failed state,
  without the uploader reloading, within 5 seconds of processing ending.
- **FR-012**: The failed state MUST tell the uploader that their media could not be processed and
  that they may upload it again.
- **FR-013**: The upload page MUST NOT tell the uploader their post is live before it is; after a
  successful submission it takes them to the post's page as today.

**Background work**

- **FR-014**: Media processing for an upload MUST produce exactly the same stored media, variants
  and metadata the inline path produces today for the same file.
- **FR-015**: When processing fails, all files written for that post MUST be removed and the post
  marked *failed*; the kept original upload MUST be removed once the post is *ready* or *failed*.
- **FR-016**: Processing MUST be safe to run more than once for the same post (after an
  interruption): the outcome MUST equal one successful run — no duplicate files, no second
  activation, no second credit.
- **FR-017**: If the post was deleted or purged before its processing runs or finishes, the
  processing MUST NOT restore, activate or credit it, and MUST leave no files behind for a purged
  post.
- **FR-018**: A YouTube post's still MUST be fetched in the background; a failed fetch MUST NOT
  fail the post (best-effort, as today). A YouTube post MUST be *ready* without waiting for media
  processing, since it has none.
- **FR-019**: Verification and recovery messages MUST be sent by the background worker with the
  same recipients, content, links and link lifetimes as today, and MUST NOT be sent to an account
  that no longer exists when the send runs.
- **FR-020**: Background work that fails transiently (mail server unreachable, remote still
  download) MUST be retried a bounded number of times with increasing delay; media processing
  that fails because the file cannot be processed MUST NOT be retried.
- **FR-021**: Work that fails permanently MUST be retained with its failure reason until the
  operator retries or discards it.

**Worker operation**

- **FR-022**: Background work MUST run in a dedicated process, separate from the request workers,
  that is restarted automatically if it exits.
- **FR-023**: The background process MUST have its own memory ceiling, MUST recycle itself after a
  bounded number of jobs or a bounded lifetime, and MUST stop any single job that exceeds its time
  allowance — including external media tools it started.
- **FR-024**: Background work MUST survive a restart of the worker or the server: queued work is
  durable and is picked up again.
- **FR-025**: Deploying a new release MUST make the worker pick up the new code, and MUST NOT lose
  queued work.
- **FR-026**: No new third-party packages MAY be added (Constitution Principle I).

### Key Entities

- **Post (Trashpost)**: gains a *processing state* (processing / ready / failed), and, while
  processing, a reference to the kept original upload. The state is never exposed to the public
  — only to the uploader and admins.
- **Background job**: a durable record of work to do (process this post's media; fetch this
  post's still; send this message), with its attempt count and, when it fails for good, the
  reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: While three maximum-size uploads are being processed at once, the home page and a
  permalink answer within their normal time (no more than 20% slower than with no uploads).
- **SC-002**: An upload request answers within 2 seconds of the file finishing transfer, for every
  accepted file type and size.
- **SC-003**: For a maximum-size image or video, the uploader sees the finished post within 60
  seconds of submitting, on the production server, when no other work is queued.
- **SC-004**: Registration and recovery requests answer within 1 second even when the mail server
  takes 10 seconds or more to accept a message.
- **SC-005**: Over 100 recovery requests each for a registered and an unregistered address, the
  median response times differ by less than 50 milliseconds.
- **SC-006**: No post is ever observed publicly (feed, permalink, sitemap, preview) while
  *processing* or *failed*.
- **SC-007**: Every message that would be sent today is still delivered once the mail server is
  reachable, and none is sent twice.
- **SC-008**: After the worker is killed mid-job, every affected upload still ends *ready* or
  *failed*, with no orphaned files and no double credit.

## Assumptions

- "Trusted uploader" and the rating credit are the existing rules from feature 011, unchanged; only
  the moment activation happens moves to the end of processing.
- The production server can spare memory for one more long-running process; the memory budget
  set by the recent deployment hardening reserved room for it (about 192 MiB without media work,
  more when it processes media, with the request workers sized down to compensate).
- One background worker is enough: work is processed one job at a time, in order of arrival. A
  slow job delays later jobs, not page loads.
- The development and test environments run the same background work; automated tests may run
  jobs immediately (in-process) as long as they exercise the same code.
- The uploader's page learns that processing ended by re-checking periodically while it shows the
  processing state; no push channel is introduced.
- Existing media and posts are untouched: everything already stored is *ready*.
- The operator retries or discards failed work with the framework's existing commands; no new admin
  screen is built for it.
- Request-time rate limits for uploads, comments, registration, recovery and verification stay as
  they are.
