const jwt = require('jsonwebtoken');

function isIdentifier(value) {
  return (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value));
}

function auth(req, res, next) {
  console.log(req.method, req.path);
  if (req.method === 'POST' && req.path === '/auth/login') {
    return next();
  }

  const authorization = req.get('authorization');
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+(\S+)$/i)
    : null;

  if (!match) {
    return res.status(401).json({ status: 'error', message: 'Bearer token is required' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT authentication is not configured: JWT_SECRET is missing');
    return res.status(500).json({ status: 'error', message: 'Authentication is not configured' });
  }

  let payload;
  try {
    payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }

  if (
    typeof payload !== 'object'
    || payload === null
    || !isIdentifier(payload.userId)
    || typeof payload.role !== 'string'
    || payload.role.trim().length === 0
    || !isIdentifier(payload.storeId)
  ) {
    return res.status(401).json({ status: 'error', message: 'Token is missing required user claims' });
  }

  req.userId = payload.userId;
  req.role = payload.role;
  req.storeId = payload.storeId;
  next();
}

module.exports = auth;
