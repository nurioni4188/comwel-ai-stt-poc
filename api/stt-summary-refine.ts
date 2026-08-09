import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTRACTIVE_DRAFT_TYPE = 'complaint_summary_extractive_v1';
const MAX_TRANSCRIPT_LENGTH = 16000;
const MAX_ITEM_LENGTH = 500;
const MAX_ITEMS_PER_LIST = 8;

interface RefineRequestBody {
  sessionId?: string;
}

interface TranscriptChunkRow {
  chunk_index: number;
  transcript: string | null;
}

interface ExtractiveDraftRow {
  id: string;
  content: string;
  version_no: number;
  status: string;
  is_current: boolean;
}

interface StructuredSummary {
  summary: string;
  requests: string[];
  key_facts: string[];
  needs_confirmation: string[];
}

interface OpenAIResponseShape {
  status?: string;
  error?: { message?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
}

const STRUCTURED_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'requests', 'key_facts', 'needs_confirmation'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 1200 },
    requests: {
      type: 'array',
      maxItems: MAX_ITEMS_PER_LIST,
      items: { type: 'string', minLength: 1, maxLength: MAX_ITEM_LENGTH },
    },
    key_facts: {
      type: 'array',
      maxItems: MAX_ITEMS_PER_LIST,
      items: { type: 'string', minLength: 1, maxLength: MAX_ITEM_LENGTH },
    },
    needs_confirmation: {
      type: 'array',
      maxItems: MAX_ITEMS_PER_LIST,
      items: { type: 'string', minLength: 1, maxLength: MAX_ITEM_LENGTH },
    },
  },
} as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
    const openAiModel = process.env.OPENAI_MODEL?.trim();

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        '필수 환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY'
      );
    }
    if (!openAiApiKey || !openAiModel) {
      throw new Error('필수 환경변수 누락: OPENAI_API_KEY, OPENAI_MODEL');
    }

    const body = parseBody(req.body);
    const sessionId = body.sessionId?.trim() ?? '';

    if (!UUID_PATTERN.test(sessionId)) {
      return res.status(400).json({
        error: '요청 처리 실패',
        detail: 'sessionId는 올바른 UUID여야 합니다.',
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      db: { schema: STT_SCHEMA },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data: session, error: sessionError } = await supabase
      .from('call_sessions')
      .select('id,status')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!session) {
      return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    }
    if (session.status !== 'completed') {
      return res.status(409).json({
        error: 'AI 정제 대기',
        detail: '녹음 종료와 세션 완료 처리 후 AI 정제본을 생성할 수 있습니다.',
      });
    }

    const { data: chunks, error: chunksError } = await supabase
      .from('transcript_chunks')
      .select('chunk_index,transcript')
      .eq('session_id', sessionId)
      .order('chunk_index', { ascending: true });

    if (chunksError) throw chunksError;

    const transcript = ((chunks ?? []) as TranscriptChunkRow[])
      .map((row) => normalizeText(row.transcript ?? ''))
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!transcript) {
      return res.status(422).json({
        error: 'AI 정제 실패',
        detail: '인식된 통화 내용이 없습니다.',
      });
    }
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      return res.status(422).json({
        error: 'AI 정제 실패',
        detail: `현재 PoC에서는 STT 원문 ${MAX_TRANSCRIPT_LENGTH}자 이하만 정제할 수 있습니다.`,
      });
    }

    const { data: extractiveDraft, error: draftError } = await supabase
      .from('drafts')
      .select('id,content,version_no,status,is_current')
      .eq('session_id', sessionId)
      .eq('draft_type', EXTRACTIVE_DRAFT_TYPE)
      .eq('is_current', true)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftError) throw draftError;
    if (!extractiveDraft) {
      return res.status(404).json({
        error: 'AI 정제 기준본 없음',
        detail: '먼저 원문 기반 민원 요지 초안을 생성해 주세요.',
      });
    }

    const extractive = extractiveDraft as ExtractiveDraftRow;
    if (extractive.status === 'confirmed') {
      return res.status(409).json({
        error: '확정본 보호',
        detail: '이미 담당자 확정된 요지는 AI 정제할 수 없습니다.',
      });
    }

    const structured = await requestStructuredSummary({
      apiKey: openAiApiKey,
      model: openAiModel,
      transcript,
      extractiveSummary: normalizeText(extractive.content),
    });

    const validated = validateStructuredSummary(structured);
    if (!validated) {
      return res.status(422).json({
        error: 'AI 정제 실패',
        detail: 'AI 응답이 고정 JSON 스키마 검증을 통과하지 못했습니다.',
      });
    }

    const content = renderStructuredSummary(validated);
    const { data: savedDraft, error: saveError } = await supabase.rpc(
      'save_ai_refined_draft',
      {
        p_session_id: sessionId,
        p_content: content,
      }
    );

    if (saveError) throw saveError;

    return res.status(200).json({
      ok: true,
      sessionId,
      draft: {
        id: savedDraft?.id,
        sessionId,
        draftType: savedDraft?.draft_type,
        versionNo: savedDraft?.version_no,
        sourceType: savedDraft?.source_type,
        status: savedDraft?.status,
        isCurrent: savedDraft?.is_current,
        parentDraftId: savedDraft?.parent_draft_id,
        structured: validated,
        content,
      },
    });
  } catch (error) {
    const detail = getErrorMessage(error);
    console.error('[stt-summary-refine] failed:', error);

    return res.status(500).json({
      error: 'AI 민원 요지 정제 실패',
      ...(process.env.VERCEL_ENV !== 'production' ? { detail } : {}),
    });
  }
}

