// src/pages/TestCallPage.tsx

import { useEffect, useState } from 'react';
import QualityEvaluationPanel from '../components/QualityEvaluationPanel';
import { useCallRecorder } from '../hooks/useCallRecorder';

interface SummaryApiResponse {
  ok?: boolean;
  summary?: string;
  mode?: string;
  error?: string;
  detail?: string;
}

interface StructuredSummary {
  summary: string;
  requests: string[];
  key_facts: string[];
  needs_confirmation: string[];
}

interface AiRefineApiResponse {
  ok?: boolean;
  error?: string;
  detail?: string;
  draft?: {
    content?: string;
    versionNo?: number;
    sourceType?: string;
    structured?: StructuredSummary;
  };
}

interface DraftMutationResponse {
  ok?: boolean;
  error?: string;
  detail?: string;
}

type ReviewState = 'idle' | 'generated' | 'refined' | 'saved' | 'confirmed';

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
  const [structuredSummary, setStructuredSummary] =
    useState<StructuredSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<ReviewState>('idle');
  const [hasExtractiveDraft, setHasExtractiveDraft] = useState(false);
  const [hasAiRefinedDraft, setHasAiRefinedDraft] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    resetDraftReviewState();
  }, [sessionId]);

  const completedCount = chunks.filter((chunk) => chunk.status === 'success').length;
  const failedCount = chunks.filter((chunk) => chunk.status === 'error').length;
  const hasRecognizedText = cumulativeText.trim().length > 0;
  const hasDraftText = summaryDraft.trim().length > 0;
  const isReviewBusy = isSummarizing || isRefining || isSaving || isConfirming;
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
      !hasRecognizedText ||
      hasAiRefinedDraft
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
        throw new Error(result.detail || result.error || `요지 생성 실패: ${response.status}`);
      }

      const nextSummary = typeof result.summary === 'string' ? result.summary.trim() : '';
      setSummaryDraft(nextSummary);
      setStructuredSummary(null);
      setHasExtractiveDraft(Boolean(nextSummary));
      setReviewState(nextSummary ? 'generated' : 'idle');
      setReviewMessage(
        nextSummary
          ? '원문 기반 요지 초안이 생성되었습니다. AI 정제 또는 담당자 직접 수정을 선택할 수 있습니다.'
          : null
      );
    } catch (summaryRequestError) {
      setSummaryError(getErrorMessage(summaryRequestError));
      console.error('[TestCallPage] summary failed:', summaryRequestError);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleAiRefine = async () => {
    if (!hasExtractiveDraft || hasAiRefinedDraft || isReviewBusy || isConfirmed) return;

    setIsRefining(true);
    setSummaryError(null);
    setReviewMessage(null);

    try {
      const response = await fetch('/api/stt-summary-refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const result = (await response.json()) as AiRefineApiResponse;
      if (!response.ok) {
        throw new Error(result.detail || result.error || `AI 정제 실패: ${response.status}`);
      }

      const nextContent = typeof result.draft?.content === 'string' ? result.draft.content.trim() : '';
      const nextStructured = result.draft?.structured ?? null;
      if (!nextContent || !nextStructured) {
        throw new Error('AI 정제 응답에 검토용 내용이 없습니다.');
      }

      setSummaryDraft(nextContent);
      setStructuredSummary(nextStructured);
      setHasAiRefinedDraft(true);
      setReviewState('refined');
      setReviewMessage(
        '생성형 AI 정제본을 새 버전으로 저장했습니다. 담당자가 내용을 검토·수정한 뒤 저장·확정해 주세요.'
      );
    } catch (refineError) {
      setSummaryError(getErrorMessage(refineError));
      console.error('[TestCallPage] AI refine failed:', refineError);
    } finally {
      setIsRefining(false);
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
        throw new Error(result.detail || result.error || `수정본 저장 실패: ${response.status}`);
      }

      setReviewState('saved');
      setReviewMessage('담당자 수정본을 새 버전으로 저장했습니다. 이전 버전은 보존됩니다.');
    } catch (saveError) {
      setSummaryError(getErrorMessage(saveError));
      console.error('[TestCallPage] draft save failed:', saveError);
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
        throw new Error(result.detail || result.error || `확정 처리 실패: ${response.status}`);
      }

      setReviewState('confirmed');
      setReviewMessage(
        '담당자 확정본으로 기록했습니다. 자동 제출·자동 처분은 수행하지 않습니다. 아래에서 품질평가를 저장할 수 있습니다.'
      );
    } catch (confirmError) {
      setSummaryError(getErrorMessage(confirmError));
      console.error('[TestCallPage] draft confirm failed:', confirmError);
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
    setStructuredSummary(null);
    setSummaryError(null);
    setReviewMessage(null);
    setReviewState('idle');
    setHasExtractiveDraft(false);
    setHasAiRefinedDraft(false);
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
            className={isRecording ? 'record-button recording' : 'record-button'}
            onClick={() => void handleRecordingClick()}
            aria-pressed={isRecording}
          >
            {isRecording ? '녹음 중지' : '녹음 시작 (마이크에 대고 말하기)'}
          </button>

          <div className="status-row" aria-live="polite">
            <span className={`status-badge ${isRecording ? 'active' : ''}`}>
              {isRecording ? '● 녹음 중' : '대기'}
            </span>
            {isSending && <span className="status-badge sending">STT 처리 중</span>}
            {completedCount > 0 && <span className="status-badge success">완료 {completedCount}건</span>}
            {failedCount > 0 && <span className="status-badge error">실패 {failedCount}건</span>}
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
            <div className="empty-result">녹음을 시작하면 첫 번째 결과가 여기에 표시됩니다.</div>
          ) : (
            <div className="chunk-list">
              {chunks.map((chunk) => (
                <article key={chunk.chunkIndex} className={`chunk-item ${chunk.status}`}>
                  <header className="chunk-header">
                    <strong className="chunk-number">청크 {chunk.chunkIndex + 1}</strong>
                    <span className="chunk-time">
                      {formatSeconds(chunk.chunkStartMs)}
                      <span aria-hidden="true"> → </span>
                      {formatSeconds(chunk.chunkEndMs)}
                    </span>
                  </header>
                  {chunk.status === 'sending' && <p className="chunk-placeholder">음성을 인식하고 있습니다…</p>}
                  {chunk.status === 'success' && (
                    <p className="chunk-text">{chunk.text.trim() || '(인식된 내용 없음)'}</p>
                  )}
                  {chunk.status === 'error' && (
                    <p className="chunk-error">{chunk.error || 'STT 처리에 실패했습니다.'}</p>
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
            <span className="section-meta">
              {hasAiRefinedDraft ? '생성형 AI refined v1' : '원문 기반 extractive v1'}
            </span>
          </div>

          <div className="summary-actions">
            <button
              type="button"
              className="summary-button"
              onClick={() => void handleSummaryDraft()}
              disabled={
                isRecording || isSending || isReviewBusy || completedCount === 0 ||
                !hasRecognizedText || isConfirmed || hasAiRefinedDraft
              }
            >
              {isSummarizing ? '요지 생성 중…' : '민원 요지 초안 생성'}
            </button>

            <button
              type="button"
              className="summary-button ai-refine-button"
              onClick={() => void handleAiRefine()}
              disabled={!hasExtractiveDraft || hasAiRefinedDraft || isReviewBusy || isConfirmed}
            >
              {isRefining ? 'AI 정제본 생성 중…' : hasAiRefinedDraft ? 'AI 정제본 생성 완료' : 'AI 정제본 생성'}
            </button>

            <p className="summary-note">
              원문 기반 1차 초안을 만든 뒤 생성형 AI 정제 또는 담당자 직접 수정을 선택합니다.
              AI 결과도 담당자가 직접 검토·수정·확정하며 자동 제출·자동 처분은 수행하지 않습니다.
            </p>
          </div>

          {summaryError && (
            <div className="error-message" role="alert">
              <strong>요지 처리 오류</strong>
              <span>{summaryError}</span>
            </div>
          )}

          {reviewMessage && <div className="review-message" role="status">{reviewMessage}</div>}

          {structuredSummary && (
            <div className="ai-structured-result" aria-label="AI 구조화 결과">
              <StructuredSection title="민원 요지" items={[structuredSummary.summary]} />
              <StructuredSection title="요청·문의" items={structuredSummary.requests} />
              <StructuredSection title="원문 확인 사실" items={structuredSummary.key_facts} />
              <StructuredSection title="추가 확인 필요" items={structuredSummary.needs_confirmation} />
            </div>
          )}

          <label className="draft-editor-label" htmlFor="draft-editor">담당자 수정 영역</label>
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
              {isConfirming ? '확정 처리 중…' : isConfirmed ? '담당자 확정 완료' : '담당자 확정'}
            </button>
            <span className={`review-state-badge ${reviewState}`}>{formatReviewState(reviewState)}</span>
          </div>
        </section>

        <QualityEvaluationPanel
          sessionId={sessionId}
          enabled={isConfirmed && hasAiRefinedDraft}
        />

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

function StructuredSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="ai-structured-section">
      <strong>{title}</strong>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <p>없음</p>
      )}
    </section>
  );
}

function formatReviewState(state: ReviewState): string {
  if (state === 'generated') return '초안 생성';
  if (state === 'refined') return 'AI 정제';
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
