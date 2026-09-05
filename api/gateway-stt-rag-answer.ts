import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireGatewayInternalAuth } from './_gatewayAuth.js';

const TARGET_PATH = '/api/stt-rag-answer';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (!requireGatewayInternalAuth(req, res)) return;

  const deploymentHost = process.env.VERCEL_URL?.trim();
  const token = process.env.STT_INTERNAL_API_TOKEN?.trim() ?? '';
  if (!deploymentHost || !token) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Gateway upstream is not configured.' });
  }

  const upstream = await fetch(`https://${deploymentHost}${TARGET_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-stt-internal-token': token,
      'x-stt-gateway-proxy': '1',
    },
    body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
  });

  const text = await upstream.text();
  res.setHeader('Cache-Control', 'no-store');
  res.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  return res.send(text);
}
