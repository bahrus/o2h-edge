/**
 * Records in KV: { config, options } from o2h's prepareO2HRecord, keyed by the hash of their content
 * (`o2h-` + 32 hex digits of the SHA-256 of their JSON). The worker checks that a record's key matches its
 * content before storing it, so anyone may store a record, but nobody can change one: a different record
 * has a different key.
 */

import type { O2HRecord } from 'o2h/worker/core.js';

const KEY = /^o2h-[0-9a-f]{32}$/;

/** The key prepareO2HRecord gives a record: the same JSON gives the same key. */
export async function keyOf(json: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `o2h-${hex.slice(0, 32)}`;
}

export function isRecordKey(key: string): boolean {
    return KEY.test(key);
}

/** Store a record sent as JSON: a reason it's refused, or undefined once stored. */
export async function putRecord(env: Env, key: string, body: string): Promise<string | undefined> {
    if (!isRecordKey(key)) return 'a record key looks like o2h- followed by 32 hex digits';
    const maxBytes = Number(env.MAX_RECORD_BYTES) || 262_144;
    if (new TextEncoder().encode(body).byteLength > maxBytes) return `a record may be at most ${maxBytes} bytes`;
    let record: O2HRecord;
    try {
        record = JSON.parse(body);
    } catch {
        return "the record isn't JSON";
    }
    if (!record || typeof record !== 'object' || !record.config || typeof record.config !== 'object') return 'a record has a config';
    // The key must be the content's: prepareO2HRecord hashes JSON.stringify(record), which parsing and
    // stringifying again reproduces
    if (await keyOf(JSON.stringify(record)) !== key) return "the key doesn't match the record's content";
    await env.RECORDS.put(key, JSON.stringify(record));
    return undefined;
}

/** The record a key names, if stored. */
export async function getRecord(env: Env, key: string): Promise<O2HRecord | undefined> {
    if (!isRecordKey(key)) return undefined;
    return (await env.RECORDS.get<O2HRecord>(key, 'json')) ?? undefined;
}
