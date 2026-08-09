# WAV STT PoC 검증 체크리스트

## 정적 검증

- [x] `npm run build`
- [x] `npm run lint` — 0 warnings, 0 errors
- [x] 저장소에 `.env.local`, `.vercel`, 실제 Secret 값이 포함되지 않음

## 로컬 기능 검증

- [x] `vercel pull --yes --environment=development`
- [x] `vercel dev`
- [x] 녹음 시작 버튼이 즉시 녹음 중 상태로 전환됨
- [x] 10초마다 WAV 청크 결과가 순서대로 표시됨
- [x] 녹음 중지 시 마지막 10초 미만 청크가 전송됨
- [x] CLOVA 400 파일 형식 오류가 발생하지 않음
- [x] 오류 발생 시 화면에 상세 원인이 표시됨(Development만)

## Supabase 검증

- [x] `call_sessions`에 세션 UUID가 한 건 생성됨
- [x] 새 녹음 시작 시마다 서로 다른 세션 UUID 생성
- [x] `transcript_chunks.chunk_index`가 0부터 연속됨
- [x] `(session_id, chunk_index)` 중복 행이 없음
- [x] `audio_format = 'audio/wav'`
- [x] `duration_ms`가 실제 청크 길이와 대체로 일치함
- [x] 동일 청크 재전송 시 기존 행이 갱신됨
- [x] 녹음 종료 후 `status = completed`
- [x] 녹음 종료 후 `ended_at` 기록
- [x] 이전 녹음의 뒤쪽 청크가 다음 세션에 잔존하지 않음

## Production 검증 — 2026-08-09

- [x] 기준 main SHA `ee6d206` Production 배포
- [x] Production URL `https://comwel-ai-stt-poc.vercel.app` 활성화
- [x] `SUPABASE_URL` Production 적용
- [x] `SUPABASE_SERVICE_ROLE_KEY` Production 적용
- [x] `CLOVA_SPEECH_INVOKE_URL` Production 적용
- [x] `CLOVA_SPEECH_SECRET` Production 적용
- [x] 실제 마이크 녹음에서 STT 결과 표시 확인
- [x] Production 화면상 STT 처리 실패 없음
- [x] 검증 세션 `fcbc1819-f89b-4c52-94b3-fb6eab732531`
- [x] 검증 세션 `status = completed`
- [x] 검증 세션 `ended_at is not null`
- [x] 청크 인덱스 0부터 연속 저장
- [x] 검사 청크 모두 `audio_format = 'audio/wav'`

## 병합/기준선 조건

- [x] Supabase 실제 DB 결과 확인
- [x] 대표 녹음 3회 반복 검증
- [x] 세션 수명주기 분리 및 완료 처리 검증
- [x] Production 실제 녹음 검증
- [ ] 모바일 폭 실기기/DevTools 최종 확인 — 비차단 후속 점검

## 기준선 이후 원칙

- Production 검증 기준 SHA는 `ee6d206`으로 기록합니다.
- 기준선 이후 기능 변경은 `main`에 직접 반영하지 않고 별도 기능 브랜치에서 진행합니다.
- 비밀값은 Vercel 환경변수에서만 관리하고 Git 저장소에는 커밋하지 않습니다.
