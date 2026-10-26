// End-to-end tests: a local stand-in API, the worker under `wrangler dev` (local runtime, local KV, local rate
// limiter), and transforms made by o2h's own prepareO2HTransform. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { prepareO2HTransform } from 'o2h/worker/client.js';

// Fresh local state each run: the KV transforms, and the rate limiter's count (the last test uses up its minute)
const STATE = '.wrangler/test-state';
fs.rmSync(STATE, { recursive: true, force: true });

const API_PORT = 8799;
const EDGE_PORT = 8788;
const API = `http://localhost:${API_PORT}`;
const EDGE = `http://localhost:${EDGE_PORT}`;

// ── The stand-in API ──
let lastHeaders = {};
const mission = { name: 'Demo Mission 7', rocket: { name: 'Falcon 9', type: 'rocket' }, note: 'Fuel </script> & <b>loading</b>' };
const api = http.createServer((req, res) => {
    lastHeaders = req.headers;
    const json = body => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/mission')) return json(mission);
    if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<p>not JSON</p>'); }
    if (req.url === '/big') return json({ data: 'x'.repeat(5000) });
    if (req.url === '/slow') return setTimeout(() => json({ late: true }), 2000);
    if (req.url === '/missing') { res.writeHead(404); return res.end(); }
    json({ headers: req.headers });
});

// ── The worker ──
let edge;
async function waitFor(url, ms = 60000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try { if ((await fetch(url)).ok) return; } catch {}
        await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`${url} didn't come up`);
}

before(async () => {
    await new Promise(r => api.listen(API_PORT, r));
    edge = spawn(process.execPath, [
        'node_modules/wrangler/bin/wrangler.js', 'dev', '--port', String(EDGE_PORT), '--ip', '127.0.0.1',
        '--var', 'ALLOW_LOCAL_UPSTREAM:on', '--var', 'MAX_RESPONSE_BYTES:1000', '--var', 'UPSTREAM_TIMEOUT_MS:500',
        '--var', 'LIST_TOKEN:test-token',
        '--persist-to', STATE,
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    let log = '';
    edge.stdout.on('data', d => { log += d; });
    edge.stderr.on('data', d => { log += d; });
    edge.on('exit', code => { if (code) console.error(log); });
    await waitFor(`${EDGE}/`);
});

after(async () => {
    // The whole tree: wrangler starts workerd processes, which outlive it on Windows if only wrangler is killed
    if (edge?.pid) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
        else edge.kill();
    }
    await new Promise(r => api.close(r));
});

const config = { map: { name: ['h2', '?.'], rocket: ['section', { 'class :=': 'card' }, [['h3', '?.name'], ['p', '?.type']]], note: ['p', '?.'] } };
const store = async (transform, key) => fetch(`${EDGE}/transforms/${key}`, { method: 'PUT', body: JSON.stringify(transform) });
const render = (apiUrl, key, init) => fetch(`${EDGE}/render?api=${encodeURIComponent(apiUrl)}&transform=${key}`, init);

test('the root describes the endpoints', async () => {
    const res = await fetch(`${EDGE}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /PUT \/transforms/);
});

test('transforms: stored under the hash of their content, and only there', async () => {
    const { key, transform } = await prepareO2HTransform(config, {});
    assert.equal((await store(transform, key)).status, 204);
    assert.equal((await store(transform, key)).status, 204, 'storing the same transform again is harmless');
    const wrong = await store({ ...transform, config: { map: {} } }, key);
    assert.equal(wrong.status, 400);
    assert.match((await wrong.json()).error, /doesn't match/);
    assert.equal((await store(transform, 'not-a-key')).status, 400);
});

test('transforms: read back exactly as stored, and cacheable for good', async () => {
    const { key, transform } = await prepareO2HTransform(config, {});
    await store(transform, key);
    const res = await fetch(`${EDGE}/transforms/${key}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control'), /immutable/);
    assert.equal(await res.text(), JSON.stringify(transform), 'the JSON its key is the hash of');
    assert.equal((await fetch(`${EDGE}/transforms/o2h-00000000000000000000000000000000`)).status, 404);
    assert.equal((await fetch(`${EDGE}/transforms/${key}`, { method: 'DELETE' })).status, 405);
});

test('transforms: listed, with size, date and summary (on localhost, no token needed)', async () => {
    const { key, transform } = await prepareO2HTransform(config, {});
    await store(transform, key);
    const res = await fetch(`${EDGE}/transforms`);
    assert.equal(res.status, 200);
    const { transforms, cursor } = await res.json();
    assert.equal(cursor, null);
    const listed = transforms.find(t => t.key === key);
    assert.equal(listed.summary, 'name, rocket, note, type');
    assert.equal(listed.bytes, JSON.stringify(transform).length);
    assert.ok(Date.now() - Date.parse(listed.stored) < 120_000, listed.stored);
});

// As a deployed host would see it: the Host header names a workers.dev host
const listAs = (headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: EDGE_PORT, path: '/transforms', headers: { Host: 'o2h-edge.someone.workers.dev', ...headers } }, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
});

