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

  useEffect(() => {
    setVotes(team.vote_count);
  }, [team.vote_count]);
  
  const handleVote = () => {
    if (team.status !== 'LIVE') return;

    setVotes(prev => prev + 1);
    setAnimate(true);
    setTimeout(() => setAnimate(false), 300);

    // Queue vote
    if (!window.voteQueue[team.id]) window.voteQueue[team.id] = 0;
    window.voteQueue[team.id]++;
  };


  return (
    <div className="card team-card" style={{ 
        border: isLive ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)',
        transform: isLive ? 'scale(1.02)' : 'none',
        boxShadow: isLive ? '0 0 20px var(--accent-glow)' : 'var(--shadow-card)',
        marginBottom: '16px',
        transition: 'all 0.3s ease'
    }}>
        <div style={{ position: 'relative' }}>
            <img 
                src={team.image_url || "/images/coming-soon.svg"} 
                alt={team.name} 
                onError={(e) => { e.target.onerror = null; e.target.src = "/images/coming-soon.svg"; }}
                style={{ width: '100%', borderRadius: 'var(--radius-md)', marginBottom: '12px', maxHeight: isLive ? '400px' : '150px', objectFit:'cover' }}
            />
            {/* User requested removal of redundant badge. We only keep the text status below. */}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div>
                <span style={{ fontSize: '0.8rem', color: '#888', marginRight: '8px' }}>#{team.perf_order}</span>
                <span style={{ 
                    padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold',
                    background: team.category === 'GROUP' ? 'rgba(0,255,157,0.1)' : 'rgba(255,204,0,0.1)',
                    color: team.category === 'GROUP' ? 'var(--success-color)' : 'var(--warning-color)'
                }}>
                    {team.category === 'GROUP' ? '단체' : '개인'}
                </span>
            </div>
            {team.status === 'LIVE' && <span className="btn-pulse" style={{color:'red', fontSize:'0.8rem', fontWeight:'bold'}}>● 실시간 진행중</span>}
        </div>
        
        <h3 style={{ margin: '0 0 8px 0', fontSize: isLive ? '1.5rem' : '1.2rem' }}>{team.name}</h3>
        <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {team.description}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                {votes.toLocaleString()} <span style={{fontSize:'0.8rem'}}>표</span>
            </div>
            <button 
                className={`btn ${animate ? 'heart-pop' : ''}`} 
                onClick={handleVote}
                disabled={team.status !== 'LIVE'}
                style={{ 
                    background: team.status === 'LIVE' ? 'var(--accent-color)' : '#444',
                    boxShadow: team.status === 'LIVE' ? 'var(--shadow-glow)' : 'none',
                    minWidth: '100px',
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
