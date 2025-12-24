import React, { useEffect, useState } from 'react';
import TeamCard from './TeamCard';
import { apiEventSource, apiFetch } from '../apiClient';

function TimetableTab() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);

  useEffect(() => {
    fetchTeams();

    // SSE for near-instant updates when admin changes status/order
    const es = apiEventSource('/api/stream/dashboard');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setTeams(Array.isArray(data.teams) ? data.teams : data);
        setLoading(false);
        setSseConnected(true);
      } catch (err) {
        console.error('SSE parse error', err);
      }
    };
    es.onerror = () => {
      setSseConnected(false);
    };

    // Fallback poll every 10s if SSE drops
    const interval = setInterval(() => {
      if (!sseConnected) fetchTeams();
    }, 10000);

    return () => {
      es.close();
      clearInterval(interval);
    };
  }, []);

  const fetchTeams = () => {
    apiFetch('/api/teams')
      .then(res => res.json())
      .then(data => {
        setTeams(data);
        setLoading(false);
      })
      .catch(err => console.error("Failed to load teams", err));
  };

  if (loading) return <div style={{textAlign: 'center', padding: '20px'}}>라인업 불러오는 중...</div>;

  const sortPriority = { 'LIVE': 0, 'WAITING': 1, 'GROUP': 1, 'INDIVIDUAL': 1, 'DONE': 2, 'HIDDEN': 3 };

  return (
    <div style={{ paddingBottom: '60px' }}>
      <h2 className="section-title">🎤 공연 순서</h2>
      <p className="section-sub">실시간 투표 집계 중 · 10초마다 자동 갱신</p>

      <div className="card-grid">
        {teams
          .filter(t => t.status !== 'HIDDEN')
          .sort((a, b) => {
               const pa = sortPriority[a.status] ?? 5;
               const pb = sortPriority[b.status] ?? 5;
               if (pa !== pb) return pa - pb;
               return a.perf_order - b.perf_order;
          })
          .map(team => (
            <TeamCard key={team.id} team={team} isLive={team.status === 'LIVE'} />
        ))}
      </div>
    </div>
  );
}

export default TimetableTab;
