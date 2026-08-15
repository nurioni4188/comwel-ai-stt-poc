import { useState } from 'react';
import TestCallPage from './pages/TestCallPage';
import QualityDashboardPage from './pages/QualityDashboardPage';
import RagAnswerPage from './pages/RagAnswerPage';
import AutoVoiceLoopPage from './pages/AutoVoiceLoopPage';
import TelephonyAdapterPage from './pages/TelephonyAdapterPage';

function App() {
  const [view, setView] = useState<'stt' | 'dashboard' | 'rag' | 'auto' | 'telephony'>('stt');

  return (
    <>
      <nav className="app-nav" aria-label="주요 화면">
        <button type="button" className={view === 'stt' ? 'active' : ''} onClick={() => setView('stt')}>
          STT 테스트
        </button>
        <button type="button" className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>
          품질 대시보드
        </button>
        <button type="button" className={view === 'rag' ? 'active' : ''} onClick={() => setView('rag')}>
          승인근거 AI 답변
        </button>
        <button type="button" className={view === 'auto' ? 'active' : ''} onClick={() => setView('auto')}>
          자동 음성상담
        </button>
        <button type="button" className={view === 'telephony' ? 'active' : ''} onClick={() => setView('telephony')}>
          전화망 어댑터
        </button>
      </nav>
      {view === 'stt' ? <TestCallPage />
        : view === 'dashboard' ? <QualityDashboardPage />
          : view === 'rag' ? <RagAnswerPage />
            : view === 'auto' ? <AutoVoiceLoopPage />
              : <TelephonyAdapterPage />}
    </>
  );
}

export default App;
