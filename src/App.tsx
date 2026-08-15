import { useState } from 'react';
import TestCallPage from './pages/TestCallPage';
import QualityDashboardPage from './pages/QualityDashboardPage';

function App() {
  const [view, setView] = useState<'stt' | 'dashboard'>('stt');

  return (
    <>
      <nav className="app-nav" aria-label="주요 화면">
        <button type="button" className={view === 'stt' ? 'active' : ''} onClick={() => setView('stt')}>
          STT 테스트
        </button>
        <button type="button" className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>
          품질 대시보드
        </button>
      </nav>
      {view === 'stt' ? <TestCallPage /> : <QualityDashboardPage />}
    </>
  );
}

export default App;