test('transforms: elsewhere, listing needs the admin token', async () => {
    const none = await listAs();
    assert.equal(none.status, 401, none.body);
    assert.match(JSON.parse(none.body).error, /admin token/);
    assert.equal((await listAs({ Authorization: 'Bearer wrong' })).status, 401);
    const allowed = await listAs({ Authorization: 'Bearer test-token' });
    assert.equal(allowed.status, 200, allowed.body);
    assert.ok(Array.isArray(JSON.parse(allowed.body).transforms));
});

test('render: the API\'s JSON as HTML, with the JSON embedded, and CORS', async () => {
    const { key, transform } = await prepareO2HTransform(config, {});
    await store(transform, key);
    const res = await render(`${API}/mission?id=7`, key);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    const html = await res.text();
    assert.ok(html.startsWith('<!--?start name="tree"--><h2>Demo Mission 7</h2><section class="card"><h3>Falcon 9</h3><p>rocket</p></section>'), html);
    assert.ok(html.includes('<p>Fuel &lt;/script&gt; &amp; &lt;b&gt;loading&lt;/b&gt;</p>'));
    const embedded = html.slice(html.indexOf('data-tree="tree">') + 'data-tree="tree">'.length, html.lastIndexOf('</script>'));
    assert.deepEqual(JSON.parse(embedded), mission);
});

test('render: code the worker can\'t have is left to the page (pending)', async () => {
    const { key, transform, lost } = await prepareO2HTransform({ map: { name: ['h2', '?.upper'], note: ['p', '?.'] } }, { pipes: { upper: s => s.toUpperCase() } });
    assert.equal(lost.length, 1);
    await store(transform, key);
    const html = await (await render(`${API}/mission`, key)).text();
    assert.ok(html.startsWith('<!--?start name="tree"--><h2 data-pending></h2><p>'), html);
});

test('render: a missing transform returns the JSON, with X-O2H-Error (exposed to pages)', async () => {
    const res = await render(`${API}/mission`, 'o2h-00000000000000000000000000000000');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('X-O2H-Error'), /no transform/);
    assert.match(res.headers.get('Access-Control-Expose-Headers'), /X-O2H-Error/);
    assert.equal((await res.json()).name, 'Demo Mission 7');
});

test('guards: JSON only, a size cap, a timeout, API errors passed on', async () => {
    const { key, transform } = await prepareO2HTransform(config, {});
    await store(transform, key);
    const page = await render(`${API}/page`, key);
    assert.equal(page.status, 415);
    assert.match((await page.json()).error, /only JSON/);
    assert.equal((await render(`${API}/big`, key)).status, 413);
    const slow = await render(`${API}/slow`, key);
    assert.equal(slow.status, 504);
    assert.equal((await render(`${API}/missing`, key)).status, 404);
});

test('guards: the caller\'s cookies and other headers don\'t reach the API', async () => {
    const { key, transform } = await prepareO2HTransform({ map: { headers: ['pre', '?.cookie'] } }, {});
    await store(transform, key);
    await render(`${API}/echo`, key, { headers: { Cookie: 'session=secret', Authorization: 'Bearer secret', 'X-Custom': '1' } });
    assert.equal(lastHeaders.cookie, undefined);
    assert.equal(lastHeaders.authorization, undefined);
    assert.equal(lastHeaders['x-custom'], undefined);
    assert.equal(lastHeaders['x-o2h-transform'], undefined, 'nor the transform key header');
    assert.equal(lastHeaders.accept, 'application/json');
});

test('guards: bad requests', async () => {
    assert.equal((await fetch(`${EDGE}/render?transform=x`)).status, 400);
    assert.equal((await render('not a url', 'x')).status, 400);
    const ftp = await render('ftp://example.com/x', 'x');
    assert.equal(ftp.status, 403);
    assert.match((await ftp.json()).error, /https/);
    assert.equal((await fetch(`${EDGE}/elsewhere`)).status, 404);
    const preflight = await fetch(`${EDGE}/transforms/x`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /PUT/);
    assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('guards: the per-IP rate limit (60 a minute)', async () => {
    let limited = 0;
    for (let i = 0; i < 70; i++) {
        const res = await fetch(`${EDGE}/render?transform=x`);
        if (res.status === 429) limited++;
    }
    assert.ok(limited > 0, 'some requests were refused with 429');
});
