# 담당자 수정·확정 및 버전관리 설계

## 목적

`v0.2.0-stt-summary` 기준선 이후 단계로, 원문 기반 민원 요지 초안을 담당자가 수정하고 확정할 수 있는 흐름을 설계합니다.

현재 `stt_poc.drafts`는 다음 구조입니다.

```text
id uuid PK
session_id uuid FK -> stt_poc.call_sessions(id)
draft_type text
content text
created_at timestamptz
updated_at timestamptz
```

현재 구조는 최신 초안 1건을 저장·갱신하는 데는 충분하지만, 담당자 수정 이력과 확정 이력을 보존하기에는 부족합니다.

## 설계 원칙

1. AI/extractive 초안과 담당자 수정본을 구분합니다.
2. 수정 시 기존 초안을 덮어쓰지 않고 새 버전을 생성합니다.
3. 한 세션에서 현재 버전은 1건만 유지합니다.
4. 확정은 자동 제출·자동 처분을 의미하지 않습니다.
5. 확정 후에도 이전 버전은 삭제하지 않습니다.
6. STT 원문, 생성 초안, 담당자 수정본 간 추적 가능성을 유지합니다.

## 권장 drafts 확장 컬럼

```text
version_no integer not null
source_type text not null
status text not null
is_current boolean not null default true
parent_draft_id uuid null
confirmed_at timestamptz null
confirmed_by text null
```

### 권장 값

`source_type`

- `extractive`
- `staff`
- 향후 `generative_ai`

`status`

- `draft`
- `confirmed`
- `superseded`

## 버전 흐름

```text
v1
source_type = extractive
status = draft
is_current = true

담당자 수정 저장
    ↓

v1
status = superseded
is_current = false

v2
source_type = staff
status = draft
is_current = true
parent_draft_id = v1.id

담당자 확정
    ↓

v2
status = confirmed
is_current = true
confirmed_at 기록
```

동일 세션에서 추가 수정이 필요하면 확정본을 직접 덮어쓰지 않고 새 버전을 생성하는 것을 기본 원칙으로 합니다.

## DB 제약 권장안

- `version_no >= 1`
- `(session_id, version_no)` unique
- 세션별 `is_current = true`는 최대 1건
- `status = confirmed`인 경우 `confirmed_at is not null`

부분 unique index 예시:

```sql
create unique index drafts_one_current_per_session_idx
  on stt_poc.drafts(session_id)
  where is_current = true;
```

## API 설계

### `POST /api/stt-draft-save`

역할: 현재 요지를 담당자 수정본으로 새 버전 저장

입력:

```json
{
  "sessionId": "uuid",
  "content": "담당자 수정 내용"
}
```

검증:

- 세션 존재
- 세션 `completed`
- `content.trim()` 비어 있지 않음
- 현재 draft 존재

처리:

- 현재 draft를 `superseded`, `is_current = false`
- `version_no + 1`로 새 staff draft 생성
- `parent_draft_id`에 직전 draft id 기록

### `POST /api/stt-draft-confirm`

역할: 현재 담당자 수정본을 확정 상태로 변경

입력:

```json
{
  "sessionId": "uuid"
}
```

검증:

- 현재 draft 존재
- `source_type = staff`
- 빈 content 금지

처리:

- `status = confirmed`
- `confirmed_at = now()`
- 자동 제출·외부 전송 없음

## 화면 설계

현재 `민원 요지 초안` 영역을 다음과 같이 변경합니다.

```text
민원 요지 초안
[버전 v1 / 원문 기반 extractive]

[편집 가능한 textarea]

[수정본 저장] [담당자 확정]

상태: 초안 / 확정
```

동작 원칙:

- extractive 초안 생성 후 textarea 편집 허용
- 내용 변경 전에는 `수정본 저장` 비활성화 가능
- 저장 성공 시 새 버전 번호 표시
- 확정 후 `confirmed` 배지 표시
- 확정 후에도 원문과 이전 버전 조회 가능하도록 확장 가능

## 이번 Draft PR 범위

이번 PR은 설계 및 안전한 기반 구현을 목표로 합니다.

- drafts 스키마 확장안 반영
- 담당자 수정본 저장 API
- 담당자 확정 API
- UI 편집·저장·확정 상태
- 버전 이력 보존
- 자동 제출·자동 처분 없음

## 병합 전 검증 기준

- `npm run build`
- `npm run lint`
- 기존 `complaint_summary_extractive_v1` 생성 회귀 없음
- 담당자 수정 저장 시 새 버전 생성
- 동일 세션 `(session_id, version_no)` 중복 없음
- 이전 버전 `superseded` 보존
- 현재 버전 1건만 `is_current = true`
- 확정 시 `status = confirmed`, `confirmed_at` 기록
- 새 녹음 시작 시 이전 편집 상태 제거
- Production 반영 전 Supabase 스키마 검증

## 현재 스키마 점검 결과

GitHub 기준 `supabase/call_sessions_schema.sql`의 `drafts`는 `id`, `session_id`, `draft_type`, `content`, `created_at`, `updated_at`만 보유하고 있어 버전·상태·확정 이력을 직접 표현하지 못합니다.

Supabase Production 실제 스키마 조회도 시도했으나 현재 연결 권한으로는 SQL 실행 권한이 없어 확인하지 못했습니다. 따라서 실제 DDL 적용 전 Production 스키마 재확인이 필요합니다.
