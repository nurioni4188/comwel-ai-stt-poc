# CLOVA 비동기 STT 안정 기준선 — 2026-08-15

## 기준선

- 기준 태그: `v0.4.1-stt-clova-async-callback`
- 기준 main SHA: `bc34dd61a81a9065b10a3f48c3f9e9677980bc10`
- Supabase project: `comwel-ai-stt-poc`
- `stt-submit`: version 8 / `verify_jwt=true`
- `stt-clova-callback`: version 7 / `verify_jwt=false`
- 기준 회귀검증 job: `bb2d4784-9ab4-491f-b040-2808067cb14f`
- 기준 session: `5497ba60-7fbb-4b4a-a4af-fdb28211c993`

## 완료된 회귀검증

- [x] `stt-submit` HTTP 202
- [x] CLOVA 비동기 제출 성공
- [x] callback HTTP 200
- [x] 상태 전이 `pending → processing → completed`
- [x] `progress = 100`
- [x] `error_code is null`
- [x] `error_message is null`
- [x] callback result `SUCCEEDED`
- [x] `stt_transcripts` 저장
- [x] `stt_segments` 1건 저장
- [x] `stt_poc.transcript_chunks` 1건 저장
- [x] transcript confidence `0.9792`
- [x] `clova_callback_completed` event 기록
- [x] `bridge_warning = null`

## callback 보안 기준선

- [x] callback URL에서 고정 `?token=` query secret 제거
- [x] CLOVA callback payload의 provider token을 필수 검증
- [x] `stt_jobs.provider_job_id`와 callback provider token이 일치할 때만 처리
- [x] event details에 provider token 원문 미저장
- [x] transcript provider metadata에 provider token 원문 미저장
- [x] Edge Function URL 로그에 고정 callback secret 미노출
- [x] 과거 event/transcript 중복 token metadata 정리

## Supabase Security Advisor 정리

- [x] `public.rls_auto_enable()` 기능 자체 유지
- [x] `ensure_rls` event trigger 활성 상태 유지
- [x] `PUBLIC`, `anon`, `authenticated`의 직접 EXECUTE 권한 회수
- [x] Advisor의 SECURITY DEFINER 실행 가능 WARN 제거 확인
- [x] Leaked Password Protection은 Supabase Free 플랜에서 미지원임을 확인하고 해당 WARN을 기준선의 수용된 잔여 경고로 기록

## 운영 원칙

- callback 함수는 외부 CLOVA webhook이므로 `verify_jwt=false`를 유지하되 provider job token 검증을 필수로 한다.
- `SUPABASE_SERVICE_ROLE_KEY`, `CLOVA_SPEECH_SECRET`은 서버 전용으로 유지한다.
- callback URL에 장기 고정 secret을 query string으로 넣지 않는다.
- 기준선 이후 변경은 별도 브랜치/PR을 거친다.
