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

## Bruce's Response I

>  **keyless or a worker-held key**

Let's start with keyless, but hopefully we will be able to add worker-held key in phase II?

> **whether it lives beside the store**

Please proceed with demo/bls/





## Claude's Implementation Notes I: step 1, keyless

Keyless for now. Phase II's worker-held key is noted below.

### What there is

[demo/bls/](../../demo/bls/), beside the store:
- [app.mjs](../../demo/bls/app.mjs) → app.json (`npm run build-bls` / `watch-bls`);
- [index.html](../../demo/bls/index.html), with `transition: true`, which gives the default cross-fade.

| Path | Sources | Shows |
|---|---|---|
| `/` | mapped: `timeseries/popular` | BLS's 25 popular series, as links |
| `/surveys` | aligned | The 70 surveys |
| `/surveys/:abbr` | mapped: `surveys/{abbr}`, `timeseries/popular?survey={abbr}` | The survey's name, its flags (net / percent changes, annual averages), and its popular series |
| `/timeseries/data/:id` | aligned | The latest value, large, and a table: year, period, value, footnotes |

There are **no layout sources**: each would cost a query on every page.

### Testing without spending the quota

- **Seven real responses, fetched once, kept as fixtures.** They are:
  - popular;
  - popular in CU;
  - the surveys;
  - CU;
  - CUUR0000SA0 (CPI);
  - LNS14000000 (unemployment);
  - an invalid series.
- **The check runs against them,** through the real worker:
  - a local stand-in for BLS serves the fixtures;
  - my `wrangler dev` (8788) runs with the existing `ALLOW_LOCAL_UPSTREAM`;
  - the page's `app.json` is rewritten to point at the stand-in.
- **With your `wrangler dev`, the demo calls BLS itself.** Today's count for your IP is 11: my 4 earlier probes, plus the 7 fixtures.

### What it uncovered

The real data had surprises the docs didn't mention:
- **`"value": "-"`** for a missing month, with a footnote: October 2025, "Data unavailable due to the 2025 lapse in appropriations".
- **`footnotes`** is `[{}]` when there are none.
- **`Results` is an object** in every response, not an array as some doc samples show.

How each issue from my thoughts turned out:

1. **Errors in a 200: displayed with what exists, but not reported.**
   - **Displayed:** each page maps `?.data?.message` to a list, and CSS hides it when it's empty. The invalid series shows "Invalid Series for Series NOPE0000000", "No data." (`each`'s `empty`), and no "latest" (a `choose`).
   - **But:** mirror and the status line still say "rendered by the worker", and the worker answered 200. If that should count as a failure, a source would need a way to say so. **It's still open,** and I'd leave it until something needs it.
2. **Envelopes: fine.** Path keys with array indexes work as map keys (`'?.data?.Results?.series?.0'`) and in route titles (`'?.survey?.Results?.survey?.0?.survey_name'`). It's wordy, but no `at:` is needed yet.
3. **Strings as numbers: no problem so far.** The values are shown as sent, `"-"` included. Formatting them (`Intl.NumberFormat`) would turn `"-"` into "NaN", so a number pipe needs a rule for non-numbers. That will matter for the chart.
4. **The chart:** step 2.
5. **`M13` annual averages:** the default request (the last three years) doesn't include them; annual averages need `annualaverage=true`, which needs a key. The CSS marks the row anyway (`tr[data-period="M13"]`). **No filter is needed yet.**
6. **`[{}]` footnotes: handled with CSS.** The `each` over footnotes renders an empty `<span>` for `{}`, and `span:empty` hides it. Of 33 rows, 32 have an empty one.
   - **The limitation:** it's fine for display, but the empty element is still there for anything that counts children.
7. **Names:** step 3. The surveys and survey pages show bare IDs.
8. **Quota:**
   - **The numbers:** one walk through the demo (popular → a series → surveys → CU → a series → an invalid one) is **8 BLS queries**. So keyless, it's **about three visitors a day**.
   - **What it means:** caching with the app's own freshness looks required before deploying it.
9. **The key:** phase II, as you said. Worth deciding then: a worker secret per upstream origin, added to the request by the worker, never visible to apps or pages.
10. **Query parameters** (year ranges): step 4.
11. **POST:** not needed so far.

**A new one, in tree:** whitespace between sibling elements doesn't survive.
- **The symptom:** `<h2><span>${name}</span> <span class="abbr">${abbr}</span></h2>` renders "…ConsumersCU". The gap is now a CSS margin.
- **Why it matters:** the accessible name is still "…ConsumersCU". The surveys list has the same issue ("CUConsumer Price Index…").
- **Also:** text after a child element, or `${…}` beside one, is refused at build time. That's a known rule, but it pushed this towards wrapping text in spans, which is where the whitespace loss shows.
- **Worth a look in assign-gingerly:** keep whitespace-only text between elements as a single space.

### Checked

The pages were checked against the fixtures, through the worker, in Chromium, Firefox and WebKit:
- **`/`:** 25 links.
- **Clicking the first** gives CUUR0000SA0:
  - latest 336.940, September 2026;
  - 33 rows;
  - October 2025 shows "-" and its footnote;
  - only one footnote is visible.
- **The surveys:** 70.
- **CU:**
  - the title is from the survey;
  - the flags are "Percent changes" and "Annual averages" (`allowsNetChange` is "false", so it's omitted);
  - 25 popular series.
- **LNS14000000 by deep link:** two footnotes (January 2026's revision, and October 2025).
- **The invalid series:** the message, "No data.", and no latest.
- **At 375px (Chromium):** no horizontal scroll on the series or the surveys. Long footnotes wrap: a URL was clipped before `overflow-wrap`.

**Changed:**
- **demo/bls/:** new, `app.mjs`, `app.json` and `index.html`;
- **package.json:** `build-bls` / `watch-bls`;
- **README:** a "Demo: BLS data" section.

Nothing in the libraries changed. Nothing is committed.

**Next, step 2: the chart.** Bars drawn by CSS from the values need the series' min and max. I'd add `max` / `min` data pipes to assign-gingerly, beside `sum`. They would skip non-numbers like `"-"`.
