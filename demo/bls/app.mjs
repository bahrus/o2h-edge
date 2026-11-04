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

// [{ seriesID }, …]: links to each series
const seriesList = tree`
    <ul class="series-list" ${each('?.', { empty: tree`<li class="empty">No series.</li>` })}>
        <li><a href="timeseries/data/${'?.seriesID'}">${'?.seriesID'}</a></li>
    </ul>`;

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

// One series ({ seriesID, data: [{ year, period, periodName, latest, value, footnotes: [{ code, text }] }] }), newest
// first. Values are strings; a missing one is "-". footnotes is [{}] when there are none (an empty item, hidden by CSS).
// The chart: a bar per value, scaled by CSS between the series' lowest and highest (the low / high pipes). A "-"
// makes its bar's height invalid, so it's a gap. The bars are hidden from assistive tech: the table has the numbers.
const series = {
    map: {
        '?.data?.message': messages,
        '?.data?.Results?.series?.0': tree`
            <section class="series">
                <h2>${'?.seriesID'}</h2>
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
        { pattern: '/timeseries/data/:id', config: series, title: '?.route?.id' },
    ],
    options: {
        // Data pipes, so the worker renders the chart: a series' range (values are strings; "-" is skipped)
        pipes: {
            low: { min: '?.value' },
            high: { max: '?.value' },
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
