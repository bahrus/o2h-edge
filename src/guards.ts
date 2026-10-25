/**
 * What o2h-edge lets through, so a public worker can't be used as a general-purpose proxy.
 *
 * - Which API origins a host may call: the sandbox (*.workers.dev, and localhost in development) allows any,
 *   unless SANDBOX is "off"; other hosts (custom domains) only what DOMAIN_ALLOWLIST lists for them.
 * - Upstream calls: GET only, https (http only in development), no IP-literal or localhost targets (unless
 *   ALLOW_LOCAL_UPSTREAM, for tests), only the Accept header (the caller's cookies and other headers aren't
 *   forwarded), a timeout, a size cap, and JSON only: anything else is refused, not passed through.
 */

/** A JSON error response (with CORS, like every response). */
export function errorResponse(status: number, error: string): Response {
    return new Response(JSON.stringify({ error }), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    });
}

/** Whether a request's host is the sandbox: the default workers.dev host, or localhost (wrangler dev). */
export function isSandboxHost(hostname: string): boolean {
    return hostname.endsWith('.workers.dev') || isLocalHost(hostname);
}

function isLocalHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** An IP literal (v4 or v6): refused as an upstream target, so only named hosts are reached. */
function isIpLiteral(hostname: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[');
}

/**
 * Check an API URL for the requesting host: a reason it's refused, or undefined when it may be called.
 */
export function refuseApiUrl(api: URL, requestHost: string, env: Env): string | undefined {
    const local = isLocalHost(requestHost);
    if (api.protocol !== 'https:' && !(local && api.protocol === 'http:')) return 'the API URL must be https';
    if ((isLocalHost(api.hostname) || isIpLiteral(api.hostname)) && !(local && env.ALLOW_LOCAL_UPSTREAM === 'on')) {
        return 'the API URL must name a public host';
    }
    if (isSandboxHost(requestHost)) {
        return env.SANDBOX === 'on' ? undefined : 'the sandbox is off';
    }
    const allowed = (env.DOMAIN_ALLOWLIST as Record<string, string[]> | undefined)?.[requestHost];
    if (!allowed) return `no API origins are allowed for ${requestHost}`;
    return allowed.includes(api.origin) ? undefined : `${api.origin} isn't allowed for ${requestHost}`;
}

/**
 * The fetch o2h's core calls upstream with: GET only, a timeout, JSON only, at most MAX_RESPONSE_BYTES.
 * Refusals are returned as non-OK responses, which the core passes back as they are.
 */
export function guardedFetch(env: Env): typeof fetch {
    const maxBytes = Number(env.MAX_RESPONSE_BYTES) || 5_000_000;
    const timeout = Number(env.UPSTREAM_TIMEOUT_MS) || 10_000;
    return (async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        if (request.method !== 'GET') return errorResponse(405, 'only GET requests are forwarded');
        let upstream: Response;
        try {
            // Only Accept goes upstream: nothing of the caller's (cookies, authorization …)
            upstream = await fetch(request.url, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(timeout),
                redirect: 'follow',
            });
        } catch (e) {
            const timedOut = (e as Error).name === 'TimeoutError';
            return errorResponse(timedOut ? 504 : 502, timedOut ? `the API didn't answer within ${timeout} ms` : `the API couldn't be reached (${(e as Error).message})`);
        }
        if (!upstream.ok) return errorResponse(upstream.status, `the API answered ${upstream.status} ${upstream.statusText}`.trim());
        const type = upstream.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
        if (type !== 'application/json' && !type.endsWith('+json')) {
            await upstream.body?.cancel();
            return errorResponse(415, `only JSON is rendered (the API answered ${type || 'with no Content-Type'})`);
        }
        const declared = Number(upstream.headers.get('Content-Length'));
        if (declared > maxBytes) {
            await upstream.body?.cancel();
            return errorResponse(413, `the API's response is larger than ${maxBytes} bytes`);
        }
        const body = await readCapped(upstream, maxBytes);
        if (!body) return errorResponse(413, `the API's response is larger than ${maxBytes} bytes`);
        return new Response(body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('Content-Type')! } });
    }) as typeof fetch;
}

/** A response's body, or undefined once it passes maxBytes (the rest isn't read). */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | undefined> {
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            return undefined;
        }
        chunks.push(value);
    }
    const body = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
        body.set(chunk, at);
        at += chunk.byteLength;
    }
    return body;
}
