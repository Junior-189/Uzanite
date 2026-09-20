// Pinned JWT claims and algorithm. Both signing and verification reference
// these, so a token issued for a different surface — or with an unexpected
// `alg` — cannot validate against this API.
export const JWT_ISSUER = 'uzanite';
export const JWT_AUDIENCE = 'uzanite-api';
export const JWT_ALGORITHM = 'HS256' as const;
