import React, { useEffect, useState } from 'react';
import TeamCard from './TeamCard';

function TimetableTab() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTeams();
    // Optional: Poll every 10s to sync actual counts? 
    // Or just rely on user activity. Let's poll to show others' votes too.
    const interval = setInterval(fetchTeams, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchTeams = () => {
    fetch('/api/teams')
      .then(res => res.json())
      .then(data => {
        setTeams(data);
        setLoading(false);
      })
      .catch(err => console.error("Failed to load teams", err));
  };

  if (loading) return <div style={{textAlign: 'center', padding: '20px'}}>라인업 불러오는 중...</div>;

  return (
    <div style={{ paddingBottom: '80px' }}>
      {teams
        .filter(t => t.status !== 'HIDDEN')
        .sort((a, b) => {
             // Sort by status (LIVE first) then by order
             if (a.status === 'LIVE' && b.status !== 'LIVE') return -1;
             if (a.status !== 'LIVE' && b.status === 'LIVE') return 1;
             return a.perf_order - b.perf_order;
        })
        .map(team => (
        <TeamCard key={team.id} team={team} isLive={team.status === 'LIVE'} />
      ))}
      <div style={{ textAlign: 'center', margin: '20px', color: '#666' }}>
        실시간 투표 집계 중 (10초마다 갱신)
      </div>
    </div>
  );
}

export default TimetableTab;
