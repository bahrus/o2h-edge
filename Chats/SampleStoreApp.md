# Sample Store App

## Bruce's Ask

I was looking at this ["Fake Store API" documentation](https://fakestoreapi.com/docs) which includes an [OpenAPI specification](../demo/FakeStoreOpenAPISpec/docs-data.json).

Do you think building a fake store around that API would shed lights on any improvements / enhancements that should be added to any of the layers (starting from assign-gingerly).

Are there any prerequisites we should look at first, like supporting navigation (vs fetch, which you added) and/or streamlining any API's / components to make for a more elegant solution?

Please add your thoughts below.

## Claude's Thoughts

**Yes, I think it's a good next demo,** and a much better stress test than APOD. APOD is one read-only list. A store has nearly every shape a real app has:
- a catalog with a filter;
- a detail page;
- data that points at other data: a cart line is `{ productId, quantity }`;
- totals;
- state that belongs to the visitor (the cart);
- writes and login.

Each of those touches a different layer. Here's what I'd expect it to show, and which parts I think should come first.

### What I checked

- **The spec lists 16 operations:** get, add, update and delete for products, carts and users, plus `POST /auth/login`.
- **The live API does more than the spec says.** These all exist and work, but the spec doesn't list them:
  - `GET /products/categories` (four categories);
  - a `limit` parameter;
  - a `rating: { rate, count }` field on products;
  - a `date` on carts.
  - So the spec is a guide, not the contract. The demo should code against what the API actually returns.
- **CORS is open** (`Access-Control-Allow-Origin: *`), so the browser can call it directly, which matters for writes. **Writes are fake:** the API answers as if it saved, but nothing changes.

### What each layer would likely be asked for

**assign-gingerly (`builtIns.tree` and pipes):**
- **Prices:** `{ intl: 'NumberFormat', options: { style: 'currency', currency: 'USD' } }` is already a data pipe, so the worker renders prices. Good.
- **Totals:** a cart's total, or the item count on the cart badge. `dataPipes` stops at comparisons, and has no **aggregate** (sum, count, sum of price × quantity). So today a total is a function pipe, which the worker leaves pending. A small `sum` descriptor (`{ sum: '?.quantity' }`, or with a product of two paths) would keep totals in the worker. **This is the first concrete enhancement I'd expect.**
- **Empty states** ("your cart is empty"): a `switch` on `?.length` with a `map` pipe (`{ 0: 'empty' }`, default `'items'`) should already work. Worth confirming in the demo rather than adding anything.
- **Stars for a rating:** a repeat over a computed array, or a CSS width from `rate / 5`. The second is a calculation, so it's the same aggregate / arithmetic question.
- **Joins:** a cart line has only a `productId`. Showing titles and prices means joining against the products. Done in a function, it's code the worker can't run. It's also a hint that o2h-edge may want **more than one API per render** (below).
- **Events:** add to cart, quantity +/−, the category filter. `+=` with `on` / `call` covers these on the page. I'd want to confirm that the worker's rendering simply skips event bindings, and that hydration (`adopt`) attaches them. I believe so, but a store would be the first demo to depend on it.

**o2h / o2h-edge: the bigger gaps**
1. **Navigation, as you suspected, is the main prerequisite.** Today a request is marked as "render me" by the `X-O2H-Transform` **header**, and a navigation (a link click, the address bar, a crawler) **can't send a custom header**. So both the service worker and the edge can render fragments that a page fetches, but neither can serve a **page**. A store wants real URLs: `/store/`, `/store/category/electronics`, `/store/product/3`. Those should arrive already rendered, which is good for first paint and for search engines, and work without JS. What's missing:
   - **A route table:** URL pattern → API URL and transform. For example, `/store/product/:id` → `https://fakestoreapi.com/products/{id}` with transform `o2h-…`. Both runtimes have `URLPattern`, so the matching belongs in o2h's shared core, the same for the edge and the service worker.
   - **A page shell:** the document around the fragment (head, nav, cart badge, the hydration script), with a slot for the rendered part. It could be stored by content hash like a transform, and it's static HTML, so it could just be a **snippet**.
   - **How the page finds its code:** in APOD, the page *is* the code. With navigation, the worker serves the page, so the shell names a module that holds the config and the real pipes, and that module hydrates. The transform already carries stand-ins for that code; the shell just has to point at the module.
2. **More than one API per render (later):** for example, the cart page needs `carts/1` and `products`. Options: render with a map of named sources (`{ cart: url, products: url }`), joined in the worker by a data pipe; or let the page join. I'd start with the page doing it, and revisit once routes exist.
3. **Response caching:** we deferred it, and the catalog is the case for it, since products barely change. Caching upstream GETs with a short TTL (the Cache API, keyed by URL) would make catalog pages nearly free. That fits a demo where every link click is a render.

**What I'd keep as it is:**
- **The worker stays read-only (GET).** Adding to cart, login and checkout go from the page straight to the API. Its CORS allows that, and it keeps your rule that keys and credentials never pass through the worker. Login's token would stay on the page.
- **The cart lives on the page:** `localStorage`, shown by hydration. Posting it to the fake API changes nothing anyway. Rendering "your cart" at the edge would need the cart in the URL or a cookie. I'd skip that.

**OpenAPI as a bonus:** the spec's schemas could generate TypeScript types (`Product`, `Cart`, …). With `TreeMap<Product>`, that gives key suggestions while writing the store's tree configs. It's a nice demonstration of an existing feature, and it shows where the spec drifts from the API: no `rating`, no `date`.

### Suggested order

1. **Stage 1, with what exists:** a fragment-rendered catalog like APOD:
   - a category filter (`/products/categories`, then `/products/category/{name}`);
   - product cards with currency prices and ratings;
   - a product detail view.
   - Note each friction point as we hit it. I expect totals and stars to come up.
2. **Small assign-gingerly additions** that stage 1 proves are needed, most likely aggregate data pipes.
3. **Routes and page shells in o2h's core,** used by both the edge and the service worker. The store then becomes real multi-page navigation. This is the substantial piece, and it's worth its own chat.
4. **The cart:** page state, events, a join done on the page, and the empty state.
5. **Caching** for catalog GETs, once routes make every click a render.

### Questions

1. **A multi-page store** (real URLs, served by the edge) **or one page** that fetches fragments (like APOD)? I'd go for multi-page in the end, since it's what shows the edge off, but start with stage 1 in one page so nothing waits on routes.
2. **Should routes and shells come first,** as their own chat, before any store code? Or is stage 1 first, to collect the friction?
3. **Login:** include it (the page calls `/auth/login` directly, and keeps the token in `sessionStorage` to show "signed in as …"), or leave it out, since the fake API doesn't really tie carts to the login?
4. **Where should the store live?** I'd say `o2h-edge/demo/store/`, next to APOD. Or should it be its own repo, if it's meant to grow into a reference app?

## Bruce's Response

This sounds like a good plan.  For stage 1 let's go with one page, no routes, and work on the points of friction, before moving on.  We can hold off on the login as well.

I agree o2h-edge/demo/store



## Claude's Implementation Notes: Stage 1

**The page:** [`demo/store/index.html`](../demo/store/index.html). Serve it as for APOD, and open `/demo/store/index.html`.
- **Three transforms, one page:**
  - **categories:** `/products/categories`, as links;
  - **products:** `/products`, or `/products/category/<name>`, as a grid of cards with photo, category, title, price and rating;
  - **product:** `/products/<id>`.
- **Links change the hash** (`#category/jewelery`, `#product/3`), so Back and Forward work, a view can be linked to, and the page needs **no event bindings at all**.
- **Checked in Chromium against the live API, through `wrangler dev`:**
  - 20 products, 4 categories, the category filter, a product view, and Back;
  - no horizontal scroll at 375px.
  - **Every part is rendered by the worker.** `data-pending` is 0 on every view, since only data pipes are used. Each render takes about 120 ms locally, including the upstream call.

**What went smoothly** (no change needed):
- **Prices:** the `intl` NumberFormat currency data pipe.
- **Star ratings without arithmetic:** a `<meter min="0" max="5" value=…>`, drawn as five stars by a CSS mask. The worker renders it as a plain attribute, and it's accessible as a meter. This is a pattern worth showing in the docs.
- **Links built from data:** `{ '?.href =&': { join: ['#product/', '?.id'] } }`, spread into the element's pattern. o2h's worker renders it, through `evaluateOther`.

**Friction, most useful first:**
1. **The edge-rendering boilerplate is now copied in two demos.** APOD and the store each have about 40 lines of the same logic: store the transform once per worker, call `/render`, put in the HTML, read the embedded JSON, hydrate with `adopt: 'pending'`, and fall back to rendering on the page when the worker passes the JSON back. That belongs in a client helper, for example in `o2h/worker/client.js` or an o2h-edge client module: `renderViaEdge(container, { worker, api, config, pipes })`. **This is the first thing I'd add.** It's also what the stage 3 routes would build on.
2. **Attribute text with data in it is verbose.** `href="#product/${'?.id'}"` would be the natural thing to write in `` tree`…` ``, but mixed attribute text isn't supported, hence the `'?.href =&'` join spread. `` tree`…` `` could compile mixed attribute text into that join, like it already compiles mixed *content* into a `microJoin`. It's a small DX change in `DX/tree.ts`.
3. **A render has nothing but the API's JSON to go on.** Marking the current category (`aria-current`) needs to know the selected category, which isn't in the data. Comparing against it isn't possible either. So the page does that one thing after hydration. When routes arrive, route parameters (`$route?.category`), plus a small equality data pipe, would let the worker do it. **This is a requirement for the routes chat**, more than for assign-gingerly now.
4. **An object API can't be rendered as one element.** `/products/<id>` returns an object, so the tree renders one element per key. I laid them out with CSS grid areas inside a static `<article>`, which works fine. A "the whole value as one element" spec would make it more natural, but this is minor.
5. **spa-ssi serves its site map for `/demo/store/`,** not the directory's `index.html`. Defaulting to `index.html` would help.

**Not reached yet** (stage 4, the cart): totals (aggregate data pipes), joins, page state and events.

**Also:** assign-gingerly's `pipes/dataPipes.ts` comment and `docs/pipes.md` still said `prepareO2HRecord`. Both are fixed; the `.js` is left for your build.

**Question:** should I start with 1 (the client helper) and 2 (mixed attribute text in `` tree`…` ``) before stage 2? Item 3 would go into the routes chat.

## Bruce's Response II

Please proceed with:

>  1. **The edge-rendering boilerplate is now copied in two demos.**

I'll want to study that and see if it makes sense to move it to a dependency package and/or wrap it as a custom element or something.

## Claude's Implementation Notes II: the client helper

**`renderViaEdge` is a new o2h module:** `o2h/worker/edge.ts`, exported as `o2h/worker/edge.js`. I kept it out of `worker/client.js`, so pages using only the service worker don't load assign-gingerly. It's easy to move wherever you decide it belongs.

```js
import { renderViaEdge } from 'o2h/worker/edge.js';

const options = { pipes, style: true };
const { by, data, elapsed, pending, lost, error } = await renderViaEdge(container, { worker, api, config, options, hydrate: { registry } });
```

- **Stores the transform once per worker.** It's prepared once per `config` / `options` object pair, so the demos create their `options` once.
- **Retries once:** if the worker answers "no transform", which happens after a restarted `wrangler dev` with fresh local KV, it stores the transform again and retries.
- **Renders and hydrates:** the worker's HTML goes into the container, then builtIns.tree hydrates it with `adopt: 'pending'`, using the page's real pipes plus any `hydrate` options. It finds the embedded JSON by the config's `markerName` (default `tree`).
- **Falls back:** when the worker passes the JSON back, the page renders it, and the result says `by: 'page'`, with the worker's reason in `error`.
- **Throws** on worker or API errors, so each page decides what to say.

**The demos now use it:**
- **apod.html:** its render, hydrate and fallback block is now one call.
- **store/index.html:** its `render()` is now one line.
- Each page keeps only its own status messages.

**Checked in Chromium:**
- **APOD:** 12 pictures, with 24 parts finished on the page while hydrating, and nothing left pending.
- **Store:** 20 products.
- **The restart:** I then restarted the worker with **empty** storage, and clicked a category and then a product. Both still came back rendered by the worker, so the helper stored the transforms again on its own.

**Docs:** o2h's README has a new section, "Edge first paint: o2h-edge". o2h-edge's README shows the helper first, then the two raw requests.

**On a dependency package or a custom element:** the helper's inputs are already the attributes such an element would have: a worker URL, an API URL, a config and options. That makes an `<o2h-edge-view worker=… api=…>` wrapper straightforward, with the config and pipes set as properties. The one design question is how the element gets its config and code. An attribute can hold the worker URL and the API URL, but not the pipes.

## Bruce's Response III

> 2. **Attribute text with data in it is verbose.** `href="#product/${'?.id'}"` would be the natural thing to write in `` tree`…` ``, but mixed attribute text isn't supported, hence the `'?.href =&'` join spread. `` tree`…` `` could compile mixed attribute text into that join, like it already compiles mixed *content* into a `microJoin`. It's a small DX change in `DX/tree.ts`.

Please proceed with this fix.

## Claude's Implementation Notes III: mixed attribute text in `` tree`…` ``

**What you write now:**

```js
tree`<a class="product ${'?.kind'}" href="#product/${'?.id'}">${'?.title'}</a>`
// → ['a', { 'class :=': { join: ['product ', '?.kind'] }, 'href :=': { join: ['#product/', '?.id'] }, textContent: '?.title' }]
```

**One change from my original suggestion:** I'd proposed compiling mixed attribute text into the `'?.href =&'` join that the store used. That sets a **property**, though, which only works for attributes that have a matching property (`href`, `title`). It fails for `aria-*`, `data-*` and custom attributes, and `class` isn't `className`. So the change is a small core addition, a **`{ join }` value for ` :=`**, which works for any attribute. `` tree`…` `` compiles mixed text into it.

**assign-gingerly (`.ts` only; your watcher has rebuilt the `.js`):**
- **`syncOps/join.ts`:** adds `isJoinValue(value)`, which recognizes `{ join: [...], separator? }`.
- **`assignGingerly.ts`, `applyAttribute`:** a ` :=` value of `{ join }` (its paths already resolved, as any RHS is) is joined into one string, exactly as the `join` op does: no separator by default, nullish items dropped, nested sub-arrays all-or-nothing.
- **`handlers/compileTree.ts`, `attributeText`:** the same rule. That's what o2h uses to render attributes, so **the worker renders these with no o2h change**. Compile doesn't bake them, since they aren't literals.
- **`DX/tree.ts`, `attributeValue`:** mixed text becomes `{ join: [...] }`, and empty literal pieces are dropped.
  - **Still errors:** mixed text in `.prop`, `@event` or `ish`, and a `${…}` in mixed text that's an object rather than a path or a literal.
- **Docs:**
  - `docs/attribute-operator.md`: the value table has a `{ join }` row;
  - `docs/tree.md`: the mapping table has a row, the "Attribute values" note is rewritten, and the error example now uses `.title`.
- **Tests:**
  - `tests/dx-tree.html`, new Test 7b: the notation, and rendering class, href, title and a dropped nullish value, then a rebind (the same element, updated).
  - Three existing checks used a mixed `class` as their example of an error. They now use `.title`, and there's a new check that an unknown value in mixed text is accepted.
  - `tests/attribute-operator.html`, new Test 13: `{ join }` with a separator and a sub-array.
  - **The full suite** (scratch copy, three browsers): the first run had 174 passed, 12 skipped, and 3 failed, all of them this DX test, before I updated its error checks. After that, the DX and attribute-operator specs pass in all three browsers (67/67 and 39/39). I didn't run the whole suite again.

**o2h:** a new Node test renders `` tree`<a class="card ${…}" href="#product/${…}">` `` in o2h, and checks that both attributes come out as one joined string. 10/10 Node tests pass.

**The store demo** now writes `href="#category/${'?.'}"` and `href="#product/${'?.id'}"`, and the `hashLink` helper is gone. Rechecked in Chromium: same results, all rendered by the worker, nothing pending.

**The editor:** the Gingerly Tree Analyzer still underlines mixed attributes in the store page and in `dx-tree.html`. It seems to have loaded `analyzeTree` before the rebuild. A **Reload Window** should pick up the new one.
