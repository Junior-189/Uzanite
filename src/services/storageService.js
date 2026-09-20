// Private object storage abstraction (Phase 3).
// S3-compatible (Cloudflare R2 / AWS S3) when configured, else a local private
// directory served through HMAC-signed URLs. Never publicly listable.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');
const logger = require('../config/logger');
const StoredFile = require('../models/StoredFile');

const cfg = config.storage;
const localDirAbs = path.isAbsolute(cfg.localDir)
  ? cfg.localDir
  : path.join(process.cwd(), cfg.localDir);

if (cfg.provider !== 's3' && !fs.existsSync(localDirAbs)) {
  fs.mkdirSync(localDirAbs, { recursive: true });
}

function isS3() {
  return cfg.provider === 's3' && !!cfg.s3.bucket;
}

let s3Client = null;
function getS3() {
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({
      region: cfg.s3.region || 'auto',
      endpoint: cfg.s3.endpoint || undefined,
      forcePathStyle: !!cfg.s3.endpoint,
      credentials:
        cfg.s3.accessKeyId && cfg.s3.secretAccessKey
          ? { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey }
          : undefined,
    });
  }
  return s3Client;
}

function newKey(prefix) {
  const rand = crypto.randomBytes(8).toString('hex');
  return `${prefix}/${Date.now()}-${rand}`;
}

function sign(key, exp) {
  return crypto.createHmac('sha256', cfg.signingSecret || '').update(`${key}:${exp}`).digest('hex');
}

async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function putObject(key, buffer, contentType = 'application/octet-stream', meta = {}) {
  if (isS3()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(
      new PutObjectCommand({ Bucket: cfg.s3.bucket, Key: key, Body: buffer, ContentType: contentType })
    );
  } else {
    const full = path.join(localDirAbs, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
  }

  const expiresAt =
    cfg.retentionDays > 0 ? new Date(Date.now() + cfg.retentionDays * 24 * 60 * 60 * 1000) : null;
  try {
    await StoredFile.create({
      businessId: meta.businessId || 'default',
      key,
      contentType,
      size: buffer.length,
      purpose: meta.purpose || 'general',
      expiresAt,
      createdBy: meta.createdBy || '',
    });
  } catch (err) {
    logger.warn({ err: err.message, key }, 'Failed to record StoredFile metadata');
  }
  return key;
}

async function getObjectBuffer(key) {
  if (isS3()) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await getS3().send(new GetObjectCommand({ Bucket: cfg.s3.bucket, Key: key }));
    return streamToBuffer(res.Body);
  }
  return fs.readFileSync(path.join(localDirAbs, key));
}

async function deleteObject(key) {
  try {
    if (isS3()) {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      await getS3().send(new DeleteObjectCommand({ Bucket: cfg.s3.bucket, Key: key }));
    } else {
      fs.unlinkSync(path.join(localDirAbs, key));
    }
  } catch (err) {
    logger.warn({ err: err.message, key }, 'Failed to delete object');
  }
  await StoredFile.deleteOne({ key }).catch(() => {});
}

async function signedUrl(key, ttl = cfg.urlTtlSeconds) {
  if (!key) return null;
  if (isS3()) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: cfg.s3.bucket, Key: key }), {
      expiresIn: ttl,
    });
  }
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = cfg.signingSecret ? sign(key, exp) : '';
  return `${config.appUrl}/api/files/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

function verifyLocalSignature(key, exp, sig) {
  if (!cfg.signingSecret || !exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(key, exp);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Stored values may be legacy URLs/paths or 'store:<key>' references.
async function resolveDisplayUrl(value) {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith('store:')) return signedUrl(value.slice(6));
  return value;
}

module.exports = {
  isS3,
  newKey,
  putObject,
  getObjectBuffer,
  deleteObject,
  signedUrl,
  verifyLocalSignature,
  resolveDisplayUrl,
  localDirAbs,
};
