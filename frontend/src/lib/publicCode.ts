// Frontend mirror of the backend App\Support\PublicCode contract (validation side).
// Both stacks must agree on the Principle V public identifier format: an immutable
// 11-character code drawn from [A-Z0-9-]. Generation lives only on the backend.
const PUBLIC_CODE_PATTERN = /^[A-Z0-9-]{11}$/;

export function isValid(value: unknown): boolean {
  return typeof value === 'string' && PUBLIC_CODE_PATTERN.test(value);
}
