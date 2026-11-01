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
