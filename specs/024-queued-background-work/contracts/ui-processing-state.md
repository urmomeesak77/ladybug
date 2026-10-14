# Contract: Uploader-facing processing UI (024)

## PostPage (`/posts/:hash`)

| `media_state` | Rendered |
|---|---|
| `ready` | The post exactly as today. |
| `processing` | Title + a status block: `role="status"`, text "Your upload is being processed. This page will update by itself." and a decorative spinner (`aria-hidden="true"`). No media element. |
| `failed` | Title + `role="alert"` block: "We couldn't process this upload." and a link "Upload it again" to `/upload`. |

- While `processing`, the post is re-fetched every 2 s; fetching pauses while `document.hidden` and
  stops on unmount or when the state leaves `processing`. The swap to `ready`/`failed` happens in
  place (no navigation, URL unchanged — Principle III).
- Text carries the meaning; colour/animation are decorative (Principle IV). The spinner respects
  `prefers-reduced-motion`.

## Moderation console (`/admin/trashposts`)

- A text badge per row: "Processing" or "Processing failed" (absent when ready).
- The row's action menu omits **Activate** unless `media_state === "ready"`; Delete/Purge remain.

## Upload page

Unchanged: on 201 it navigates to `/posts/{hash}`, where the processing state takes over.
