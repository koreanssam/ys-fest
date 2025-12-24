import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import InfoTab from './components/InfoTab';
import TimetableTab from './components/TimetableTab';
import BoothList from './components/BoothList';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import AdminScoreboard from './pages/AdminScoreboard';
import AdminBooths from './pages/AdminBooths';
import JudgeLogin from './pages/JudgeLogin';
import JudgePage from './pages/JudgePage';
import BoothOps from './pages/BoothOps';
import { apiFetch } from './apiClient';

function UserApp() {
  const [activeTab, setActiveTab] = useState('info');
  const [phase, setPhase] = useState('BOOTHS'); // Default

  useEffect(() => {
    // Poll system phase every 3 seconds to auto-switch tabs for users
    const pollPhase = () => {
        apiFetch('/api/phase')
            .then(res => res.json())
            .then(data => {
                setPhase(data.phase);
                // Only auto-switch if user hasn't manually overridden? 
                // For now, let's just highlight the right tab or force switch if desired.
                // PRD said "Mode auto/manual toggle". Let's stick to highlighting or basic state.
                // Actually user asked for "Main page adapts... to time/phase".
                // I'll make it switch active tab ONLY if the user is on the 'wrong' mode potentially, or just let them click.
                // But strictly speaking, "Dynamic Main Page" implies content changes.
                // Let's set the default active tab if it changes.
            })
            .catch(err => console.log(err));
    };

    pollPhase(); // Initial
    const interval = setInterval(pollPhase, 3000); // Poll
    return () => clearInterval(interval);
  }, []);

  // Effect to switch tab when phase changes (optional, but requested behavior for "Dynamic")
  useEffect(() => {
    if (phase === 'BOOTHS') setActiveTab('booths');
    if (phase === 'PERFORMANCE') setActiveTab('timetable');
  }, [phase]);

  return (
    <div className="container">
       <div className="logo-area">
          <div className="logo-text">영축한마당</div>
          <div className="title-row">
            <div style={{color:'var(--text-secondary)', fontSize:'0.9rem', letterSpacing:'0.2em'}}>2025 OFFICIAL</div>
            <div className={`badge-phase ${phase === 'BOOTHS' ? 'badge-phase--booths' : 'badge-phase--performance'}`}>
              {phase === 'BOOTHS' ? '부스 진행중' : '공연 진행중'}
            </div>
          </div>
       </div>

       <div className="tabs">
          <div className={`tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>
            안내
          </div>
          {/* Strict Phase Visibility: BOOTHS only shows Booths, PERFORMANCE only shows Stages. Info always available? Usually yes. */}
          {phase === 'BOOTHS' && (
              <div className={`tab ${activeTab === 'booths' ? 'active' : ''}`} onClick={() => setActiveTab('booths')}>
                부스마당
              </div>
          )}
          {phase === 'PERFORMANCE' && (
              <div className={`tab ${activeTab === 'timetable' ? 'active' : ''}`} onClick={() => setActiveTab('timetable')}>
                공연마당
              </div>
          )}
       </div>

       <div className="content">
          {activeTab === 'info' && <InfoTab />}
          {activeTab === 'booths' && <BoothList />}
          {activeTab === 'timetable' && <TimetableTab />}
       </div>
    </div>
  );
}

function App() {
  const basename = import.meta.env.BASE_URL || '/';

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<UserApp />} />
        
        {/* Admin Routes */}
        <Route path="/admin" element={<Navigate to="/admin/login" />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/scoreboard" element={<AdminScoreboard />} />
        <Route path="/admin/booths" element={<AdminBooths />} />

        {/* Judge Routes */}
        <Route path="/judge" element={<Navigate to="/judge/login" />} />
        <Route path="/judge/login" element={<JudgeLogin />} />
        <Route path="/judge/vote" element={<JudgePage />} />

        {/* Booth Ops */}
        <Route path="/booth-ops" element={<BoothOps />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
