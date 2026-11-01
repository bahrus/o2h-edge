# Create Build Step

## Bruce's Ask

One lingering question from [Initialization](../../../navigate-gingerly/Chats/Initialization.md#questions):

> 2. **`app.js` vs `app.json`:** is the JS module fine for the store? Or do you want a small build step that writes `app.json` from it, so the page imports JSON, as originally envisioned?

I took a look at [app.js](../../demo/store/app.js), and was pleasantly surprised to see that it looks to be 00% JSON serializable.  Does that seem like it will always be the case?

My preference would be to follow the approach used for [custom elements](../../../o2h/types/NewCustomElement.md) and [enhancements](../../../o2h/types/NewEnhancementInstructions.md):

1.  app.mjs that uses @ts-check
2.  build instructions in package.json that serializes app.mjs to app.json, that rebuilds when app.mjs changes.
3.  [store/index.html](../../demo/store/index.html) uses a JSON module import (type: 'json') to import app.json.
## Claude's Response

Done, as you described:

1. **[app.mjs](../../demo/store/app.mjs)** (renamed from app.js with `git mv`, so its history carries over) starts with `//@ts-check`. The app is typed `/** @type {NavigateApp} */`. Like el-maker.mjs, it exports `render()`, which returns the JSON, and it writes [app.json](../../demo/store/app.json) beside itself. It writes only when run directly (`import.meta.main`), so spa-ssi can import it and call `render()` without a file being written.
2. **package.json** has `"build-store": "node demo/store/app.mjs"` and `"watch-store": "node --watch demo/store/app.mjs"`. The watch rebuilds whenever app.mjs, or anything it imports, changes, as `build-el-maker` does.
3. **[index.html](../../demo/store/index.html)** imports it as `import app from './app.json' with { type: 'json' };`.

I checked the store through wrangler dev and spa-ssi in Chromium, Firefox and WebKit. In all three, `/demo/store/` renders 20 products by the worker, and the deep link `/demo/store/products/2` renders the product with its title. spa-ssi serves `.json` as `application/json`, which JSON modules require.

### Will it always be JSON serializable?

Not on its own. It is today because of how the app is written:

- ``tree`…` `` only produces notation, which is plain arrays and objects.
- The only pipe, `usd`, is a descriptor (`{ intl: 'NumberFormat', … }`), not a function.

These would make it stop being JSON serializable:

- a function pipe, such as `pipes: { shout: s => s.toUpperCase() }`;
- a manager class, such as `ish=${SomeManager}` in a `tree` template or `options.managers`;
- anything else holding code.

`JSON.stringify` drops functions *silently*, so app.json would be missing them and nothing would say so. To prevent that, `render()` throws, naming the key:

```
app.mjs: "shout" is code, which JSON can't hold; use { import: './module.js', export: 'shout' }
```

That error points at the fix navigate-gingerly already has. A module reference, `{ import, export }`, is plain data, and `mirror` resolves it against the page (`resolveModules`) before preparing the app. So the rule becomes **code goes in by reference**, and with it, app.json is always complete.

### Small things to know

- **Type errors in the editor:** o2h-edge has no `@types/node`, so the editor flags `node:fs`, `node:url` and `import.meta.main` in app.mjs. Everything else type-checks. I can add `@types/node` as a dev dependency if you'd like it clean. Or the file can write app.json with `console.log(render())` and a shell redirect, as emc.mjs does, which needs no Node types at all.
- **The `NavigateApp` type is loose for configs:** a route's `config` is `unknown`, so @ts-check checks the app's shape (routes, patterns, sources, title) but not the o2h notation inside. That would take `NavigateApp<O2HConfig, O2HOptions>`, once o2h's types are importable from here. Do you want that?
- **app.json is committed output:** the static server serves it as is, with no build when a page is requested. If app.mjs is edited without running `build-store`/`watch-store`, the page uses the old app.
- **VS Code file nesting:** the enhancement instructions nest `*.mjs` → `${capture}.json` in `.vscode/settings.json`. o2h-edge has no settings.json yet. I left it out, but it's a two-line addition if you want it.

Not committed. The rename is staged, from `git mv`; the other changes aren't. The README's store section is updated to match.

## Bruce's Response

> - **The `NavigateApp` type is loose for configs:** a route's `config` is `unknown`, so @ts-check checks the app's shape (routes, patterns, sources, title) but not the o2h notation inside. That would take `NavigateApp<O2HConfig, O2HOptions>`, once o2h's types are importable from here. Do you want that?

Yes, please

> - **VS Code file nesting:** the enhancement instructions nest `*.mjs` → `${capture}.json` in `.vscode/settings.json`. o2h-edge has no settings.json yet. I left it out, but it's a two-line addition if you want it.

Yes, please


## Claude's Response II

Both done.

### Typed configs: `O2HApp`

`NavigateApp<O2HConfig, O2HOptions>` wasn't quite right. `O2HOptions.pipes` only accepts functions, so the store's `usd` descriptor would have failed. What an app needs is the options *as JSON holds them*. So in the types submodule, [o2h/types.d.ts](../../../o2h/types/o2h/types.d.ts) now has:

```ts
/** O2HOptions as JSON holds them (a navigate-gingerly app, before its module references are loaded): … */
export interface O2HAppOptions extends Omit<O2HOptions, 'pipes' | 'managers' | 'protocols'> {
    pipes?: Record<string, PipeDescriptor | ModuleReference>;
    managers?: Record<string, ModuleReference>;
    protocols?: Record<string, ModuleReference>;
}

/** A navigate-gingerly app that o2h renders: its configs are builtIns.tree configs, and its options JSON. */
export type O2HApp = NavigateApp<O2HConfig, O2HAppOptions>;
```

[app.mjs](../../demo/store/app.mjs) imports it with `/** @import {O2HApp} from 'o2h' */`. Both imports are relative, `../assign-gingerly/types.js` and `../navigate-gingerly/types.js`, within the types repo. I tried `assign-gingerly/types/assign-gingerly/types.js` first, but assign-gingerly's package only exports `./types/treeTypes.js`. The other path quietly resolved to `any`, which would have let anything through.

To check that it really catches mistakes, I type-checked a copy of app.mjs with four of them planted. All four were flagged:

| Mistake | Error |
|---|---|
| `title: 3` | `Type 'number' is not assignable to type 'string'` |
| `config: { mapp: {} }` | `'mapp' does not exist in type 'O2HConfig'. Did you mean to write 'map'?` |
| `pipes: { usd: { intl: 'NumberFmt', … } }` | `'"NumberFmt"' is not assignable to type '"DateTimeFormat" \| … \| "NumberFormat" \| …'. Did you mean '"NumberFormat"'?` |
| `managers: { x: 'y' }` | `Type 'string' is not assignable to type 'ModuleReference'` |

The real app.mjs passes. The only errors left are the Node ones (`node:fs`, `node:url`, `import.meta.main`) from the missing `@types/node`. That's unchanged, since you didn't take that option. The tree notation inside each config is checked as far as `ElementSpecification` goes, since ``tree`…` `` returns one.

The types submodule is checked out twice, in o2h/types and navigate-gingerly/types, both at the same commit. I made the same 15-line edit in each, so they stay alike until you commit and push one of them. o2h's `tsc` is clean, and navigate-gingerly rebuilds and passes all 26 tests.

### VS Code file nesting

[.vscode/settings.json](../../.vscode/settings.json) is new, with the two settings from the enhancement instructions. app.json now nests under app.mjs in the explorer.

The README's store section now says `O2HApp`. I rebuilt app.json and it didn't change. Not committed.
