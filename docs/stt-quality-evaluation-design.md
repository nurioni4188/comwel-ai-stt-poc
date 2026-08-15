# STT 품질평가 설계 — v0.5.0

## 목표

v0.4.x에서 검증한 `STT → extractive v1 → AI refined v2 → staff v3 → confirmed` 흐름에 담당자 품질평가 데이터를 추가한다.

v0.5.0은 다음 질문에 답할 수 있는 평가 기반을 만드는 버전이다.

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

- `accurate`: 정확 — 수정 없이 그대로 사용 가능
- `minor_edit`: 경미한 수정 — 표현·문구 수준의 소폭 수정 필요
- `major_edit`: 상당한 수정 — 핵심 내용 또는 구조 수정 필요
- `unusable`: 사용 불가 — 업무 활용이 곤란한 수준

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

```text
call_sessions.id
  └─ draft_evaluations.session_id
       ├─ ai_draft_id    → drafts.id (source_type = ai)
       └─ staff_draft_id → drafts.id (confirmed staff)
```

세션별 unique index를 사용하며 `save_quality_evaluation` RPC는 `ON CONFLICT(session_id) DO UPDATE`로 재평가를 upsert한다.

## 보안·운영 원칙

- 브라우저에서 Supabase에 직접 평가 데이터를 쓰지 않는다.
- Vercel API 서버가 service role로만 RPC를 호출한다.
- `public`, `anon`, `authenticated`에는 테이블·RPC 권한을 부여하지 않는다.
- 자동 제출·자동 처분·자동 확정 기능은 추가하지 않는다.
- 평가 데이터는 AI 품질 검증용이며 인사평가 자료로 자동 전환하지 않는다.

## v0.5.0 기준선 검증

- [x] `draft_evaluations` 테이블 존재 및 컬럼 확인
- [x] `save_quality_evaluation` RPC 존재
- [x] AI 정제본 + 담당자 확정본 조건을 RPC/API에서 검사
- [x] 전체평가 4단계 지원
- [x] 오류유형 복수 선택 지원
- [x] 평가 메모 지원
- [x] edit distance / edit ratio 자동 계산 구현
- [x] review duration 자동 계산 구현
- [x] 동일 세션 재평가 upsert 검증 — 두 번째 저장 후 행 수 1건 유지 및 값 갱신 확인
- [x] upsert 검증은 트랜잭션 `ROLLBACK`으로 운영 데이터 비변경 확인
- [x] 담당자 품질평가 UI/API 연결
- [x] 모바일 대응 평가 UI 스타일 추가

## 기준선 이후 운영 검증

- [ ] 30건 이상 담당자 평가 데이터 축적
- [ ] 전체평가 분포 및 오류유형 빈도 분석
- [ ] `edit_ratio`, 검토시간과 담당자 평가 간 관계 검토
- [ ] raw STT 정답문 데이터 확보 시 WER/CER 지표 추가 검토

## 이후 단계

충분한 평가 데이터가 축적되면 다음 버전에서 품질 대시보드, 민원유형·쟁점 자동분류 또는 모델 비교를 검토한다. 모델 변경 전후 성능은 v0.5.0 평가 데이터 구조를 공통 기준으로 비교한다.
