# o2h-edge

A Cloudflare Worker that renders external, proxied JSON APIs as HTML with [o2h](https://github.com/bahrus/o2h), at the edge.  Note that o2h stands for [JavaScript] **O**bject to (2) **H**TML, which then needs to be hydrated in the browser's main page ("H2O", get it?)

## Workflow

For this to work, we need to pass to the cloudflare worker *what* to display -- the url of the api, the query string parameters, headers, etc.

But before doing that, we first need to indicate *how* to display it.  For that, the page needs to store a **transform** (the config and options it would use with [builtIns.tree](https://github.com/bahrus/assign-gingerly/blob/baseline/docs/tree.md) on the client), and then ask the worker to call the desired API and render its JSON response as HTML via the stored transform. The worker returns HTML with the JSON embedded after it, and the page hydrates it. It's the same shared core as o2h's service worker (`o2h/worker/core.js`), running at the edge instead.

## Endpoints

| Request | Does |
|---|---|
| `PUT /transforms/<key>` | Stores a transform (JSON) in KV, under the **hash of its content**, as o2h's `prepareO2HTransform` computes it. A key that doesn't match its content is refused, so anyone may store a transform, but nobody can change one. |
| `GET /transforms/<key>` | The transform, exactly as stored: the JSON its key is the hash of. Cacheable for good (`immutable`), since a key always names the same content. |
| `GET /transforms[?cursor=…]` | Lists the stored transforms: `{ transforms: [{ key, bytes, stored, summary }], cursor }`, up to 1000 a page (`cursor` asks for the next; `null` when there's none). `summary` names the data fields a transform reads. Transforms stored before the list existed have only a `key`. **Needs the admin token** (below), except on localhost. |
| `GET /render?api=<url>&transform=<key>` | Calls the API (through the guards below), and renders its JSON with the transform. The result is `text/html`, with the JSON in `<script type="application/json" data-tree="tree">`. With no transform for the key, or a rendering error, the API's JSON comes back as is, with an `X-O2H-Error` header saying why. |
| `PUT /o2h-app/<key>` | Installs an app ([navigate-gingerly](https://github.com/bahrus/navigate-gingerly)'s `prepareApp`): routes whose paths mirror an API's, and their transforms. Keyed by the hash of its content (`app-` and 32 hex digits) and checked like transforms, so anyone may install one, but nobody can change one. Capped at `MAX_APP_BYTES`. |
| `GET /o2h-app/<key>` | The app, exactly as stored. Cacheable for good. |
| `GET /o2h-app/<key>/<path>` | Matches the path to one of the app's routes, fetches the route's sources in parallel (each through the guards below), and renders the VM `{ route, ...sources }` with the route's transform: an HTML **fragment**, with the VM embedded, as `/render` returns. An aligned route fetches the path itself under the app's API (`/products/3` → `<api>/products/3`); the visitor's query string isn't passed on. `404` for no app (`no app …`: the page installs it again) or no route; a failing source answers with its status. |
| `GET /` | A one-line description |

**Every response allows any origin** (CORS), since the pages calling the worker live elsewhere. `X-O2H-Error` is exposed to them.

**From a page,** o2h's `renderViaEdge` does the whole round trip: it stores the transform (once), renders, inserts the HTML, and hydrates it. When the worker passes the JSON back, the page renders it itself. Both demos use it.

```js
import { renderViaEdge } from 'o2h/worker/edge.js';

const options = { pipes, managers, style: true };
const { by, data, pending } = await renderViaEdge(container, {
    worker: 'https://o2h-edge.<your-subdomain>.workers.dev', api: apiUrl, config, options,
});
```

By hand, it's two requests:

```js
import { prepareO2HTransform } from 'o2h/worker/client.js';

const edge = 'https://o2h-edge.<your-subdomain>.workers.dev';
const { key, transform } = await prepareO2HTransform(config, { pipes, managers });
await fetch(`${edge}/transforms/${key}`, { method: 'PUT', body: JSON.stringify(transform) });

const response = await fetch(`${edge}/render?api=${encodeURIComponent(apiUrl)}&transform=${key}`);
container.innerHTML = await response.text();
// then hydrate, as with o2h's service worker (adopt: 'pending', with the real pipes and managers)
```

**Code the worker can't have** (function pipes, manager classes) works as in o2h's service worker: the transform holds stand-ins, the worker leaves what needs them to the page (marked `data-pending`), and the page finishes it while hydrating. [Data pipes](https://github.com/bahrus/assign-gingerly/blob/baseline/docs/pipes.md#data-pipes-opt-in-pipes-described-as-data) run in the worker. Cloudflare Workers can't run code they receive (`eval` is disabled), so this is the only way code gets there.

## Guards

A public worker that calls any URL would be a proxy anyone could abuse, so it lets through only:
- **API origins allowed for the requesting host:**
  - the **sandbox** (the default `*.workers.dev` host, and `localhost` in development) allows any, while `SANDBOX` is `"on"`;
  - **other hosts** (custom domains) allow only what `DOMAIN_ALLOWLIST` lists for them: `{ "apis.example.com": ["https://api.nasa.gov"] }`.
- **Targets:** `https` only, and named public hosts only (no IP literals, no localhost).
- **Upstream calls:** `GET` only. Only an `Accept: application/json` header is sent: the caller's cookies, authorization and other headers aren't forwarded.
- **Responses:** **JSON only**; anything else is refused (`415`), not passed through. They're capped at `MAX_RESPONSE_BYTES` (`413`), with a timeout of `UPSTREAM_TIMEOUT_MS` (`504`). Transforms are capped at `MAX_TRANSFORM_BYTES`, and apps at `MAX_APP_BYTES`.
- **Listing:** only with the admin token, `Authorization: Bearer <token>`, which must match the `LIST_TOKEN` secret (`npx wrangler secret put LIST_TOKEN`). Without the secret, listing is off (`403`). On localhost (`npm run dev`), no token is needed. Reading one transform by its key stays public, since anyone with the key can render with it anyway.
- **Rate:** 60 requests a minute per IP (the `LIMITER` rate-limit binding; it works on `workers.dev`, where dashboard WAF rules don't apply).

All of these but `LIST_TOKEN` (a secret) are `vars` in `wrangler.jsonc`.

## Demo: NASA's Astronomy Picture of the Day

[`demo/apod.html`](demo/apod.html) shows NASA's APOD feed (`https://science.nasa.gov/wp-json/wp/v2/apod-basic`) as a grid of cards, rendered by this worker and finished on the page, with a form for the page number and page size.

1. `npm run dev`: the worker, at http://localhost:8787.
2. `npm run serve` in a second terminal: spa-ssi serves this repo (port 8000, or the next free one; set `PORT` to choose), with [`imports.html`](imports.html) as the import map.
3. Open `/demo/apod.html`.

The page stores its transform (a tree config and pipes), then asks the worker to render each page of the feed. The dates and the image / video badges use **data pipes**, so the worker renders them. The explanations and credits need a **function** pipe (HTML to plain text), so they arrive marked pending (hidden), and the page fills them in while hydrating. The status line says how many parts that was.

**Served from the beGingerly workspace instead** (its `npm run serve`), the page is at `/o2h-edge/demo/apod.html`, and the workspace's `imports.html` maps `o2h/` and `assign-gingerly/` to the sibling repos.

## Demo: a store

[`demo/store/index.html`](demo/store/index.html) is a one-page store over the [Fake Store API](https://fakestoreapi.com/docs): category links, a product grid (photo, price, star rating) and a product view. They're three transforms, all rendered by the worker, since only data pipes are used. Links change the hash (`#category/jewelery`, `#product/3`), and the page renders what it names. Serve it like the APOD demo, and open `/demo/store/index.html` (with the file name: spa-ssi serves its site map for a bare directory).

## Demo: the stored transforms

[`demo/transforms.html`](demo/transforms.html) lists the transforms a worker holds: key, the data fields each reads, size and date. Open one to see its JSON, indented and colored. **Copy raw** copies it exactly as stored, so storing the copy elsewhere gives the same key. Serve it like the APOD demo. For a deployed worker, enter its URL and the admin token, which the page keeps for that tab only (`sessionStorage`).

## Developing

- **`npm run dev`:** `wrangler dev`, the worker on your machine, in Cloudflare's runtime, with local KV.
- **`npm test`:** starts a stand-in API and the worker under `wrangler dev` (fresh local state each run), and checks the endpoints and the guards end to end. It also unit-tests which API URLs a host may call.
- **`npm run check`:** type-checks. **`npm run types`** regenerates `worker-configuration.d.ts` (the `Env` type) after changing `wrangler.jsonc`.
- **In the beGingerly workspace,** o2h and assign-gingerly come from the sibling repos (`file:` dependencies). `wrangler.jsonc`'s `alias` entries make the bundle use the sibling assign-gingerly too, since o2h's own `node_modules` may hold an older one. Switch both to published versions before deploying from elsewhere.

## Deploying

1. `npx wrangler login` (once).
2. `npm run deploy`. The worker is then at `o2h-edge.<your-subdomain>.workers.dev`: the sandbox.
   - **The KV namespace:** `wrangler.jsonc` holds the id of this repo's deployed one. **Deploying to your own account?** Remove the `id` first: the deploy then creates a namespace for you and writes its id back.
   - **To list transforms there,** set the admin token: `npx wrangler secret put LIST_TOKEN`.
3. **Optionally:** connect the GitHub repo to **Workers Builds** in the Cloudflare dashboard, so a push deploys. Custom domains are added there too, along with their `DOMAIN_ALLOWLIST` entries.
