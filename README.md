# COMWEL AI STT PoC

브라우저 마이크 음성을 10초 단위 WAV 청크로 변환하고, CLOVA Speech 단문 인식 결과를 Supabase에 저장한 뒤 민원 요지 초안·생성형 AI 정제·담당자 수정·확정까지 연결하는 독립 PoC입니다.

## 처리 흐름

```text
마이크 입력
→ Web Audio API PCM 수집
→ 16kHz·mono·16-bit WAV 생성
→ /api/stt-ingest
→ CLOVA Speech 단문 인식
→ stt_poc.call_sessions / transcript_chunks 저장
→ 녹음 종료 및 세션 completed
→ /api/stt-summary
→ STT 원문 기반 민원 요지 초안 v1 (extractive)
→ /api/stt-summary-refine
→ 생성형 AI 정제본 v2 (ai)
→ 담당자 수정
→ 수정본 v3 저장 (staff)
→ 담당자 확정
→ 이전 버전 superseded 보존 / 현재 버전 confirmed 유지
```

## 민원 요지 초안 — extractive v1

완료된 세션의 STT 원문 중 요청·문의와 관련된 문장을 서버에서 추출해 담당자 검토용 1차 요지로 저장합니다.

- 세션이 `completed`인 경우에만 생성
- `transcript_chunks`를 `chunk_index` 순서로 조회
- STT 원문에 없는 사실·사건번호·결론을 새로 만들지 않음
- 결과는 `draft_type = complaint_summary_extractive_v1`로 `stt_poc.drafts`에 저장
- 화면에서 전체 통화 인식문과 요지 초안을 분리 표시
- 빈 STT에서는 요지 생성 버튼을 비활성화
- 새 녹음 시작 시 이전 요지 화면 상태를 초기화

## 생성형 AI 민원 요지 정제 — ai refined v1

기존 extractive 요지와 STT 원문을 기반으로 생성형 AI가 담당자 검토용 구조화 초안을 만듭니다.

- `POST /api/stt-summary-refine`
- 구조화 출력: `summary`, `requests`, `key_facts`, `needs_confirmation`
- 서버 측 JSON 스키마 검증 후에만 저장
- `draft_type = complaint_summary_ai_refined_v1`
- `source_type = ai`
- 이전 current 버전은 `superseded`로 보존
- AI 결과는 직접 확정할 수 없음
- 불확실한 내용은 `needs_confirmation`으로 분리
- 자동 제출·자동 처분·자동 확정 없음

## 담당자 수정·확정 — draft review

AI 정제본 또는 원문 기반 초안 생성 후 담당자가 직접 수정·저장·확정할 수 있습니다.

- v1: `source_type = extractive`
- v2: `source_type = ai`
- v3: `source_type = staff`
- 새 버전 저장 시 이전 버전은 삭제하지 않고 `status = superseded`, `is_current = false`로 보존
- 최신 담당자 수정본은 `is_current = true`
- 담당자 확정 시 `status = confirmed`
- 확정 시 `confirmed_at`, `confirmed_by` 기록
- 각 새 버전은 `parent_draft_id`로 직전 버전을 참조
- 확정 후 textarea는 읽기 전용
- 담당자 확정은 자동 제출·자동 처분을 의미하지 않음

## 보안 원칙

- `SUPABASE_SERVICE_ROLE_KEY`, `CLOVA_SPEECH_SECRET`, `OPENAI_API_KEY`는 서버 전용입니다.
- 비밀값을 `VITE_*` 환경변수, React 코드, Git 커밋에 넣지 않습니다.
- `.env`, `.env.*`, `.vercel`, `node_modules`, `dist`는 Git에서 제외합니다.
- `stt_poc` 스키마는 `anon`, `authenticated` 접근을 철회하고 `service_role`만 사용합니다.

## 환경변수

