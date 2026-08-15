# Live Gateway deployment checklist

1. Deploy `gateway/` to a Node host that supports persistent WebSockets and HTTPS/WSS.
2. Set environment variables:
   - `TELEPHONY_PROVIDER=twilio`
   - `LIVE_E2E_ENABLED=true`
   - `TWILIO_AUTH_TOKEN`
   - `PUBLIC_MEDIA_WSS_URL=wss://<host>/v1/media`
   - `OPENAI_API_KEY`
   - `AI_APP_BASE_URL=https://comwel-ai-stt-poc.vercel.app`
3. Confirm `GET https://<host>/health` returns `version=v0.15.0` and `liveE2E.enabled=true`.
4. Confirm `GET https://<host>/v1/twiml` returns `<Connect><Stream>` pointing to the same WSS URL.
5. Configure the Twilio Voice trial webhook to `https://<host>/v1/twiml`.
6. Place one call from a verified trial phone and run the v0.15 E2E script in `docs/v0.15.0-live-telephony-e2e.md`.

Do not merge/tag v0.15.0 until the real phone call E2E passes.
