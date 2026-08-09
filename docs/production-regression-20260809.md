# Production 최종 회귀검증 기록 — 2026-08-09

기준 기능: 담당자 수정·확정 버전관리 흐름

검증 기준 main SHA: `32b510ad246916a168c9c7007cd527e8e22dd0b0`

검증 흐름:

`STT → complaint_summary_extractive_v1(v1) → 담당자 수정 → complaint_summary_staff_v1(v2) → 담당자 확정`

확인 결과:

- v1 `source_type = extractive`
- v1 `status = superseded`
- v1 `is_current = false`
- v2 `source_type = staff`
- v2 `status = confirmed`
- v2 `is_current = true`
- v2 `parent_draft_id`가 v1을 참조
- v2 `confirmed_at` 기록 확인
- v2 `confirmed_by = staff`
- 이전 버전 삭제 없음
- 자동 제출·자동 처분 없음

권장 기준 태그: `v0.3.0-stt-draft-review`
