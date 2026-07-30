import { createHmac, timingSafeEqual } from 'node:crypto';

export const VISITOR_COOKIE_NAME = 'hmt.vid';
export const VISITOR_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 400;

const COOKIE_SIGNATURE_NAMESPACE = 'visitor-cookie';
const VISIT_HASH_NAMESPACE = 'daily-visit';

export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator === -1) continue;
    if (segment.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function signVisitorId(visitorId: string, secret: string): string {
  const signature = hmac(COOKIE_SIGNATURE_NAMESPACE, visitorId, secret).digest(
    'base64url',
  );
  return `${visitorId}.${signature}`;
}

export function verifyVisitorCookie(
  value: string | undefined,
  secret: string,
): string | undefined {
  if (!value) return undefined;
  const [visitorId, signature, extra] = value.split('.');
  if (!visitorId || !signature || extra) return undefined;

  const expected = hmac(COOKIE_SIGNATURE_NAMESPACE, visitorId, secret).digest(
    'base64url',
  );
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return undefined;
  }
  return visitorId;
}

export function hashVisitorId(visitorId: string, secret: string): string {
  return hmac(VISIT_HASH_NAMESPACE, visitorId, secret).digest('hex');
}

function hmac(namespace: string, value: string, secret: string) {
  return createHmac('sha256', secret).update(`${namespace}:${value}`);
}
