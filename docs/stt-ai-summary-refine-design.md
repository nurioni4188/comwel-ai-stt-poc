# STT 생성형 AI 민원 요지 정제·구조화 설계

## 목적

기존 `complaint_summary_extractive_v1`를 안전한 1차 근거로 유지하면서, 생성형 AI가 STT 원문과 extractive 요지를 바탕으로 담당자 검토용 구조화 초안을 생성합니다.

AI 결과는 자동 제출·자동 처분에 사용하지 않으며, 항상 담당자 수정·확정 단계를 거칩니다.

## 처리 흐름

```text
STT 전체 원문
→ extractive v1
→ AI 정제·구조화 v2
→ 담당자 수정 v3
→ 담당자 확정
```

## API

### `POST /api/stt-summary-refine`

완료된 세션의 STT 원문과 현재 extractive 요지를 읽어 생성형 AI 정제본을 생성하고 `stt_poc.drafts`에 새 버전으로 저장합니다.

### 요청 본문

```json
{
  "sessionId": "uuid"
}
```

클라이언트가 STT 원문·기존 요지·버전번호·권한값을 임의로 보내는 구조는 사용하지 않습니다. 서버가 `sessionId`를 기준으로 DB에서 직접 조회합니다.

### 서버 입력 구성

서버는 다음 자료만 AI 입력으로 사용합니다.

1. `call_sessions.status = completed` 확인
2. `transcript_chunks`를 `chunk_index` 순서로 조립한 전체 STT 원문
3. 해당 세션의 현재 `complaint_summary_extractive_v1`
4. 시스템 안전 지침 및 JSON 출력 스키마

## AI 출력 JSON 스키마

```json
{
  "summary": "민원 요지 1~3문장",
  "requests": [
    "민원인이 명시적으로 요청하거나 문의한 사항"
  ],
  "key_facts": [
    "STT 원문에서 직접 확인 가능한 사실"
  ],
  "needs_confirmation": [
    "원문만으로 확정할 수 없어 담당자 확인이 필요한 사항"
  ]
}
```

### 필드 규칙

- `summary`: 원문의 핵심 문의·요청을 행정업무용 문장으로 정리합니다.
- `requests`: 원문에 실제로 나타난 요청·문의만 포함합니다.
- `key_facts`: 원문에 명시된 사실만 포함합니다.
- `needs_confirmation`: 원문에 없거나 불명확한 사항만 기재합니다.
- 해당 항목이 없으면 빈 배열 `[]`을 반환합니다.
- 모든 필드는 필수입니다.

## 금지 규칙

AI는 다음 내용을 새로 만들면 안 됩니다.

- 사건번호·접수번호·사업장관리번호
- 원문에 없는 날짜·금액·인원·직책
- 원문에 없는 신청·처분·결정 사실
- 법적 결론·수급 자격·승인 여부
- 기관의 최종 판단 또는 확정적 안내
- 원문에 없는 민원인의 의도·감정·동기

불확실한 내용은 추정하지 않고 `needs_confirmation`에 둡니다.

## 저장 규칙

AI 정제본은 기존 버전관리 구조를 그대로 사용합니다.

```text
v1  complaint_summary_extractive_v1
    source_type = extractive

v2  complaint_summary_ai_refined_v1
    source_type = ai
    status = draft
    is_current = true
    parent_draft_id = v1.id

v3  complaint_summary_staff_v1
    source_type = staff
    status = draft 또는 confirmed
```

AI 정제본 생성 시 이전 current 버전은 `superseded / is_current=false`로 전환합니다.

AI 정제본 자체는 `confirmed`가 될 수 없으며, 담당자 수정본을 거친 뒤에만 확정합니다.

## API 응답 예시

```json
{
  "ok": true,
  "draft": {
    "id": "uuid",
    "sessionId": "uuid",
    "draftType": "complaint_summary_ai_refined_v1",
    "versionNo": 2,
    "sourceType": "ai",
    "status": "draft",
    "isCurrent": true,
    "parentDraftId": "uuid",
    "structured": {
      "summary": "민원인은 고용보험 이직사유 정정 절차를 문의함.",
      "requests": ["이직사유 정정 가능 여부 및 절차 안내"],
      "key_facts": ["사업장에서 정정이 어렵다는 안내를 받았다고 진술함"],
      "needs_confirmation": ["현재 신고된 이직사유", "실제 이직 경위"]
    }
  }
}
```

## 오류 처리

- `400`: sessionId 누락·형식 오류
- `404`: 세션 또는 extractive 기준본 없음
- `409`: 세션이 completed 상태가 아님
- `422`: STT 원문이 비어 있거나 AI JSON 스키마 검증 실패
- `500`: AI 호출·DB 저장 실패

AI 응답이 JSON 스키마를 통과하지 못하면 DB에 저장하지 않습니다.

## UI 원칙

- `AI 정제본 생성` 버튼은 STT 완료 + extractive 초안 존재 시에만 활성화
- 생성 전후 결과를 구분해 표시
- AI 정제본임을 명확히 표시
- 담당자 수정 textarea에는 AI 정제본의 `summary`와 구조화 항목을 사람이 검토할 수 있는 형태로 전달
- AI 생성 실패 시 기존 extractive 요지는 그대로 보존
- 자동 제출·자동 처분 없음 안내 유지

## 검증 기준

- [ ] 완료된 새 테스트 세션에서 extractive v1 생성
- [ ] AI 정제 API가 고정 JSON 스키마로 응답
- [ ] 원문에 없는 사건번호·날짜·결론 생성 없음
- [ ] AI 정제본이 `source_type = ai`로 새 버전 저장
- [ ] 이전 extractive 버전이 `superseded / false`
- [ ] AI 버전이 `draft / true`
- [ ] `parent_draft_id`가 직전 버전을 참조
- [ ] AI 실패 시 기존 draft 상태 보존
- [ ] 담당자 수정본 저장 시 다음 버전 생성
- [ ] 담당자 확정 흐름 회귀 없음
- [ ] 새 녹음 시작 시 AI 정제 화면 상태 초기화
- [ ] `npm run build`
- [ ] `npm run lint`

## 이번 단계에서 하지 않는 것

- 업무유형 자동 확정
- 법령·판례 자동 검색
- 답변서 자동 작성
- 자동 제출·자동 처분
- AI 결과의 자동 확정
