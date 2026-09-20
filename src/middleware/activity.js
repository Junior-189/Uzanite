const ActivityLog = require('../models/ActivityLog');

function parseUserAgent(ua) {
  if (!ua) return { device: 'Unknown', browser: 'Unknown', os: 'Unknown' };

  let device = 'Desktop';
  if (/mobile|android|iphone|ipad/i.test(ua)) device = /ipad/i.test(ua) ? 'Tablet' : 'Mobile';

  let browser = 'Unknown';
  if (/chrome/i.test(ua) && !/edge|opr/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/edge/i.test(ua)) browser = 'Edge';
  else if (/opr|opera/i.test(ua)) browser = 'Opera';

  let os = 'Unknown';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';

  return { device, browser, os };
}

async function logActivity({ userId, userName, userEmail, sessionId, page, action, duration, ip, userAgent, referrer, businessId }) {
  try {
    const { device, browser, os } = parseUserAgent(userAgent);
    await ActivityLog.create({
      userId, userName, userEmail, sessionId,
      page, action, duration, ip, userAgent, referrer, businessId,
      device, browser, os,
    });
  } catch (err) {
    console.error('Activity log error:', err.message);
  }
}

function activityMiddleware(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') {
    return next();
  }

  const originalSend = res.send;
  res.send = function (body) {
    res.send = originalSend;
    res.send(body);

    try {
      const userId = req.user?._id;
      const userName = req.user?.name || '';
      const userEmail = req.user?.email || '';
      const businessId = req.user?.businessId || 'default';
      const ip = req.ip || req.connection?.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';
      const page = req.originalUrl;
      const action = req.method === 'POST' ? 'create' : req.method === 'PUT' ? 'update' : 'delete';

      logActivity({ userId, userName, userEmail, page, action, ip, userAgent, businessId });
    } catch {}
  };

  next();
}

module.exports = { logActivity, parseUserAgent, activityMiddleware };
