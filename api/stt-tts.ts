import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA='stt_poc';
const MAX_TTS_CHARS=2000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
  let ttsRunId:string|undefined;
  try{
    const supabaseUrl=process.env.SUPABASE_URL?.trim();
    const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const clientId=process.env.CLOVA_VOICE_CLIENT_ID?.trim();
    const clientSecret=process.env.CLOVA_VOICE_CLIENT_SECRET?.trim();
    const speaker=(process.env.CLOVA_VOICE_SPEAKER?.trim()||'nara');
    if(!supabaseUrl||!serviceRoleKey) throw new Error('Supabase 환경변수가 누락되었습니다.');
    const body=typeof req.body==='string'?JSON.parse(req.body):(req.body??{});
    const ragRunId=String(body.ragRunId??'').trim();
    const text=String(body.text??'').trim();
    if(!UUID.test(ragRunId)) return res.status(400).json({error:'ragRunId가 올바르지 않습니다.'});
    if(!text||text.length>MAX_TTS_CHARS) return res.status(400).json({error:`TTS 텍스트는 1~${MAX_TTS_CHARS}자여야 합니다.`});

    const db=createClient(supabaseUrl,serviceRoleKey,{db:{schema:STT_SCHEMA},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const {data:run,error:runError}=await db.from('rag_answer_runs').select('id,answer_generated,answer_hash').eq('id',ragRunId).maybeSingle();
    if(runError) throw runError;
    const answerHash=createHash('sha256').update(text,'utf8').digest('hex');
    if(!run||!run.answer_generated||!run.answer_hash||run.answer_hash!==answerHash){
      await db.from('tts_runs').insert({rag_run_id:ragRunId,answer_hash:answerHash,provider:'clova_voice',speaker,format:'mp3',status:'blocked',error_code:'answer_guard'});
      return res.status(409).json({error:'승인근거 기반으로 실제 생성된 AI 답변만 음성합성할 수 있습니다.'});
    }
    if(!clientId||!clientSecret){
      const {data:blocked}=await db.from('tts_runs').insert({rag_run_id:ragRunId,answer_hash:answerHash,provider:'clova_voice',speaker,format:'mp3',status:'blocked',error_code:'tts_not_configured'}).select('id').single();
      ttsRunId=blocked?.id;
      return res.status(503).json({error:'CLOVA Voice 환경변수가 아직 설정되지 않았습니다.',code:'tts_not_configured'});
    }

    const {data:requested,error:insertError}=await db.from('tts_runs').insert({rag_run_id:ragRunId,answer_hash:answerHash,provider:'clova_voice',speaker,format:'mp3',status:'requested'}).select('id').single();
    if(insertError) throw insertError;
    ttsRunId=requested.id;

    const form=new URLSearchParams({speaker,text,volume:'0',speed:'0',pitch:'0',format:'mp3'});
    const response=await fetch('https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts',{
      method:'POST',headers:{'X-NCP-APIGW-API-KEY-ID':clientId,'X-NCP-APIGW-API-KEY':clientSecret,'Content-Type':'application/x-www-form-urlencoded'},body:form.toString()
    });
    if(!response.ok){
      const detail=(await response.text()).slice(0,500);
      await db.from('tts_runs').update({status:'failed',error_code:`clova_${response.status}`}).eq('id',ttsRunId);
      console.error('[stt-tts] CLOVA failed',response.status,detail);
      return res.status(502).json({error:'CLOVA Voice 음성합성에 실패했습니다.',code:`clova_${response.status}`});
    }
    const bytes=Buffer.from(await response.arrayBuffer());
    await db.from('tts_runs').update({status:'completed'}).eq('id',ttsRunId);
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-TTS-Run-Id',ttsRunId);
    return res.status(200).send(bytes);
  }catch(error){
    console.error('[stt-tts] failed',error);
    return res.status(500).json({error:'TTS 음성응답 생성 실패',...(process.env.VERCEL_ENV!=='production'?{detail:error instanceof Error?error.message:String(error)}:{})});
  }
}
