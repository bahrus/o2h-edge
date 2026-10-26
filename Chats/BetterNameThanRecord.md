# Better Name Than Record

## Bruce's Ask

Maybe this naming already got defined in o2h, and o2h-edge is just carrying over that name.  I was attempting to provide a [gentler learning path in the README.md](../README.md#workflow) (with humans in mind, perhaps), and the name "record" feels too vague.  I'm thinking a better name might be O2HConfig, which maybe should mean that the function prepareO2HRecord in o2h package should be renamed prepareO2HConfigInfo.  Maybe that would be over riding something else we are calling "Config", so maybe another name should be used?

Let me know your thoughts.


## Claude's Thoughts

**You're right on both counts.**
- **The name came from o2h:** `prepareO2HRecord`, `storeO2HRecord`, `O2HRecord`, all from the service worker work. o2h-edge just carried it over.
- **`O2HConfig` is already taken:** it's o2h's type for the **tree config**, o2h's first argument (`o2h(config: O2HConfig, from, options)`, in `types/o2h/types.d.ts`). The "record" *contains* one: it's `{ config, options }`. Calling the whole thing `O2HConfig` would make "config" mean two different things, one inside the other.

**"Record" is vague** because it describes how the thing is *stored* (a row in IndexedDB or KV), not what it *is*. What it is: **everything needed to display an API's data, apart from the data itself.** That's the tree config, the pipes and the other options, stored under a key so the request only has to name it.

### Suggestion: a "view"

| Today | Renamed |
|---|---|
| record | **view** |
| `O2HRecord` | `O2HView` |
| `prepareO2HRecord` / `PreparedO2HRecord` | `prepareO2HView` / `PreparedO2HView` |
| `storeO2HRecord`, `getO2HRecord`, `deleteO2HRecord` | `storeO2HView`, `getO2HView`, `deleteO2HView` |
| `reviveO2HRecord` | `reviveO2HView` |
| the `X-O2H-Config` header (already named "Config"!) | `X-O2H-View` |
| o2h-edge: `PUT /records/<key>` | `PUT /views/<key>` |
| o2h-edge: `/render?api=…&config=<key>` | `/render?api=…&view=<key>` |
| o2h-edge: the `RECORDS` KV binding, `MAX_RECORD_BYTES` | `VIEWS`, `MAX_VIEW_BYTES` |

**Why "view":**
- **It pairs with a word the project already uses:** the API's JSON is the **view model** (`vm`) everywhere in assign-gingerly's docs. The "record" is how to show it: **the view**. "Render this view model with that view" says exactly what `/render` does.
- **It reads naturally in the README's workflow:** "the page stores a *view* (how to display the data), then asks the worker to call an API (*what* to display) and render it with that view."
- **It's short,** and works in code, URLs and headers alike.

**The one risk:** "view" is a common word (MVC views, database views). Within this project, though, it sits next to "view model", where its meaning is clear.

**Other candidates I considered:**
- **"Template":** clearest to newcomers, but already used twice: HTML `<template>`, and `compile`'s compiled templates. It would collide.
- **"Recipe":** friendly and clearly "how", but whimsical in an API (`prepareO2HRecipe`).
- **"Render plan":** accurate, but long. "Plan" is also used for microJoin (`planMicroJoin`).
- **`prepareO2HConfigInfo`:** avoids the clash, but "info" is as vague as "record", and "Config" still suggests it *is* the tree config.

### What renaming would touch

Nothing is published yet (o2h's worker modules and o2h-edge are both new), so there's no compatibility to keep. It's a mechanical rename:
- **o2h:**
  - `worker/` (`store.ts`, `record.ts`, which would become `view.ts`, `core.ts`, `client.ts`, `serviceWorker.ts`);
  - the IndexedDB store name;
  - `o2h-sw.js` (rebuilt);
  - the README;
  - the tests.
- **o2h-edge:** `src/`, `wrangler.jsonc`, the tests, the demo and the README.

The chats would keep the old word, as history. The test suites in both repos would confirm the rename.

### Question

**"View"** (with the table above), or another name? Once you've chosen, I'll do the rename across both repos and run the tests.

## Bruce's Response I

What do you think of:

| Today | Renamed |
|---|---|
| record | **transform** |
| `O2HRecord` | `O2HTransform` |
| `prepareO2HRecord` / `PreparedO2HRecord` | `prepareO2HTransform` / `PreparedO2HTransform` |
| `storeO2HRecord`, `getO2HRecord`, `deleteO2HRecord` | `storeO2HTransform`, `getO2HTransform`, `deleteO2HTransform` |
| `reviveO2HRecord` | `reviveO2HTransform` |
| the `X-O2H-Config` header (already named "Config"!) | `X-O2H-Transform` |
| o2h-edge: `PUT /records/<key>` | `PUT /transforms/<key>` |
| o2h-edge: `/render?api=…&config=<key>` | `/render?api=…&transform=<key>` |
| o2h-edge: the `RECORDS` KV binding, `MAX_RECORD_BYTES` | `TRANSFORMS`, `MAX_TRANSFORM_BYTES` |


## Claude's Thoughts II

**I like "transform", maybe better than "view".**

**For:**
- **It names what the thing is for:** o2h turns an object into HTML, and this is the description of *how*. o2h's own `package.json` already lists `"transformer"` as a keyword.
- **It has a strong precedent:** an **XSLT stylesheet** is exactly this. It's a stored, reusable description of how to turn data into HTML, and XSLT calls it a *transform*. People who know XSLT will get it immediately.
- **It sidesteps "view"'s baggage:** MVC views, database views, and the near-collision with *view model* that I had counted as a plus, but which could just as well confuse.
- **It reads well in the workflow:** "store a transform (*how*), then ask the worker to render an API (*what*) with it", and `/render?api=…&transform=…`.

**Against, mildly:**
- **`TransformStream`:** the Web Streams API has a `TransformStream`. If o2h-edge streams later (the page shell, or NDJSON), the code may hold both "a transform" and "a TransformStream". That's manageable with clear variable names, but worth knowing.
- **Verb and noun:** "transform" is also a verb, so `prepareO2HTransform` could read as "prepare to transform". In context, the type `O2HTransform` makes it clear it's a noun.

**One thing to settle:** the table's first row still says record → **view**. I assume you mean **transform** there too, so that the prose ("the page stores a transform") matches the code.

**If that's a yes,** I'll do the rename across both repos exactly as in your table:
- **o2h:** `worker/` (`record.ts` becomes `transform.ts`), the IndexedDB store, the header, the bundle, the README and the tests;
- **o2h-edge:** endpoints, the query parameter, the KV binding and vars, `src/`, the tests, the demo and the README (including your Workflow section).

The chats keep the old word, as history.

## Bruce's Response II

Sorry, missed the first row, corrected it inline.  Agreed, view => transform.

No need to rename it in chats history, unless it is easier to rename with search and replace, which I'm okay with too.



## Claude's Implementation Notes

**Done:** "record" is now "transform" in code and docs across both repos, per the table. The chats keep the old word, as history.

**o2h:**
- **`worker/record.ts` is now `worker/transform.ts`.** It exports `prepareO2HTransform` / `PreparedO2HTransform`. The old `record.js` is deleted.
- **`store.ts`:**
  - `O2HTransform` and `store/get/deleteO2HTransform`.
  - The IndexedDB store is now called `transforms`. The database moves to version 2: the upgrade deletes the old `records` store and creates `transforms`. Transforms stored before the rename are dropped, not migrated. Their keys are content hashes, so pages just store them again.
- **`core.ts`:** `reviveO2HTransform`. `O2H_HEADER` is now `X-O2H-Transform`. The error header says `no transform for "<key>"`.
- **Also updated:** `client.ts` (its re-exports), `serviceWorker.ts`, `o2h.ts`, the README and the tests. The worker bundle `o2h-sw.js` is rebuilt.

**o2h-edge:**
- **`src/records.ts` is now `src/transforms.ts`**, with `getTransform` / `putTransform` / `isTransformKey`.
- **Endpoints:** `PUT /transforms/<key>` and `GET /render?api=<url>&transform=<key>`.
- **`wrangler.jsonc`:** the KV binding is `TRANSFORMS` and the size var is `MAX_TRANSFORM_BYTES`. `worker-configuration.d.ts` is regenerated.
- **Also updated:** the type shim, `test/edge.test.mjs`, `demo/apod.html` and the README (your Workflow section included).
- **On deploy:** nothing is deployed yet, so the first deploy creates the namespace under its new name. Local dev data stored under the old binding is no longer used. The demo stores its transform again each time it loads.

**Verified:**
- **Typecheck:** clean for o2h (its build, plus a workspace check) and for o2h-edge.
- **o2h browser tests:** 12/12 pass, the service worker test included.
- **o2h Node tests:** 9/9 pass.
- **o2h-edge:** 13/13 pass.
- **Leftovers:** a grep for `record` / `config=` outside the chats finds only `MutationRecord` in benchmark data.

**Nothing is committed.**
