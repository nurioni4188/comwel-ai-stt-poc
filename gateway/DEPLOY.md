# Live Gateway deployment checklist

## 배포 방식

`gateway/`는 장시간 연결되는 Media WebSocket을 유지해야 하므로 Vercel Serverless가 아니라 persistent WebSocket을 지원하는 Node 호스트에 배포한다.

두 방식 모두 사용할 수 있다.

- Node 방식: Root Directory `gateway`, install `npm install`, start `npm start`
- Container 방식: Root Directory `gateway`, `Dockerfile`로 빌드/실행

Container는 Node.js 20 기반이며 `/health` HEALTHCHECK를 포함한다. 호스트가 `PORT`를 주입하면 Gateway가 해당 값을 사용한다.

## 배포 체크리스트

1. `gateway/`를 Node.js 20+, HTTPS/WSS 및 persistent WebSocket을 지원하는 별도 호스트에 배포한다.
2. 다음 환경변수를 설정한다.
   - `TELEPHONY_PROVIDER=twilio`
   - `LIVE_E2E_ENABLED=true`
   - `TWILIO_AUTH_TOKEN`
   - `PUBLIC_MEDIA_WSS_URL=wss://<host>/v1/media`
   - `OPENAI_API_KEY`
   - `AI_APP_BASE_URL=https://comwel-ai-stt-poc.vercel.app`
   - `GATEWAY_CONTROL_TOKEN=<random secret>`
   - optional: `LIVE_TURN_MS=8000`
   - optional: `LIVE_HTTP_TIMEOUT_MS=20000`
3. `GET https://<host>/health`에서 `version=v0.15.0`, `liveE2E.enabled=true`, `liveE2E.readiness.ready=true`를 확인한다.
4. readiness의 모든 check가 `true`인지 확인한다. 비밀값 자체는 응답에 노출되지 않는다.
5. `GET https://<host>/v1/twiml`이 동일한 WSS URL의 `<Connect><Stream>`을 반환하는지 확인한다.
6. `GET /v1/sessions`를 토큰 없이 호출하면 차단되고, `Authorization: Bearer <GATEWAY_CONTROL_TOKEN>`으로만 성공하는지 확인한다.
7. `POST /v1/tts`, `POST /v1/clear`도 동일하게 control token 없이는 차단되는지 확인한다.
8. Twilio Voice Trial webhook을 `https://<host>/v1/twiml`로 설정한다.
9. 검증된 Trial 전화에서 한 통을 걸고 `docs/v0.15.0-live-telephony-e2e.md`의 시험 시나리오를 수행한다.
10. 문서의 합성·비식별 시험 문장만 사용한다. 기존 `/api/stt-ingest`는 Gateway 원시 오디오를 저장하지 않더라도 인식된 transcript text는 저장한다.

## 배포 전 로컬 검증

Repository root에서 production build를 실행하면 Gateway 검증이 먼저 수행된다.

```bash
npm run build
```

Gateway만 확인하려면 다음을 실행한다.

```bash
npm --prefix gateway run check
```

## 병합 원칙

실제 전화 E2E, fallback, 보호 control endpoint까지 확인하기 전에는 PR #24를 Draft로 유지하고 `v0.15.0`을 main에 병합/태그하지 않는다.
