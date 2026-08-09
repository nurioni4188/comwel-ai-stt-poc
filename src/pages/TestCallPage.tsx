// src/pages/TestCallPage.tsx

import { useEffect, useState } from 'react';
import { useCallRecorder } from '../hooks/useCallRecorder';

interface SummaryApiResponse {
  ok?: boolean;
  summary?: string;
  mode?: string;
  error?: string;
  detail?: string;
}

interface DraftMutationResponse {
  ok?: boolean;
  error?: string;
  detail?: string;
}

type ReviewState = 'idle' | 'generated' | 'saved' | 'confirmed';

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

  const [summaryDraft, setSummaryDraft] = useState('');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<ReviewState>('idle');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    resetDraftReviewState();
  }, [sessionId]);

  const completedCount = chunks.filter(
    (chunk) => chunk.status === 'success'
  ).length;
  const failedCount = chunks.filter(
    (chunk) => chunk.status === 'error'
  ).length;
  const hasRecognizedText = cumulativeText.trim().length > 0;
  const hasDraftText = summaryDraft.trim().length > 0;
  const isReviewBusy = isSummarizing || isSaving || isConfirming;
  const isConfirmed = reviewState === 'confirmed';

  const handleRecordingClick = async () => {
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        resetDraftReviewState();
        await startRecording();
      }
    } catch (clickError) {
      console.error('[TestCallPage] recording button failed:', clickError);
    }
  };

  const handleSummaryDraft = async () => {
    if (
      isRecording ||
      isSending ||
      isReviewBusy ||
      completedCount === 0 ||
      !hasRecognizedText
    ) {
      return;
    }

    setIsSummarizing(true);
    setSummaryError(null);
    setReviewMessage(null);

    try {
      const response = await fetch('/api/stt-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      const result = (await response.json()) as SummaryApiResponse;
      if (!response.ok) {
        throw new Error(
          result.detail || result.error || `요지 생성 실패: ${response.status}`
        );
      }

      const nextSummary =
        typeof result.summary === 'string' ? result.summary.trim() : '';
      setSummaryDraft(nextSummary);
      setReviewState(nextSummary ? 'generated' : 'idle');
      setReviewMessage(
        nextSummary ? '원문 기반 요지 초안이 생성되었습니다. 담당자가 수정할 수 있습니다.' : null
      );
    } catch (summaryRequestError) {
      const message = getErrorMessage(summaryRequestError);
      console.error('[TestCallPage] summary failed:', summaryRequestError);
      setSummaryError(message);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!hasDraftText || isReviewBusy || isConfirmed) return;

    setIsSaving(true);
    setSummaryError(null);
    setReviewMessage(null);

    try {
      const response = await fetch('/api/stt-draft-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content: summaryDraft }),
      });
      const result = (await response.json()) as DraftMutationResponse;
      if (!response.ok) {
        throw new Error(
          result.detail || result.error || `수정본 저장 실패: ${response.status}`
        );
      }

      setReviewState('saved');
      setReviewMessage('담당자 수정본을 새 버전으로 저장했습니다. 이전 버전은 보존됩니다.');
    } catch (saveError) {
      const message = getErrorMessage(saveError);
      console.error('[TestCallPage] draft save failed:', saveError);
      setSummaryError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDraft = async () => {
    if (!hasDraftText || isReviewBusy || isConfirmed) return;

    setIsConfirming(true);
    setSummaryError(null);
    setReviewMessage(null);

    try {
      const response = await fetch('/api/stt-draft-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const result = (await response.json()) as DraftMutationResponse;
      if (!response.ok) {
        throw new Error(
          result.detail || result.error || `확정 처리 실패: ${response.status}`
        );
      }

      setReviewState('confirmed');
      setReviewMessage('담당자 확정본으로 기록했습니다. 자동 제출·자동 처분은 수행하지 않습니다.');
    } catch (confirmError) {
      const message = getErrorMessage(confirmError);
      console.error('[TestCallPage] draft confirm failed:', confirmError);
      setSummaryError(message);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDraftChange = (value: string) => {
    if (isConfirmed) return;
    setSummaryDraft(value);
    setReviewState(value.trim() ? 'generated' : 'idle');
    setReviewMessage(null);
  };

  const handleReset = () => {
    if (isSending || isReviewBusy) return;
    resetDraftReviewState();
    resetRecording();
  };

  function resetDraftReviewState() {
    setSummaryDraft('');
    setSummaryError(null);
    setReviewMessage(null);
    setReviewState('idle');
  }

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
              <h2 id="summary-title">전체 통화 인식문</h2>
            </div>
          </div>

          <div className="cumulative-result" aria-live="polite">
            {cumulativeText || '(아직 인식된 내용이 없습니다.)'}
          </div>
        </section>

        <section className="result-section" aria-labelledby="draft-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">담당자 검토용</p>
              <h2 id="draft-title">민원 요지 초안</h2>
            </div>
            <span className="section-meta">원문 기반 extractive v1</span>
          </div>

          <div className="summary-actions">
            <button
              type="button"
              className="summary-button"
              onClick={() => void handleSummaryDraft()}
              disabled={
                isRecording ||
                isSending ||
                isReviewBusy ||
                completedCount === 0 ||
                !hasRecognizedText ||
                isConfirmed
              }
            >
              {isSummarizing ? '요지 생성 중…' : '민원 요지 초안 생성'}
            </button>
            <p className="summary-note">
              원문 기반 1차 초안을 만든 뒤 담당자가 직접 수정·저장·확정합니다.
              확정해도 자동 제출·자동 처분은 수행하지 않습니다.
            </p>
          </div>

          {summaryError && (
            <div className="error-message" role="alert">
              <strong>요지 처리 오류</strong>
              <span>{summaryError}</span>
            </div>
          )}

          {reviewMessage && (
            <div className="review-message" role="status">
              {reviewMessage}
            </div>
          )}

          <label className="draft-editor-label" htmlFor="draft-editor">
            담당자 수정 영역
          </label>
          <textarea
            id="draft-editor"
            className="draft-editor"
            value={summaryDraft}
            onChange={(event) => handleDraftChange(event.target.value)}
            placeholder="녹음 종료 후 민원 요지 초안을 생성하면 여기에서 수정할 수 있습니다."
            disabled={!hasDraftText && reviewState === 'idle' ? false : isConfirmed}
            readOnly={isConfirmed}
            maxLength={4000}
          />

          <div className="draft-review-actions">
            <button
              type="button"
              className="secondary-action-button"
              onClick={() => void handleSaveDraft()}
              disabled={!hasDraftText || isReviewBusy || isConfirmed}
            >
              {isSaving ? '수정본 저장 중…' : '수정본 저장'}
            </button>
            <button
              type="button"
              className="confirm-action-button"
              onClick={() => void handleConfirmDraft()}
              disabled={!hasDraftText || isReviewBusy || isConfirmed}
            >
              {isConfirming
                ? '확정 처리 중…'
                : isConfirmed
                  ? '담당자 확정 완료'
                  : '담당자 확정'}
            </button>
            <span className={`review-state-badge ${reviewState}`}>
              {formatReviewState(reviewState)}
            </span>
          </div>
        </section>

        {!isRecording && (chunks.length > 0 || error || summaryDraft) && (
          <div className="footer-actions">
            <button
              type="button"
              className="reset-button"
              onClick={handleReset}
              disabled={isSending || isReviewBusy}
            >
              결과 초기화
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function formatReviewState(state: ReviewState): string {
  if (state === 'generated') return '초안 생성';
  if (state === 'saved') return '수정본 저장';
  if (state === 'confirmed') return '확정';
  return '대기';
}

function formatSeconds(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}초`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return '알 수 없는 오류';
  }
}