`.env.example`을 참고해 Vercel Development 및 Production 환경에 아래 값을 등록합니다.

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CLOVA_SPEECH_INVOKE_URL
CLOVA_SPEECH_SECRET
OPENAI_API_KEY
OPENAI_MODEL
```

로컬에서는 Vercel 환경변수를 내려받은 뒤 실행합니다.

```powershell
vercel pull --yes --environment=development
vercel dev
```

## 데이터베이스

Supabase SQL Editor에서 기본 스키마를 적용합니다.

```text
supabase/call_sessions_schema.sql
```

담당자 수정·확정 버전관리 기능은 다음 migration을 사용합니다.

```text
supabase/migrations/20260809_draft_review_versioning.sql
```

생성형 AI 정제 기능은 다음 migration을 추가 적용합니다.

```text
supabase/migrations/20260809_ai_summary_refine.sql
```

Data API에서 `stt_poc` 스키마가 노출되어 있어야 서버의 Supabase 클라이언트가 해당 스키마를 사용할 수 있습니다. 브라우저 공개 접근은 허용하지 않습니다.

## 개발 명령

```bash
npm install
npm run build
npm run lint
vercel dev
```

## 수동 검증 기준

1. 녹음 시작 후 10초마다 청크가 한 건씩 표시됩니다.
2. 각 청크의 시간이 `0.0초 → 10.0초`처럼 연속으로 표시됩니다.
3. 마지막 10초 미만 음성도 녹음 중지 시 전송됩니다.
4. PowerShell 로그에 `audio/webm;codecs=opus` 또는 CLOVA 파일 형식 400 오류가 없어야 합니다.
5. Supabase `transcript_chunks`의 `chunk_index`가 0부터 연속이고 중복되지 않아야 합니다.
6. `audio_format`은 `audio/wav`로 저장되어야 합니다.
7. 같은 청크가 재전송되면 `(session_id, chunk_index)` 기준으로 갱신되어 중복 행이 생기지 않아야 합니다.
8. 녹음 종료 후 `call_sessions.status = completed`, `ended_at`이 기록되어야 합니다.
9. 완료된 세션에서 민원 요지 초안 v1을 생성할 수 있어야 합니다.
10. AI 정제본 v2가 생성되고 v1은 이력으로 보존되어야 합니다.
11. 담당자 수정본 v3가 새 버전으로 저장되고 v2는 이력으로 보존되어야 합니다.
12. 담당자 확정 시 v3가 `confirmed`, `is_current = true`로 유지되어야 합니다.
13. `confirmed_at`, `confirmed_by = staff`가 기록되어야 합니다.
14. AI 정제본은 직접 확정되지 않아야 합니다.
15. 같은 세션에서 AI 정제를 다시 요청해도 불필요한 중복 AI 버전이 생성되지 않아야 합니다.

## Production 검증 기준선

### v0.1.0 — WAV STT 기준선

2026-08-09 기준 Production 배포와 실제 마이크 녹음을 완료했습니다.

- 기준 main SHA: `ee6d206`
- 기준 태그: `v0.1.0-stt-poc`
- Production URL: `https://comwel-ai-stt-poc.vercel.app`

### v0.2.0 — STT + 민원 요지 초안 기준선

PR #3 병합 후 main `3491d9c`를 Production에 배포하고 회귀검증을 완료했습니다.

- 기준 main SHA: `3491d9c`
- 기준 태그: `v0.2.0-stt-summary`
- Production URL: `https://comwel-ai-stt-poc.vercel.app`

### v0.3.0 — 담당자 수정·확정 기준선

PR #5 병합 후 main `32b510ad246916a168c9c7007cd527e8e22dd0b0`를 Production에 재배포하고 회귀검증을 완료했습니다.

- 기준 main SHA: `32b510ad246916a168c9c7007cd527e8e22dd0b0`
- 기준 태그: `v0.3.0-stt-draft-review`
- Production URL: `https://comwel-ai-stt-poc.vercel.app`
- Production 실제 녹음 → STT → 요지 v1 → 수정본 v2 → 담당자 확정 흐름 확인

### v0.4.0 — 생성형 AI 민원 요지 정제 기준선

PR #7 병합 후 main `d2c1797f00c1d6d41ed8f5f150a0fa4e25c1624e`를 Production에 재배포하고 새 세션으로 최종 회귀검증을 완료했습니다.

- 기준 main SHA: `d2c1797f00c1d6d41ed8f5f150a0fa4e25c1624e`
- 기준 태그 예정: `v0.4.0-stt-ai-summary-refine`
- Production URL: `https://comwel-ai-stt-poc.vercel.app`
- Production 실제 녹음 및 STT 정상 동작 확인
- v1: `complaint_summary_extractive_v1`, `source_type = extractive`, `status = superseded`, `is_current = false`
- v2: `complaint_summary_ai_refined_v1`, `source_type = ai`, `status = superseded`, `is_current = false`
- v3: `complaint_summary_staff_v1`, `source_type = staff`, `status = confirmed`, `is_current = true`
- v2 `parent_draft_id`가 v1을 참조하고 v3 `parent_draft_id`가 v2를 참조하는 흐름 확인
- v3 `confirmed_at` 기록 확인
- v3 `confirmed_by = staff` 확인
- AI 정제본 직접 확정 방지 확인
- 같은 세션 AI 정제 재실행 시 불필요한 추가 AI 버전이 생성되지 않음 확인
- 자동 제출·자동 처분·자동 확정 없음 유지

## 현재 범위

- 직원 시범 검증용 독립 PoC
- 자동 민원 등록·자동 처분 기능 없음
- 녹음 원본 파일은 Supabase에 저장하지 않음
- 민원 요지 초안·AI 정제본·담당자 확정본은 내부 검토용이며 자동 제출하지 않음
- 운영 활성화 전 별도 개인정보·보존기간·접근통제 검토 필요
