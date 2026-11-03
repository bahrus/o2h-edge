//@ts-check
// The store, as a navigate-gingerly app: routes whose paths are the Fake Store API's paths, rendered by o2h-edge.
// Built to app.json (`npm run build-store`, or `npm run watch-store`), which the shell imports: tree`…` only writes
// the configs' notation, so the app is plain data. Code (a pipe, a manager) goes in as { import, export } references.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tree, each } from 'assign-gingerly/DX/tree.js';

/** @import {O2HApp} from 'o2h' */

// A rating ({ rate, count }) at a path: five stars, and the numbers
const stars = (/** @type {string} */ at) => tree`
    <p class="rating">
        <meter class="stars" min="0" max="5" value=${`${at}?.rate`}></meter>
        <span>${`${at}?.rate`} (${`${at}?.count`})</span>
    </p>`;

// ["electronics", "jewelery", …]: links relative to the shell's <base href>, so the app works under any base
const categories = tree`
    <nav class="categories" aria-label="Categories" ${each('?.')}><a href="products/category/${'?.'}">${'?.'}</a></nav>`;

// [{ id, title, price, description, category, image, rating: { rate, count } }, …]
const grid = {
    map: {
        categories,
        data: tree`
            <section class="products" ${each('?.')}>
                <a class="product" href="products/${'?.id'}">
                    <div class="photo"><img src=${'?.image'} alt="" loading="lazy"></div>
                    <div class="body">
                        <p class="category">${'?.category'}</p>
                        <h2>${'?.title'}</h2>
                        <p class="price">${'?.price?.usd'}</p>
                        ${stars('?.rating')}
                    </div>
                </a>
            </section>`,
    },
};

// Add to cart: the button dispatches cart-add, with the product as a cart line, for the page's cart (cart.js).
// Data only: the get block is resolved against the product when hydration binds the button. The worker can't
// bind events, so it marks the button data-pending, and it's hidden (options.style) until the page binds it.
const addToCart = { get: { dispatch: { type: 'cart-add', detail: { id: '?.id', title: '?.title', price: '?.price', image: '?.image' } } } };

// { id, title, price, description, category, image, rating }
const product = {
    map: {
        categories,
        data: tree`
            <article class="detail">
                <img src=${'?.image'} alt=${'?.title'}>
                <div class="info">
                    <h2>${'?.title'}</h2>
                    <p class="category">${'?.category'}</p>
                    <p class="price">${'?.price?.usd'}</p>
                    ${stars('?.rating')}
                    <button type="button" class="add" @click=${addToCart}>Add to cart</button>
                    <p class="description">${'?.description'}</p>
                </div>
            </article>`,
    },
};

/** @type {O2HApp} */
export const app = {
    api: 'https://fakestoreapi.com',
    // The category nav, on every page
    layout: { categories: '/products/categories' },
    routes: [
        // The base itself: all products (mapped, since the API has nothing at its root)
        { pattern: '/', sources: { data: '/products' }, config: grid, title: 'Fake Store' },
        // Aligned: the path is the API's path
        { pattern: '/products', config: grid, title: 'Fake Store' },
        { pattern: '/products/category/:name', config: grid, title: '?.route?.name' },
        { pattern: '/products/:id', config: product, title: '?.data?.title' },
    ],
    options: {
        // Data pipes, as descriptors, so the worker renders everything. The cart (cart.js) uses them too.
        pipes: {
            usd: { intl: 'NumberFormat', locale: 'en-US', options: { style: 'currency', currency: 'USD' } },
            // A cart's lines ([{ quantity, price, … }]): the badge's count, and the total
            itemCount: { sum: '?.quantity' },
            subtotal: { sum: ['?.quantity', '?.price'] },
            total: { chain: ['subtotal', 'usd'] },
        },
        style: true,
    },
};

/** The app as JSON. Throws for code, which JSON would silently drop: reference it as { import, export } instead. */
export function render() {
    return JSON.stringify(app, (key, value) => {
        if (typeof value === 'function' || typeof value === 'symbol') {
            throw new Error(`app.mjs: "${key}" is code, which JSON can't hold; use { import: './module.js', export: '${key}' }`);
        }
        return value;
    }, 4);
}

// Run directly (not imported, as spa-ssi does to call render()): write app.json beside this file
if (import.meta.main) writeFileSync(fileURLToPath(new URL('app.json', import.meta.url)), render(), 'utf8');
