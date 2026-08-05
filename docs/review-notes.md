# 코드 점검 메모

## 보완한 항목

1. WAV MIME 형식과 RIFF/WAVE 헤더 검증
2. 요청 크기 2 MiB 제한
3. session UUID·청크 번호·시간값 검증
4. 세션과 청크 저장을 upsert로 변경해 재전송 중복 방지
5. Production에서 내부 오류 상세 비노출 유지
6. 청크 번호와 시간 표시 분리
7. 녹음·처리·성공·실패 상태 표시
8. 반응형 결과 카드 UI
9. 실제 Secret 값이 없는 `.env.example` 추가
10. 독립 PoC 실행·보안·DB 검증 절차 문서화

## 병합 전 미확인 항목

- 현재 GitHub 연결에서는 로컬 명령을 실행할 수 없어 브랜치의 `npm run build`와 `npm run lint` 결과는 아직 확인하지 못함
- Supabase 플러그인에 `comwel-ai-stt-poc` 프로젝트 권한이 없어 실제 행 저장 결과는 아직 확인하지 못함
- CLOVA Speech와 실제 마이크를 사용하는 런타임 검증은 누리온님 로컬 Development 환경에서 필요

위 항목이 완료될 때까지 PR은 Draft로 유지합니다.
