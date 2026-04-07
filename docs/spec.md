# bun-readlater-epub v1 technical spec

## Goal

Build a self-hosted Instapaper-like service that accepts article URLs from Safari, fetches and normalizes article content and images, produces self-contained EPUB files, and stores them inside a dedicated Calibre article library for later reading via OPDS and KOReader.

## Problem being solved

Current workflow is fragmented:

- discover article in Safari
- save manually through ad-hoc means
- later read elsewhere
- no clean server-side article-to-EPUB workflow

The service should collapse that into a single save action and a durable reading output.

## User and environment

- primary user: single user
- environment: trusted LAN
- auth: shared secret token
- primary capture surface: Safari bookmarklet
- primary reading surface: KOReader via OPDS
- runtime: Bun on Linux

## Dependency policy

Direct dependencies should remain intentionally small.

### Approved direct dependencies for current v1 planning

- `@mozilla/readability` — article extraction
- `linkedom` — DOM implementation required by Readability
- `@types/bun` / `bun-types` — development-time typing only

### Image-processing dependency recommendation

- preferred first spike: `imagescript`
- rationale: no native install step, direct decode/resize/encode support, and enough pixel access for custom grayscale and dithering logic
- possible future refinement: `@jsquash/jpeg`, `@jsquash/png`, and `@jsquash/resize` if we want a more modular codec pipeline later

### Dependency rules

- prefer Bun built-ins and stdlib-style code wherever possible
- do not add EPUB helper libraries for the core writer
- do not add Calibre wrapper libraries for DB/library management
- do not add browser automation or queue frameworks for v1
- any new runtime dependency must be justified by meaningful complexity reduction
- `linkedom` is the dependency to keep under review because it carries most of the transitive parser stack

## Explicit v1 scope

### Included

- Safari bookmarklet submission flow
- fast acknowledgement + background processing
- serial job queue
- readability-like extraction
- lead and inline image capture
- self-contained EPUB packaging
- create and maintain the dedicated Calibre `metadata.db` directly in Bun
- write into a real dedicated Calibre library
- canonical URL dedupe
- explicit re-fetch of existing items
- retry/failure handling
- minimal HTML queue/status UI with retry/refetch controls
- paywall fallback via archive.is or similar configurable provider
- service DB to track workflow state independently of Calibre

### Excluded

- multi-user auth/accounting
- browser extensions beyond bookmarklet
- feed/newsletter ingestion
- headless browser rendering
- cookie/session replay
- multiple article revisions in the Calibre library
- rich frontend framework
- direct send-to-device logic
- ML summarisation/tagging
- persistent debug/source artifact archive by default

## Data model

### Core item lifecycle

States:

- `queued`
- `fetching`
- `fallback`
- `building`
- `saved`
- `duplicate`
- `failed`

### Service DB tables (proposed)

#### `items`

- `id` TEXT primary key
- `submitted_url` TEXT not null
- `canonical_url` TEXT
- `status` TEXT not null
- `title` TEXT
- `author` TEXT
- `published_at` TEXT
- `source_domain` TEXT
- `source_url` TEXT
- `fallback_url` TEXT
- `content_hash` TEXT
- `unread` INTEGER not null default 1
- `queued` INTEGER not null default 1
- `calibre_book_id` INTEGER
- `calibre_book_path` TEXT
- `last_error` TEXT
- `created_at` TEXT not null
- `updated_at` TEXT not null
- `last_attempted_at` TEXT
- `last_saved_at` TEXT
- `last_refetched_at` TEXT
- `refetch_count` INTEGER not null default 0

Unique index:
- `canonical_url`

#### `item_attempts`

- `id` TEXT primary key
- `item_id` TEXT not null
- `attempt_kind` TEXT not null (`save`, `retry`, `refetch`)
- `status` TEXT not null
- `message` TEXT
- `started_at` TEXT not null
- `finished_at` TEXT

## Dedupe and re-fetch semantics

### Dedupe key

- primary: normalized canonical URL
- canonical normalization should strip fragments, remove common tracking parameters, normalize host/protocol casing, remove default ports, and prefer declared canonical metadata when available
- store submitted URL and content hash as secondary metadata

### Duplicate submit

- return existing item by default
- do not create a second Calibre record

### Explicit re-fetch

- allowed for an existing canonical URL
- rebuilds/replaces the existing EPUB in place when content changed
- preserves logical linkage to the existing Calibre item where possible
- updates timestamps and content hash
- if the rebuilt content hash is unchanged, skip the library rewrite and record the refetch as unchanged

## Calibre integration model

- use a dedicated article library under a broader reading storage root
- Calibre is the delivery and storage target, not the workflow DB
- the service creates and maintains the article library `metadata.db` itself in Bun
- service DB tracks queue state, failures, dedupe, and refetch history

### Metadata policy

For each saved article:

- title: extracted article title
- author: extracted author or fallback to source/site
- publication date: extracted if available
- tags: source domain + `readlater`
- source/canonical URL stored in metadata/comments as available

### Read/unread state

- stored only in the service DB for v1
- not mirrored into Calibre custom columns initially

## Fetch and extraction pipeline

### Normal path

1. accept submitted URL
2. fetch URL using a normal-browser request profile, ideally Safari-like headers
3. resolve redirects/canonical URL and normalize it for dedupe purposes
4. parse article with readability-like extraction
5. normalize body HTML/XHTML
6. fetch and rewrite lead/inline images
7. embed fetched images into the EPUB package and rewrite references locally
8. generate EPUB package
9. write/import into Calibre library
10. update DB record to `saved`

