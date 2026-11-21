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
