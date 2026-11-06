// The product page's manager: how many to add, which is state per page view, so it needs code. The app names it
// (ish="product-view", and { import, export } under options.managers), and its config stays JSON. The worker can't
// have it, so it renders the product from the raw value, and leaves what reads these getters to the page, pending.
export class ProductView {
    static is = 'product-view';
    quantity = 1;
    #element;
    #rebind;

    constructor(element, initVals, { rebind }) {
        Object.assign(this, initVals);
        this.#element = element;
        this.#rebind = rebind;
    }

    /** What the quantity costs (a number: the app's usd pipe formats it). */
    get lineTotal() {
        return this.quantity * this.price;
    }

    less() {
        if (this.quantity === 1) return;
        this.quantity--;
        this.#rebind();
    }

    more() {
        this.quantity++;
        this.#rebind();
    }

    /** Tells the page's cart (cart.js), and starts over at one. */
    add() {
        const { id, title, price, image, quantity } = this;
        this.#element.dispatchEvent(new CustomEvent('cart-add', { bubbles: true, detail: { id, title, price, image, quantity } }));
        this.quantity = 1;
        this.#rebind();
    }
}
