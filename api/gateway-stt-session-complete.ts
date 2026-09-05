import type { VercelRequest, VercelResponse } from '@vercel/node';
import completeHandler from './stt-session-complete';
import { requireGatewayInternalAuth } from './_gatewayAuth';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (!requireGatewayInternalAuth(req, res)) return;
  return completeHandler(req, res);
}
