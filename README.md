# o2h-edge

A Cloudflare Worker that renders JSON APIs as HTML with [o2h](https://github.com/bahrus/o2h), at the edge.

## Workflow

For this to work, we need to pass to the cloudflare worker *what* to display -- the url of the api, the query string parameters, headers, etc.

But before doing that, we need to indicate *how* to display it.  For that, the page needs to store a "record". 

A page stores a **record** (the config and options it would use with [builtIns.tree](https://github.com/bahrus/assign-gingerly/blob/baseline/docs/tree.md) on the client), then asks the worker to call an API and render its JSON with that record. The worker returns HTML with the JSON embedded after it, and the page hydrates it. It's the same shared core as o2h's service worker (`o2h/worker/core.js`), running at the edge instead.

## Endpoints

| Request | Does |
|---|---|
| `PUT /records/<key>` | Stores a record (JSON) in KV, under the **hash of its content**, as o2h's `prepareO2HRecord` computes it. A key that doesn't match its content is refused, so anyone may store a record, but nobody can change one. |
| `GET /render?api=<url>&config=<key>` | Calls the API (through the guards below), and renders its JSON with the record. The result is `text/html`, with the JSON in `<script type="application/json" data-tree="tree">`. With no record for the key, or a rendering error, the API's JSON comes back as is, with an `X-O2H-Error` header saying why. |
| `GET /` | A one-line description |

**Every response allows any origin** (CORS), since the pages calling the worker live elsewhere. `X-O2H-Error` is exposed to them.

```js
import { prepareO2HRecord } from 'o2h/worker/client.js';

const edge = 'https://o2h-edge.<your-subdomain>.workers.dev';
const { key, record } = await prepareO2HRecord(config, { pipes, managers });
await fetch(`${edge}/records/${key}`, { method: 'PUT', body: JSON.stringify(record) });

const response = await fetch(`${edge}/render?api=${encodeURIComponent(apiUrl)}&config=${key}`);
container.innerHTML = await response.text();
// then hydrate, as with o2h's service worker (adopt: 'pending', with the real pipes and managers)
```

**Code the worker can't have** (function pipes, manager classes) works as in o2h's service worker: the record holds stand-ins, the worker leaves what needs them to the page (marked `data-pending`), and the page finishes it while hydrating. [Data pipes](https://github.com/bahrus/assign-gingerly/blob/baseline/docs/pipes.md#data-pipes-opt-in-pipes-described-as-data) run in the worker. Cloudflare Workers can't run code they receive (`eval` is disabled), so this is the only way code gets there.

## Guards

A public worker that calls any URL would be a proxy anyone could abuse, so it lets through only:
- **API origins allowed for the requesting host:**
  - the **sandbox** (the default `*.workers.dev` host, and `localhost` in development) allows any, while `SANDBOX` is `"on"`;
  - **other hosts** (custom domains) allow only what `DOMAIN_ALLOWLIST` lists for them: `{ "apis.example.com": ["https://api.nasa.gov"] }`.
- **Targets:** `https` only, and named public hosts only (no IP literals, no localhost).
- **Upstream calls:** `GET` only. Only an `Accept: application/json` header is sent: the caller's cookies, authorization and other headers aren't forwarded.
- **Responses:** **JSON only**; anything else is refused (`415`), not passed through. They're capped at `MAX_RESPONSE_BYTES` (`413`), with a timeout of `UPSTREAM_TIMEOUT_MS` (`504`). Records are capped at `MAX_RECORD_BYTES`.
- **Rate:** 60 requests a minute per IP (the `LIMITER` rate-limit binding; it works on `workers.dev`, where dashboard WAF rules don't apply).

All of these are `vars` in `wrangler.jsonc`.

## Demo: NASA's Astronomy Picture of the Day

[`demo/apod.html`](demo/apod.html) shows NASA's APOD feed (`https://science.nasa.gov/wp-json/wp/v2/apod-basic`) as a grid of cards, rendered by this worker and finished on the page, with a form for the page number and page size.

1. `npm run dev`: the worker, at http://localhost:8787.
2. `npm run serve` in a second terminal: spa-ssi serves this repo (port 8000, or the next free one; set `PORT` to choose), with [`imports.html`](imports.html) as the import map.
3. Open `/demo/apod.html`.

The page stores its record (a tree config and pipes), then asks the worker to render each page of the feed. The dates and the image / video badges use **data pipes**, so the worker renders them. The explanations and credits need a **function** pipe (HTML to plain text), so they arrive marked pending (hidden), and the page fills them in while hydrating. The status line says how many parts that was.

**Served from the beGingerly workspace instead** (its `npm run serve`), the page is at `/o2h-edge/demo/apod.html`, and the workspace's `imports.html` maps `o2h/` and `assign-gingerly/` to the sibling repos.

## Developing

- **`npm run dev`:** `wrangler dev`, the worker on your machine, in Cloudflare's runtime, with local KV.
- **`npm test`:** starts a stand-in API and the worker under `wrangler dev` (fresh local state each run), and checks the endpoints and the guards end to end. It also unit-tests which API URLs a host may call.
- **`npm run check`:** type-checks. **`npm run types`** regenerates `worker-configuration.d.ts` (the `Env` type) after changing `wrangler.jsonc`.
- **In the beGingerly workspace,** o2h and assign-gingerly come from the sibling repos (`file:` dependencies). `wrangler.jsonc`'s `alias` entries make the bundle use the sibling assign-gingerly too, since o2h's own `node_modules` may hold an older one. Switch both to published versions before deploying from elsewhere.

## Deploying

1. `npx wrangler login` (once).
2. `npm run deploy`. The first deploy creates the KV namespace (the config has no id on purpose). The worker is then at `o2h-edge.<your-subdomain>.workers.dev`: the sandbox.
3. **Optionally:** connect the GitHub repo to **Workers Builds** in the Cloudflare dashboard, so a push deploys. Custom domains are added there too, along with their `DOMAIN_ALLOWLIST` entries.
