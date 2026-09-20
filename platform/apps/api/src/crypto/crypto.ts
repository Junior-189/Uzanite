// Secrets-at-rest crypto lives in the shared @uzanite/messaging package so the
// API and worker use one implementation (Meta tokens are encrypted here and
// decrypted by the worker when sending). Re-exported to keep existing imports.
//
// Note `decrypt` THROWS a DecryptionError on a key mismatch — use `tryDecrypt`
// where a missing secret is a tolerable outcome that should still be diagnosed.
export {
  encrypt,
  decrypt,
  tryDecrypt,
  DecryptionError,
  isEncrypted,
  sha256,
  randomToken,
} from '@uzanite/messaging';
