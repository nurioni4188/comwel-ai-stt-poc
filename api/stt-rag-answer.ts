import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const MAX_QUESTION = 3000;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CONTENT = 1500;
const MIN_SCORE = 5;
const MAX_EVIDENCE = 3;
const PII_PATTERNS = [
  /\b\d{6}-?[1-4]\d{6}\b/,
  /\b01[016789]-?\d{3,4}-?\d{4}\b/,
  /\b\d{2,4}-\d{2,4}-\d{4}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d{3}-?\d{2}-?\d{5}\b/,
];
const FOLLOWUP_PATTERN = /^(그럼|그러면|그렇다면|그거|그것|그 내용|그 경우|그때|그런 경우|그건|그게|그것도|그럼요|그러면요)\b|^(그럼|그러면|그렇다면)/;

const ANSWER_SCHEMA = {
  type:'object', additionalProperties:false,
  required:['answer','confidence','needs_human_review'],
  properties:{
    answer:{type:'string',minLength:1,maxLength:4000},
    confidence:{type:'number',minimum:0,maximum:1},
    needs_human_review:{type:'boolean'},
  },
} as const;

type HistoryTurn = { role:'user'|'assistant'; content:string };
type OpenAIResponse = { error?:{message?:string}|null; output?:Array<{type?:string;content?:Array<{type?:string;text?:string;refusal?:string}>}> };
type AnswerOutput = { answer:string; confidence:number; needs_human_review:boolean };
type Doc = { id:string;title:string;source_label:string;source_url:string|null;domain:string;approval_status:string;approved_at:string|null;valid_from:string|null;valid_to:string|null;is_test_fixture:boolean };
type Chunk = { id:string;document_id:string;chunk_no:number;content:string;keywords:string[]|null };
type Evidence = { chunkId:string;documentId:string;title:string;sourceLabel:string;sourceUrl:string|null;domain:string;excerpt:string;score:number;approvedAt:string|null;isTestFixture:boolean };