async function requestStructuredSummary(input: {
  apiKey: string;
  model: string;
  transcript: string;
  extractiveSummary: string;
}): Promise<unknown> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      store: false,
      instructions: [
        '당신은 공공기관 담당자의 내부 검토를 돕는 민원 요지 정제 도구입니다.',
        '오직 제공된 STT 원문과 extractive 기준본에 근거해 작성하세요.',
        '원문에 없는 사건번호, 접수번호, 사업장관리번호, 날짜, 금액, 인원, 직책, 신청·처분·결정 사실, 법적 결론, 수급 자격, 승인 여부, 민원인의 감정·동기를 새로 만들지 마세요.',
        '불명확하거나 확인이 필요한 내용은 needs_confirmation에 넣으세요.',
        '자동 제출·자동 처분·기관의 최종 판단을 암시하지 마세요.',
        'requests와 key_facts에는 원문에서 직접 확인되는 내용만 넣으세요.',
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                '[STT 전체 원문]',
                input.transcript,
                '',
                '[원문 기반 extractive 기준본]',
                input.extractiveSummary,
                '',
                '위 자료만 사용해 담당자 검토용 민원 요지를 정제·구조화하세요.',
              ].join('\n'),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'complaint_summary_refined',
          strict: true,
          schema: STRUCTURED_OUTPUT_SCHEMA,
        },
      },
    }),
  });

  const payload = (await response.json()) as OpenAIResponseShape;
  if (!response.ok) {
    throw new Error(
      payload.error?.message || `OpenAI Responses API 오류: ${response.status}`
    );
  }

  const text = extractOutputText(payload);
  if (!text) {
    throw new Error('OpenAI 응답에서 구조화 텍스트를 찾을 수 없습니다.');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('OpenAI 구조화 응답을 JSON으로 해석할 수 없습니다.');
  }
}

function extractOutputText(payload: OpenAIResponseShape): string {
  for (const item of payload.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'refusal' && part.refusal) {
        throw new Error(`AI 응답 거절: ${part.refusal}`);
      }
      if (part.type === 'output_text' && typeof part.text === 'string') {
        return part.text.trim();
      }
    }
  }
  return '';
}

function validateStructuredSummary(value: unknown): StructuredSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const allowedKeys = [
    'summary',
    'requests',
    'key_facts',
    'needs_confirmation',
  ];

  if (Object.keys(candidate).some((key) => !allowedKeys.includes(key))) {
    return null;
  }

  if (typeof candidate.summary !== 'string') return null;
  const summary = normalizeText(candidate.summary);
  if (!summary || summary.length > 1200) return null;

  const requests = validateStringArray(candidate.requests);
  const keyFacts = validateStringArray(candidate.key_facts);
  const needsConfirmation = validateStringArray(candidate.needs_confirmation);
  if (!requests || !keyFacts || !needsConfirmation) return null;

  return {
    summary,
    requests,
    key_facts: keyFacts,
    needs_confirmation: needsConfirmation,
  };
}

function validateStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_LIST) return null;
  const normalized = value.map((item) =>
    typeof item === 'string' ? normalizeText(item) : ''
  );
  if (normalized.some((item) => !item || item.length > MAX_ITEM_LENGTH)) {
    return null;
  }
  return normalized;
}

function renderStructuredSummary(value: StructuredSummary): string {
  const sections = [
    ['민원 요지', [value.summary]],
    ['요청·문의', value.requests],
    ['원문 확인 사실', value.key_facts],
    ['추가 확인 필요', value.needs_confirmation],
  ] as const;

  return sections
    .map(([title, items]) => {
      const body = items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- 없음';
      return `[${title}]\n${body}`;
    })
    .join('\n\n');
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseBody(rawBody: unknown): RefineRequestBody {
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as RefineRequestBody;
    } catch {
      return {};
    }
  }
  return rawBody && typeof rawBody === 'object'
    ? (rawBody as RefineRequestBody)
    : {};
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
