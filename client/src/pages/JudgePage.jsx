
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StarSlider from '../components/StarSlider';
import { apiFetch } from '../apiClient';

function JudgePage() {
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [scores, setScores] = useState({ prep: 0, resp: 0, exp: 0, inc: 0 });
  const [judgedTeamIds, setJudgedTeamIds] = useState([]);
  const [judgeScores, setJudgeScores] = useState({});
  const navigate = useNavigate();
  const judge = JSON.parse(localStorage.getItem('judge_token') || 'null');

  // Filter teams based on Judge Permissions
  // User Rule: "Moon Unju (문운주)" cannot judge INDIVIDUAL (Permission Check)
  // Filter teams based on Judge Permissions
  const judgeName = judge?.name || '';
  
  // DEBUG LOGGING
  console.log('Current Judge:', judgeName);
  
  const filteredTeams = teams.filter(t => {
      // Normalization
      const jName = judgeName.trim();
      const cat = (t.category || '').toUpperCase();

      if (t.judge_exempt) {
          return false;
      }
      // Permission Rule: Moon Unju cannot see INDIVIDUAL
      if (jName.includes('문운주') && cat === 'INDIVIDUAL') {
          console.log(`Skipping team ${t.name} (Category: ${cat}) for judge ${jName}`);
          return false;
      }
      return true;
  });

  const activeTeam = filteredTeams.find(t => t.status === 'LIVE');
  const waitingTeams = filteredTeams.filter(t => t.status === 'WAITING');
  const doneTeams = filteredTeams.filter(t => t.status === 'DONE');

  useEffect(() => {
    if (!judge) {
      navigate('/judge/login');
      return;
    }
    apiFetch('/api/teams')
      .then(res => res.json())
      .then(setTeams);

    apiFetch(`/api/judge/${judge.id}/scores`)
      .then(res => res.json())
      .then(data => {
        const scoreRows = Array.isArray(data.scores) ? data.scores : [];
        const idsFromScores = scoreRows
          .map(row => parseInt(row.team_id, 10))
          .filter(id => !Number.isNaN(id));

        const idsFromTeamIds = Array.isArray(data.teamIds)
          ? data.teamIds.map(n => parseInt(n, 10)).filter(id => !Number.isNaN(id))
          : [];

        const scoresByTeam = {};
        scoreRows.forEach(row => {
          if (row && row.team_id !== undefined) {
            const teamId = parseInt(row.team_id, 10);
            if (!Number.isNaN(teamId)) {
              scoresByTeam[teamId] = row.total;
            }
          }
        });

        // Backward compatibility: if API only returns teamIds, mark as judged without totals
        if (Object.keys(scoresByTeam).length === 0) {
          idsFromTeamIds.forEach(id => {
            scoresByTeam[id] = scoresByTeam[id] ?? null;
          });
        }

        const finalIds = idsFromScores.length > 0 ? idsFromScores : idsFromTeamIds;
        setJudgeScores(scoresByTeam);
        setJudgedTeamIds(finalIds);
      })
      .catch(() => {});
  }, [judge?.id]);

  const handleScoreChange = (field, val) => {
    setScores(prev => ({ ...prev, [field]: parseInt(val) || 0 }));
  };

  const submitScore = async () => {
    if (!selectedTeam) return;
    
    // Calculate total based on criteria
    // Group: Prep(25), Resp(25), Exp(25), Inc(25)
    // Individual: Prep(30), Resp(30), Exp(40)
    let total = 0;
    if (selectedTeam.category === 'GROUP') {
        total = scores.prep + scores.resp + scores.exp + scores.inc;
    } else {
        total = scores.prep + scores.resp + scores.exp;
    }

    if (total > 100) {
        alert("총점은 100점을 초과할 수 없습니다.");
        return;
    }

    await apiFetch('/api/judge/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            judgeId: judge.id, 
            teamId: selectedTeam.id, 
            scores: { ...scores, total } 
        })
    });

    alert(`${selectedTeam.name} 팀 채점 완료!`);
    setJudgedTeamIds(prev => prev.includes(selectedTeam.id) ? prev : [...prev, selectedTeam.id]);
    setJudgeScores(prev => ({ ...prev, [selectedTeam.id]: total }));
    setSelectedTeam(null);
    setScores({ prep: 0, resp: 0, exp: 0, inc: 0 });
  };

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>⚖️ 심사 패널</h2>
          <div style={{textAlign:'right'}}>
            <span style={{color: 'var(--text-secondary)', display:'block'}}>{judge?.name}님</span>
            {judge?.name?.includes('문운주') && <span style={{fontSize:'0.7rem', color:'orange'}}>* 개인부문 심사제외</span>}
          </div>
      </div>

      {!selectedTeam ? (
          <div className="fade-in">
              <p>채점할 팀을 선택하세요:</p>
              {filteredTeams.map(team => (
                  <div 
                      key={team.id} 
                      className="card" 
                      onClick={() => setSelectedTeam(team)} 
                      style={{ 
                          cursor: 'pointer', 
                          border: team.status === 'LIVE' ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)',
                          background: judgedTeamIds.includes(team.id) ? 'rgba(60, 210, 165, 0.14)' : undefined,
                          boxShadow: judgedTeamIds.includes(team.id) ? '0 0 0 1px rgba(60, 210, 165, 0.25), var(--shadow-card)' : undefined
                      }}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px'}}>
                          <b>{team.name}</b>
                          <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                              {team.status === 'LIVE' && <span style={{color:'red'}}>● 진행중</span>}
                              {judgedTeamIds.includes(team.id) && (
                                  <span style={{
                                      background: 'rgba(60, 210, 165, 0.2)',
                                      color: 'var(--success-color)',
                                      border: '1px solid rgba(60, 210, 165, 0.3)',
                                      borderRadius: '999px',
                                      padding: '2px 10px',
                                      fontSize: '0.8rem',
                                      fontWeight: 700
                                  }}>
                                      심사완료{judgeScores[team.id] !== undefined && judgeScores[team.id] !== null ? ` · ${judgeScores[team.id]}점` : ''}
                                  </span>
                              )}
                          </div>
                      </div>
                      <div style={{fontSize:'0.8rem', color:'#888'}}>{team.description}</div>
                  </div>
              ))}
          </div>
      ) : (
          <div className="fade-in card">
              <button className="btn btn-secondary" onClick={() => setSelectedTeam(null)} style={{marginBottom:'20px'}}>← 뒤로가기</button>
              
              <h3>채점: {selectedTeam.name}</h3>
              <p style={{fontSize:'0.9rem', color:'var(--text-secondary)'}}>분야: {selectedTeam.category === 'GROUP' ? '단체' : '개인'}</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <StarSlider 
                    label={`준비성/노력 (${selectedTeam.category === 'GROUP' ? 25 : 30}점)`}
                    maxScore={selectedTeam.category === 'GROUP' ? 25 : 30}
                    value={scores.prep}
                    onChange={val => handleScoreChange('prep', val)} 
                  />
                  
                  <StarSlider 
                    label={`호응도 (${selectedTeam.category === 'GROUP' ? 25 : 30}점)`}
                    maxScore={selectedTeam.category === 'GROUP' ? 25 : 30}
                    value={scores.resp}
                    onChange={val => handleScoreChange('resp', val)} 
                  />

                  <StarSlider 
                    label={`표현력/완성도 (${selectedTeam.category === 'GROUP' ? 25 : 40}점)`}
                    maxScore={selectedTeam.category === 'GROUP' ? 25 : 40}
                    value={scores.exp}
                    onChange={val => handleScoreChange('exp', val)} 
                  />

                  {selectedTeam.category === 'GROUP' && (
                      <StarSlider 
                        label="포용성/협력성 (25점)"
                        maxScore={25}
                        value={scores.inc}
                        onChange={val => handleScoreChange('inc', val)} 
                      />
                  )}

                  <div style={{ marginTop: '20px', textAlign: 'center' }}>
                      <h3>총점: {
                          selectedTeam.category === 'GROUP' 
                          ? scores.prep + scores.resp + scores.exp + scores.inc 
                          : scores.prep + scores.resp + scores.exp
                      } / 100</h3>
                  </div>

                  <button className="btn" onClick={submitScore}>점수 제출</button>
              </div>
          </div>
      )}
    </div>
  );
}

export default JudgePage;
