# STT 품질평가 설계 — v0.5.0

## 목표

v0.4.0에서 검증한 `STT → extractive v1 → AI refined v2 → staff v3 → confirmed` 흐름에 담당자 품질평가 데이터를 추가한다.

v0.5.0의 목적은 기능 확장이 아니라 다음 질문을 수치로 답할 수 있게 만드는 것이다.

- AI 정제본이 실제 업무에서 어느 정도 수정 없이 사용 가능한가?
- 어떤 오류가 가장 자주 발생하는가?
- AI 정제본과 담당자 최종본의 차이는 어느 정도인가?
- 담당자가 검토·확정하는 데 얼마나 시간이 걸리는가?

## 평가 단위

평가는 `session_id`당 1건을 기본으로 한다. 같은 세션을 재평가하면 기존 평가 행을 갱신한다.

평가 저장 조건:

1. AI 정제본(`source_type = ai`)이 존재할 것
2. 현재 담당자 확정본(`source_type = staff`, `status = confirmed`, `is_current = true`)이 존재할 것
3. AI 정제본 자체는 평가 확정본으로 취급하지 않을 것

## 담당자 입력 항목

### 전체 평가

- `accurate`: 정확 — 실무상 수정 불필요 또는 의미 없는 표기 수정만 존재
- `minor_edit`: 경미한 수정 — 의미는 정확하나 표현·구조·일부 세부사항 수정 필요
- `major_edit`: 상당한 수정 — 핵심내용은 일부 사용 가능하나 중요한 보완 필요
- `unusable`: 사용 불가 — 핵심 사실·요청을 신뢰하기 어려워 재작성 필요

### 오류 유형

복수 선택 가능:

- 중요 사실 누락 `fact_omission`
- 사실 왜곡 `fact_distortion`
- 원문에 없는 사실 생성 `hallucination`
- 요청·문의 누락 `request_omission`
- 추가 확인 필요사항 누락 `confirmation_omission`
- STT 인식 오류 영향 `stt_error_impact`
- 기타 `other_issue`

### 담당자 메모

최대 2,000자. 평가 근거 또는 대표 오류를 기록한다. 개인정보를 새로 입력하는 용도로 사용하지 않는다.

## 자동 산출 지표

`POST /api/stt-quality-evaluation`에서 서버가 계산한다.

- `edit_distance`: AI 정제본과 담당자 확정본의 Levenshtein 거리
- `edit_ratio`: `edit_distance / max(ai_char_count, staff_char_count, 1)`
- `ai_char_count`
- `staff_char_count`
- `review_duration_ms`: AI 정제본의 `updated_at`부터 담당자 확정본의 `confirmed_at`까지
- `model_name`: `OPENAI_MODEL`
- `schema_version = quality_evaluation_v1`

`edit_ratio`는 품질 자체를 단독 판정하는 점수가 아니라 담당자 수정량을 비교하기 위한 보조지표로 사용한다.

## 데이터 모델

테이블: `stt_poc.draft_evaluations`

핵심 연결:

```text
call_sessions.id
  └─ draft_evaluations.session_id
       ├─ ai_draft_id    → drafts.id (source_type = ai)
       └─ staff_draft_id → drafts.id (confirmed staff)
```

세션별 1행 unique index를 사용해 재평가 시 update한다.

## 보안·운영 원칙

- 브라우저에서 Supabase에 직접 평가 데이터를 쓰지 않는다.
- API 서버가 service role로만 RPC를 호출한다.
- `public`, `anon`, `authenticated`에는 테이블·RPC 권한을 부여하지 않는다.
- 자동 제출·자동 처분·자동 확정 기능은 추가하지 않는다.
- 평가 데이터는 AI 품질 검증용이며 인사평가 자료로 자동 전환하지 않는다.

## v0.5.0 검증 기준

최소 기능 완료 기준:

- [ ] migration 적용 후 `draft_evaluations` 생성
- [ ] `save_quality_evaluation` RPC 존재
- [ ] 확정 전 평가 저장 차단
- [ ] AI 정제본이 없는 세션 평가 차단
- [ ] 전체평가 4단계 저장
- [ ] 오류유형 복수 선택 저장
- [ ] 평가 메모 저장
- [ ] edit distance / edit ratio 자동 계산
- [ ] review duration 자동 계산
- [ ] 동일 세션 재평가 시 중복행 없이 갱신
- [ ] 담당자 평가 UI 추가
- [ ] 30건 이상 평가 데이터 축적 후 기초 통계 검토

## 이후 단계

v0.5.0에서 평가 데이터가 충분히 축적된 뒤 v0.6.0에서 민원유형·쟁점 자동분류를 추가한다. 분류 모델 변경 전후의 성능은 v0.5.0 품질지표를 기준선으로 비교한다.
