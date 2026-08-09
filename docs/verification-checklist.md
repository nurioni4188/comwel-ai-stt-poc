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

## Production 검증 — WAV STT 기준선 — 2026-08-09

- [x] 기준 main SHA `ee6d206` Production 배포
- [x] 기준 태그 `v0.1.0-stt-poc`
- [x] Production URL `https://comwel-ai-stt-poc.vercel.app` 활성화
- [x] Production 환경변수 4종 적용
- [x] 실제 마이크 녹음에서 STT 결과 표시 확인
- [x] 검증 세션 `fcbc1819-f89b-4c52-94b3-fb6eab732531`
- [x] 검증 세션 `status = completed`
- [x] 검증 세션 `ended_at is not null`
- [x] 청크 인덱스 0부터 연속 저장
- [x] 검사 청크 모두 `audio_format = 'audio/wav'`

## 민원 요지 초안 — PR #3

- [x] 최신 브랜치 `npm run build` 통과
- [x] 최신 브랜치 `npm run lint` 0 warnings, 0 errors
- [x] 완료되지 않은 세션에서 `/api/stt-summary`가 요지 생성을 거부함 — `status !== 'completed'`이면 409 반환
- [x] 완료된 세션에서 `/api/stt-summary`가 요지 초안을 반환함
- [x] 요지 초안이 STT 원문에 없는 사실·사건번호·결론을 새로 만들지 않음 — 원문 추출형 `extractive_v1`
- [x] `draft_type = 'complaint_summary_extractive_v1'`로 `stt_poc.drafts`에 저장됨
- [x] 같은 세션에서 재생성 시 최신 기존 초안이 갱신되고 불필요한 중복이 늘지 않음
- [x] 화면에서 전체 통화 인식문과 민원 요지 초안이 분리 표시됨
- [x] 요지 생성 중 버튼 중복 클릭이 차단됨
- [x] 새 녹음 시작/결과 초기화 시 이전 요지 초안이 화면에서 제거됨
- [x] 빈 STT에서는 민원 요지 초안 생성 버튼이 비활성화됨
- [x] PR #3 main 병합 완료 — main SHA `3491d9c`

## Production 회귀검증 — STT + 민원 요지 초안 — 2026-08-09

- [x] main SHA `3491d9c` Production 재배포
- [x] Production 실제 녹음 및 STT 정상 동작 확인
- [x] Production 민원 요지 초안 생성 정상 동작 확인
- [x] 검증 세션 `dd32ce90-47cd-44d4-8a45-062eb9fdf306`
- [x] 검증 세션 `status = completed`, `ended_at is not null`
- [x] `stt_poc.drafts` 조회 결과 1 row 확인
- [x] `draft_type = 'complaint_summary_extractive_v1'` 확인
- [x] Production에서 STT → completed → 요지 생성 → drafts 저장 흐름 확인

## 병합/기준선 조건

- [x] Supabase 실제 DB 결과 확인
- [x] 대표 녹음 3회 반복 검증
- [x] 세션 수명주기 분리 및 완료 처리 검증
- [x] Production 실제 녹음 검증
- [x] PR #3 핵심 기능 검증 완료
- [x] main `3491d9c` Production 회귀검증 완료
- [ ] 모바일 폭 실기기/DevTools 최종 확인 — 비차단 후속 점검

## 기준선 이후 원칙

- WAV STT 기준선 SHA는 `ee6d206`, 태그는 `v0.1.0-stt-poc`입니다.
- STT + 민원 요지 초안의 검증 완료 SHA는 `3491d9c`입니다.
- 새 기준선 권장 태그는 `v0.2.0-stt-summary`입니다.
- 기준선 이후 기능 변경은 `main`에 직접 반영하지 않고 별도 기능 브랜치에서 진행합니다.
- 비밀값은 Vercel 환경변수에서만 관리하고 Git 저장소에는 커밋하지 않습니다.
- 민원 요지 초안은 담당자 검토용이며 자동 제출·자동 처분으로 연결하지 않습니다.
