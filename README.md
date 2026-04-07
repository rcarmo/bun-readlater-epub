# bun-readlater-epub

A self-hosted, Bun-based read-later service that turns saved article URLs into self-contained EPUBs inside a dedicated Calibre library.

It is designed for a simple personal workflow:

- save from Safari via a bookmarklet
- fetch and clean up the article server-side
- embed images for offline reading
- write the result to a Calibre-compatible library
- read later through OPDS and KOReader

License: MIT © Rui Carmo

## Why this exists

Most read-later services stop at storing a URL or cleaned HTML. This project aims to produce a durable, portable reading artifact:

- a real EPUB
- stored in your own library
- managed with a small service DB
- consumable through an existing Calibre/OPDS setup

## Current status

The project already includes:

- Safari bookmarklet flow
- plain form-submit bookmarklet for better browser compatibility
- HTML acknowledgement page after save
- queue/status web UI
- item detail page with attempt history
- retry/refetch controls in the UI
- URL normalization and canonical dedupe
- archive fallback support
- fetch timeout/retry/content-size protections
- EPUB generation implemented directly in Bun
- Calibre `metadata.db` and library writing implemented directly in Bun
- adaptive grayscale image processing for e-ink-oriented reading
- unchanged-content short-circuiting on refetch
- end-to-end tests
- Dockerfile, Compose file, and GHCR publish workflow scaffold

## Scope for v1

- single-user, trusted LAN
- shared-secret token auth
- Safari bookmarklet entrypoint
- serial queue processing
- readability-style article extraction
- Safari-like browser spoofing for fetch requests
- fetch hardening with timeout, retry, content-type validation, and HTML size limits
- lead + inline image capture with local embedding into the EPUB package
- adaptive e-ink image processing:
  - `gray8`
  - `gray4-dither`
- self-contained EPUB output
- dedicated Calibre article library
- canonical-URL dedupe with URL normalization and tracking-parameter stripping
- explicit re-fetch for existing items, with unchanged-content short-circuiting
- minimal HTML status/queue UI with retry/refetch controls
- archive fallback support with provenance recorded per item
- temporary built EPUB cleanup after successful library import

## Architecture

- `src/server.ts` — web service and routes
- `src/queue/` — serial queue and item state transitions
- `src/fetch/` — browser-like fetch, normalization, extraction, fallback logic
- `src/epub/` — EPUB packaging implemented directly with Bun/stdlib primitives
- `src/calibre/` — Calibre-compatible library and `metadata.db` management
- `src/db/` — service SQLite schema and workflow state
- `docs/spec.md` — detailed technical spec

## Design constraints

- create and maintain the dedicated Calibre `metadata.db` directly in Bun
- generate EPUB containers directly in Bun/stdlib code
- avoid external EPUB or Calibre-management libraries for the core write path
- keep runtime dependencies intentionally small

## Quick start

### Local

```bash
cp .env.example .env
# edit READLATER_TOKEN and any paths you want to change
bun install
bun run src/server.ts
```

Then open:

- `http://localhost:8788/items`
- `http://localhost:8788/bookmarklet`

### Docker Compose

```bash
cp .env.example .env
# edit READLATER_TOKEN first
docker compose up -d --build
```

Default mounts:

- `./data` → service DB
- `./books` → generated Calibre article library

The container now supports LinuxServer-style ownership overrides via:

- `PUID`
- `PGID`

The bundled `docker-compose.yml` passes those through automatically.

## Configuration

Important environment variables:

- `PUID` / `PGID` — optional container runtime UID/GID remapping for Docker deployments
- `READLATER_TOKEN` — shared secret for bookmarklet/UI actions
- `READLATER_DB_PATH` — service SQLite DB path
- `CALIBRE_ARTICLE_LIBRARY` — output Calibre article library root
- `ARCHIVE_FALLBACK_BASE_URL` — optional fallback provider base URL
- `READLATER_FETCH_TIMEOUT_MS` — fetch timeout per request
- `READLATER_FETCH_MAX_HTML_BYTES` — maximum accepted HTML payload size
- `READLATER_FETCH_RETRIES` — GET retry count for retryable failures
- `READLATER_IMAGE_MAX_WIDTH` / `READLATER_IMAGE_MAX_HEIGHT` — image resize cap

See `.env.example` for a minimal starting configuration.

## Deployment files

Prepared deployment/publishing files:

- `.env.example`
- `docker-compose.yml`
- `.dockerignore`
- `Dockerfile`
- `docker/entrypoint.sh`
- `.github/workflows/docker-publish.yml`

The GitHub workflow mirrors the `bun-opds-server` publish pattern:

- tag-triggered multi-arch Docker build
- GHCR publish
- Buildx cache
- provenance attestation

## Dependency policy

Current direct dependencies are intentionally minimal:

- `@mozilla/readability` — article extraction
- `linkedom` — DOM layer for Readability
- `imagescript` — current image-processing implementation
- `@types/bun` — development only

General rules:

- prefer Bun built-ins and small focused libraries over frameworks
- do not add headless-browser, queue-framework, EPUB-helper, or Calibre-wrapper dependencies by default
- keep file-format logic owned by the project where it matters

## Image pipeline

The target is e-ink reading rather than preserving full web colour fidelity.

Current modes:

- `gray8` for photo-like images and gradients
- `gray4-dither` for diagrams, screenshots, and high-contrast images

Default resize cap:

- `800×600`

## API surface

- `POST /save`
- `GET /items`
- `GET /items/:id`
- `POST /items/:id/retry`
- `POST /items/:id/refetch`
- `GET /bookmarklet`

## Testing

```bash
bun test
```

The test suite covers:

- fetch policy and retries
- URL normalization and canonical extraction
- archive fallback
- image pipeline behaviour
- queue transitions
- endpoint behaviour
- end-to-end EPUB + Calibre library flow

## Runtime assumptions

- Bun on Linux
- dedicated Calibre article library under a broader reading storage root
- OPDS/KOReader as downstream readers
- single-user trusted-LAN deployment for v1

## Roadmap

Likely next areas of polish:

- richer EPUB styling/presentation
- broader real-world extraction fixtures
- more UI polish and navigation
- deployment/public-repo polish as the project stabilises
