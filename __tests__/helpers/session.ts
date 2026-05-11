import { generateSessionValue, SESSION_COOKIE } from '../../apiUtils/auth/session';

export function authedCookies(): Record<string, string> {
  return { [SESSION_COOKIE]: generateSessionValue() };
}
