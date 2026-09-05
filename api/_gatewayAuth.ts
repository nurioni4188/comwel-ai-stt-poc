import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';

const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 256;

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

function isStrongSecret(value: string): boolean {
  return value.length >= MIN_SECRET_LENGTH && value.length <= MAX_SECRET_LENGTH;
}

function secureEqual(expected: string, actual: string): boolean {
  if (!isStrongSecret(expected) || !isStrongSecret(actual)) return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function noStore(res: VercelResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export function requireGatewayInternalAuth(
  req: VercelRequest,
  res: VercelResponse
): boolean {
  const expected = process.env.STT_INTERNAL_API_TOKEN?.trim() ?? '';
  noStore(res);

  if (!isStrongSecret(expected)) {
    res.status(503).json({
      error: 'STT 내부 인증 설정이 완료되지 않았습니다.',
    });
    return false;
  }

  const actual = headerValue(req.headers['x-stt-internal-token']);
  if (!secureEqual(expected, actual)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}
