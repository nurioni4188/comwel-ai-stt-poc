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

## Production 검증 — v0.1.0 / 2026-08-09

- [x] 기준 main SHA `ee6d206` Production 배포
- [x] Production URL `https://comwel-ai-stt-poc.vercel.app` 활성화
- [x] Production 환경변수 4종 적용
- [x] 실제 마이크 녹음에서 STT 결과 표시 확인
- [x] Production 화면상 STT 처리 실패 없음
- [x] 검증 세션 `fcbc1819-f89b-4c52-94b3-fb6eab732531`
- [x] 검증 세션 `status = completed`
- [x] 검증 세션 `ended_at is not null`
- [x] 청크 인덱스 0부터 연속 저장
- [x] 검사 청크 모두 `audio_format = 'audio/wav'`

## 민원 요지 초안 — v0.2.0

- [x] 완료된 세션에서 `/api/stt-summary` 요지 초안 반환
- [x] `draft_type = 'complaint_summary_extractive_v1'` 저장
- [x] 같은 세션 재생성 시 불필요한 중복 없음
- [x] 전체 통화 인식문과 민원 요지 초안 분리 표시
- [x] 새 녹음 시작/결과 초기화 시 이전 요지 제거
- [x] 빈 STT에서 민원 요지 초안 생성 버튼 비활성화
- [x] Production 검증 세션 `dd32ce90-47cd-44d4-8a45-062eb9fdf306`
- [x] Production `stt_poc.drafts` 저장 확인

## 담당자 수정·확정 — v0.3.0 후보 / PR #5

- [x] DB migration 작성
- [x] `/api/stt-draft-save` 구현
- [x] `/api/stt-draft-confirm` 구현
- [x] 편집 textarea / 수정본 저장 / 담당자 확정 UI 구현
- [x] 기존 `/api/stt-summary`를 버전 컬럼과 호환되도록 보정
- [x] Production 실제 `drafts` 스키마 재확인
- [x] migration 적용 후 신규 7개 컬럼 확인
- [x] 기존 drafts backfill 검증
- [x] RPC `save_staff_draft`, `confirm_current_draft` 생성 확인
- [x] PR #5 최신 브랜치 `npm run build`
- [x] PR #5 최신 브랜치 `npm run lint`
- [x] 기존 extractive 요지 생성 회귀 없음
- [x] 수정본 저장 시 `version_no` 1 → 2 증가
- [x] 이전 버전 `status = superseded`, `is_current = false`
- [x] 세션별 `is_current = true` 1건
- [x] v2 `source_type = staff`
- [x] v2 `parent_draft_id`가 v1을 참조
- [x] 확정 시 `status = confirmed`
- [x] 확정 시 `confirmed_at is not null`
- [x] 확정 시 `confirmed_by = staff`
- [x] 확정 후 textarea 읽기 전용
- [x] 새 녹음 시작 시 편집 상태 초기화
- [x] 자동 제출·자동 처분 없음 확인

## PR #5 병합 후 Production 최종 회귀검증

- [x] PR #5 main 병합 완료
- [x] 병합 main SHA `32b510ad246916a168c9c7007cd527e8e22dd0b0`
- [x] Production 재배포 완료
- [x] 새 테스트 세션에서 STT 정상 동작
- [x] 민원 요지 v1 생성
- [x] 담당자 수정본 v2 저장
- [x] v1 `extractive / superseded / is_current=false`
- [x] v2 `staff / confirmed / is_current=true`
- [x] v2 `parent_draft_id` 존재 및 v1 참조
- [x] v2 `confirmed_at` 기록 확인
- [x] v2 `confirmed_by = staff` 확인
- [x] 기존 v1 이력 보존 확인

## 기준선 이후 원칙

- WAV STT 기준 태그는 `v0.1.0-stt-poc`입니다.
- STT + 민원 요지 기준 태그는 `v0.2.0-stt-summary`입니다.
- 담당자 수정·확정 기준 태그 권장값은 `v0.3.0-stt-draft-review`입니다.
- 기준선 이후 기능 변경은 `main`에 직접 반영하지 않고 별도 기능 브랜치에서 진행합니다.
- 비밀값은 Vercel 환경변수에서만 관리하고 Git 저장소에는 커밋하지 않습니다.
- 담당자 확정은 자동 제출·자동 처분을 의미하지 않습니다.
