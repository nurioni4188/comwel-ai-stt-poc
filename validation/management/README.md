# STT PoC 30건 실증검증 운영 패키지

이 폴더는 `v0.7.0-stt-classification-review` 이후 기능 추가 없이 실증검증을 진행하기 위한 관리 자산입니다.

## 포함 파일
- `validation-30.csv`: 30건 전체 진행관리표
- `interim-analysis-template.md`: 10건/20건/30건 중간분석 양식
- `final-poc-report-outline.md`: 최종 PoC 성과보고서 목차·작성틀

## 운영 순서
1. `validation/batch-01`의 1차 10건을 녹음·실행
2. 각 케이스 결과를 `validation-30.csv`에 기록
3. 10건 완료 후 `interim-analysis-template.md`로 중간분석
4. 중간결과에 따라 B02/B03의 조건·비중을 조정
5. 누적 30건 완료 후 최종 지표 집계
6. `final-poc-report-outline.md`를 기반으로 최종 성과보고서 작성

## 상태값 권고
- `planned`: 계획됨
- `recorded`: 녹음 완료
- `processed`: STT/AI 처리 완료
- `reviewed`: 품질평가·분류 검토 완료
- `failed`: 실패
- `excluded`: 분석 제외

## 원칙
- 자동처분·자격판단 목적으로 사용하지 않는다.
- 실제 민원인 개인정보가 포함된 음성은 별도 보안·개인정보 검토 전에는 검증셋에 넣지 않는다.
- 30건 미만 결과는 통계적 일반화보다 오류 패턴 탐색을 우선한다.
