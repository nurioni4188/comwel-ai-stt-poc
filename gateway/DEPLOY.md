# Live Gateway deployment checklist

1. Deploy `gateway/` to a Node.js 20+ host that supports persistent WebSockets and HTTPS/WSS.
2. Set environment variables:
   - `TELEPHONY_PROVIDER=twilio`
   - `LIVE_E2E_ENABLED=true`
   - `TWILIO_AUTH_TOKEN`
   - `PUBLIC_MEDIA_WSS_URL=wss://<host>/v1/media`
   - `OPENAI_API_KEY`
   - `AI_APP_BASE_URL=https://comwel-ai-stt-poc.vercel.app`
   - `GATEWAY_CONTROL_TOKEN=<random secret>`
   - optional: `LIVE_TURN_MS=8000`
   - optional: `LIVE_HTTP_TIMEOUT_MS=20000`
3. Confirm `GET https://<host>/health` returns `version=v0.15.0`, `liveE2E.enabled=true`, and `liveE2E.readiness.ready=true`.
4. Confirm `GET https://<host>/v1/twiml` returns `<Connect><Stream>` pointing to the same WSS URL.
5. Confirm `GET /v1/sessions` without a control token is rejected and succeeds with `Authorization: Bearer <GATEWAY_CONTROL_TOKEN>`.
6. Configure the Twilio Voice trial webhook to `https://<host>/v1/twiml`.
7. Place one call from a verified trial phone and run the v0.15 E2E script in `docs/v0.15.0-live-telephony-e2e.md`.
8. Use only the documented synthetic, non-identifiable test phrases. The existing `/api/stt-ingest` persists recognized transcript text even though the Gateway does not persist raw audio.

Do not merge/tag v0.15.0 until the real phone call E2E and protected-control checks pass.
