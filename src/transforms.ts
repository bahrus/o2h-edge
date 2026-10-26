/**
 * Transforms in KV: { config, options } from o2h's prepareO2HTransform, keyed by the hash of their content
 * (`o2h-` + 32 hex digits of the SHA-256 of their JSON). The worker checks that a transform's key matches its
 * content before storing it, so anyone may store a transform, but nobody can change one: a different transform
 * has a different key.
 */

import type { O2HTransform } from 'o2h/worker/core.js';

const KEY = /^o2h-[0-9a-f]{32}$/;

/** The key prepareO2HTransform gives a transform: the same JSON gives the same key. */
export async function keyOf(json: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `o2h-${hex.slice(0, 32)}`;
}

export function isTransformKey(key: string): boolean {
    return KEY.test(key);
}

/** Store a transform sent as JSON: a reason it's refused, or undefined once stored. */
export async function putTransform(env: Env, key: string, body: string): Promise<string | undefined> {
    if (!isTransformKey(key)) return 'a transform key looks like o2h- followed by 32 hex digits';
    const maxBytes = Number(env.MAX_TRANSFORM_BYTES) || 262_144;
    if (new TextEncoder().encode(body).byteLength > maxBytes) return `a transform may be at most ${maxBytes} bytes`;
    let transform: O2HTransform;
    try {
        transform = JSON.parse(body);
    } catch {
        return "the transform isn't JSON";
    }
    if (!transform || typeof transform !== 'object' || !transform.config || typeof transform.config !== 'object') return 'a transform has a config';
    // The key must be the content's: prepareO2HTransform hashes JSON.stringify(transform), which parsing and
    // stringifying again reproduces
    if (await keyOf(JSON.stringify(transform)) !== key) return "the key doesn't match the transform's content";
    await env.TRANSFORMS.put(key, JSON.stringify(transform));
    return undefined;
}

/** The transform a key names, if stored. */
export async function getTransform(env: Env, key: string): Promise<O2HTransform | undefined> {
    if (!isTransformKey(key)) return undefined;
    return (await env.TRANSFORMS.get<O2HTransform>(key, 'json')) ?? undefined;
}
