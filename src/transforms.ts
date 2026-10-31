/**
 * Transforms in KV: { config, options } from o2h's prepareO2HTransform, keyed by the hash of their content
 * (`o2h-` + 32 hex digits of the SHA-256 of their JSON). The worker checks that a transform's key matches its
 * content before storing it, so anyone may store a transform, but nobody can change one: a different transform
 * has a different key.
 *
 * Each transform is stored with a little metadata (TransformInfo), so listing them reads no values.
 */

import type { O2HTransform } from 'o2h/worker/core.js';

const KEY = /^o2h-[0-9a-f]{32}$/;

/** What's kept beside a transform, for the list. Transforms stored before there was any have none. */
export interface TransformInfo {
    bytes: number;
    /** When it was first stored (ISO) */
    stored: string;
    /** The data fields it reads, e.g. "title, date, explanation" */
    summary: string;
}

/** The key prepareO2HTransform gives a transform: the same JSON gives the same key. */
export async function keyOf(json: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `o2h-${hex.slice(0, 32)}`;
}

export function isTransformKey(key: string): boolean {
    return KEY.test(key);
}

/**
 * The data fields a config reads, in order of appearance: its maps' keys (comments stripped, `*` skipped), and
 * the first step of its `?.` paths. A hint for people reading the list, not an analysis. KV caps metadata at
 * 1024 bytes, so it's cut short.
 */
export function summarize(config: unknown): string {
    const fields = new Set<string>();
    const walk = (node: unknown): void => {
        if (typeof node === 'string') {
            const field = /^\?\.([^?.\s]+)/.exec(node)?.[1];
            if (field) fields.add(field);
        } else if (Array.isArray(node)) {
            node.forEach(walk);
        } else if (node && typeof node === 'object') {
            const map = (node as { map?: unknown }).map;
            if (map && typeof map === 'object' && !Array.isArray(map)) {
                for (const key of Object.keys(map)) {
                    const field = key.replace(/\/\*.*?\*\//g, '').trim();
                    if (field && field !== '*') fields.add(field);
                }
            }
            Object.values(node).forEach(walk);
        }
    };
    walk(config);
    const summary = [...fields].join(', ');
    return summary.length > 300 ? `${summary.slice(0, 299)}…` : summary;
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
    const json = JSON.stringify(transform);
    if (await keyOf(json) !== key) return "the key doesn't match the transform's content";
    // Already stored (with its metadata): nothing to write, and the first store's date stays
    const existing = await env.TRANSFORMS.getWithMetadata<TransformInfo>(key);
    if (existing.value !== null && existing.metadata) return undefined;
    const metadata: TransformInfo = {
        bytes: new TextEncoder().encode(json).byteLength,
        stored: new Date().toISOString(),
        summary: summarize(transform.config),
    };
    await env.TRANSFORMS.put(key, json, { metadata });
    return undefined;
}

/** The transform a key names, if stored. */
export async function getTransform(env: Env, key: string): Promise<O2HTransform | undefined> {
    if (!isTransformKey(key)) return undefined;
    return (await env.TRANSFORMS.get<O2HTransform>(key, 'json')) ?? undefined;
}

/** The transform a key names, exactly as stored (the JSON its key is the hash of), if stored. */
export async function getTransformJson(env: Env, key: string): Promise<string | undefined> {
    if (!isTransformKey(key)) return undefined;
    return (await env.TRANSFORMS.get(key, 'text')) ?? undefined;
}

/** One page of the list (KV gives up to 1000 keys a page); a cursor for the next, if there is one. */
export async function listTransforms(env: Env, cursor?: string): Promise<{ transforms: ({ key: string } & Partial<TransformInfo>)[]; cursor: string | null }> {
    // Apps share the namespace (as app-…): only transforms are listed
    const page = await env.TRANSFORMS.list<TransformInfo>({ prefix: 'o2h-', cursor: cursor || undefined });
    return {
        transforms: page.keys.map(({ name, metadata }) => ({ key: name, ...metadata })),
        cursor: page.list_complete ? null : page.cursor,
    };
}
