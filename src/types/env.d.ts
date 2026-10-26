// Secrets aren't in wrangler.jsonc, so `wrangler types` doesn't know them: declared here.
// LIST_TOKEN: the admin token that lists transforms (`npx wrangler secret put LIST_TOKEN`). Unset, listing is off
// (except on localhost).
declare namespace Cloudflare {
    interface Env {
        LIST_TOKEN?: string;
    }
}
interface Env {
    LIST_TOKEN?: string;
}
