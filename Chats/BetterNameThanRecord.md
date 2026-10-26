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
