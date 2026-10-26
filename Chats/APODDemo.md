# APOD Demo

## Bruce's Ask

Would it break anything to add the spa-ssi web server to this project, so that I can test pages served via spa-ssi that submits to the cloudflare worker running on a different port?

If the above is safe to do, can that be followed by creating a demo folder, with a page that accesses https://science.nasa.gov/wp-json/wp/v2/apod-basic and displays it as HTML using some UI interface of your choice?  Maybe with a form with the filter options to fine tune the list returned.


## Claude's Notes

### spa-ssi: safe, and added

**It breaks nothing.** Wrangler bundles only what `src/index.ts` imports, so dev dependencies never reach the deployed worker, and the two servers don't interact. Added:
- **`spa-ssi`** as a dev dependency, and `npm run serve`. It defaults to port 8000, or the next free one; set `PORT` to choose.
- **`imports.html`**, the import map, mapping `o2h/` and `assign-gingerly/` to `/node_modules/…`. Those link to the sibling repos in the workspace, and spa-ssi serves through the links (checked).
- **The workspace's own `imports.html`** (`beGingerly/imports.html`) gains `o2h/` → `/o2h/`. So the demo also works served from the workspace root, at `/o2h-edge/demo/apod.html`.

### The demo: [`demo/apod.html`](../demo/apod.html)

A grid of cards for NASA's APOD feed. Each card has the image (with a ▶ overlay for videos), an Image / Video badge, the date, the title (linking to the NASA article), an excerpt of the explanation, and the credit. A form above it has **Page**, **Per page** (6, 12, 18 or 25), the **Worker** URL (default `http://localhost:8787`), and **Newer / Older** buttons. A status line reports what happened.

**How it uses the worker:**
1. **The record:** the page builds its tree config with `` tree`…` `` and `choose`, plus its pipes. `prepareO2HRecord` turns them into a record, which is stored with the worker (`PUT /records/<key>`, once per worker).
2. **Rendering:** the page calls `/render?api=…&config=<key>` and assigns the HTML.
3. **Hydrating:** `adopt: 'pending'`, from the embedded JSON, with the real pipes.

**What the worker renders, and what the page finishes:**
- **Data pipes run in the worker:** the date (`intl` `DateTimeFormat`, in UTC so the date doesn't shift) and the badge (`map`: image → Image, video → Video).
- **A function pipe can't reach the worker:** `plainText` (the API's explanations and credits are HTML; it parses them inertly in a `<template>` and takes the text), and the `excerpt` chain through it. So those parts arrive **marked pending**, hidden by o2h's `style` option, and the page fills them in while hydrating. The status line says how many: 24 for 12 cards.
- **Fallback:** if the worker passes the JSON through (no record, or a render error), the page renders it itself and shows the `X-O2H-Error`. Guard refusals (403, 413, 415…) are shown as errors.

### Things I found about the API

- **`date_from` / `date_to` don't work.** The endpoint's own schema lists them, but it rejected every format I tried with "Invalid parameter": `2026-10-01`, `20261001`, `2026/10/01`, `10/01/2026`, `01-10-2026`, ISO date-times with and without a zone, `2026-10`, a month name, and a Unix timestamp. That was with each parameter alone and with both together. **So the form leaves them out,** and says why.
- **`per_page` is capped at 25:** asking for more silently returns 25.
- **`url` is the article page, not the image.** The image is `hdurl` (videos have a still there too). My first version used `url` for the images, and the browser blocked them as HTML posing as images. The demo now uses `hdurl`, which is full size, often 1,000–3,000 px wide. The images are lazy-loaded. Smaller thumbnails would need a pipe that rewrites the image service's `w=` parameter. That's a function, so the images would then be pending, and would load only after hydration. So I left them full size.

### Checked

**In Chromium,** against the worker under `wrangler dev`:
- 12 cards, all 12 images loading, the right dates and badges;
- explanations and credits filled in, and no `data-pending` left after hydration;
- the "Older" page working, with a screenshot reviewed.

The worker answered in about 50–130 ms once warm (the first call took ~1.4 s, mostly the API).

**Also, the tests' teardown:** `npm test` now stops `wrangler dev` with its whole process tree on Windows (`taskkill /T`), since its `workerd` processes can outlive it. 13 of 13 tests still pass.

### To run it

1. `npm run dev`: the worker.
2. `npm run serve`, in a second terminal.
3. Open `http://localhost:8000/demo/apod.html`, or whichever port spa-ssi reports.
