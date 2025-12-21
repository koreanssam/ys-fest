import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useNavigate } from 'react-router-dom';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

function AdminDashboard() {
  const [teams, setTeams] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [phase, setPhase] = useState('BOOTHS'); // Global Phase state
  const navigate = useNavigate();

  useEffect(() => {
    // Auth check
    if (!localStorage.getItem('admin_token')) {
      navigate('/admin/login');
      return;
    }

    // Initial fetch
    fetch('/api/teams').then(res => res.json()).then(setTeams);
    fetch('/api/phase').then(res => res.json()).then(d => setPhase(d.phase));

    // SSE Connection
    const eventSource = new EventSource('/api/stream/dashboard');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.teams) setTeams(data.teams); // Handle update
      else setTeams(data); // Handle initial or direct array
      setIsConnected(true);
    };
    
    eventSource.onerror = (err) => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [navigate]);

  const startEdit = (team) => {
      setEditingId(team.id);
      setEditName(team.name);
      setEditDesc(team.description);
  };

  const saveEdit = async (id) => {
      await fetch(`/api/admin/team/${id}`, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ name: editName, description: editDesc })
      });
      setEditingId(null);
  };

  const updateStatus = (teamId, status) => {
    // Optimistic UI update to avoid waiting for SSE roundtrip
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, status } : t));
    fetch('/api/admin/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, status })
    }).catch(() => {
        // Fallback: refetch if request fails
        fetch('/api/teams').then(res => res.json()).then(setTeams);
    });
  };

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('dragIndex', index);
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // Necessary for Drop
  };

  const handleDrop = async (e, dropIndex) => {
    const dragIndex = parseInt(e.dataTransfer.getData('dragIndex'));
    if (dragIndex === dropIndex) return;

    const newTeams = [...teams];
    const item = newTeams.splice(dragIndex, 1)[0];
    newTeams.splice(dropIndex, 0, item);

    // Optimistic UI
    setTeams(newTeams);

    // Sync to Server
    const orders = newTeams.map((t, i) => ({ id: t.id, order: i + 1 }));
    await fetch('/api/admin/team/reorder', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ orders })
    });
  };

  // --- Toggle Phase ---
  // No explicit function needed if we inline in onChange, but let's keep it clean
  const togglePhase = (e) => {
      const newP = e.target.checked ? 'PERFORMANCE' : 'BOOTHS';
      setPhase(newP); // Optimistic
      fetch('/api/admin/phase', { 
           method: 'POST', 
           headers: {'Content-Type': 'application/json'},
           body: JSON.stringify({ phase: newP })
       });
  };

  // Chart Data
  const chartData = {
    labels: teams.map(t => t.name),
    datasets: [
      {
        label: 'Votes',
        data: teams.map(t => t.vote_count),
        backgroundColor: 'rgba(255, 64, 129, 0.7)',
        borderColor: 'rgba(255, 64, 129, 1)',
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Real-time Vote Counts' },
    },
    scales: {
        y: { beginAtZero: true }
    }
  };

  return (
    <div className="container" style={{ maxWidth: '1200px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Dashboard</h2>
        <span style={{ color: isConnected ? 'green' : 'red' }}>
             {isConnected ? '● Live' : '○ Disconnected'}
        </span>
      </div>

      <div className="card">
        <Bar data={chartData} options={options} />
      </div>

      <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{margin:0}}>진행 단계 ({phase === 'BOOTHS' ? '부스 운영' : '공연'})</h3>
                <p style={{color:'#888', margin:0}}>{phase === 'BOOTHS' ? '현재 부스 탭만 보입니다.' : '현재 공연 탭만 보입니다.'}</p>
              </div>
              
              <label className="switch">
                  <input type="checkbox" checked={phase === 'PERFORMANCE'} onChange={togglePhase} />
                  <span className="slider round"></span>
              </label>
          </div>
          
          <div style={{ marginTop: '20px', display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap' }}>
               <button className="btn btn-compact" onClick={() => navigate('/admin/scoreboard')}>🏆 스코어보드 열기</button>
               <button className="btn btn-secondary btn-compact" onClick={() => navigate('/admin/booths')}>🏫 부스 관리</button>
               
               <div style={{marginLeft: 'auto', display:'flex', alignItems:'center', gap:'8px', background: 'rgba(255,255,255,0.05)', padding: '5px 10px', borderRadius:'8px'}}>
                    <span style={{fontSize:'0.8rem'}}>🧹 청소 알림 시간 설정:</span>
                    <input type="datetime-local" style={{padding:'4px', fontSize:'0.8rem', width:'180px'}} onChange={(e) => {
                        const val = e.target.value; // "YYYY-MM-DDTHH:mm"
                        if(val) {
                            fetch('/api/admin/cleanup', {
                                method: 'POST',
                                headers: {'Content-Type':'application/json'},
                                body: JSON.stringify({ target: val })
                            });
                        }
                    }} />
               </div>
          </div>
      </div>

      <div className="card">
        <h3>무대 관리 (Drag & Drop to Reorder)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
                    <th style={{padding: '10px'}}>순서</th>
                    <th style={{padding: '10px'}}>팀명</th>
                    <th style={{padding: '10px'}}>현재 상태</th>
                    <th style={{padding: '10px'}}>관리</th>
                </tr>
            </thead>
            <tbody>
                {teams.map((team, idx) => (
                    <tr 
                        key={team.id} 
                        draggable 
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, idx)}
                        style={{ borderBottom: '1px solid #333', cursor: 'grab', background: 'var(--card-bg)' }}
                    >
                        <td style={{padding: '10px'}}>
                            <span style={{fontSize:'1.2rem'}}>☰</span> {idx + 1}
                        </td>
                        <td style={{padding: '10px'}}>
                            {editingId === team.id ? (
                                <div>
                                    <input value={editName} onChange={e => setEditName(e.target.value)} style={{marginBottom:'4px'}} />
                                    <input value={editDesc} onChange={e => setEditDesc(e.target.value)} />
                                    <button className="btn" style={{padding: '4px 8px', fontSize: '0.7rem', marginTop:'4px'}} onClick={() => saveEdit(team.id)}>저장</button>
                                    <button className="btn btn-secondary" style={{padding: '4px 8px', fontSize: '0.7rem', marginTop:'4px'}} onClick={() => setEditingId(null)}>취소</button>
                                </div>
                            ) : (
                                <div onClick={() => startEdit(team)} style={{cursor:'pointer', borderBottom:'1px dashed #666', display:'inline-block'}}>
                                    {team.name}
                                    <div style={{fontSize: '0.8rem', color: '#888'}}>{team.description}</div>
                                </div>
                            )}
                        </td>
                        <td style={{padding: '10px'}}>
                            <span style={{ 
                                padding: '4px 8px', borderRadius: '4px', 
                                background: team.status === 'LIVE' ? 'red' : team.status === 'HIDDEN' ? '#777' : '#444' 
                            }}>
                                {team.status}
                            </span>
                        </td>
                        <td style={{padding: '10px'}}>
                            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', marginRight:'8px', background: '#222', border: '1px solid #444' }} onClick={() => updateStatus(team.id, 'HIDDEN')}>숨김</button>
                            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', marginRight:'8px' }} onClick={() => updateStatus(team.id, 'WAITING')}>대기</button>
                            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', marginRight:'8px', background: 'red' }} onClick={() => updateStatus(team.id, 'LIVE')}>라이브</button>
                            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', marginRight:'8px', background: '#555' }} onClick={() => updateStatus(team.id, 'DONE')}>완료</button>
                            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#333', border: '1px solid #555' }} onClick={async () => {
                                if(confirm('정말 이 팀을 삭제하시겠습니까? (되돌릴 수 없습니다!)')) {
                                    await fetch(`/api/admin/team/${team.id}`, { method: 'DELETE' });
                                    // SSE handles update, but optimistic update is good too
                                    setTeams(prev => prev.filter(t => t.id !== team.id));
                                }
                            }}>🗑️ 삭제</button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
        
        <h4 style={{marginTop:'20px'}}>새 팀 추가</h4>
        <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
            <input placeholder="팀명 (예: 1학년 3반)" id="newTeamName" />
            <input placeholder="곡명/설명" id="newTeamDesc" />
            <select id="newTeamCategory" style={{width:'auto'}}>
                <option value="GROUP">단체</option>
                <option value="INDIVIDUAL">개인</option>
            </select>
            <button className="btn" onClick={() => {
                const name = document.getElementById('newTeamName').value;
                const description = document.getElementById('newTeamDesc').value;
                const category = document.getElementById('newTeamCategory').value;
                
                if(!name) {
                    alert('팀명을 입력해주세요.');
                    return;
                }

                fetch('/api/admin/team', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ name, description, category })
                })
                .then(res => res.json())
                .then(data => {
                    if(data.success) {
                        alert('팀이 추가되었습니다!');
                        document.getElementById('newTeamName').value = '';
                        document.getElementById('newTeamDesc').value = '';
                        // Refresh logic if SSE is slow
                        fetch('/api/teams').then(res => res.json()).then(setTeams);
                    } else {
                        alert('추가 실패: ' + (data.error || 'Unknown error'));
                    }
                })
                .catch(err => alert('Network Error: ' + err));
            }}>추가</button>
        </div>

      </div>
    </div>
  );
}

export default AdminDashboard;
