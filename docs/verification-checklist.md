# WAV STT PoC 검증 체크리스트

## 정적 검증

- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] 저장소에 `.env.local`, `.vercel`, 실제 Secret 값이 포함되지 않음

## 로컬 기능 검증

- [ ] `vercel pull --yes --environment=development`
- [ ] `vercel dev`
- [ ] 녹음 시작 버튼이 즉시 녹음 중 상태로 전환됨
- [ ] 10초마다 WAV 청크 결과가 순서대로 표시됨
- [ ] 녹음 중지 시 마지막 10초 미만 청크가 전송됨
- [ ] CLOVA 400 파일 형식 오류가 발생하지 않음
- [ ] 오류 발생 시 화면에 상세 원인이 표시됨(Development만)

## Supabase 검증

- [ ] `call_sessions`에 세션 UUID가 한 건 생성됨
- [ ] `transcript_chunks.chunk_index`가 0부터 연속됨
- [ ] `(session_id, chunk_index)` 중복 행이 없음
- [ ] `audio_format = 'audio/wav'`
- [ ] `duration_ms`가 실제 청크 길이와 대체로 일치함
- [ ] 동일 청크 재전송 시 기존 행이 갱신됨

## 병합 전 조건

- [ ] Supabase 연결 권한으로 실제 DB 결과 확인
- [ ] 대표 녹음 3회 반복 검증
- [ ] 모바일 폭에서 결과 카드와 버튼 확인
- [ ] Draft PR 체크리스트와 실제 결과 일치
