import React, { useEffect, useState, useRef } from 'react';

function BoothList() {
  const [booths, setBooths] = useState([]);
  const [isCleanupTime, setIsCleanupTime] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  
  // Use ref to keep track of target time without closure staleness issues in setInterval
  const cleanupTarget = useRef(null); 

  useEffect(() => {
    fetch('/api/booths')
      .then(res => res.json())
      .then(data => setBooths(data));

    const fetchCleanup = () => {
        fetch('/api/cleanup').then(r => r.json()).then(d => {
            if(d.target) cleanupTarget.current = new Date(d.target);
        }).catch(e => console.error("Time fetch error", e));
    };
    fetchCleanup();

    const checkTime = () => {
        const targetTime = cleanupTarget.current;
        if (!targetTime) return; // Wait for server config

        const now = new Date();
        const start = targetTime;
        // End is 1 hour after start? Or fixed 12:00?
        // Let's assume cleanup session is 1 hour default
        const end = new Date(start.getTime() + 60 * 60 * 1000); 
        
        // If current time is within [start, end)
        if (now >= start && now < end) {
            setIsCleanupTime(true);
            const diff = end - now;
            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            setTimeLeft(`${m}:${s < 10 ? '0'+s : s}`);
        } else {
             // If manually untoggled by test button, honor that? 
             // But effect resets it. For test button to persist, we need separate state or let test button override for X seconds.
             // For now, let real time logic prevail unless we're in "Test Mode".
             if (!window.testMode) setIsCleanupTime(false);
        }
    };

    const interval = setInterval(checkTime, 1000);
    const syncInterval = setInterval(fetchCleanup, 10000); // Sync config every 10s

    return () => {
        clearInterval(interval);
        clearInterval(syncInterval);
    };
  }, []);

  return (
    <div className={`fade-in ${isCleanupTime ? 'cleanup-alert' : ''}`}>
        
        {isCleanupTime && (
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
                background: 'rgba(255,0,0,0.2)', zIndex: 99, 
                display: 'flex', flexDirection: 'column',
                justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'
            }}>
                <h1 style={{fontSize: '3rem', color: 'red', textShadow: '0 0 20px black'}}>🧹 정리 정돈 시간!</h1>
                <h2 style={{fontSize: '5rem', color: 'white', textShadow: '0 0 20px red'}}>{timeLeft}</h2>
                <p style={{fontSize: '1.5rem', color: 'white', background: 'rgba(0,0,0,0.8)', padding: '10px'}}>남은 시간 (12:00 종료)</p>
            </div>
        )}

        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <h2>🏫 학급 부스 운영</h2>
            <p style={{ color: 'var(--text-secondary)' }}>09:30 ~ 12:00</p>
        </div>

        {booths.map((booth, idx) => (
            <div key={idx} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ 
                        background: 'rgba(255,255,255,0.1)', 
                        padding: '4px 8px', borderRadius: '8px', 
                        fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--accent-color)'
                    }}>
                        {booth.class_name}
                    </span>
                    <span style={{ fontSize: '0.9rem', color: '#888' }}>{booth.location}</span>
                </div>
                <h3 style={{ margin: 0, fontSize: '1.4rem' }}>{booth.name}</h3>
                <p style={{ margin: 0, color: '#ccc' }}>{booth.description}</p>
            </div>
        ))}
    </div>
  );
}

export default BoothList;
