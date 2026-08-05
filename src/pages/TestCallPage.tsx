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

  const handleRecordingClick = async () => {
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (clickError) {
      console.error(
        '[TestCallPage] recording button failed:',
        clickError
      );
    }
  };

  return (
    <main className="stt-page">
      <section className="stt-card">
        <h1>STT 흐름 테스트</h1>

        <p className="session-id">
          session: {sessionId}
        </p>

        <button
          type="button"
          className={
            isRecording
              ? 'record-button recording'
              : 'record-button'
          }
          onClick={() => {
            void handleRecordingClick();
          }}
          disabled={isSending && !isRecording}
        >
          {isRecording
            ? '녹음 중지'
            : '녹음 시작 (마이크에 대고 말하기)'}
        </button>

        {isSending && (
          <p className="sending-message">
            STT 처리 중입니다…
          </p>
        )}

        {error && (
          <div
            className="error-message"
            role="alert"
          >
            ⚠️ {error}
          </div>
        )}

        <section className="result-section">
          <h2>청크별 STT 결과 (10초 단위)</h2>

          {chunks.length === 0 ? (
            <div className="empty-result">
              아직 전송된 청크가 없습니다.
            </div>
          ) : (
            <div className="chunk-list">
              {chunks.map((chunk) => (
                <article
                  key={chunk.chunkIndex}
                  className={`chunk-item ${chunk.status}`}
                >
                  <header>
                    <strong>
                      청크 {chunk.chunkIndex + 1}
                    </strong>

                    <span>
                      {formatSeconds(
                        chunk.chunkStartMs
                      )}
                      {' ~ '}
                      {formatSeconds(
                        chunk.chunkEndMs
                      )}
                    </span>
                  </header>

                  {chunk.status === 'sending' && (
                    <p>인식 중…</p>
                  )}

                  {chunk.status === 'success' && (
                    <p>
                      {chunk.text.trim() ||
                        '(인식된 내용 없음)'}
                    </p>
                  )}

                  {chunk.status === 'error' && (
                    <p className="chunk-error">
                      {chunk.error ||
                        'STT 처리에 실패했습니다.'}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="result-section">
          <h2>누적 민원입력요지</h2>

          <div className="cumulative-result">
            {cumulativeText ||
              '(아직 없음)'}
          </div>
        </section>

        {!isRecording &&
          (chunks.length > 0 || error) && (
            <button
              type="button"
              className="reset-button"
              onClick={resetRecording}
            >
              결과 초기화
            </button>
          )}
      </section>
    </main>
  );
}

function formatSeconds(
  milliseconds: number
): string {
  return `${(
    Math.max(0, milliseconds) / 1000
  ).toFixed(1)}초`;
}