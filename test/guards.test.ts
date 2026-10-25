// Unit tests for which API URLs a host may call (run by Node directly; it strips the types). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSandboxHost, refuseApiUrl } from '../src/guards.ts';

const env = (vars: Partial<Env> = {}) => ({ SANDBOX: 'on', DOMAIN_ALLOWLIST: {}, ALLOW_LOCAL_UPSTREAM: 'off', ...vars }) as Env;
const refuse = (api: string, host: string, vars?: Partial<Env>) => refuseApiUrl(new URL(api), host, env(vars));

test('the sandbox: workers.dev and localhost', () => {
    assert.ok(isSandboxHost('o2h-edge.someone.workers.dev'));
    assert.ok(isSandboxHost('localhost'));
    assert.ok(!isSandboxHost('apis.example.com'));
    assert.ok(!isSandboxHost('workers.dev.example.com'));
});

test('the sandbox allows any public https API, unless switched off', () => {
    assert.equal(refuse('https://api.nasa.gov/planetary/apod', 'o2h-edge.someone.workers.dev'), undefined);
    assert.match(refuse('https://api.nasa.gov/x', 'o2h-edge.someone.workers.dev', { SANDBOX: 'off' })!, /sandbox is off/);
});

test('other hosts: only their allowlisted origins', () => {
    const allowlist = { DOMAIN_ALLOWLIST: { 'apis.example.com': ['https://api.nasa.gov'] } };
    assert.equal(refuse('https://api.nasa.gov/x', 'apis.example.com', allowlist), undefined);
    assert.match(refuse('https://api.github.com/x', 'apis.example.com', allowlist)!, /isn't allowed for apis\.example\.com/);
    assert.match(refuse('https://api.nasa.gov/x', 'other.example.com', allowlist)!, /no API origins are allowed/);
});

test('targets: https, named public hosts', () => {
    assert.match(refuse('http://api.nasa.gov/x', 'o2h-edge.someone.workers.dev')!, /https/);
    assert.match(refuse('https://127.0.0.1/x', 'o2h-edge.someone.workers.dev')!, /public host/);
    assert.match(refuse('https://[::1]/x', 'o2h-edge.someone.workers.dev')!, /public host/);
    assert.match(refuse('https://localhost/x', 'o2h-edge.someone.workers.dev')!, /public host/);
    // Development: http and localhost targets only from localhost, and only with ALLOW_LOCAL_UPSTREAM
    assert.match(refuse('http://localhost:8799/x', 'localhost')!, /public host/);
    assert.equal(refuse('http://localhost:8799/x', 'localhost', { ALLOW_LOCAL_UPSTREAM: 'on' }), undefined);
    assert.match(refuse('http://localhost:8799/x', 'o2h-edge.someone.workers.dev', { ALLOW_LOCAL_UPSTREAM: 'on' })!, /https/);
});
