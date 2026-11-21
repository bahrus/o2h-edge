# Caching

## Bruce's Ask

There have been numerous references made in these chats to providing robust caching support.

I'd like to do that in baby steps and make sure each step adds significant value.

The first thing I see when I open http://localhost:8000/demo/store/ multiple times is that each time, two calls are made:

1.  A Put request that passes a significant payload.
2.  The Get Request that retrieves the products.

The costliest "overhead" is the first request.

I can see a number of ways of improving this.  I think my favorite at the moment is:

The second request returns a special status code if the first call wasn't made yet, i.e. the configuration is missing from the store.  Only if this status code is returned is the first call made, followed by the second one.

Let me know your thoughts / alternatives / clarifications needed below.

## Claude's Response

**Agreed. It's a good first step, and most of it is already built.** The PUT on every visit isn't designed in. It comes from one detail in navigate-gingerly's `mirror.ts`.

### Why the PUT happens every time

`mirror` remembers which apps a worker holds in a module-level `Set` (`installed`). It doesn't send the GET until that set says the app is installed. The set starts empty on every page load, so every fresh visit sends the PUT first.

The fallback you describe is already there too. If the GET comes back `404` with "no app", mirror re-installs the app and asks again, once. That's how it recovers from a restarted `wrangler dev`.

### The change

**Assume the app is installed, and PUT only when the worker says it isn't.** In `mirror.ts`:
- `request()` no longer installs first; it just sends the GET;
- on the "app missing" answer: install, then send the GET again (the existing retry, now the only install path).

That's a few lines. The worker doesn't change, apart from the signal below.

**The signal.** Today mirror spots the missing app by looking for the text "no app" in the error message. A plain `404` isn't enough, because a path that matches no route is also a `404`. I'd make it machine-readable without changing the status: the worker keeps `404` and adds a header, e.g. `X-O2H-Missing: app` (exposed via CORS). I'd avoid a different status code (`409`, `412`, `424`): none of them really means "the thing in the URL doesn't exist", and `404` is accurate.

### What it saves (on every visit except the first)

- **The PUT itself:** about 30 KB uploaded (the prepared app);
- **its CORS preflight:** a `PUT` isn't a "simple" request, so the browser sends an `OPTIONS` before it. You save 2 round trips, not 1;
- **the worker's work:** parsing, validating, hashing and a KV read;
- **one of the 60-a-minute rate-limit tokens** per visit.

**The cost:** the first visitor after a deploy (or a `wrangler dev` restart) gets one failed GET before the install. That's one extra round trip, once.

**KV's eventual consistency** isn't a problem here. A write is visible right away in the location that made it. Another location may not see it for up to about a minute, and a visitor there just PUTs it again. Installs are idempotent, since the key is the content's hash.

### Alternatives I considered

- **Remembering "installed" in `localStorage`/`sessionStorage`:** this skips the PUT on repeat visits only. It still needs the 404 fallback (the worker can lose the app), and the optimistic GET covers everything it does. Not worth it.
- **One request that carries the app along with the path:** it still uploads the app on every visit. It only removes the preflight.

### A natural next step (not this one)

Even without the PUT, the page does work before the first GET goes out. It loads the app's modules, runs `prepareApp` (each route's transform) and hashes the result, because the key is the prepared content's hash. `npm run build-store` could compute the key (and the prepared app) ahead of time, so the GET leaves immediately and preparation happens only on a miss. This needs the build to run the renderer's `prepare` in Node, so I'd measure it first and see whether it's worth it.

After that, "real" caching starts: `Cache-Control` / Cache API on rendered paths (per route, opt-in, as discussed in Initialization).

### Questions for you

1. **A `404` plus a header** for "the app is missing", or do you want a distinct status code anyway?
2. Should I **add a test** in navigate-gingerly's Playwright suite? It would check: second visit, no PUT; restarted worker, PUT and retry.

If you agree with 1 as proposed, I'll implement it: mirror in navigate-gingerly, the header in o2h-edge's `apps.ts`/CORS.


## Bruce's Response I

> 1. **A `404` plus a header** for "the app is missing", or do you want a distinct status code anyway?

