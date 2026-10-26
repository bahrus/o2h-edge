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
