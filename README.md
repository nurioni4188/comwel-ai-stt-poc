# COMWEL AI STT PoC

브라우저 마이크 음성을 10초 단위 WAV 청크로 변환하고, CLOVA Speech 단문 인식 결과를 Supabase에 저장하는 독립 PoC입니다.

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
→ STT 원문 기반 민원 요지 초안
→ stt_poc.drafts 저장
→ 담당자 검토
```

## 민원 요지 초안 — extractive v1

현재 단계는 생성형 모델을 바로 연결하지 않고, 완료된 세션의 STT 원문 중 요청·문의와 관련된 문장을 서버에서 추출해 담당자 검토용 요지 초안으로 저장합니다.

- 세션이 `completed`인 경우에만 생성
- `transcript_chunks`를 `chunk_index` 순서로 조회
- STT 원문에 없는 사실·사건번호·결론을 새로 만들지 않음
- 결과는 `draft_type = complaint_summary_extractive_v1`로 `stt_poc.drafts`에 저장
- 같은 세션에서 다시 생성하면 기존 최신 초안을 갱신
- 화면에서 전체 통화 인식문과 요지 초안을 분리 표시
- 빈 STT에서는 요지 생성 버튼을 비활성화
- 새 녹음 시작 시 이전 요지 화면 상태를 초기화

이 단계의 목적은 STT → 세션 종료 → 요지 생성 → drafts 저장 흐름을 먼저 안정화하는 것입니다. 생성형 AI 기반 재작성·분류·답변 초안은 이 흐름 검증 후 별도 단계에서 연결합니다.

## 보안 원칙

- `SUPABASE_SERVICE_ROLE_KEY`와 `CLOVA_SPEECH_SECRET`은 서버 전용입니다.
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
```

로컬에서는 Vercel 환경변수를 내려받은 뒤 실행합니다.

```powershell
vercel pull --yes --environment=development
vercel dev
```

## 데이터베이스

Supabase SQL Editor에서 다음 스크립트를 적용합니다.

```text
supabase/call_sessions_schema.sql
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
9. 완료된 세션에서 민원 요지 초안을 생성할 수 있어야 합니다.
10. 생성된 요지가 `stt_poc.drafts`에 저장되어야 합니다.

## Production 검증 기준선

### v0.1.0 — WAV STT 기준선

2026-08-09 기준 Production 배포와 실제 마이크 녹음을 완료했습니다.

- 기준 main SHA: `ee6d206`
- 기준 태그: `v0.1.0-stt-poc`
- Production URL: `https://comwel-ai-stt-poc.vercel.app`
- 실제 녹음에서 10초 단위 WAV 청크 STT 결과 표시 확인
- 검증 세션: `fcbc1819-f89b-4c52-94b3-fb6eab732531`
- 해당 세션 `status = completed`, `ended_at` 기록 확인
- `chunk_index` 0부터 연속 저장 확인
- 검사 청크 `audio_format = audio/wav` 확인

### v0.2.0 후보 — STT + 민원 요지 초안 기준선

PR #3 병합 후 main `3491d9c`를 Production에 배포하고 회귀검증을 완료했습니다.

- 기준 main SHA: `3491d9c`
- Production URL: `https://comwel-ai-stt-poc.vercel.app`
- Production 실제 녹음 및 STT 정상 동작 확인
- 민원 요지 초안 생성 정상 동작 확인
- Production 검증 세션: `dd32ce90-47cd-44d4-8a45-062eb9fdf306`
- 검증 세션 `status = completed`, `ended_at` 기록 확인
- `stt_poc.drafts` 저장 확인
- `draft_type = complaint_summary_extractive_v1` 확인
- 동일 세션 재생성 시 불필요한 중복 draft가 늘지 않는 구조 확인
- 새 녹음 시작 시 이전 요지 초기화 확인
- 빈 STT에서는 요지 생성 버튼 비활성화 확인

권장 태그는 `v0.2.0-stt-summary`입니다. 태그 생성 전에는 이 SHA를 검증 완료 기준점으로 유지합니다.

## 현재 범위

- 직원 시범 검증용 독립 PoC
- 자동 민원 등록·자동 처분 기능 없음
- 녹음 원본 파일은 Supabase에 저장하지 않음
- 민원 요지 초안은 담당자 검토용이며 자동 제출하지 않음
- 운영 활성화 전 별도 개인정보·보존기간·접근통제 검토 필요
