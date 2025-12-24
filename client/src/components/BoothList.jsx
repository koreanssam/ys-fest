import React, { useEffect, useState, useRef } from 'react';
import { apiFetch } from '../apiClient';

function BoothList() {
  const [booths, setBooths] = useState([]);
  const [isCleanupTime, setIsCleanupTime] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  
  // Use ref to keep track of target time without closure staleness issues in setInterval
  const cleanupTarget = useRef(null); 

  useEffect(() => {
    apiFetch('/api/booths')
      .then(res => res.json())
      .then(data => setBooths(data));

    const parseTarget = (val) => {
        if (!val) return null;
        const direct = new Date(val);
        if (!isNaN(direct.getTime())) return direct;
        // Fallback: assume local time string missing timezone -> append 'Z'
        const withZ = new Date(`${val}Z`);
        if (!isNaN(withZ.getTime())) return withZ;
        return null;
    };

    const fetchCleanup = () => {
        apiFetch('/api/cleanup', { cache: 'no-store' })
          .then(r => r.json())
          .then(d => {
              const parsed = parseTarget(d.target);
              if (parsed) cleanupTarget.current = parsed;
          })
          .catch(e => console.error("Time fetch error", e));
    };
    fetchCleanup();

    const checkTime = () => {
        const targetTime = cleanupTarget.current;
        if (!targetTime) return; // Wait for server config

        const now = new Date();
        const start = targetTime;
        const end = new Date(start.getTime() + 60 * 60 * 1000); 
        
        if (now >= start && now < end) {
            setIsCleanupTime(true);
            const diff = end - now;
            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            setTimeLeft(`${m}:${s < 10 ? '0'+s : s}`);
        } else {
            setIsCleanupTime(false);
        }
    };

    const interval = setInterval(checkTime, 1000);
    const syncInterval = setInterval(fetchCleanup, 3000); // faster sync for admin changes

    return () => {
        clearInterval(interval);
        clearInterval(syncInterval);
    };
  }, []);

  return (
    <div className="fade-in">
        {isCleanupTime && (
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
                background: 'rgba(255,0,0,0.25)', zIndex: 99, 
                display: 'flex', flexDirection: 'column',
                justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'
            }}>
                <h1 style={{fontSize: '3rem', color: 'red', textShadow: '0 0 20px black'}}>🧹 정리 정돈 시간!</h1>
                <h2 style={{fontSize: '5rem', color: 'white', textShadow: '0 0 20px red'}}>{timeLeft}</h2>
                <p style={{fontSize: '1.3rem', color: 'white', background: 'rgba(0,0,0,0.7)', padding: '10px 16px', borderRadius: '12px'}}>남은 시간 (시작 시점부터 1시간)</p>
            </div>
        )}

        <div>
            <h2 className="section-title">🏫 학급 부스 운영</h2>
            <p className="section-sub">09:30 ~ 12:00</p>
        </div>

        <div className="card-grid">
          {booths.map((booth, idx) => (
              <div key={idx} className="booth-card">
                  <div className="meta-row">
                      <span className="chip chip--accent">{booth.class_name}</span>
                      <span className="pill">{booth.location}</span>
                  </div>
                  <h3 style={{ margin: '6px 0 4px', fontSize: '1.2rem' }}>{booth.name}</h3>
                  <p className="muted" style={{ margin: 0, lineHeight: 1.4 }}>{booth.description}</p>
              </div>
          ))}
        </div>
    </div>
  );
}

export default BoothList;
