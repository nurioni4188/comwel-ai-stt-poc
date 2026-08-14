import { useEffect, useState } from 'react';

type OverallRating = 'accurate' | 'minor_edit' | 'major_edit' | 'unusable';

interface QualityEvaluationPanelProps {
  sessionId: string;
  enabled: boolean;
}

interface QualityMetrics {
  editDistance?: number;
  editRatio?: number;
  aiCharCount?: number;
  staffCharCount?: number;
  reviewDurationMs?: number | null;
  modelName?: string | null;
  schemaVersion?: string;
}

interface QualityEvaluationResponse {
  ok?: boolean;
  error?: string;
  detail?: string;
  metrics?: QualityMetrics;
}

const RATING_OPTIONS: Array<{ value: OverallRating; label: string; description: string }> = [
  { value: 'accurate', label: '정확', description: '수정 없이 그대로 사용 가능' },
  { value: 'minor_edit', label: '경미한 수정', description: '표현·문구 수준의 소폭 수정' },
  { value: 'major_edit', label: '상당한 수정', description: '핵심 내용 또는 구조 수정 필요' },
  { value: 'unusable', label: '사용 불가', description: '업무 활용이 곤란한 수준' },
];

const ISSUE_OPTIONS = [
  ['factOmission', '중요 사실 누락'],
  ['factDistortion', '사실 왜곡'],
  ['hallucination', '원문에 없는 사실 추가'],
  ['requestOmission', '요청·문의 누락'],
  ['confirmationOmission', '추가 확인사항 누락'],
  ['sttErrorImpact', 'STT 인식 오류 영향'],
  ['otherIssue', '기타'],
] as const;

type IssueKey = (typeof ISSUE_OPTIONS)[number][0];

type IssueState = Record<IssueKey, boolean>;

const EMPTY_ISSUES: IssueState = {
  factOmission: false,
  factDistortion: false,
  hallucination: false,
  requestOmission: false,
  confirmationOmission: false,
  sttErrorImpact: false,
  otherIssue: false,
};

export default function QualityEvaluationPanel({
  sessionId,
  enabled,
}: QualityEvaluationPanelProps) {
  const [overallRating, setOverallRating] = useState<OverallRating | ''>('');
  const [issues, setIssues] = useState<IssueState>({ ...EMPTY_ISSUES });
  const [reviewerNote, setReviewerNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<QualityMetrics | null>(null);

  useEffect(() => {
    setOverallRating('');
    setIssues({ ...EMPTY_ISSUES });
    setReviewerNote('');
    setIsSaving(false);
    setMessage(null);
    setError(null);
    setMetrics(null);
  }, [sessionId]);

  const handleIssueChange = (key: IssueKey, checked: boolean) => {
    setIssues((current) => ({ ...current, [key]: checked }));
    setMessage(null);
  };

  const handleSave = async () => {
    if (!enabled || !overallRating || isSaving) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/stt-quality-evaluation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          overallRating,
          ...issues,
          reviewerNote,
          actor: 'staff',
        }),
      });
      const result = (await response.json()) as QualityEvaluationResponse;
      if (!response.ok) {
        throw new Error(
          result.detail || result.error || `품질평가 저장 실패: ${response.status}`
        );
      }

      setMetrics(result.metrics ?? null);
      setMessage('품질평가를 저장했습니다. 같은 세션에서 다시 저장하면 기존 평가가 갱신됩니다.');
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="result-section quality-evaluation-section" aria-labelledby="quality-evaluation-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">v0.5.0 품질 검증</p>
          <h2 id="quality-evaluation-title">담당자 품질평가</h2>
        </div>
        <span className="section-meta">AI 정제본 ↔ 담당자 확정본</span>
      </div>

      {!enabled && (
        <div className="quality-locked-message">
          AI 정제본을 담당자가 수정·저장한 뒤 최종 확정하면 품질평가가 활성화됩니다.
        </div>
      )}

      <fieldset className="quality-fieldset" disabled={!enabled || isSaving}>
        <legend>전체 평가</legend>
        <div className="quality-rating-grid">
          {RATING_OPTIONS.map((option) => (
            <label className="quality-rating-option" key={option.value}>
              <input
                type="radio"
                name="overall-quality-rating"
                value={option.value}
                checked={overallRating === option.value}
                onChange={() => {
                  setOverallRating(option.value);
                  setMessage(null);
                }}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="quality-fieldset" disabled={!enabled || isSaving}>
        <legend>오류 유형</legend>
        <div className="quality-issue-grid">
          {ISSUE_OPTIONS.map(([key, label]) => (
            <label className="quality-checkbox-option" key={key}>
              <input
                type="checkbox"
                checked={issues[key]}
                onChange={(event) => handleIssueChange(key, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="draft-editor-label" htmlFor="quality-reviewer-note">
        담당자 평가 메모
      </label>
      <textarea
        id="quality-reviewer-note"
        className="quality-note-editor"
        value={reviewerNote}
        onChange={(event) => {
          setReviewerNote(event.target.value);
          setMessage(null);
        }}
        placeholder="수정 이유, AI 결과의 장점·오류, 실제 업무 활용 가능성 등을 기록합니다."
        disabled={!enabled || isSaving}
        maxLength={2000}
      />

      {error && (
        <div className="error-message" role="alert">
          <strong>품질평가 오류</strong>
          <span>{error}</span>
        </div>
      )}

      {message && (
        <div className="review-message" role="status">
          {message}
        </div>
      )}

      {metrics && (
        <div className="quality-metrics" aria-label="자동 계산 품질지표">
          <MetricItem label="수정 거리" value={formatNumber(metrics.editDistance)} />
          <MetricItem label="수정률" value={formatPercent(metrics.editRatio)} />
          <MetricItem label="AI 문자수" value={formatNumber(metrics.aiCharCount)} />
          <MetricItem label="확정본 문자수" value={formatNumber(metrics.staffCharCount)} />
          <MetricItem label="검토시간" value={formatDuration(metrics.reviewDurationMs)} />
          <MetricItem label="모델" value={metrics.modelName || '-'} />
        </div>
      )}

      <div className="quality-actions">
        <button
          type="button"
          className="confirm-action-button"
          onClick={() => void handleSave()}
          disabled={!enabled || !overallRating || isSaving}
        >
          {isSaving ? '평가 저장 중…' : '평가 저장'}
        </button>
        <span className="summary-note">
          재평가 시 동일 세션의 평가행을 새로 만들지 않고 갱신합니다.
        </span>
      </div>
    </section>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="quality-metric-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(2)}%`;
}

function formatDuration(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}초`;
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
