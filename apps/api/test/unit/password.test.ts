import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/core/security/password';

describe('password hashing', () => {
  it('produces a hash that is not the plaintext password', async () => {
    const hashed = await hashPassword('correct-horse-battery-staple');
    expect(hashed).not.toBe('correct-horse-battery-staple');
    expect(hashed.length).toBeGreaterThan(0);
  });

  it('verifies the correct password against its hash', async () => {
    const hashed = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword(hashed, 'correct-horse-battery-staple')).resolves.toBe(true);
  });

  it('rejects an incorrect password against the hash', async () => {
    const hashed = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword(hashed, 'wrong-password')).resolves.toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const first = await hashPassword('correct-horse-battery-staple');
    const second = await hashPassword('correct-horse-battery-staple');
    expect(first).not.toBe(second);
  });
});