I would have preferred a standard status code for this scenario, but I guess there isn't one, so let's go with 404 + header.

> 2. Should I **add a test**

Sounds good.

Note that I still have spa-ssi nd wrangler running.  Feel free to stop and/or restart them.

## Claude's Implementation Notes I

Done as agreed: a `404` plus a header. All tests pass, and the store demo now sends one request per visit.

### navigate-gingerly

| File | Change |
|---|---|
| `routes.ts` | A new constant, `MISSING_HEADER = 'X-O2H-Missing'`, beside `API_KEY_HEADER`, so the worker and the page share the name. |
| `mirror.ts` | The in-memory `installed` set is gone. Each path is asked for as if the worker held the app. Only a `404` with `X-O2H-Missing: app` installs it (the PUT), and then the path is asked for again, once. The old check for the text "no app" in the error message is gone. |
| `README.md` | The "Installs the app" bullet now describes this. |
| `tests/mirror.spec.ts` | The stand-in worker now behaves like the real one: it holds the apps installed with it, and answers a path of an app it doesn't hold with the `404` and header. Tests added: **first visit** (a miss, one install, then the render), **second visit** (a new page against the same worker: no PUT at all), and **a `404` without the header** (a source's) installs nothing. The "worker lost the app" test now empties the stand-in's store. |

The `.js` files are rebuilt (`npm run build`). **46 tests pass** in Chromium, Firefox and WebKit.

### o2h-edge

| File | Change |
|---|---|
| `src/guards.ts` | `errorResponse` takes optional extra headers. |
| `src/apps.ts` | "no app" (rendering a path) adds `X-O2H-Missing: app`. "No route" and failing sources don't. |
| `src/index.ts` | The header is added to `Access-Control-Expose-Headers`, so a cross-origin page can read it. |
| `test/edge.test.mjs` | The missing-app test checks the header and that it's exposed. It also checks that a missing route doesn't have it. |

`npm run check` is clean. **23 tests pass.**

### Checked against the running servers

Your `wrangler dev` reloaded by itself and already sends the header, so I didn't restart anything. I opened `http://localhost:8000/demo/store/` twice in a fresh headless Chromium, and each visit made a single call: `GET /o2h-app/<key>/` → `200`. That means no PUT, and no preflight either. The app was already in local KV from earlier visits, so the miss-then-install path wasn't exercised live; the tests cover it on both sides.

**One thing to know:** `wrangler dev` keeps its local KV in `.wrangler/state` across restarts, so a restart no longer triggers a PUT. You'll only see one after changing the app (a new key), or after clearing that state.


## Bruce's Response II

Looks good.  Are there any README.md or other documentation files that should be updating to reflect this approach?  If so, please update them.

## Claude's Implementation Notes II

The docs are up to date now. I searched the READMEs, source comments and demos in o2h, o2h-edge and navigate-gingerly, but left the chat history as it is.

- **o2h-edge `README.md`:**
  - the `GET /o2h-app/<key>/<path>` row now says that "no app" comes with `X-O2H-Missing: app`, and that the page installs the app only then (so a returning visitor sends no `PUT`), and that a missing route's `404` has no header;
  - the CORS note now lists `X-O2H-Missing` as exposed, beside `X-O2H-Error`.
- **navigate-gingerly `README.md`:** the "Installs the app" bullet (updated last round) said "a restarted worker". That isn't really a case, since `wrangler dev` keeps its local storage. It now says "a worker whose storage was cleared".
- **navigate-gingerly `mirror.ts`:** the same wording in a comment, fixed, and `mirror.js` rebuilt.

Nothing else describes the install flow. o2h's README only mentions `X-O2H-Error`, which is unchanged.

## Bruce's Response III

In terms of caching, what is the next lowest hanging fruit?  Please explain what advantages / disadvantages it would bring to the table.

## Claude's Response III

### Where the time goes now

