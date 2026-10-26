# Add API to List All Transforms

## Bruce's Ask

I think it would be helpful to provide an endpoint that lists all the transforms.

Ideally, the transform would display as "pretty" JSON, but also provide a button to copy the raw information to the clipboard.

Let me know your thoughts on this / what clarifications are needed.

## Claude's Thoughts

**Agreed, it's useful.** Today a transform is a hash you can store but never see again, so you can't tell what's in KV or reuse a transform somewhere else. Here's what I'd propose, and three questions.

**The API (JSON, like the rest of the worker):**
- **`GET /transforms`:** the list, as `{ transforms: [{ key, bytes, stored, summary }], cursor }`.
  - KV lists 1,000 keys per call. The `cursor` asks for the next page (`?cursor=…`).
  - **Listing doesn't read every value.** `PUT` would save a little metadata next to the transform: its size, when it was stored, and a summary (the config's top-level map keys, e.g. `title, date, explanation, media`). So the list costs one KV call, not one read per transform. A bare hash says nothing, so the summary is what makes the list readable.
- **`GET /transforms/<key>`:** one transform, exactly as stored (today that answers 405). Copy and pretty-print both need it.

**The pretty view:** a page in `demo/`, say `demo/transforms.html`, served by `npm run serve` like `apod.html`, that calls the API.
- **Each transform shows its key, summary, size and date**, and expands to show the JSON, indented and colored.
- **A Copy button** copies the **raw** JSON: the exact stored string, the one the key is a hash of. That way, pasting it into another `PUT` reproduces the same key. The pretty version is for reading only.
- **I'd keep this page out of the worker.** The worker stays a JSON API with no HTML of its own. It's also a nice chance to render the list with o2h itself, through the worker.

**Questions:**
1. **Who may list?** This is the main one. Anyone can store a transform, so on the public sandbox a list would show everyone's transforms to everyone. They aren't secrets (keys come from their content, and the pages that use them ship them anyway), but a public list turns the worker into a browsable store, spam included. Options:
   - **(a) An off switch:** a `LISTING` var, `"off"` in `wrangler.jsonc` and `"on"` in `.dev.vars`. You'd only list locally.
   - **(b) An admin token** (my recommendation): a `wrangler secret` called `LIST_TOKEN`. Listing needs `Authorization: Bearer <token>`, except on localhost. The demo page has a field for the token and keeps it only in `sessionStorage`. You can list the deployed worker, and nobody else can.
   - **(c) Public.** Simplest, if a public catalog is actually what you want.

   `GET /transforms/<key>` can stay public in every case, since anyone who knows a key could render with it anyway.
2. **What about transforms stored before this change?** They have no metadata. I'd show them with the size and summary left blank, rather than reading each one. That's only local dev data anyway, since nothing is deployed.
3. **Delete?** You didn't ask, and a transform can't be changed, so I'd leave it out for now. If you want it, it should be behind the same token.

## Bruce's Response

> 1. **Who may list?** 

I agree with your recommendation (admin token)

> 2. **What about transforms stored before this change?**

I agree.

> 3. **Delete?**

Agreed, until a strong need arises, let's not.


## Claude's Implementation Notes

**The worker:**
- **`GET /transforms[?cursor=…]`** lists the stored transforms, as `{ transforms: [{ key, bytes, stored, summary }], cursor }`. A page holds up to 1000, and `cursor` is `null` on the last one.
  - **On localhost** it's open. **Elsewhere** it needs `Authorization: Bearer <token>` matching the `LIST_TOKEN` secret, compared in constant time.
  - **Without the secret**, listing is off: `403`. A missing or wrong token gets `401`.
  - **To turn it on** for the deployed worker: `npx wrangler secret put LIST_TOKEN`. Its type is declared in `src/types/env.d.ts`, since `wrangler types` doesn't see secrets.
- **`GET /transforms/<key>`** returns the transform exactly as stored, and it's public. It's marked `Cache-Control: immutable`, since a key always names the same content.
- **On `PUT`, each transform gets metadata** (`TransformInfo` in `src/transforms.ts`), so listing reads no values:
  - **`bytes`;**
  - **`stored`:** the date it was **first** stored. Storing it again now reads first and skips the write. That keeps the date, and saves a KV write each time the APOD page loads.
  - **`summary`:** the data fields it reads, in order of appearance: map keys with their comments stripped, plus the first step of each `?.` path. For example, APOD's is `media_type, permalink, hdurl, alt, date, title, explanation, credit`. It's a hint for readers, capped to fit KV's 1 KB metadata limit.
- **Transforms stored earlier** list with only their key, as agreed. Storing one again adds its metadata.
- **CORS** now allows the `Authorization` header. The rate limit covers `/transforms` too.

**The page:** [`demo/transforms.html`](../demo/transforms.html) is served like the APOD demo.
- **Each row** shows the key, summary, size and date, in a `<details>`. The list is rendered with `builtIns.tree`.
- **Opening a row** fetches that transform once, and shows it indented and colored.
- **Copy raw** copies the exact stored string.
- **"More"** fetches the next page into its own container, so open rows stay open.
- **The token field** is kept in `sessionStorage` (this tab only).
- **Checked in Chromium:**
  - the list, with the metadata-less transforms showing blanks;
  - a row expands to colored JSON;
  - after Copy, the clipboard equals the stored JSON;
  - no horizontal scroll at 375px.

**Tests:** 16/16 pass (there were 13). The new ones cover:
- reading a transform back (exact JSON, `immutable`, 404, 405 for other methods);
- the list from localhost (size, date, summary);
- the token. Requests sent with a `workers.dev` Host header get `401` without the token and with a wrong one, and `200` with the right one.

**One thing I noticed:** `wrangler.jsonc` now has the KV namespace's `id` (so you've deployed), but its comment and the README's Deploying step still say there's "no id on purpose". I left both alone. Should I update them to match?

## Bruce's Response II

Looks good.

> **One thing I noticed:** `wrangler.jsonc` now has the KV namespace's `id` (so you've deployed), but its comment and the README's Deploying step still say there's "no id on purpose". I left both alone. Should I update them to match?

Yes, please
## Claude's Implementation Notes II

**Updated both:**
- **The `wrangler.jsonc` comment:** the id is this repo's deployed namespace, which wrangler created on the first deploy and wrote back. A copy deployed to another account removes the id and gets its own the same way.
- **The README's Deploying step** says the same. It also adds the `LIST_TOKEN` secret, needed for listing transforms on the deployed worker.
