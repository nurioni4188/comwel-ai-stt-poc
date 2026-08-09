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
```

## 보안 원칙

- `SUPABASE_SERVICE_ROLE_KEY`와 `CLOVA_SPEECH_SECRET`은 서버 전용입니다.
- 비밀값을 `VITE_*` 환경변수, React 코드, Git 커밋에 넣지 않습니다.
- `.env`, `.env.*`, `.vercel`, `node_modules`, `dist`는 Git에서 제외합니다.
- `stt_poc` 스키마는 `anon`, `authenticated` 접근을 철회하고 `service_role`만 사용합니다.

## 환경변수

`.env.example`을 참고해 Vercel Development 환경에 아래 값을 등록합니다.

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

검증 SQL 예시:

```sql
select
  session_id,
  chunk_index,
  transcript,
  audio_format,
  duration_ms,
  created_at
from stt_poc.transcript_chunks
where session_id = '<검증할 UUID>'
order by chunk_index;
```

## 현재 범위

- 직원 시범 검증용 독립 PoC
- 자동 민원 등록·자동 처분 기능 없음
- 녹음 원본 파일은 Supabase에 저장하지 않음
- 운영 활성화 전 별도 개인정보·보존기간·접근통제 검토 필요
