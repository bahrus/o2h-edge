# Create Demo

## Bruce's Ask

I would like to see if creating a UI similar to the Store for this set of API:  https://www.bls.gov/developers/api_signature_v2.htm would possible iron out more issues not yet uncovered?  What do you think?

Please add your thoughts below.
## Claude's Thoughts

**Yes, I think it's worth it.** The store mostly exercised what the libraries were built around: lists of records, one record, links between them. The BLS API is different almost everywhere the store was easy, so it should surface new issues rather than repeat old ones.

### What I checked

I read the [v2 signatures](https://www.bls.gov/developers/api_signature_v2.htm) and the FAQ, and made four keyless GETs to `https://api.bls.gov/publicAPI/v2/`:
- `timeseries/data/LNS14000000`, the unemployment rate;
- `timeseries/popular?survey=CU`;
- `surveys/CU`;
- `timeseries/data/LNS14000000?startyear=2010&endyear=2012`.

What came back:
- **Without a key, GET works on v2,** year ranges in the query string included. The FAQ's limits without a key are 25 queries a day, 25 series and 10 years.
- **Responses are `application/json`, with `Access-Control-Allow-Origin: *`.** So it passes the worker's JSON-only guard, and a page could also call it directly.
- **`Cache-Control: max-age=0, no-cache, no-store`.** That's on data that changes once a month.
- **The envelope:** `{ status, responseTime, message: [], Results: { series: [{ seriesID, data: [...] }] } }`.
  - Every value is a string: `"value": "4.2"`, `"year": "2026"`, `"latest": "true"`.
  - The data comes newest first.
  - `footnotes` is `[{}]` when there are none.
- **`popular` returns only IDs** (`{ seriesID }`), with no titles. Titles come from `catalog`, which needs a key.

### A UI like the store's

The paths would still mirror the API:

| Path | Shows | Sources |
|---|---|---|
| `/surveys` | The surveys (about 60), as links | aligned |
| `/surveys/:abbr` | One survey, its flags, and its popular series | mapped: `surveys/{abbr}` and `timeseries/popular?survey={abbr}` |
| `/timeseries/data/:id` | One series: the latest value, large, with its change; a bar chart of the last three years; and a table (period, value, footnotes such as "P: preliminary") | aligned |

The home page could be a mapped route to `timeseries/popular`, showing the headline series.

### Issues I'd expect it to uncover

1. **Errors inside a 200.**
   - **Today:** the worker and mirror treat 200 as success. BLS reports a bad series as `status: "REQUEST_SUCCEEDED"`, with `message: ["Invalid Series …"]` and empty `data`.
   - **The question:** is that just a `choose` in the tree, on `?.data?.message`? Or does a source need a way to say "this 200 is a failure" (e.g. `{ url, ok: '?.status' }`), so `onRender` and the status code reflect it?
   - **Tests:** conditional display over real data.
2. **Envelopes.** The useful data sits at `?.data?.Results?.series?.0?.data`, and the title at `?.survey?.Results?.survey?.0?.survey_name`.
   - **Tests:** deep paths with array indexes, in route titles too.
   - **A possible need:** a way to name a sub-path once (a source's `at:`), instead of repeating it.
3. **Numbers as strings.**
   - `sum` already uses `Number()`, and `Intl.NumberFormat` formats numeric strings.
   - **Tests:** whether the rest holds up, e.g. a change computed as `value - previous`.
4. **Charts without arithmetic.**
   - **The easy part:** bars can be drawn with CSS from data, `style="--v: ${'?.value'}"`, with `height: calc(var(--v) / var(--max) * 100%)`. Newest-first data is no problem: `flex-direction: row-reverse`.
   - **The gap:** `--max` (and `--min`, for a sensible baseline) need **aggregates over the array**.
   - **How it could be filled:** `max` and `min` data pipes would be small siblings of `sum`, the kind of addition stage 1 added. A line chart (`<polyline points>`) would need per-point arithmetic, which I'd avoid: bars are enough.
5. **Periods that aren't months.**
   - **The codes:** `M13` is an annual average, mixed in with `M01`–`M12`, alongside `A01`, `Q01`–`Q05` and `S01`–`S03`.
   - **Tests:** CSS can hide them (`[data-period="M13"]`). But a filter on `each` (`each('?.', { if: … })`), or a data pipe that filters, may turn out to be needed. Either is a real question for assign-gingerly.
6. **Empty-object footnotes.**
   - **The issue:** `[{}]` renders one empty item.
   - **Tests:** `each` over sparse records: a filter again, or `empty` keyed to "has text".
7. **Names for IDs: the join.**
   - **The issue:** without a key, `popular` gives `CUUR0000SA0`, not "CPI-U, all items".
   - **What's needed:** a lookup from ID to title (shipped with the app) joined to the list. That's the join handler, which the store never needed. A `lookup` data pipe over a table held in the app's options would be the data-only version.
8. **Quotas, so caching becomes required.**
   - **The problem:** 25 queries a day, without a key, are counted **per IP**. From the worker, that's Cloudflare's egress IP, shared with other tenants. The demo could run dry before anyone visits.
   - **Caching is stage 5, and here it's a prerequisite.** And it can't follow the upstream's headers, which say `no-store`. The app would declare its own freshness per source (e.g. `maxAge: 6h`). That's a design question the store never raised.
9. **The key.**
   - **The tension:** 500 a day, 20 years, and catalog titles all need `registrationkey`. Our rule is that keys live in neither the worker nor pages.
   - **Options:**
     - keep the demo keyless, which makes caching essential;
     - or decide on a narrow exception: a worker secret per upstream origin, added by the worker, never seen by apps or pages.

   I'd stay keyless, but it's your call, and it's worth settling explicitly.
10. **Query parameters from the visitor.**
    - **The issue:** a year-range form produces `?startyear=2015&endyear=2020`. But mirror doesn't pass the visitor's query string on, by design.
    - **Options:**
      - put it in the path (`/timeseries/data/:id/:start/:end`, mapped to `…?startyear={start}&endyear={end}`), which breaks the mirroring and doesn't fit a GET form;
      - or let a route allow named query parameters through (`query: ['startyear', 'endyear']`), validated.

    This is a gap the store hid.
11. **POST for several series.** Comparing series means POST, and the worker is GET-only, which should stay. Parallel sources (one GET per series) cover a small comparison, but each costs a query. That's another reason for caching.

### What it wouldn't test much

Events and the cart, popovers, hydration of interactive parts. The store covers those.

### Suggested order

1. **Surveys, a survey, a series (table only).** That finds issues 1, 2, 3, 5 and 6 quickly, with nothing new in the libraries unless they force it.
2. **The chart:** issue 4, probably `min` and `max` data pipes.
3. **Names (the join or a lookup):** issue 7.
4. **Year ranges:** issue 10, the query-parameter decision.
5. **Caching with app-declared freshness:** issue 8. This is stage 5, done for an API that needs it.

Before starting, two questions: **keyless or a worker-held key** (issue 9), and **whether it lives beside the store** (`demo/bls/`, my assumption) or elsewhere.

My four probe requests count against today's 25 for your IP.
