import assert from 'node:assert/strict';
import { authorized, isLocal } from '../server/auth.js';
const req = (address, headers = {}) => ({ socket: { remoteAddress: address }, headers });
const allowed = ['owner@example.com'];
for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
  assert.equal(authorized(req(address), allowed), true);
  assert.equal(authorized(req(address, { 'tailscale-user-login': 'OWNER@example.com' }), allowed), true);
  assert.equal(authorized(req(address, { 'tailscale-user-login': 'other@example.com' }), allowed), false);
  for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) {
    assert.equal(authorized(req(address, { [header]: 'proxy' }), allowed), false);
    assert.equal(isLocal(req(address, { [header]: 'proxy' })), false);
  }
}
for (const address of ['100.90.8.42', '192.168.1.10', '::ffff:192.168.1.10']) {
  assert.equal(authorized(req(address), allowed), false);
  assert.equal(authorized(req(address, { 'tailscale-user-login': 'owner@example.com' }), allowed), false);
}
assert.equal(authorized(req('127.0.0.1', { 'tailscale-user-login': 'member@example.com' })), true);
assert.equal(authorized(req('127.0.0.1', { 'x-forwarded-for': 'remote', cookie: 'baton_device=old' }), allowed), false);
console.log('Access checks passed');
