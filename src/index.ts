/**
 * o2h-edge: renders JSON APIs as HTML with o2h, at the edge (a Cloudflare Worker).
 *
 *   PUT /transforms/<key>                   store a transform (o2h's prepareO2HTransform: { config, options }),
 *                                           keyed by the hash of its content
 *   GET /transforms/<key>                   a transform, exactly as stored
 *   GET /transforms[?cursor=…]              list them (key, size, date, summary): the admin token, or localhost
 *   GET /render?api=<url>&transform=<key>   call the API, and render its JSON with that transform:
 *                                           HTML, with the JSON embedded after it, for the page to hydrate
 *
 * The rendering itself is o2h's shared worker core (o2h/worker/core.js), as in o2h's service worker: what
 * needs code the worker can't have (function pipes, manager classes) is left to the page, marked pending.
 * Every response allows any origin (CORS), since pages calling the worker live elsewhere.
 * See src/guards.ts for what's let through.
 */

import { handleO2HRequest, O2H_HEADER } from 'o2h/worker/core.js';
import { errorResponse, guardedFetch, refuseApiUrl, refuseListing } from './guards.js';
import { getTransform, getTransformJson, listTransforms, putTransform } from './transforms.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-O2H-Error',
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

        const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
        if (url.pathname === '/render' || url.pathname === '/transforms' || url.pathname.startsWith('/transforms/')) {
            const { success } = await env.LIMITER.limit({ key: ip });
            if (!success) return errorResponse(429, 'too many requests: try again in a minute');
        }

        if (url.pathname === '/transforms') {
            if (request.method !== 'GET') return errorResponse(405, 'list transforms with GET');
            const refused = await refuseListing(request, env);
            if (refused) return errorResponse(refused.status, refused.error);
            const list = await listTransforms(env, url.searchParams.get('cursor') ?? undefined);
            return new Response(JSON.stringify(list), {
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
            });
        }

        if (url.pathname.startsWith('/transforms/')) {
            const key = url.pathname.slice('/transforms/'.length);
            if (request.method === 'GET') {
                const json = await getTransformJson(env, key);
                if (json === undefined) return errorResponse(404, `no transform for "${key}"`);
                // A key names one content forever, so it may be cached for good
                return new Response(json, {
                    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable', ...CORS },
                });
            }
            if (request.method !== 'PUT') return errorResponse(405, 'transforms are read with GET, and stored with PUT');
            const refused = await putTransform(env, key, await request.text());
            return refused ? errorResponse(400, refused) : new Response(null, { status: 204, headers: CORS });
        }

        if (url.pathname === '/render') {
            if (request.method !== 'GET') return errorResponse(405, 'render with GET');
            const api = url.searchParams.get('api');
            const key = url.searchParams.get('transform');
            if (!api || !key) return errorResponse(400, 'render needs ?api=<url>&transform=<key>');
            let apiUrl: URL;
            try {
                apiUrl = new URL(api);
            } catch {
                return errorResponse(400, "the api parameter isn't a URL");
            }
            const refused = refuseApiUrl(apiUrl, url.hostname, env);
            if (refused) return errorResponse(403, refused);
            // The core forwards this (without the header), through the guards, and renders the JSON
            const marked = new Request(apiUrl, { headers: { [O2H_HEADER]: key } });
            const response = await handleO2HRequest(marked, k => getTransform(env, k), guardedFetch(env));
            return withCors(response);
        }

        if (url.pathname === '/') {
            return new Response('o2h-edge: PUT /transforms/<key>, GET /transforms/<key>, GET /transforms (admin), GET /render?api=<url>&transform=<key>\n', {
                headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
            });
        }
        return errorResponse(404, 'not found');
    },
} satisfies ExportedHandler<Env>;

function withCors(response: Response): Response {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
