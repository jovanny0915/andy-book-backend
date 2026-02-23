import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET || 'dev-secret';

export function signForumToken(email) {
  return jwt.sign(
    { email, purpose: 'forum' },
    secret,
    { expiresIn: '7d' }
  );
}

export function verifyForumToken(token) {
  try {
    const payload = jwt.verify(token, secret);
    if (payload.purpose !== 'forum' || !payload.email) return null;
    return payload.email;
  } catch {
    return null;
  }
}

export function forumAuthMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const email = token ? verifyForumToken(token) : null;
  if (!email) {
    return res.status(401).json({ message: 'Authentication required. Please verify your email first.' });
  }
  req.forumEmail = email;
  next();
}
