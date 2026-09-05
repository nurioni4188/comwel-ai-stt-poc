# Live Gateway deployment checklist

## 배포 방식

`gateway/`는 장시간 Media WebSocket을 유지하므로 Vercel Serverless가 아니라 persistent WebSocket을 지원하는 Node 호스트에 배포한다.

- Node: Root Directory `gateway`, install `npm install`, start `npm start`
- Container: Root Directory `gateway`, `Dockerfile` 빌드/실행

Container는 Node.js 20 기반이며 `/health` HEALTHCHECK를 포함한다.

## 배포 체크리스트

1. Vercel Preview build가 성공하고 `lambdaRuntimeStats`가 Hobby 한도인 12 Functions 이내인지 확인한다.
2. Vercel과 Gateway 양쪽에 동일한 강한 난수 `STT_INTERNAL_API_TOKEN`을 설정한다. 실제 값은 GitHub/문서/로그에 기록하지 않는다.
3. Gateway에 설정:
   - `TELEPHONY_PROVIDER=twilio`
   - `LIVE_E2E_ENABLED=true`
   - `TWILIO_AUTH_TOKEN`
   - `PUBLIC_MEDIA_WSS_URL=wss://<host>/v1/media`
   - `OPENAI_API_KEY`
   - `AI_APP_BASE_URL=https://<v0.15-tested-vercel-host>`
   - `STT_INTERNAL_API_TOKEN=<Vercel과 동일한 secret>`
   - `GATEWAY_CONTROL_TOKEN=<STT token과 다른 secret>`
   - optional `LIVE_TURN_MS=8000`
   - optional `LIVE_HTTP_TIMEOUT_MS=20000`
   - optional `OPENAI_TTS_TIMEOUT_MS=30000`
4. 실전화 Gateway의 Vercel 호출은 `POST /api/telephony-adapter` 하나만 사용한다. `gatewayOperation`은 `stt_ingest`, `rag_answer`, `session_complete`만 허용한다.
5. 잘못된 `x-stt-internal-token`으로 Gateway operation이 401인지 확인한다.
6. 올바른 internal token으로만 Gateway operation이 통과하는지 확인한다.
7. `GET https://<host>/health`에서 `version=v0.15.0`, `liveE2E.enabled=true`, `liveE2E.internalApiTokenConfigured=true`, `liveE2E.readiness.ready=true`를 확인한다.
8. `GET https://<host>/v1/twiml`이 같은 WSS URL의 `<Connect><Stream>`을 반환하는지 확인한다.
9. `GET /v1/sessions`, `POST /v1/tts`, `POST /v1/clear`가 control token 없이는 차단되는지 확인한다.
10. Twilio Voice Trial webhook을 `https://<host>/v1/twiml`로 설정한다.
11. 검증된 Trial 전화에서 문서의 비식별 합성 시험 시나리오만 수행한다.
12. 통화 종료 후 합성 시험 STT session이 `completed`이고 chunk index가 연속인지 확인한다.

## Vercel Hobby Function 한도 대응

이 프로젝트는 이미 12개의 `/api` Serverless Functions를 사용한다. 보호용 endpoint를 세 개 별도 추가하면 Hobby plan의 `exceeded_serverless_functions_per_deployment` 오류가 발생한다.

따라서 v0.15는 **기존 `api/telephony-adapter.ts`를 보호 multiplex endpoint로 재사용**한다. 인증 helper인 `api/_gatewayAuth.ts`는 별도 공개 endpoint가 아니며, 실전화용 새 Serverless Function을 추가하지 않는다.

## 기존 브라우저 PoC와 분리

실전화 Gateway는 보호된 `telephony-adapter`만 호출한다. 기존 브라우저 PoC의 `/api/stt-*` 직접 호출 동작은 유지한다.

따라서 이번 조치는 실전화 서버 간 경로 보강이다. 브라우저 PoC 자체를 정식 운영으로 승격할 경우 사용자 인증, 권한, 요청량 제한, 개인정보 정책을 별도 구현한다.

## 배포 전 검증

Repository root:

```bash
npm run build
```

Gateway만:

```bash
npm --prefix gateway run check
```

## 병합 원칙

실제 전화 E2E, fallback, STT session 완료, Gateway↔Vercel shared-secret 인증, 보호 control endpoint까지 모두 확인하기 전에는 PR #24를 Draft로 유지하고 `v0.15.0`을 main에 병합/태그하지 않는다.
