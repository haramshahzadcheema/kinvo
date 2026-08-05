import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 over the classic `argon2` package: it ships prebuilt
// napi-rs binaries (including linux-musl), so it installs cleanly in the
// same Alpine-based Docker images that have already been a source of
// native-build pain in this project — no C++ toolchain needed at install
// time.

const HASH_OPTIONS = {
  memoryCost: 19_456, // ~19 MiB, OWASP-recommended minimum for Argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return hash(plainTextPassword, HASH_OPTIONS);
}

export async function verifyPassword(
  hashedPassword: string,
  plainTextPassword: string,
): Promise<boolean> {
  return verify(hashedPassword, plainTextPassword);
}
