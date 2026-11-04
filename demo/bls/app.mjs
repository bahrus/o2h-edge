//@ts-check
// The BLS Public Data API (v2, keyless), as a navigate-gingerly app: paths are the API's paths (surveys, surveys/CU,
// timeseries/data/CUUR0000SA0), rendered by o2h-edge. Built to app.json (`npm run build-bls`, or `npm run watch-bls`).
// Keyless means 25 queries a day per IP, so nothing is fetched on every page (no layout sources).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tree, each, choose } from 'assign-gingerly/DX/tree.js';

/** @import {O2HApp} from 'o2h' */

// Every response is { status, responseTime, message: [...], Results: {...} }. The messages carry errors, even in a
// 200 ("Invalid Series for Series X"), so each page shows them (an empty list shows nothing).
const messages = tree`<ul class="messages" ${each('?.')}><li>${'?.'}</li></ul>`;

// [{ seriesID }, …]: links to each series, named where the app knows the name (the seriesName pipe)
const seriesList = tree`
    <ul class="series-list" ${each('?.', { empty: tree`<li class="empty">No series.</li>` })}>
        <li><a href="timeseries/data/${'?.seriesID'}"><span class="id">${'?.seriesID'}</span><span class="name">${'?.seriesID?.seriesName'}</span></a></li>
    </ul>`;

// Names for series IDs. Keyless, the API gives IDs only (titles come with catalog=true, which needs a key), so the
// app names the ones it shows most, from BLS's ID conventions (CU: CPI-U; U / S: not / seasonally adjusted; 0000:
// U.S. city average; then the item). Not checked against BLS's catalog. Unnamed IDs show just the ID.
const cpi = (/** @type {string} */ item) => ({
    [`CUUR0000${item}`]: `CPI-U, ${CPI_ITEMS[item]}, not seasonally adjusted`,
    [`CUSR0000${item}`]: `CPI-U, ${CPI_ITEMS[item]}, seasonally adjusted`,
});
/** @type {Record<string, string>} */
const CPI_ITEMS = {
    SA0: 'all items', SA0L1E: 'all items less food and energy', SA0E: 'energy', SAF1: 'food', SAF11: 'food at home',
    SAH1: 'shelter', SEHA: 'rent of primary residence', SEHC: "owners' equivalent rent of residences", SAA: 'apparel',
    SAM: 'medical care', SAR: 'recreation', SETA01: 'new vehicles', SETA02: 'used cars and trucks',
    SETB01: 'gasoline (all types)', SASLE: 'services less energy services', SACL1E: 'commodities less food and energy commodities',
};
const seriesNames = {
    ...Object.assign({}, ...Object.keys(CPI_ITEMS).map(cpi)),
    LNS14000000: 'Unemployment rate, seasonally adjusted',
    CES0000000001: 'All employees, total nonfarm, seasonally adjusted (thousands)',
    CES0500000003: 'Average hourly earnings of all employees, total private, seasonally adjusted',
    WPUFD4: 'PPI, final demand, not seasonally adjusted',
    WPSFD4: 'PPI, final demand, seasonally adjusted',
    WPUFD49104: 'PPI, final demand less foods, energy, and trade services, not seasonally adjusted',
};

// Popular series (BLS's 25 headline series)
const popular = {
    map: {
        '?.data?.message': messages,
        '?.data?.Results?.series': seriesList,
    },
};

// [{ survey_abbreviation, survey_name }, …]
const surveys = {
    map: {
        '?.data?.message': messages,
        '?.data?.Results?.survey': tree`
            <ul class="surveys" ${each('?.', { key: '?.survey_abbreviation' })}>
                <li><a href="surveys/${'?.survey_abbreviation'}"><span class="abbr">${'?.survey_abbreviation'}</span> <span>${'?.survey_name'}</span></a></li>
            </ul>`,
    },
};

// A flag, as BLS sends it ("true" / "false"): an item when "true", nothing otherwise
const flag = (/** @type {string} */ at, /** @type {string} */ label) => choose(at, { true: tree`<li>${label}</li>` }, null);

// One survey ({ survey_name, survey_abbreviation, allowsNetChange, … }), and its popular series
const survey = {
    map: {
        '?.survey?.message': messages,
        '?.survey?.Results?.survey?.0': tree`
            <header class="survey">
                <h2><span>${'?.survey_name'}</span> <span class="abbr">${'?.survey_abbreviation'}</span></h2>
                <ul class="flags">
                    ${flag('?.allowsNetChange', 'Net changes')}
                    ${flag('?.allowsPercentChange', 'Percent changes')}
                    ${flag('?.hasAnnualAverages', 'Annual averages')}
                </ul>
            </header>`,
        '?.popular?.message': messages,
        '?.popular?.Results?.series': seriesList,
    },
};

