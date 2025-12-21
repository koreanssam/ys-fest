import React, { useState, useEffect, useRef } from 'react';

// Batching logic could be global, but for simplicity we can trigger headers here or use a context.
// Actually, detailed plan says "Client collects votes and sends every 1s".
// We'll implement a simple global batcher in a utility or just inside the component if we want isolated logic 
// (but isolated logic means multiple requests if not careful). 
// Better: Global accumulator.

// We will use a simple window helper for batching to keep it simple without Redux.
if (!window.voteQueue) window.voteQueue = {};

// Flush queue every 1s
if (!window.voteInterval) {
  window.voteInterval = setInterval(() => {
    const queue = window.voteQueue;
    if (Object.keys(queue).length === 0) return;

    // Send payload
    // We can send one request per team or one bulk request. API said:
    // "POST /api/vote body: { teamId, count }" - implies per team.
    // We will iterate and send.
    Object.keys(queue).forEach(teamId => {
      const count = queue[teamId];
      if (count > 0) {
        fetch('/api/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamId: parseInt(teamId), count })
        }).catch(err => console.error("Vote failed", err));
        
        // Reset
        queue[teamId] = 0;
      }
    });
  }, 1000);
}

function TeamCard({ team, isLive }) {
  // Optimistic UI state
  const [votes, setVotes] = useState(team.vote_count);
  const [animate, setAnimate] = useState(false);
  const [burst, setBurst] = useState([]);
  const isDone = team.status === 'DONE';
  const burstCountRef = useRef(0);
  const cardRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    setVotes(team.vote_count);
  }, [team.vote_count]);
  
  const handleVote = () => {
    if (team.status !== 'LIVE') return;

    setVotes(prev => prev + 1);
    setAnimate(true);
    setTimeout(() => setAnimate(false), 300);

    // Heart burst (visual only)
    const id = Date.now() + Math.random();
    burstCountRef.current += 1;
    const size = Math.min(22 + burstCountRef.current * 6, 64); // grows faster with rapid clicks, capped
    const hue = 320 + Math.random() * 60; // wider pink-magenta range
    const dx = (Math.random() - 0.5) * 140; // -70~70px scatter
    const rot = (Math.random() - 0.5) * 60; // -30~30 deg
    const scaleMid = Math.min(1.4 + size * 0.025, 3.0);
    const scaleEnd = Math.min(1.1 + size * 0.018, 2.2);
    const lifetime = 650;

    // start offsets: button center relative to card center
    let sx = 0;
    let sy = 0;
    if (cardRef.current && buttonRef.current) {
      const cardRect = cardRef.current.getBoundingClientRect();
      const btnRect = buttonRef.current.getBoundingClientRect();
      sx = (btnRect.left + btnRect.width / 2) - (cardRect.left + cardRect.width / 2);
      sy = (btnRect.top + btnRect.height / 2) - (cardRect.top + cardRect.height / 2);
    }

    setBurst(prev => [...prev, { id, size, hue, dx, rot, scaleMid, scaleEnd, sx, sy, rise: 220 }]);
    setTimeout(() => {
      setBurst(prev => prev.filter(b => b.id !== id));
      burstCountRef.current = Math.max(0, burstCountRef.current - 1);
    }, lifetime);

    // Queue vote
    if (!window.voteQueue[team.id]) window.voteQueue[team.id] = 0;
    window.voteQueue[team.id]++;
  };


  return (
    <div ref={cardRef} className={`card team-card ${isLive ? 'live' : ''} ${isDone ? 'done' : ''}`}>
        <div className="burst-layer">
            {burst.map(b => (
              <span 
                key={b.id} 
                className="heart-pop-anim"
                style={{
                  color: `hsl(${b.hue || 340}, 85%, 65%)`,
                  fontSize: `${b.size || 22}px`,
                  '--dx': `${b.dx || 0}px`,
                  '--rot': `${b.rot || 0}deg`,
                  '--scaleMid': `${b.scaleMid || 1.6}`,
                  '--scaleEnd': `${b.scaleEnd || 1.2}`,
                  '--startX': `${b.sx || 0}px`,
                  '--startY': `${b.sy || 0}px`,
                  '--rise': `${b.rise || 220}px`
                }}
              >
                ♥
              </span>
            ))}
        </div>
        <div>
            <img 
                className="team-thumb"
                src={team.image_url || "/images/coming-soon.svg"} 
                alt={team.name} 
                loading="lazy"
                onError={(e) => { e.target.onerror = null; e.target.src = "/images/coming-soon.svg"; }}
            />
        </div>
        
        <div className="meta-row">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="pill">#{team.perf_order}</span>
                <span className={`chip ${team.category === 'GROUP' ? 'chip--success' : 'chip--warn'}`}>
                    {team.category === 'GROUP' ? '단체' : '개인'}
                </span>
            </div>
            {team.status === 'LIVE' && <span className="status-dot btn-pulse">● LIVE</span>}
            {isDone && <span className="pill">종료</span>}
        </div>
        
        <h3 style={{ margin: '4px 0 4px', fontSize: isLive ? '1.35rem' : '1.15rem' }}>{team.name}</h3>
        <p className="muted" style={{ margin: '0 0 10px', lineHeight: 1.5 }}>
            {team.description}
        </p>

        <div className="vote-row">
            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                {votes.toLocaleString()} <span className="small">표</span>
            </div>
            <button 
                className={`btn ${animate ? 'heart-pop' : ''}`} 
                onClick={handleVote}
                disabled={team.status !== 'LIVE'}
                ref={buttonRef}
                style={{ 
                    background: team.status === 'LIVE' ? 'linear-gradient(135deg, var(--accent-grad-start), var(--accent-grad-end))' : 'rgba(255,255,255,0.08)',
                    boxShadow: team.status === 'LIVE' ? 'var(--shadow-glow)' : 'none',
                    minWidth: '120px',
                    opacity: team.status === 'LIVE' ? 1 : 0.6,
                    cursor: team.status === 'LIVE' ? 'pointer' : 'not-allowed'
                }}
            >
                {team.status === 'LIVE' ? '♥ 좋아요' : '대기중'}
            </button>
        </div>
    </div>
  );
}

export default TeamCard;
