import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { adminIpAllowed, isAdminAuthorised } from './auth';

const saved = { hash: process.env.ADMIN_PASSWORD_HASH, ips: process.env.ADMIN_ALLOWED_IPS };
afterEach(() => {
  process.env.ADMIN_PASSWORD_HASH = saved.hash;
  process.env.ADMIN_ALLOWED_IPS = saved.ips;
  if (saved.hash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
  if (saved.ips === undefined) delete process.env.ADMIN_ALLOWED_IPS;
});

describe('isAdminAuthorised', () => {
  it('refuses everything when no hash is configured', () => {
    delete process.env.ADMIN_PASSWORD_HASH;
    expect(isAdminAuthorised('Bearer anything')).toBe(false);
  });

  it('accepts the token whose hash is configured, and nothing else', () => {
    process.env.ADMIN_PASSWORD_HASH = createHash('sha256').update('s3cret-token').digest('hex');
    expect(isAdminAuthorised('Bearer s3cret-token')).toBe(true);
    expect(isAdminAuthorised('Bearer wrong')).toBe(false);
    expect(isAdminAuthorised('s3cret-token')).toBe(false);
    expect(isAdminAuthorised(null)).toBe(false);
  });
});

describe('adminIpAllowed (audit V-06)', () => {
  it('allows any address when no list is set, as before', () => {
    delete process.env.ADMIN_ALLOWED_IPS;
    expect(adminIpAllowed('203.0.113.9')).toBe(true);
    expect(adminIpAllowed(null)).toBe(true);
  });

  it('allows only listed addresses when a list is set', () => {
    process.env.ADMIN_ALLOWED_IPS = '203.0.113.9, 198.51.100.4';
    expect(adminIpAllowed('203.0.113.9')).toBe(true);
    expect(adminIpAllowed('198.51.100.4')).toBe(true);
    expect(adminIpAllowed('192.0.2.1')).toBe(false);
    expect(adminIpAllowed(null)).toBe(false);
  });
});