// The years shown: a plain GET form, whose fields are the API's own parameters (the route lets them through), so
// the page's URL is the API's: timeseries/data/X?startyear=2010&endyear=2012. BLS wants both years, or neither
// (the last three years). Its context is the VM's route ({ id, startyear, endyear }).
const range = tree`
    <form class="range" action="timeseries/data/${'?.id'}">
        <label><span>From</span><input name="startyear" type="number" inputmode="numeric" min="1913" max="2099" required value=${'?.startyear'}></label>
        <label><span>to</span><input name="endyear" type="number" inputmode="numeric" min="1913" max="2099" required value=${'?.endyear'}></label>
        <button type="submit">Show</button>
        <a href="timeseries/data/${'?.id'}">The last three years</a>
        <small>Without a key, BLS gives up to 10 years at a time.</small>
    </form>`;

// One series ({ seriesID, data:[{ year, period, periodName, latest, value, footnotes: [{ code, text }] }] }), newest
// first. Values are strings; a missing one is "-". footnotes is [{}] when there are none (an empty item, hidden by CSS).
// The chart: a bar per value, scaled by CSS between the series' lowest and highest (the low / high pipes). A "-"
// makes its bar's height invalid, so it's a gap. The bars are hidden from assistive tech: the table has the numbers.
const series = {
    map: {
        '?.route': range,
        '?.data?.message': messages,
        '?.data?.Results?.series?.0': tree`
            <section class="series">
                <h2>${'?.seriesID'}</h2>
                <p class="name">${'?.seriesID?.seriesName'}</p>
                ${choose('?.data?.0?.latest', { true: tree`
                    <p class="latest">
                        <span class="value">${'?.data?.0?.value'}</span>
                        <span>${'?.data?.0?.periodName'} ${'?.data?.0?.year'}, the latest</span>
                    </p>` }, null)}
                <figure class="chart" style="--low: ${'?.data?.low'}; --high: ${'?.data?.high'}">
                    <ol class="bars" aria-hidden="true" ${each('?.data')}>
                        <li style="--v: ${'?.value'}" data-period=${'?.period'} title="${'?.periodName'} ${'?.year'}: ${'?.value'}"></li>
                    </ol>
                    <figcaption><span>Lowest ${'?.data?.low'}</span> <span>highest ${'?.data?.high'}</span></figcaption>
                </figure>
                <table>
                    <thead><tr><th scope="col">Year</th><th scope="col">Period</th><th scope="col" class="value">Value</th><th scope="col">Notes</th></tr></thead>
                    <tbody ${each('?.data', { empty: tree`<tr><td colspan="4" class="empty">No data.</td></tr>` })}>
                        <tr data-period=${'?.period'}>
                            <td>${'?.year'}</td>
                            <td>${'?.periodName'}</td>
                            <td class="value">${'?.value'}</td>
                            <td class="notes" ${each('?.footnotes')}><span>${'?.text'}</span></td>
                        </tr>
                    </tbody>
                </table>
            </section>`,
    },
};

/** @type {O2HApp} */
export const app = {
    api: 'https://api.bls.gov/publicAPI/v2',
    routes: [
        // The base: BLS's popular series (mapped, since the API has nothing at its root)
        { pattern: '/', sources: { data: 'timeseries/popular' }, config: popular, title: 'BLS data' },
        // Aligned: the path is the API's path
        { pattern: '/surveys', config: surveys, title: 'Surveys' },
        { pattern: '/surveys/:abbr', sources: { survey: 'surveys/{abbr}', popular: 'timeseries/popular?survey={abbr}' }, config: survey, title: '?.survey?.Results?.survey?.0?.survey_name' },
        // Aligned, with the API's own year parameters let through: ?startyear=2010&endyear=2012
        { pattern: '/timeseries/data/:id', query: ['startyear', 'endyear'], config: series, title: '?.route?.id' },
    ],
    options: {
        // Data pipes, so the worker renders the chart: a series' range (values are strings; "-" is skipped)
        pipes: {
            low: { min: '?.value' },
            high: { max: '?.value' },
            // A lookup (no default: an unnamed ID renders nothing)
            seriesName: { map: seriesNames },
        },
    },
};

/** The app as JSON. Throws for code, which JSON would silently drop: reference it as { import, export } instead. */
export function render() {
    return JSON.stringify(app, (key, value) => {
        if (typeof value === 'function' || typeof value === 'symbol') {
            throw new Error(`app.mjs: "${key}" is code, which JSON can't hold; use { import: './module.js', export: '${key}' }`);
        }
        return value;
    }, 4);
}

// Run directly (not imported, as spa-ssi does to call render()): write app.json beside this file
if (import.meta.main) writeFileSync(fileURLToPath(new URL('app.json', import.meta.url)), render(), 'utf8');
