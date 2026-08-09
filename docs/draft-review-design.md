# 담당자 수정·확정 및 버전관리 설계

## 목표

`v0.2.0-stt-summary` 이후 단계에서 민원 요지 초안을 담당자가 직접 수정하고 새 버전으로 저장한 뒤 확정할 수 있도록 합니다. 자동 제출·자동 처분은 포함하지 않습니다.

## 현재 drafts 구조의 한계

기존 `stt_poc.drafts`는 다음 컬럼만 가집니다.

- `id`
- `session_id`
- `draft_type`
- `content`
- `created_at`
- `updated_at`

이 구조는 최신 초안 저장에는 충분하지만 담당자 수정 이력, 현재 버전, 확정 상태, 부모 버전을 명시적으로 표현하기 어렵습니다.

## 확장 컬럼

- `version_no integer not null`
- `source_type text not null`
  - `extractive`
  - `staff`
  - 향후 `generative_ai`
- `status text not null`
  - `draft`
  - `confirmed`
  - `superseded`
- `is_current boolean not null`
- `parent_draft_id uuid null`
- `confirmed_at timestamptz null`
- `confirmed_by text null`

세션별 `version_no`는 유일해야 하고, `is_current = true`인 행은 최대 1건만 허용합니다.

## 버전 흐름

```text
extractive v1
→ 담당자 편집
→ 수정본 저장
→ 기존 current = superseded / is_current = false
→ 새 staff 버전 = draft / is_current = true
→ 담당자 확정
→ current 버전 = confirmed / confirmed_at 기록
```

확정 후에도 이전 버전은 삭제하지 않습니다.

## DB migration

`supabase/migrations/20260809_draft_review_versioning.sql`

- 기존 drafts 데이터 backfill
- 버전/상태/현재버전 컬럼 추가
- 세션별 버전 유일 인덱스
- 세션별 현재 버전 1건 partial unique index
- `save_staff_draft` RPC
- `confirm_current_draft` RPC
- RPC는 `service_role`만 실행 가능

Production DB에는 Draft PR 검증 전에 직접 적용하지 않습니다.

## API

### `/api/stt-draft-save`

입력:

```json
{
  "sessionId": "uuid",
  "content": "담당자가 수정한 민원 요지"
}
```

처리:

1. UUID와 빈 내용/길이 검증
2. `stt_poc.save_staff_draft` RPC 호출
3. 기존 current 버전을 superseded 처리
4. 새 `complaint_summary_staff_v1` 버전 생성
5. 새 버전을 current로 유지

### `/api/stt-draft-confirm`

입력:

```json
{
  "sessionId": "uuid"
}
```

처리:

1. 현재 버전 조회 및 잠금
2. `status = confirmed`
3. `confirmed_at` 기록
4. `confirmed_by` 기록
5. `is_current = true` 유지

## 기존 extractive 요지와의 호환

`/api/stt-summary`도 버전 컬럼을 인식하도록 보정합니다.

- 최초 extractive 요지는 `version_no = 1`, `source_type = extractive`, `status = draft`, `is_current = true`
- 기존 extractive 요지가 있으면 같은 extractive 행의 내용만 갱신
- 담당자 확정된 extractive 행은 재생성으로 덮어쓰지 않음
- 이미 다른 current 버전이 있는 예외 상황에서는 새 extractive 행을 current로 만들지 않음

## UI

`TestCallPage.tsx`에 다음을 추가합니다.

- 민원 요지 편집 textarea
- `수정본 저장`
- `담당자 확정`
- 대기 / 초안 생성 / 수정본 저장 / 확정 상태 배지
- 확정 후 textarea 읽기 전용
- 새 녹음/결과 초기화 시 편집 및 상태 초기화
- 자동 제출·자동 처분 없음 안내

## 검증 항목

- [ ] Production 실제 `drafts` 스키마 재확인
- [ ] migration을 비운영/개발 DB에 먼저 적용
- [ ] 기존 drafts backfill 검증
- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] 기존 extractive 요지 생성 회귀 없음
- [ ] 수정 저장 시 `version_no` 증가
- [ ] 이전 버전 `superseded` 및 보존
- [ ] 세션별 `is_current = true` 1건
- [ ] 확정 시 `status = confirmed`
- [ ] `confirmed_at is not null`
- [ ] 새 녹음 시작 시 편집 상태 초기화
- [ ] 확정 후 자동 제출/처분이 발생하지 않음
