// JWT lifecycle: short-lived access tokens + rotating, revocable refresh tokens.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/RefreshToken');
const { jwtSecret } = require('../config/env');
const logger = require('../config/logger');

const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function signAccessToken(payload) {
  // A caller that sets its own `exp` (impersonation uses a shorter TTL) must
  // not also receive `expiresIn`, which jsonwebtoken rejects as a conflict.
  if (payload && payload.exp) return jwt.sign(payload, jwtSecret);
  return jwt.sign(payload, jwtSecret, { expiresIn: ACCESS_TTL });
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issueRefreshToken(user, userType, meta = {}) {
  const raw = crypto.randomBytes(48).toString('hex');
  await RefreshToken.create({
    tokenHash: hashToken(raw),
    userId: user._id,
    userType,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    createdByIp: meta.ip || '',
    userAgent: meta.userAgent || '',
  });
  return raw;
}

// Rotates a refresh token. Returns { userId, userType } or null when invalid.
// Reuse of an already-revoked token revokes every token for that user.
async function rotateRefreshToken(raw, meta = {}) {
  if (!raw || typeof raw !== 'string') return null;
  const tokenHash = hashToken(raw);
  const doc = await RefreshToken.findOne({ tokenHash });
  if (!doc) return null;

  if (doc.revokedAt) {
    logger.warn({ userId: String(doc.userId) }, 'Refresh token reuse detected — revoking all sessions');
    await RefreshToken.updateMany(
      { userId: doc.userId, userType: doc.userType, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return null;
  }
  if (doc.expiresAt < new Date()) return null;

  const newRaw = crypto.randomBytes(48).toString('hex');
  const newHash = hashToken(newRaw);
  doc.revokedAt = new Date();
  doc.replacedByHash = newHash;
  await doc.save();

  await RefreshToken.create({
    tokenHash: newHash,
    userId: doc.userId,
    userType: doc.userType,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    createdByIp: meta.ip || '',
    userAgent: meta.userAgent || '',
  });

  return { userId: doc.userId, userType: doc.userType, refreshToken: newRaw };
}

async function revokeRefreshToken(raw) {
  if (!raw || typeof raw !== 'string') return;
  await RefreshToken.updateOne({ tokenHash: hashToken(raw) }, { $set: { revokedAt: new Date() } });
}

async function revokeAllForUser(userId, userType) {
  await RefreshToken.updateMany({ userId, userType, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = {
  ACCESS_TTL,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  hashToken,
};
