import { useState } from 'react';
import './RagAnswerPage.css';

type Manifest={
  version?:string;
  mode?:string;
  mediaGateway?:{
    providerIntegration?:{implementation:string;enabledByDefault:boolean;inboundAudio:{codec:string;sampleRate:number;channels:number};outboundAudio:{codec:string;sampleRate:number;channels:number};requiredSecrets:string[];signatureValidationRequired:boolean};
    serverTts?:{implementation:string;model:string;responseFormat:string;telephoneOutput:{codec:string;sampleRate:number;channels:number};requiredSecrets:string[];monthlyBaseFee:boolean};
    controlPlane?:string[];
    scope?:string;
  };
  error?:string;
};

export default function ProviderTtsPage(){
  const [manifest,setManifest]=useState<Manifest|null>(null);
  const [error,setError]=useState<string|null>(null);
  const load=async()=>{
    setError(null);
    try{
      const response=await fetch('/api/telephony-adapter');
      const body=await response.json() as Manifest;
      if(!response.ok)throw new Error(body.error||'통합 manifest 조회 실패');
      setManifest(body);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  const provider=manifest?.mediaGateway?.providerIntegration;
  const tts=manifest?.mediaGateway?.serverTts;
  return <main className="rag-page">
    <header className="rag-header">
      <p className="rag-kicker">COMWEL AI STT PoC · v0.14.0</p>
      <h1>Provider + Server TTS Integration Baseline</h1>
      <p>실제 전화망 직전 단계로, <strong>Twilio Media Streams 어댑터</strong>와 <strong>OpenAI Server TTS</strong>를 독립 Media Gateway에 연결합니다.</p>
    </header>
    <section className="rag-warning"><strong>비용 안전 기준선</strong> · 실전화번호 미구매 · 실제 유료 통화 미실행 · Provider/TTS는 자격증명 설정 시에만 활성화 · 실제 통화음성 저장 없음</section>
    <section className="rag-input-card">
      <h2>통합 manifest 확인</h2>
      <p>이 화면은 실제 Secret 값을 노출하지 않고 구현체·오디오 형식·필수 설정 이름만 확인합니다.</p>
      <div className="rag-actions"><button className="primary" type="button" onClick={()=>void load()}>v0.14 계약 확인</button></div>
    </section>
    {manifest&&<section className="rag-result">
      <h2>{manifest.version} · {manifest.mode}</h2>
      <div className="evidence-list">
        <article className="evidence-card"><strong>Provider</strong><p>{provider?.implementation}</p><p>전화 오디오: {provider?.inboundAudio.codec} / {provider?.inboundAudio.sampleRate}Hz / {provider?.inboundAudio.channels}ch</p><p>Signature validation: {String(provider?.signatureValidationRequired)}</p><small>필수 환경변수: {provider?.requiredSecrets.join(', ')}</small></article>
        <article className="evidence-card"><strong>Server TTS</strong><p>{tts?.implementation} · {tts?.model}</p><p>전화 출력: {tts?.telephoneOutput.codec} / {tts?.telephoneOutput.sampleRate}Hz / {tts?.telephoneOutput.channels}ch</p><p>월 기본료 구조: {tts?.monthlyBaseFee?'있음':'없음'}</p><small>필수 환경변수: {tts?.requiredSecrets.join(', ')}</small></article>
        <article className="evidence-card"><strong>Gateway control plane</strong><p>{manifest.mediaGateway?.controlPlane?.join(' · ')}</p><small>{manifest.mediaGateway?.scope}</small></article>
      </div>
    </section>}
    {error&&<div className="rag-error">{error}</div>}
  </main>;
}
