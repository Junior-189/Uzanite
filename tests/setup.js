// Test environment bootstrap.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-0123456789abcdef0123456789abcdef';
process.env.DISABLE_TRANSACTIONS = 'true';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.WHATSAPP_TRANSPORT = process.env.WHATSAPP_TRANSPORT || 'meta';
process.env.STORAGE_SIGNING_SECRET =
  process.env.STORAGE_SIGNING_SECRET || 'test-storage-signing-secret-0123456789abcdef';
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || 'private_uploads_test';
