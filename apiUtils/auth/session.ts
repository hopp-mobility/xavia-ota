import { createHmac, timingSafeEqual } from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';

export const SESSION_COOKIE = 'xavia-ota-session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  return Buffer.from(secret, 'utf8');
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function generateSessionValue(): string {
  const payload = JSON.stringify({ iat: Date.now() });
  const b64 = Buffer.from(payload, 'utf8').toString('base64url');
  return `${b64}.${sign(b64)}`;
}

function cookieAttrs(): string {
  const isProd = process.env.NODE_ENV === 'production';
  return `HttpOnly; SameSite=Strict; Path=/${isProd ? '; Secure' : ''}`;
}

export function issueSessionCookie(res: NextApiResponse): void {
  const value = generateSessionValue();
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${value}; ${cookieAttrs()}; Max-Age=${MAX_AGE_SECONDS}`
  );
}

export function clearSessionCookie(res: NextApiResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs()}; Max-Age=0`);
}

export function verifySession(req: NextApiRequest): boolean {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (!cookie) return false;
  const [b64, sig] = cookie.split('.');
  if (!b64 || !sig) return false;

  let expected: string;
  try {
    expected = sign(b64);
  } catch {
    return false;
  }
  if (sig.length !== expected.length) return false;
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return false;
  } catch {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (typeof payload.iat !== 'number') return false;
    if (Date.now() - payload.iat > MAX_AGE_SECONDS * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

export function requireSession(req: NextApiRequest, res: NextApiResponse): boolean {
  if (verifySession(req)) return true;
  res.status(401).json({ error: 'Authentication required' });
  return false;
}
