import type { VercelRequest, VercelResponse } from '@vercel/node';
import ingestHandler from './stt-ingest';
import { requireGatewayInternalAuth } from './_gatewayAuth';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (!requireGatewayInternalAuth(req, res)) return;
  return ingestHandler(req, res);
}
