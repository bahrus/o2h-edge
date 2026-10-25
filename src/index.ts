/**
 * o2h-edge: renders JSON APIs as HTML with o2h, at the edge (a Cloudflare Worker).
 *
 *   PUT /records/<key>                     store a record (o2h's prepareO2HRecord: { config, options }),
 *                                          keyed by the hash of its content
 *   GET /render?api=<url>&config=<key>     call the API, and render its JSON with that record:
 *                                          HTML, with the JSON embedded after it, for the page to hydrate
 *
 * The rendering itself is o2h's shared worker core (o2h/worker/core.js), as in o2h's service worker: what
 * needs code the worker can't have (function pipes, manager classes) is left to the page, marked pending.
 * Every response allows any origin (CORS), since pages calling the worker live elsewhere.
 * See src/guards.ts for what's let through.
 */

import { handleO2HRequest, O2H_HEADER } from 'o2h/worker/core.js';
import { errorResponse, guardedFetch, refuseApiUrl } from './guards.js';
import { getRecord, putRecord } from './records.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'X-O2H-Error',
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

        const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
        if (url.pathname === '/render' || url.pathname.startsWith('/records/')) {
            const { success } = await env.LIMITER.limit({ key: ip });
            if (!success) return errorResponse(429, 'too many requests: try again in a minute');
        }

        if (url.pathname.startsWith('/records/')) {
            if (request.method !== 'PUT') return errorResponse(405, 'records are stored with PUT');
            const refused = await putRecord(env, url.pathname.slice('/records/'.length), await request.text());
            return refused ? errorResponse(400, refused) : new Response(null, { status: 204, headers: CORS });
        }

        if (url.pathname === '/render') {
            if (request.method !== 'GET') return errorResponse(405, 'render with GET');
            const api = url.searchParams.get('api');
            const key = url.searchParams.get('config');
            if (!api || !key) return errorResponse(400, 'render needs ?api=<url>&config=<key>');
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
            const response = await handleO2HRequest(marked, k => getRecord(env, k), guardedFetch(env));
            return withCors(response);
        }

        if (url.pathname === '/') {
            return new Response('o2h-edge: PUT /records/<key>, GET /render?api=<url>&config=<key>\n', {
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