I measured against your running servers. A render of the store's home page (`GET /o2h-app/<key>/`) takes **about 330 ms** once warm, and almost all of it is the Fake Store API: `/products` and the layout's `/products/categories` take about 300–500 ms each, fetched in parallel. Rendering is a small part. The API sends **no `Cache-Control`** (only an `ETag`), and our rendered responses don't send one either. So every visit and every navigation, Back and Forward included, makes the worker call the API again.

### My recommendation: let the browser cache rendered paths (opt-in per route)

**The worker adds `Cache-Control: private, max-age=<n>` to a rendered path**, with `n` taken from the route, e.g. `"maxAge": 300` beside its `pattern`. A route without it is unchanged (off by default, as agreed in Initialization).

Why this is the lowest-hanging fruit:
- **It's tiny:** the worker sets a header. mirror's `fetch` already uses the browser's HTTP cache, so the page needs no change.
- **App changes can't serve stale pages:** the app's key, the hash of its content, is in the URL. A changed app is a different URL, so only the *data* can be stale, and only for `n` seconds.
- **It works on `*.workers.dev`** (the sandbox). Cloudflare's edge cache (the Cache API) does nothing there, so the worker-side options below would need a custom domain.

**Advantages**
- **A repeat within `n` seconds costs nothing:** Back, Forward, revisiting a category, reopening the store. The browser answers right away (about 0 ms instead of about 330 ms). No request reaches the worker, so it uses no rate-limit token and makes no call to the API.
- **It's the visitor's own cache (`private`)**, so a visitor's API key can't leak into anyone else's page. I'd add `X-O2H-Api-Key` to `Vary`, so changing or removing a key isn't answered from the old entry.

**Disadvantages**
- **It only helps the same browser.** A first visit, or another visitor, still pays the full 330 ms.
- **The data can be up to `n` seconds old,** and there's no way to purge a browser's cache. That's why it's opt-in, per route: a product list can take minutes, a cart or stock level none.
- **Errors must never be cached.** The "app missing" `404` in particular: if a browser kept it, the page would install the app on every visit again. I'd mark every error, and a VM passed back with `X-O2H-Error`, as `no-store`.
- **`refresh()` would be answered from the cache too.** mirror's `refresh()` could ask with `cache: 'no-cache'` (revalidate) to keep meaning "fetch it again".

### The next step after that: cache the sources in the worker

This is the bigger win, because it helps **every visitor, the first visit included**. It also helps every route that shares a source: the layout's `/products/categories` is fetched for every path. The worker would keep each source's JSON for the route's `maxAge`, keyed by its URL. Its disadvantages are why I'd do it second:

| Where | Advantage | Disadvantage |
|---|---|---|
| Cloudflare's Cache API | Free, fast, shared by everyone in a data centre | **Does nothing on `*.workers.dev`**, so it needs a custom domain; each data centre has its own copy |
| KV | Works anywhere, shared worldwide | The free tier allows only 1,000 writes a day; changes take up to about a minute to reach other locations |
| Memory (like the apps' cache in `apps.ts`) | Free, works anywhere, simplest | One isolate's memory: lost whenever Cloudflare recycles it, so hits are hard to predict |

**Sources fetched with a visitor's API key must never be shared.** They'd be skipped, or cached under the key, which defeats the purpose. Also, on a custom domain the same `Cache-Control` could add `s-maxage` and let Cloudflare's CDN cache the rendered paths themselves. That's another reason to start with the header.

### Questions for you

1. **Per route `maxAge`** (my preference), an app-wide default, or both (the route wins)?
2. **For the store demo:** say 300 s on the product list, categories and products?
3. **`refresh()` revalidates** (`cache: 'no-cache'`): agreed?

## Bruce's Response IV

> - **A repeat within `n` seconds costs nothing:** Back, Forward, revisiting a category, reopening the store. The browser answers right away (about 0 ms instead of about 330 ms). No request reaches the worker, so it uses no rate-limit token and makes no call to the API.

I'm more interested in improving the UI so that already loaded routes don't get loaded again -- if someone scrolls within a route, expands a section, plays a song from a link in a route, etc, moving away from the route, then coming back doesn't lose all that state.  Is that oable?




## Claude's Response IV

**Yes, it's doable, and it fits mirror well.** The Navigation API already hands mirror every move between routes, Back and Forward included. What it means in practice is that **mirror stops throwing a route's DOM away**.

### How it would work

Today, each navigation does `into.innerHTML = html`, which destroys the previous route's DOM and, with it, everything you listed. Instead:

- **Each rendered route gets its own wrapper** inside `into`, e.g. `<div data-route-path="/products/3">`, holding its fragment.
- **Moving away hides the wrapper; it isn't removed.** Coming back shows it again. There's no request to the worker, no hydration (its listeners are still attached), and no rendering. Only `finish()` runs (the title, `aria-current`).
- **A route not kept** is fetched and rendered as now, into a new wrapper.

**How it's hidden matters.** Removing an `<audio>`/`<video>` element from the document **pauses it** (that's in the HTML spec), and `display: none` resets scroll positions inside the route. So I'd hide with **`content-visibility: hidden`** (plus `inert`, so it's skipped by focus, find-in-page and screen readers). It's meant for exactly this: the browser skips rendering the content but keeps its state.

