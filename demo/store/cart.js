// The visitor's cart: lines kept in localStorage, rendered on this page (builtIns.tree), and changed by the events the
// store's buttons dispatch: cart-add (a product's line, with a quantity, from its page) and cart-change ({ id, by }, from the cart).
// The worker never sees it. The badge's count and the total are the app's sum data pipes (itemCount, total).
import { tree, each } from 'assign-gingerly/DX/tree.js';
import { assignFromAsync } from 'assign-gingerly/assignFromAsync.js';

// A quantity button: dispatches cart-change for its line (resolved against the line when the button is bound)
const change = by => ({ get: { dispatch: { type: 'cart-change', detail: { id: '?.id', by } } } });

// [{ id, title, price, image, quantity }, …]: a badge that opens the cart (a popover), and the cart
const config = {
    map: {
        lines: tree`
            <div class="cart">
                <button type="button" class="cart-button" popovertarget="cart-panel">Cart <span class="badge">${'?.itemCount'}</span></button>
                <div id="cart-panel" class="cart-panel" popover>
                    <div class="cart-head">
                        <h2>Your cart</h2>
                        <button type="button" class="close" popovertarget="cart-panel" popovertargetaction="hide">Close</button>
                    </div>
                    <ul class="lines" ${each('?.', { key: '?.id', empty: tree`<li class="empty">Your cart is empty.</li>` })}>
                        <li class="line">
                            <img src=${'?.image'} alt="">
                            <div class="what">
                                <a href="products/${'?.id'}">${'?.title'}</a>
                                <span class="price">${'?.price?.usd'}</span>
                            </div>
                            <div class="quantity">
                                <button type="button" aria-label="One less ${'?.title'}" @click=${change(-1)}>−</button>
                                <output>${'?.quantity'}</output>
                                <button type="button" aria-label="One more ${'?.title'}" @click=${change(1)}>+</button>
                            </div>
                        </li>
                    </ul>
                    <p class="total">Total <strong>${'?.total'}</strong></p>
                </div>
            </div>`,
    },
};

/**
 * Keep the cart, and render it into `into`: now, on every cart-add / cart-change, and when another tab changes it.
 * `pipes`: the app's pipe descriptors (usd, itemCount, total). `onChange(lines, line)` is told what changed.
 */
export function cart({ into, pipes, key = 'fake-store-cart', onChange }) {
    let lines = load();

    function load() {
        try {
            const stored = JSON.parse(localStorage.getItem(key) ?? '[]');
            return Array.isArray(stored) ? stored : [];
        } catch {
            return [];   // storage blocked, or not JSON: an empty cart
        }
    }
    function render() {
        return assignFromAsync(into, { '?. =>': { do: 'builtIns.tree', ...config } }, { from: { lines }, pipes });
    }
    function save(line) {
        try {
            localStorage.setItem(key, JSON.stringify(lines));
        } catch { /* storage blocked: the cart lasts as long as the page */ }
        onChange?.(lines, line);
        return render();
    }

    document.addEventListener('cart-add', ({ detail }) => {
        if (detail?.id == null) return;
        const line = lines.find(l => l.id === detail.id);
        const { quantity = 1 } = detail;
        if (line) line.quantity += quantity;
        else lines = [...lines, { ...detail, quantity }];
        save(line ?? lines.at(-1));
    });
    document.addEventListener('cart-change', ({ detail }) => {
        const line = lines.find(l => l.id === detail?.id);
        if (!line) return;
        line.quantity += detail.by;
        if (line.quantity <= 0) lines = lines.filter(l => l !== line);
        save(line);
    });
    // Another tab changed it
    window.addEventListener('storage', event => {
        if (event.key !== key) return;
        lines = load();
        render();
    });

    return { ready: render(), get lines() { return lines; } };
}
