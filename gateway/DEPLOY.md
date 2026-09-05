# Live Gateway deployment checklist

## 배포 방식

`gateway/`는 장시간 연결되는 Media WebSocket을 유지해야 하므로 Vercel Serverless가 아니라 persistent WebSocket을 지원하는 Node 호스트에 배포한다.

두 방식 모두 사용할 수 있다.

- Node 방식: Root Directory `gateway`, install `npm install`, start `npm start`
- Container 방식: Root Directory `gateway`, `Dockerfile`로 빌드/실행

Container는 Node.js 20 기반이며 `/health` HEALTHCHECK를 포함한다. 호스트가 `PORT`를 주입하면 Gateway가 해당 값을 사용한다.

## 배포 체크리스트

1. `gateway/`를 Node.js 20+, HTTPS/WSS 및 persistent WebSocket을 지원하는 별도 호스트에 배포한다.
2. Vercel과 Gateway 양쪽에 동일한 강한 난수 `STT_INTERNAL_API_TOKEN`을 설정한다. 실제 값은 GitHub/문서/로그에 기록하지 않는다.
3. Gateway에 다음 환경변수를 설정한다.
   - `TELEPHONY_PROVIDER=twilio`
   - `LIVE_E2E_ENABLED=true`
   - `TWILIO_AUTH_TOKEN`
   - `PUBLIC_MEDIA_WSS_URL=wss://<host>/v1/media`
   - `OPENAI_API_KEY`
   - `AI_APP_BASE_URL=https://comwel-ai-stt-poc.vercel.app`
   - `STT_INTERNAL_API_TOKEN=<Vercel과 동일한 secret>`
   - `GATEWAY_CONTROL_TOKEN=<STT token과 다른 random secret>`
   - optional: `LIVE_TURN_MS=8000`
   - optional: `LIVE_HTTP_TIMEOUT_MS=20000`
   - optional: `OPENAI_TTS_TIMEOUT_MS=30000`
4. `GET https://<host>/health`에서 `version=v0.15.0`, `liveE2E.enabled=true`, `liveE2E.internalApiTokenConfigured=true`, `liveE2E.readiness.ready=true`를 확인한다.
5. readiness의 모든 check가 `true`인지 확인한다. 비밀값 자체는 응답에 노출되지 않는다.
6. 보호된 Vercel API `/api/gateway-stt-ingest`, `/api/gateway-stt-rag-answer`, `/api/gateway-stt-session-complete`가 잘못된 `x-stt-internal-token`을 401로 거부하는지 확인한다.
7. 올바른 `STT_INTERNAL_API_TOKEN`을 가진 Gateway 요청만 보호된 Vercel API를 통과하는지 확인한다.
8. `GET https://<host>/v1/twiml`이 동일한 WSS URL의 `<Connect><Stream>`을 반환하는지 확인한다.
9. `GET /v1/sessions`를 토큰 없이 호출하면 차단되고, `Authorization: Bearer <GATEWAY_CONTROL_TOKEN>`으로만 성공하는지 확인한다.
10. `POST /v1/tts`, `POST /v1/clear`도 동일하게 control token 없이는 차단되는지 확인한다.
11. Twilio Voice Trial webhook을 `https://<host>/v1/twiml`로 설정한다.
12. 검증된 Trial 전화에서 한 통을 걸고 `docs/v0.15.0-live-telephony-e2e.md`의 시험 시나리오를 수행한다.
13. 문서의 합성·비식별 시험 문장만 사용한다. 보호된 Gateway ingest는 원시 오디오를 Gateway에 저장하지 않더라도 인식된 transcript text는 기존 STT DB에 저장한다.
14. 통화 종료 후 합성 시험 STT session이 `completed`이고 transcript chunk 인덱스가 연속인지 확인한다.

## 기존 브라우저 PoC와 분리

실전화 Gateway는 기존 브라우저용 `/api/stt-*` endpoint를 직접 호출하지 않고 `gateway-stt-*` 보호 endpoint만 사용한다. 이 방식은 현재 브라우저 PoC를 깨뜨리지 않으면서 실전화 서버 간 경로에 shared-secret 인증을 적용하기 위한 것이다.

브라우저 PoC 자체를 실제 운영으로 승격하려면 사용자 인증, 권한, 요청량 제한 및 개인정보 정책을 별도로 검토한다.

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

실제 전화 E2E, fallback, STT session 완료, Gateway↔Vercel 내부 API 인증, 보호 control endpoint까지 확인하기 전에는 PR #24를 Draft로 유지하고 `v0.15.0`을 main에 병합/태그하지 않는다.