const KOREAN_SUFFIXES=['에서는','으로는','에게는','이라는','이라고','이라면','에서도','으로','에서','에게','한테','처럼','보다','까지','부터','하고','하며','해서','하면','해도','하지','하는','되어','되는','되나요','인가요','입니까','습니다','입니다','나요','까요','거나','는데','지만','으나','라는','라고','이라','와','과','을','를','이','가','은','는','에','의','도','만'];
function stemKoreanToken(token:string){
  if(!/[가-힣]/.test(token)||token.length<3)return token;
  for(const suffix of KOREAN_SUFFIXES){
    if(token.endsWith(suffix)&&token.length-suffix.length>=2)return token.slice(0,-suffix.length);
  }
  return token;
}
function normalizeTokens(value:string){
  const raw=value.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? [];
  const expanded=raw.flatMap(token=>{const stem=stemKoreanToken(token);return stem!==token?[token,stem]:[token];});
  return [...new Set(expanded)].slice(0,90);
}
function fuzzyContains(haystack:string,token:string){
  if(token.length<2)return false;
  if(haystack.includes(token))return true;
  if(/[가-힣]/.test(token)&&token.length>=3){
    const stem=stemKoreanToken(token);
    if(stem.length>=2&&haystack.includes(stem))return true;
  }
  return false;
}
function scoreEvidence(question:string,tokens:string[],doc:Doc,chunk:Chunk){
  const content=chunk.content.toLowerCase(); const title=doc.title.toLowerCase(); const keywords=(chunk.keywords??[]).map(k=>k.toLowerCase()); let score=0;
  for(const token of tokens){
    if(fuzzyContains(title,token))score+=3;
    if(fuzzyContains(content,token))score+=2;
    if(keywords.some(k=>k===token||k.includes(token)||token.includes(k)||fuzzyContains(k,token)))score+=4;
  }
  if(question.length>=4 && content.includes(question.toLowerCase()))score+=8;
  return score;
}
function normalizeHistory(raw:unknown):HistoryTurn[]{
  if(!Array.isArray(raw)) return [];
  return raw.slice(-MAX_HISTORY_TURNS).flatMap((item:any)=>{
    const role=item?.role==='user'||item?.role==='assistant'?item.role:null;
    const content=String(item?.content??'').trim().slice(0,MAX_HISTORY_CONTENT);
    return role&&content?[{role,content}]:[];
  });
}
function buildRetrievalQuestion(question:string,history:HistoryTurn[]){
  if(!FOLLOWUP_PATTERN.test(question.trim())) return { text:question, usedContext:false };
  const previousUser=[...history].reverse().find(turn=>turn.role==='user');
  if(!previousUser) return { text:question, usedContext:false };
  return { text:`${previousUser.content}\n후속 질문: ${question}`, usedContext:true };
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
  try{
    const supabaseUrl=process.env.SUPABASE_URL?.trim(); const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(); const apiKey=process.env.OPENAI_API_KEY?.trim(); const model=process.env.OPENAI_MODEL?.trim();
    if(!supabaseUrl||!serviceRoleKey||!apiKey||!model) throw new Error('필수 환경변수가 누락되었습니다.');
    const body=typeof req.body==='string'?JSON.parse(req.body):(req.body??{});
    const question=String(body.question??'').trim(); const history=normalizeHistory(body.history);
    if(question.length<2||question.length>MAX_QUESTION) return res.status(400).json({error:`질문은 2~${MAX_QUESTION}자여야 합니다.`});
    const privacyText=[...history.map(h=>h.content),question].join('\n');
    if(PII_PATTERNS.some(pattern=>pattern.test(privacyText))) return res.status(400).json({error:'대화에 개인정보로 의심되는 값이 포함되어 있습니다. 테스트용 비식별 질문만 입력하세요.'});

    const db=createClient(supabaseUrl,serviceRoleKey,{db:{schema:STT_SCHEMA},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const today=new Date().toISOString().slice(0,10); const allowInternal=String(process.env.RAG_ALLOW_INTERNAL_APPROVED??'').toLowerCase()==='true';
    let docsQuery=db.from('knowledge_documents').select('id,title,source_label,source_url,domain,approval_status,approved_at,valid_from,valid_to,is_test_fixture').eq('approval_status','approved');
    if(!allowInternal) docsQuery=docsQuery.eq('is_test_fixture',true);
    const {data:docsData,error:docsError}=await docsQuery; if(docsError)throw docsError;
    const docs=(docsData??[]).filter((d:any)=>(!d.valid_from||d.valid_from<=today)&&(!d.valid_to||d.valid_to>=today)) as Doc[]; const docIds=docs.map(d=>d.id);
    const questionHash=createHash('sha256').update(question,'utf8').digest('hex');
    if(!docIds.length){ await db.from('rag_answer_runs').insert({question_hash:questionHash,evidence_count:0,answer_generated:false,fallback_reason:'no_approved_documents',model_name:model}); return res.status(200).json({ok:true,generated:false,answer:'현재 승인된 근거가 없어 자동 답변을 생성하지 않았습니다. 담당자 확인이 필요합니다.',evidence:[],needsHumanReview:true,reason:'no_approved_documents',contextTurns:history.length}); }

    const {data:chunksData,error:chunksError}=await db.from('knowledge_chunks').select('id,document_id,chunk_no,content,keywords').in('document_id',docIds).limit(500); if(chunksError)throw chunksError;
    const chunks=(chunksData??[]) as Chunk[]; const docMap=new Map(docs.map(d=>[d.id,d]));

    const retrieval=buildRetrievalQuestion(question,history);
    const tokens=normalizeTokens(retrieval.text);
    const ranked=chunks.map(chunk=>{const doc=docMap.get(chunk.document_id)!;return{chunk,doc,score:scoreEvidence(retrieval.text,tokens,doc,chunk)}}).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,MAX_EVIDENCE);
    if(!ranked.length||ranked[0].score<MIN_SCORE){ await db.from('rag_answer_runs').insert({question_hash:questionHash,evidence_chunk_ids:ranked.map(r=>r.chunk.id),evidence_count:ranked.length,answer_generated:false,fallback_reason:'insufficient_evidence',model_name:model}); return res.status(200).json({ok:true,generated:false,answer:'현재 질문과 충분히 부합하는 승인 근거를 찾지 못해 자동 답변을 생성하지 않았습니다. 담당자 확인이 필요합니다.',evidence:ranked.map(toEvidence),needsHumanReview:true,reason:'insufficient_evidence',contextTurns:history.length,retrievalContextUsed:retrieval.usedContext}); }

    const evidence=ranked.map(toEvidence); const evidenceText=ranked.map((r,i)=>`[근거 ${i+1}]\n제목: ${r.doc.title}\n출처: ${r.doc.source_label}\n내용: ${r.chunk.content}`).join('\n\n');
    const conversationText=history.length?history.map(h=>`${h.role==='user'?'민원인':'AI'}: ${h.content}`).join('\n'):'(이전 대화 없음)';
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({
      model,store:false,
      instructions:['당신은 근로복지공단 내부직원용 전화상담 PoC의 다회차 근거 기반 답변 도구입니다.','이전 대화는 문맥 이해와 대명사·생략 표현 해석에만 사용하고 사실 근거로 사용하지 마세요.','반드시 제공된 승인 근거 안에서만 답변하세요. 근거에 없는 사실, 법적 판단, 지급·인정 결과를 만들지 마세요.','현재 질문과 승인 근거의 주제가 다르면 답변을 확장하지 말고 담당자 확인이 필요하다고 명시하세요.','개별 사건의 처분 결과를 확정하지 말고 필요한 경우 담당자 확인이 필요하다고 명시하세요.','답변은 한국어로 짧고 전화상담에서 읽기 쉬운 문장으로 작성하세요.','근거가 질문을 완전히 해결하지 못하면 needs_human_review=true로 하세요.'].join('\n'),
      input:[{role:'user',content:[{type:'input_text',text:`[이전 대화 - 문맥 전용]\n${conversationText}\n\n[현재 질문]\n${question}\n\n[승인 근거]\n${evidenceText}`}]}],
      text:{format:{type:'json_schema',name:'approved_evidence_multiturn_answer',strict:true,schema:ANSWER_SCHEMA}},
    })});
    const payload=await response.json() as OpenAIResponse; if(!response.ok)throw new Error(payload.error?.message||`OpenAI Responses API 오류: ${response.status}`);
    let output=''; for(const item of payload.output??[])for(const part of item.content??[]){if(part.type==='refusal'&&part.refusal)throw new Error(`AI 응답 거절: ${part.refusal}`);if(part.type==='output_text'&&part.text)output=part.text;}
    if(!output)throw new Error('AI 답변 결과가 비어 있습니다.'); const parsed=JSON.parse(output) as AnswerOutput; const confidence=Number(parsed.confidence); if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw new Error('AI 답변 신뢰도 값이 유효하지 않습니다.');
    const needsHumanReview=Boolean(parsed.needs_human_review||confidence<0.75);
    await db.from('rag_answer_runs').insert({question_hash:questionHash,evidence_chunk_ids:evidence.map(e=>e.chunkId),evidence_count:evidence.length,answer_generated:true,model_name:model});
    return res.status(200).json({ok:true,generated:true,answer:String(parsed.answer).trim(),confidence,evidence,needsHumanReview,mode:allowInternal?'approved_all':'approved_fixture_only',contextTurns:history.length,retrievalContextUsed:retrieval.usedContext});
  }catch(error){console.error('[stt-rag-answer] failed:',error);return res.status(500).json({error:'근거 기반 AI 답변 생성 실패',...(process.env.VERCEL_ENV!=='production'?{detail:error instanceof Error?error.message:String(error)}:{})});}
}
function toEvidence(row:{chunk:Chunk;doc:Doc;score:number}):Evidence{return{chunkId:row.chunk.id,documentId:row.doc.id,title:row.doc.title,sourceLabel:row.doc.source_label,sourceUrl:row.doc.source_url,domain:row.doc.domain,excerpt:row.chunk.content.slice(0,700),score:row.score,approvedAt:row.doc.approved_at,isTestFixture:row.doc.is_test_fixture};}