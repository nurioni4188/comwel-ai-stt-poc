// src/pages/TestCallPage.tsx

import { useCallRecorder } from '../hooks/useCallRecorder';

export default function TestCallPage() {
  const {
    sessionId,
    isRecording,
    isSending,
    error,
    chunks,
    cumulativeText,
    startRecording,
    stopRecording,
    resetRecording,
  } = useCallRecorder();

  const completedCount = chunks.filter(
    (chunk) => chunk.status === 'success'
  ).length;
  const failedCount = chunks.filter(
    (chunk) => chunk.status === 'error'
  ).length;

  const handleRecordingClick = async () => {
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (clickError) {
      console.error('[TestCallPage] recording button failed:', clickError);
    }
  };

  return (
    <main className="stt-page">
      <section className="stt-card" aria-labelledby="stt-title">
        <header className="page-header">
          <p className="eyebrow">COMWEL AI STT PoC</p>
          <h1 id="stt-title">STT 흐름 테스트</h1>
          <p className="page-description">
            마이크 음성을 10초 단위 WAV 청크로 변환해 인식 결과를 확인합니다.
          </p>
          <code className="session-id">session: {sessionId}</code>
        </header>

        <div className="recording-controls">
          <button
            type="button"
            className={
              isRecording ? 'record-button recording' : 'record-button'
            }
            onClick={() => void handleRecordingClick()}
            aria-pressed={isRecording}
          >
            {isRecording
              ? '녹음 중지'
              : '녹음 시작 (마이크에 대고 말하기)'}
          </button>

          <div className="status-row" aria-live="polite">
            <span className={`status-badge ${isRecording ? 'active' : ''}`}>
              {isRecording ? '● 녹음 중' : '대기'}
            </span>
            {isSending && (
              <span className="status-badge sending">STT 처리 중</span>
            )}
            {completedCount > 0 && (
              <span className="status-badge success">
                완료 {completedCount}건
              </span>
            )}
            {failedCount > 0 && (
              <span className="status-badge error">실패 {failedCount}건</span>
            )}
          </div>
        </div>

        {error && (
          <div className="error-message" role="alert">
            <strong>처리 오류</strong>
            <span>{error}</span>
          </div>
        )}

        <section className="result-section" aria-labelledby="chunk-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">실시간 변환</p>
              <h2 id="chunk-title">청크별 STT 결과</h2>
            </div>
            <span className="section-meta">10초 단위</span>
          </div>

          {chunks.length === 0 ? (
            <div className="empty-result">
              녹음을 시작하면 첫 번째 결과가 여기에 표시됩니다.
            </div>
          ) : (
            <div className="chunk-list">
              {chunks.map((chunk) => (
                <article
                  key={chunk.chunkIndex}
                  className={`chunk-item ${chunk.status}`}
                >
                  <header className="chunk-header">
                    <strong className="chunk-number">
                      청크 {chunk.chunkIndex + 1}
                    </strong>
                    <span className="chunk-time">
                      {formatSeconds(chunk.chunkStartMs)}
                      <span aria-hidden="true"> → </span>
                      {formatSeconds(chunk.chunkEndMs)}
                    </span>
                  </header>

                  {chunk.status === 'sending' && (
                    <p className="chunk-placeholder">음성을 인식하고 있습니다…</p>
                  )}

                  {chunk.status === 'success' && (
                    <p className="chunk-text">
                      {chunk.text.trim() || '(인식된 내용 없음)'}
                    </p>
                  )}

                  {chunk.status === 'error' && (
                    <p className="chunk-error">
                      {chunk.error || 'STT 처리에 실패했습니다.'}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="result-section" aria-labelledby="summary-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">누적 결과</p>
              <h2 id="summary-title">민원입력요지</h2>
            </div>
          </div>

          <div className="cumulative-result" aria-live="polite">
            {cumulativeText || '(아직 인식된 내용이 없습니다.)'}
          </div>
        </section>

        {!isRecording && (chunks.length > 0 || error) && (
          <div className="footer-actions">
            <button
              type="button"
              className="reset-button"
              onClick={resetRecording}
              disabled={isSending}
            >
              결과 초기화
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function formatSeconds(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}초`;
}