### Fallback path

When normal fetch or extraction fails:

1. record transition to `fallback`
2. try configured archive provider (e.g. archive.is)
3. repeat extraction pipeline on fallback source
4. expose fallback state while processing the fallback source
5. store fallback provenance URL on the item record
6. save if successful, otherwise mark `failed`

## Minimal API surface

### `POST /save`

Input:

```json
{
  "url": "https://example.com/article",
  "token": "shared-secret"
}
```

Response:

- quick acknowledgement
- item id
- status (`queued`, `duplicate`, etc.)
- existing item reference if deduped

### `GET /items`

- minimal HTML or JSON list of queued/failed/saved items
- enough to inspect failures and queue state

### `GET /items/:id`

- item detail view
- latest state, URLs, metadata, errors

### `POST /items/:id/retry`

- retry failed item without changing dedupe identity

### `POST /items/:id/refetch`

- explicit rebuild for an existing saved item

## Bookmarklet flow

Hybrid model:

- bookmarklet sends URL to `/save`
- service responds quickly with acknowledgement page
- background worker continues processing
- user checks result later in queue/status UI or via OPDS/KOReader

## Image processing policy

The image pipeline should be optimized for article reading on e-ink devices rather than preserving web originals exactly.

### Planned output modes

- `gray8` — 8-bit grayscale for photos, gradients, and shaded illustrations
- `gray4-dither` — 4-level grayscale with dithering for diagrams, screenshots, UI captures, and other high-contrast images

### Selection strategy

Default behaviour should be adaptive:

- prefer `gray8` for photo-like or gradient-heavy images
- prefer `gray4-dither` for diagram-like, screenshot-like, or high-contrast images
- allow a future explicit override per item or globally

### Implementation direction

- prefer a WASM-oriented image pipeline over native dependencies
- decode, transform, and re-encode images inside the Bun app where practical
- avoid large framework-style image libraries unless the implementation cost clearly justifies them
- first implementation candidate: `imagescript` for decode/resize/encode plus custom grayscale/dither transforms
- lower-level future candidate: `@jsquash/*` if we later want more explicit codec/resize composition

### Planned transform pipeline

1. decode source image
2. optionally resize to a sane maximum for EPUB/e-ink use (default cap: 800×600)
3. convert to grayscale luminance
4. classify image coarsely as photo-like vs diagram/screenshot-like
5. choose output mode:
   - `gray8` for photo-like images
   - `gray4-dither` for diagram/screenshot-like images
6. encode the transformed asset for EPUB embedding

### Planned gray4-dither behaviour

- quantize grayscale output to 4 luminance levels
- use ordered or error-diffusion dithering to preserve edge detail and contrast
- prefer readability/contrast over photographic smoothness

## Fetch profile

The fetcher should not present itself as a generic script client by default.

For v1 it should:

- spoof a normal browser request profile
- prefer a Safari-like header set by default
- send realistic `User-Agent`, `Accept`, `Accept-Language`, and related navigation headers
- apply request timeouts and bounded retries for idempotent fetches
- validate content type before article parsing
- reject oversized HTML payloads using header and post-read checks
- avoid headless-browser rendering, but still try to look like an ordinary article fetch from a browser

This is intended to reduce trivial bot blocking and improve parity with what Safari itself would receive.

## Security model

- trusted LAN deployment
- shared secret token for bookmarklet and minimal UI/API
- no public exposure assumed in v1
- no multi-user separation

## Performance model

- serial processing only
- no headless browser
- modest memory footprint
- slow/failing jobs become visible states, not indefinite hangs
- bookmarklet response should be fast; processing can continue in background

## Export/storage policy

Persist by default only:

- service DB metadata
- final EPUB in Calibre library
- Calibre `metadata.db`
- logs/errors

Temporary built EPUBs should be removed after successful import into the article library.

Do not persist source/debug artifacts by default.

## Acceptance criteria

V1 is done when the following all work:

1. click Safari bookmarklet on an article page
2. receive quick acknowledgement
3. background job processes the article
4. resulting EPUB is self-contained and readable offline, including fetched article images
5. embedded images should be eligible for adaptive e-ink-oriented grayscale processing
5. title/author/date/source metadata are sane
6. lead and inline images are included when available
7. EPUB lands in the dedicated Calibre article library
8. item is visible downstream via OPDS/KOReader
9. duplicate submission returns existing item instead of creating a second record
10. explicit refetch replaces existing item in place
11. failures are visible in a minimal UI
12. wrong/missing token is rejected

## Test plan

1. normal public article save
2. repeated save of same URL dedupes
3. explicit refetch rebuilds existing item
4. article with lead + inline images renders offline
5. poor markup still extracts reasonably or fails cleanly
6. broken URL becomes `failed`
7. image failure still allows EPUB if body text is usable
8. fallback/archive failure is recorded cleanly
9. bookmarklet acknowledgement page returns quickly
10. OPDS/KOReader can read the resulting EPUB
11. wrong token is rejected
12. changed article content updates hash and replaces in place on refetch

## Suggested implementation order

1. core library + CLI pipeline
2. create EPUB writer directly with Bun/stdlib primitives
3. create and maintain Calibre `metadata.db` directly in Bun
4. minimal web service and `/save`
5. bookmarklet end-to-end flow
6. queue/status UI
7. retry/refetch actions and fallback polish
