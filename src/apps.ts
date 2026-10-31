/**
 * Apps (navigate-gingerly): routes whose paths mirror an API's, installed by the hash of their content, and
 * rendered path by path.
 *
 *   PUT /o2h-app/<key>          install an app (navigate-gingerly's prepareApp), keyed by the hash of its content
 *   GET /o2h-app/<key>          the app, exactly as stored
 *   GET /o2h-app/<key>/<path>   match the path to a route, fetch its sources in parallel, and render the VM
 *                               ({ route, ...sources }) with the route's transform: an HTML fragment, with the VM
 *                               embedded after it, for the app's page to insert and hydrate
 *
 * As with transforms, anyone may install an app but nobody can change one: a different app has a different key.
 * Apps are data only (the page resolved its code before preparing it, and the transforms hold stand-ins), and
 * the worker returns fragments, not documents, so an app can't put pages or scripts on the worker's origin.
 * Every source goes through the same guards as /render.
 */

import { handleO2HRequest, O2H_HEADER } from 'o2h/worker/core.js';
import type { O2HTransform } from 'o2h/worker/core.js';
import { appKey, validateApp } from 'navigate-gingerly/app.js';
import { composeVM, matchRoute, sourcesFor } from 'navigate-gingerly/routes.js';
import type { InstalledApp } from 'navigate-gingerly/routes.js';
import { errorResponse, guardedFetch, refuseApiUrl } from './guards.js';

const KEY = /^app-[0-9a-f]{32}$/;

/** What's kept beside an app, for a list (later). */
export interface AppInfo {
    bytes: number;
    /** When it was first stored (ISO) */
    stored: string;
    /** Its route patterns, e.g. "/, /products/:id" */
    summary: string;
}

export function isAppKey(key: string): boolean {
    return KEY.test(key);
}

/** Install an app sent as JSON: a reason it's refused, or undefined once stored. */
export async function putApp(env: Env, key: string, body: string): Promise<string | undefined> {
    if (!isAppKey(key)) return 'an app key looks like app- followed by 32 hex digits';
    const maxBytes = Number(env.MAX_APP_BYTES) || 1_048_576;
    if (new TextEncoder().encode(body).byteLength > maxBytes) return `an app may be at most ${maxBytes} bytes`;
    let app: InstalledApp<O2HTransform>;
    try {
        app = JSON.parse(body);
    } catch {
        return "the app isn't JSON";
    }
    try {
        validateApp(app);
    } catch (e) {
        return (e as Error).message;
    }
    const { routes, transforms } = app;
    if (!transforms || typeof transforms !== 'object') return 'an app has transforms';
    for (const [i, route] of routes.entries()) {
        const transform = transforms[route.transform];
        if (!transform || typeof transform !== 'object' || !transform.config || typeof transform.config !== 'object') {
            return `route ${i} ("${route.pattern}") names the transform "${route.transform}", which the app doesn't have`;
        }
    }
    // prepareApp hashes JSON.stringify(app), which parsing and stringifying again reproduces
    if (await appKey(app) !== key) return "the key doesn't match the app's content";
    const existing = await env.TRANSFORMS.getWithMetadata<AppInfo>(key);
    if (existing.value !== null && existing.metadata) return undefined;
    const json = JSON.stringify(app);
    const summary = routes.map(r => r.pattern).join(', ');
    const metadata: AppInfo = {
        bytes: new TextEncoder().encode(json).byteLength,
        stored: new Date().toISOString(),
        summary: summary.length > 300 ? `${summary.slice(0, 299)}…` : summary,
    };
    await env.TRANSFORMS.put(key, json, { metadata });
    return undefined;
}

/** The app a key names, exactly as stored, if stored. */
export async function getAppJson(env: Env, key: string): Promise<string | undefined> {
    if (!isAppKey(key)) return undefined;
    return (await env.TRANSFORMS.get(key, 'text')) ?? undefined;
}

/** Apps read in this isolate: an app never changes, so it can be kept (a few, the most recent). */
const cache = new Map<string, InstalledApp<O2HTransform>>();
const CACHED_APPS = 50;

async function getApp(env: Env, key: string): Promise<InstalledApp<O2HTransform> | undefined> {
    let app = cache.get(key);
    if (!app) {
        if (!isAppKey(key)) return undefined;
        app = (await env.TRANSFORMS.get<InstalledApp<O2HTransform>>(key, 'json')) ?? undefined;
        if (!app) return undefined;
        if (cache.size >= CACHED_APPS) cache.delete(cache.keys().next().value!);
        cache.set(key, app);
    }
    return app;
}

/** Render a path of an installed app (see the module comment). */
export async function renderAppPath(env: Env, key: string, path: string, requestHost: string): Promise<Response> {
    const app = await getApp(env, key);
    if (!app) return errorResponse(404, `no app "${key}"`);
    const match = matchRoute(app, path);
    if (!match) return errorResponse(404, `no route of the app matches "${path}"`);
    let urls: Record<string, string>;
    try {
        urls = sourcesFor(app, match);
    } catch (e) {
        return errorResponse(400, (e as Error).message);
    }
    for (const [name, url] of Object.entries(urls)) {
        const refused = refuseApiUrl(new URL(url), requestHost, env);
        if (refused) return errorResponse(403, `the source "${name}": ${refused}`);
    }

    // Every source, in parallel, through the guards; the first that fails is the answer
    const fetchUpstream = guardedFetch(env);
    const names = Object.keys(urls);
    const responses = await Promise.all(names.map(name => fetchUpstream(urls[name])));
    const results: Record<string, unknown> = {};
    for (const [i, response] of responses.entries()) {
        if (!response.ok) {
            const { error } = await response.json<{ error?: string }>().catch(() => ({ error: response.statusText }));
            return errorResponse(response.status, `the source "${names[i]}": ${error ?? response.status}`);
        }
        try {
            results[names[i]] = await response.json();
        } catch {
            return errorResponse(502, `the source "${names[i]}" isn't valid JSON`);
        }
    }

    // o2h's core renders the VM as it renders an API's JSON (embedded, stand-ins revived, the VM passed back
    // with X-O2H-Error if rendering fails), so the VM is handed to it as the "upstream" response
    const { transform } = match.route as { transform: string };
    const vm = composeVM(match, results);
    const marked = new Request('https://o2h-app.invalid/', { headers: { [O2H_HEADER]: transform } });
    return handleO2HRequest(marked, k => app.transforms[k],
        async () => new Response(JSON.stringify(vm), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
}