| State | Kept? |
|---|---|
| Scroll position inside the route (scrolling panels, carousels) | Yes |
| The page's own scroll position | Yes, and better than now: the Navigation API restores it on Back/Forward, and the content is there right away instead of arriving after a fetch |
| Expanded `<details>`, popovers, tabs, anything the hydrated code set | Yes |
| Form fields typed into but not submitted | Yes |
| A song playing from a route | **Keeps playing** while you browse other routes |
| Focus | Restored by the Navigation API's `focusReset` as now (the element focused inside the route isn't refocused) |

### The decisions

1. **What counts as "coming back"?**
   - **By history entry** (like the browser's own back-forward cache): Back and Forward restore the route as you left it, and clicking a link to it renders it fresh. This is what people expect from Back, and it never surprises anyone with old content after a deliberate click.
   - **By path:** any return restores it, links included. More is kept, but clicking "Jewelery" again shows the Jewelery page as you left it, possibly scrolled halfway down.

   I'd start **by history entry**, with an option for by path.
2. **How many to keep.** Kept routes stay in memory, with their images and listeners. I'd keep the **last 10** (an option), dropping the least recently shown, **but never one that's playing media**. Otherwise the song would stop.
3. **How long the data stays good.** A kept route is never refreshed, however old it gets. An optional `maxAge` could re-render a kept route that's older than that, which loses its state. `refresh()` always re-renders the current route.

### What it costs (disadvantages)

- **Several routes are in the document at once.** That has a few effects:
  - **Duplicate `id`s:** if two routes render the same id, `getElementById` finds the first, which may be a hidden one. The store's fragments don't use ids, but an app's own code could.
  - **App code that searches the whole document** (`document.querySelector`) instead of its own route would find hidden routes' elements too. Hydration is already given the container, so the renderers are fine. This is a rule for app authors.
  - **View transitions:** the store names each product's photo `product-<id>`, in both the grid and the product view. A hidden route's content isn't rendered, so it shouldn't be captured, but I'd test that in all three browsers before relying on it.
- **Without the Navigation API,** every link loads the shell again, so there's nothing to keep. The browser's own back-forward cache already covers Back there.
- **Memory**, as above: bounded by the limit.
- **Stale data**, as above: bounded by `maxAge`, if set.

### Compared with the HTTP caching I proposed

They solve different problems, and you could have both. HTTP caching saves the **request** (about 330 ms), but the page still renders and hydrates again, so **all state is lost**. Keeping the DOM saves the request, the rendering **and** the state, but only for routes already shown on this page load. Keeping the DOM is the better fit for what you describe, so I'd do it first. HTTP caching stays on the list for reopening the store and for links to routes no longer kept.

### Questions for you

1. **By history entry** to start (my preference), or by path?
2. **Opt-in or on by default?** I'd make it on by default, keeping 10 routes, since mirror's whole job is in-app navigation. `keep: 0` would turn it off.
3. **The store demo:** anything in particular you'd like it to show off? It has no media today. A quick check would be: scroll the grid, open a product, go Back, and land at the same spot with no request.
