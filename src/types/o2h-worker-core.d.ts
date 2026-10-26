// The part of o2h's shared worker core (o2h/worker/core.js) o2h-edge uses, for type-checking.
// o2h's own TypeScript sources import assign-gingerly's DOM-side modules, which don't type-check against the
// Workers runtime types; tsconfig.json maps the import here instead. Keep in step with o2h/worker/core.ts
// (or drop this once o2h publishes .d.ts files for its worker modules).

/** What an X-O2H-Transform key names: o2h's config and options (see o2h's prepareO2HTransform). */
export interface O2HTransform {
    config: Record<string, unknown>;
    options?: Record<string, unknown>;
}

export declare const O2H_HEADER: 'X-O2H-Transform';
export declare const O2H_ERROR_HEADER: 'X-O2H-Error';

export type O2HLookup = (key: string) => Promise<O2HTransform | undefined> | O2HTransform | undefined;

/** Forward a marked request (without the header), and render its JSON response as HTML with the transform its key names. */
export declare function handleO2HRequest(request: Request, lookup: O2HLookup, fetchUpstream?: typeof fetch): Promise<Response>;
