import {
  hashVisitorId,
  readCookie,
  signVisitorId,
  verifyVisitorCookie,
  VISITOR_COOKIE_NAME,
} from './visitor-identity';

describe('visitor identity', () => {
  const secret = 'a sufficiently long test secret';
  const visitorId = '011c5902-4a98-45ea-aa18-cd74411f31b0';

  it('reads and decodes the named cookie from a cookie header', () => {
    expect(
      readCookie(
        `other=value; ${VISITOR_COOKIE_NAME}=visitor%2Esignature; last=one`,
        VISITOR_COOKIE_NAME,
      ),
    ).toBe('visitor.signature');
  });

  it('ignores missing and malformed cookie values', () => {
    expect(readCookie(undefined, VISITOR_COOKIE_NAME)).toBeUndefined();
    expect(readCookie('other=value', VISITOR_COOKIE_NAME)).toBeUndefined();
    expect(
      readCookie(`malformed; ${VISITOR_COOKIE_NAME}=valid`, VISITOR_COOKIE_NAME),
    ).toBe('valid');
    expect(
      readCookie(`${VISITOR_COOKIE_NAME}=%E0%A4%A`, VISITOR_COOKIE_NAME),
    ).toBeUndefined();
  });

  it('round-trips a signed visitor identifier', () => {
    const cookie = signVisitorId(visitorId, secret);

    expect(verifyVisitorCookie(cookie, secret)).toBe(visitorId);
  });

  it.each([
    ['missing signature', visitorId],
    ['empty visitor identifier', '.signature'],
    ['extra segment', `${visitorId}.signature.extra`],
    ['tampered signature', `${visitorId}.tampered`],
  ])('rejects a %s', (_label, cookie) => {
    expect(verifyVisitorCookie(cookie, secret)).toBeUndefined();
  });

  it('creates a stable pseudonymous visit hash in a separate namespace', () => {
    const hash = hashVisitorId(visitorId, secret);

    expect(hash).toHaveLength(64);
    expect(hashVisitorId(visitorId, secret)).toBe(hash);
    expect(signVisitorId(visitorId, secret)).not.toContain(hash);
  });
});
