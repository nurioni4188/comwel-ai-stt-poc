import type { VercelRequest, VercelResponse } from '@vercel/node';
import ragAnswerHandler from './stt-rag-answer';
import { requireGatewayInternalAuth } from './_gatewayAuth';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (!requireGatewayInternalAuth(req, res)) return;
  return ragAnswerHandler(req, res);
}
