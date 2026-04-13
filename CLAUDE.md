# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Build production bundle: `npm run build`
- Preview production build locally: `npm run preview`
- Lint: `npm run lint`

### Notes on tests

- There is currently no test script configured in [package.json](package.json). If tests are added later, expose them via npm scripts and document single-test invocation here.

## Architecture overview

This is a single-page React + Vite app for batch-generating image-to-video prompts (“Grok Director”). The core flow is:

1. User loads a folder of images.
2. Images are resized/client-encoded and persisted in IndexedDB.
3. A sequential queue sends each image + context to EzAI `/messages` via a local proxy path.
4. Returned prompts are stored per image, editable in UI, and exportable.

### Core modules

- App shell and workflow orchestration: [src/App.jsx](src/App.jsx)
  - Owns all UI state (`images`, API settings, processing/cancel state, global context text).
  - Handles queue processing one image at a time and per-item status transitions (`pending` → `processing` → `done`/`error`).
  - Persists non-binary app state to localStorage and reloads on startup.

- API integration: [src/services/api.js](src/services/api.js)
  - Defines canonical system prompt constraints for generated video prompts (concise output, subtle motion, no blur/bokeh, gentle dolly/pan).
  - Sends multimodal payloads (`image` base64 + text context) to `'/api/ezai/messages'` with `x-api-key` header.
  - Normalizes image MIME handling for supported web formats.

- Persistence layer: [src/services/storage.js](src/services/storage.js)
  - IndexedDB (`idb`) stores image base64 payloads keyed by image id.
  - localStorage stores lightweight app/session state (`grok_prompter_state`) excluding transient file/object URL fields.

- Project import/export: [src/utils.js](src/utils.js)
  - Exports full project state to ZIP (`state.json` + image files) using JSZip.
  - Imports ZIP, restores state, repopulates IndexedDB, and hydrates image list.

## Data model and state boundaries

- `images` entries in UI state follow shape: `{ id, name, prompt, status, file?, url? }`.
- `file` and object URLs are treated as ephemeral runtime fields and should not be considered durable state.
- Durable image content lives in IndexedDB; durable app metadata/config lives in localStorage and ZIP state.

## Runtime behavior that matters when editing

- Queue cancellation uses both React state and a ref guard (`isCancelledRef`) to avoid stale closure issues during async iteration.
- On app reload, any image left in `processing` is reset to `pending` before rendering.
- Image preprocessing intentionally scales large images down (max dimension 1024) before API submission to reduce token/input size.

## Deployment/proxy expectation

- Frontend calls EzAI through `'/api/ezai'` (see [src/services/api.js](src/services/api.js)); this assumes a serverless/API proxy exists in deployment (per recent commit history). Keep this contract stable unless proxy routing is intentionally changed.
