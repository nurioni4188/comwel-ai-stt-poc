import { useMemo, useState } from 'react';
import type { TelephonyInboundEvent, TelephonyOutboundCommand } from '../telephony/types';
import { simulatorTelephonyAdapter } from '../telephony/simulatorAdapter';
import './RagAnswerPage.css';

type LogRow = {
  direction: 'IN' | 'OUT';
  label: string;
  payload: unknown;
};

function now() {
  return new Date().toISOString();
}

export default function TelephonyAdapterPage() {
  const [callId, setCallId] = useState(() => crypto.randomUUID());
  const [sequence, setSequence] = useState(0);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [status, setStatus] = useState<'idle' | 'connected' | 'handoff' | 'ended'>('idle');

  const capabilities = simulatorTelephonyAdapter.capabilities;
  const statusLabel = useMemo(() => ({
    idle: '대기',
    connected: '통화 연결',
    handoff: '담당자 전환 요청',
    ended: '통화 종료',
  }[status]), [status]);

  const nextSequence = () => {
    const next = sequence + 1;
    setSequence(next);
    return next;
  };

  const pushInbound = (event: TelephonyInboundEvent, label: string) => {
    const normalized = simulatorTelephonyAdapter.normalizeInbound(event);
    setLogs((prev) => [...prev, { direction: 'IN', label, payload: normalized }]);
  };

  const pushOutbound = (command: TelephonyOutboundCommand, label: string) => {
    const encoded = simulatorTelephonyAdapter.encodeOutbound(command);
    setLogs((prev) => [...prev, { direction: 'OUT', label, payload: encoded }]);
  };

  const startCall = () => {
    const id = crypto.randomUUID();
    setCallId(id);
    setSequence(1);
    setLogs([]);
    setStatus('connected');
    pushInbound({ type: 'call.started', callId: id, sequence: 1, occurredAt: now(), from: 'TEST_CALLER', to: 'COMWEL_AI' }, '전화 수신');
  };

  const receiveAudio = () => {
    if (status !== 'connected') return;
    pushInbound({
      type: 'audio.inbound',
      callId,
      sequence: nextSequence(),
      occurredAt: now(),
      format: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      payloadBase64: 'UENNX1NJTVVMQVRFRF9GUkFNRQ==',
    }, '인바운드 음성 프레임');
  };

  const sendAudio = () => {
    if (status !== 'connected') return;
    pushOutbound({
      type: 'audio.outbound',
      callId,
      sequence: nextSequence(),
      format: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      payloadBase64: 'UENNX1NJTVVMQVRFRF9SRVNQT05TRQ==',
    }, '아웃바운드 음성 프레임');
  };

  const requestHandoff = () => {
    if (status !== 'connected') return;
    setStatus('handoff');
    pushOutbound({
      type: 'call.handoff',
      callId,
      sequence: nextSequence(),
      reason: 'insufficient_evidence',
      target: 'human-agent',
    }, '담당자 전환');
  };

  const endCall = () => {
    if (status === 'idle' || status === 'ended') return;
    const seq = nextSequence();
    pushInbound({ type: 'call.stopped', callId, sequence: seq, occurredAt: now(), reason: 'completed' }, '통화 종료');
    setStatus('ended');
  };

  return (
    <main className="rag-page">
      <header className="rag-header">
        <p className="rag-kicker">COMWEL AI STT PoC · v0.12.0</p>
        <h1>Telephony Adapter Baseline</h1>
        <p>전화사업자별 프로토콜을 핵심 AI 엔진에서 분리하고, 공통 통화 이벤트/명령 계약으로 연결합니다.</p>
      </header>

      <section className="rag-warning">
        <strong>사업자 중립 기준선</strong> · 실제 PSTN/SIP 연결 없음 · 실전화번호 없음 · 실제 음성 저장 없음 · 자동처분/자동발송 없음
      </section>

      <section className="rag-input-card">
        <h2>표준 계약</h2>
        <p><strong>상태:</strong> {statusLabel}</p>
        <p><strong>내부 표준 오디오:</strong> PCM signed 16-bit LE · 16 kHz · mono</p>
        <p><strong>수신 이벤트:</strong> call.started / audio.inbound / dtmf.received / call.stopped</p>
        <p><strong>송신 명령:</strong> audio.outbound / audio.clear / call.handoff / call.hangup</p>
        <p><strong>현재 어댑터:</strong> {capabilities.provider} · bidirectional={String(capabilities.supportsBidirectionalMedia)} · handoff={String(capabilities.supportsHandoff)}</p>
      </section>

      <section className="rag-input-card">
        <h2>통화 시뮬레이터</h2>
        <p><strong>callId:</strong> {callId}</p>
        <div className="rag-actions">
          <button className="primary" type="button" onClick={startCall}>☎ 시험 통화 시작</button>
          <button type="button" disabled={status !== 'connected'} onClick={receiveAudio}>수신 음성 프레임</button>
          <button type="button" disabled={status !== 'connected'} onClick={sendAudio}>AI 음성 프레임 송신</button>
          <button type="button" disabled={status !== 'connected'} onClick={requestHandoff}>담당자 전환</button>
          <button type="button" disabled={status === 'idle' || status === 'ended'} onClick={endCall}>통화 종료</button>
        </div>
      </section>

      <section className="rag-result">
        <div className="rag-result-top">
          <h2>어댑터 이벤트 로그</h2>
          <button type="button" onClick={() => setLogs([])}>로그 초기화</button>
        </div>
        {logs.length === 0 ? <p>(아직 이벤트 없음)</p> : (
          <div className="evidence-list">
            {logs.map((row, index) => (
              <article className="evidence-card" key={`${row.direction}-${index}`}>
                <strong>{row.direction} · {row.label}</strong>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.payload, null, 2)}</pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
