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
import { apiEventSource, apiFetch } from '../apiClient';

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
  const [uploadingTeamId, setUploadingTeamId] = useState(null);
  const [studentCount, setStudentCount] = useState(null);
  const [studentCsvFile, setStudentCsvFile] = useState(null);
  const [studentImportMode, setStudentImportMode] = useState('replace');
  const [studentResetUsage, setStudentResetUsage] = useState(false);
  const [studentImporting, setStudentImporting] = useState(false);
  const [studentImportResult, setStudentImportResult] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Auth check
    if (!localStorage.getItem('admin_token')) {
      navigate('/admin/login');
      return;
    }

    // Initial fetch
    apiFetch('/api/teams').then(res => res.json()).then(setTeams);
    apiFetch('/api/phase').then(res => res.json()).then(d => setPhase(d.phase));
    apiFetch('/api/admin/students/stats').then(res => res.json()).then(d => setStudentCount(d.totalStudents)).catch(() => {});

    // SSE Connection
    let eventSource;
    let cancelled = false;
    (async () => {
      try {
        eventSource = await apiEventSource('/api/stream/dashboard');
      } catch (err) {
        console.error('SSE connect error', err);
        return;
      }
      if (cancelled) {
        eventSource.close();
        return;
      }
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.teams) setTeams(data.teams); // Handle update
        else setTeams(data); // Handle initial or direct array
        setIsConnected(true);
      };
      
      eventSource.onerror = () => {
        eventSource.close();
      };
    })();

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [navigate]);

  const startEdit = (team) => {
      setEditingId(team.id);
      setEditName(team.name);
      setEditDesc(team.description);
  };

  const saveEdit = async (id) => {
      await apiFetch(`/api/admin/team/${id}`, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ name: editName, description: editDesc })
      });
      setTeams(prev => prev.map(t => t.id === id ? { ...t, name: editName, description: editDesc } : t));
      setEditingId(null);
  };

  const cancelEdit = () => {
      setEditingId(null);
      setEditName('');
      setEditDesc('');
  };

  const toggleJudgeExempt = async (teamId, exempt) => {
    // Optimistic update
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, judge_exempt: exempt } : t));
    await apiFetch(`/api/admin/team/${teamId}/judge-exempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exempt })
    }).catch(() => {
      // Refresh on failure
      apiFetch('/api/teams').then(res => res.json()).then(setTeams);
    });
  };

  const uploadTeamImage = async (teamId, file) => {
    if (!file) return;
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB (server-enforced too)
    if (file.size > MAX_IMAGE_BYTES) {
      alert('이미지는 2MB 이하만 업로드할 수 있습니다.');
      return;
    }

    const readAsDataUrl = (f) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsDataURL(f);
    });

    setUploadingTeamId(teamId);
    try {
      const dataUrl = await readAsDataUrl(file);
      const res = await apiFetch(`/api/admin/team/${teamId}/image`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '업로드 실패');

      setTeams(prev => prev.map(t => t.id === teamId ? { ...t, image_url: data.imageUrl } : t));
    } catch (err) {
      alert(err?.message || '업로드 실패');
    } finally {
      setUploadingTeamId(null);
    }
  };

  const downloadStudentTemplate = async () => {
    try {
      const res = await apiFetch('/api/admin/students/template');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '다운로드 실패');

      const csv = data?.csv || 'grade,class_no,student_no,name\n';
      const filename = data?.filename || 'students_template.csv';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err?.message || '다운로드 실패');
    }
  };

  const decodeStudentCsvFile = async (file) => {
    const ab = await file.arrayBuffer();
    const decode = (enc) => {
      try {
        return new TextDecoder(enc).decode(ab);
      } catch (e) {
        return null;
      }
    };
    const countReplacement = (text) => (text?.match(/\uFFFD/g) || []).length;

    const utf8 = decode('utf-8') || '';
    const euckr = decode('euc-kr') || decode('windows-949') || null;
    if (!euckr) return utf8;

    return countReplacement(euckr) < countReplacement(utf8) ? euckr : utf8;
  };

  const importStudentsCsv = async () => {
    if (!studentCsvFile) return;

    const confirmed = studentImportMode === 'replace'
      ? window.confirm('학생 목록을 전체 교체할까요? (기존 학생 목록이 삭제됩니다)')
      : true;
    if (!confirmed) return;

    setStudentImporting(true);
    setStudentImportResult(null);

    try {
      const csvText = await decodeStudentCsvFile(studentCsvFile);
      const res = await apiFetch('/api/admin/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvText,
          mode: studentImportMode,
          resetBoothUsage: studentResetUsage
        })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error === 'HAS_USAGE_DATA') {
          throw new Error('부스 이용 기록이 있어서 전체 교체가 막혔습니다. "부스 이용 기록도 함께 초기화"를 체크하고 다시 업로드하세요.');
        }
        throw new Error(data?.error || '업로드 실패');
      }
      setStudentImportResult(data);
      if (typeof data?.totalStudents === 'number') setStudentCount(data.totalStudents);
      setStudentCsvFile(null);
      alert('학생 CSV 반영 완료');
    } catch (err) {
      alert(err?.message || '업로드 실패');
    } finally {
      setStudentImporting(false);
    }
  };

  const updateStatus = (teamId, status) => {
    // Optimistic UI update to avoid waiting for SSE roundtrip
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, status } : t));
    apiFetch('/api/admin/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, status })
    }).catch(() => {
        // Fallback: refetch if request fails
        apiFetch('/api/teams').then(res => res.json()).then(setTeams);
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
    await apiFetch('/api/admin/team/reorder', {
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
      apiFetch('/api/admin/phase', { 
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
               <button className="btn btn-secondary btn-compact" onClick={() => navigate('/booth-ops')}>📋 부스 운영</button>
               <button className="btn btn-secondary btn-compact" style={{background:'#442'}} onClick={async () => {
                   if (!window.confirm('전체 투표/점수를 초기화할까요? 되돌릴 수 없습니다.')) return;
                   await apiFetch('/api/admin/reset-stats', { method: 'POST' });
                   apiFetch('/api/teams').then(res => res.json()).then(setTeams);
                   alert('전체 통계가 초기화되었습니다.');
               }}>🗑️ 통계 초기화</button>
               
               <div style={{marginLeft: 'auto', display:'flex', alignItems:'center', gap:'8px', background: 'rgba(255,255,255,0.05)', padding: '5px 10px', borderRadius:'8px'}}>
                    <span style={{fontSize:'0.8rem'}}>🧹 청소 알림 시간 설정:</span>
                    <input type="datetime-local" style={{padding:'4px', fontSize:'0.8rem', width:'180px'}} onChange={(e) => {
                        const val = e.target.value; // "YYYY-MM-DDTHH:mm"
                        if(val) {
                            apiFetch('/api/admin/cleanup', {
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
        <h3 style={{ marginTop: 0 }}>Booth Ops 학생 CSV</h3>
        <p style={{ color: '#888', marginTop: 0 }}>
          CSV로 전교 학생 목록을 업로드하면 Booth Ops에서 학생 검색/체크가 가능합니다.
        </p>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
          <button className="btn btn-secondary btn-compact" onClick={downloadStudentTemplate}>CSV 양식 다운로드</button>
          <span className="pill">현재 학생 수: {typeof studentCount === 'number' ? `${studentCount}명` : '불러오는 중...'}</span>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setStudentCsvFile(e.target.files?.[0] || null)}
          />
          <select value={studentImportMode} onChange={(e) => setStudentImportMode(e.target.value)} style={{ width: 'auto' }}>
            <option value="replace">전체 교체</option>
            <option value="merge">추가/수정(기존 유지)</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#cfd4e0' }}>
            <input
              type="checkbox"
              checked={studentResetUsage}
              onChange={(e) => setStudentResetUsage(e.target.checked)}
              disabled={studentImportMode !== 'replace'}
            />
            부스 이용 기록도 함께 초기화
          </label>
          <button
            className="btn btn-compact"
            onClick={importStudentsCsv}
            disabled={!studentCsvFile || studentImporting}
          >
            {studentImporting ? '업로드 중...' : 'CSV 업로드/반영'}
          </button>
        </div>

        {studentImportResult && (
          <pre style={{ marginTop: '12px', whiteSpace: 'pre-wrap', color: '#cfd4e0' }}>
            {JSON.stringify(studentImportResult, null, 2)}
          </pre>
        )}
      </div>

      <div className="card">
        <h3>무대 관리 (Drag & Drop to Reorder)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
                    <th style={{padding: '10px'}}>순서</th>
                    <th style={{padding: '10px'}}>팀 / 무대 정보</th>
                    <th style={{padding: '10px'}}>현재 상태</th>
                    <th style={{padding: '10px'}}>심사제외</th>
                    <th style={{padding: '10px'}}>관리</th>
                </tr>
            </thead>
            <tbody>
                {teams.map((team, idx) => {
                    const isEditing = editingId === team.id;
                    return (
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
                            {isEditing ? (
                                <div style={{display:'flex', gap:'12px', alignItems:'flex-start'}}>
                                  <img
                                    src={team.image_url || "/images/coming-soon.svg"}
                                    alt={team.name}
                                    style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #444' }}
                                    onError={(e) => { e.target.onerror = null; e.target.src = "/images/coming-soon.svg"; }}
                                  />
                                  <div style={{display:'flex', flexDirection:'column', gap:'6px', flex: 1}}>
                                      <label style={{fontSize:'0.8rem', color:'#aaa'}}>팀명</label>
                                      <input value={editName} onChange={e => setEditName(e.target.value)} style={{marginBottom:'4px'}} />
                                      <label style={{fontSize:'0.8rem', color:'#aaa'}}>무대 / 설명</label>
                                      <textarea value={editDesc} rows="2" onChange={e => setEditDesc(e.target.value)} />

                                      <div style={{display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', marginTop:'6px'}}>
                                        <input
                                          type="file"
                                          accept="image/png,image/jpeg,image/webp"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            e.target.value = '';
                                            uploadTeamImage(team.id, file);
                                          }}
                                        />
                                        {uploadingTeamId === team.id && <span className="pill">업로드 중...</span>}
                                      </div>
                                  </div>
                                </div>
                            ) : (
                                <div style={{display:'flex', gap:'12px', alignItems:'flex-start'}}>
                                  <img
                                    src={team.image_url || "/images/coming-soon.svg"}
                                    alt={team.name}
                                    style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #444' }}
                                    onError={(e) => { e.target.onerror = null; e.target.src = "/images/coming-soon.svg"; }}
                                  />
                                  <div style={{ flex: 1 }}>
                                    <div onClick={() => startEdit(team)} style={{cursor:'pointer', borderBottom:'1px dashed #666', display:'inline-block'}}>
                                        {team.name}
                                        <div style={{fontSize: '0.8rem', color: '#888'}}>{team.description || '무대 설명이 없습니다.'}</div>
                                    </div>
                                    <div style={{display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', marginTop:'8px'}}>
                                      <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          e.target.value = '';
                                          uploadTeamImage(team.id, file);
                                        }}
                                      />
                                      {uploadingTeamId === team.id && <span className="pill">업로드 중...</span>}
                                    </div>
                                  </div>
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
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                <input 
                                  type="checkbox" 
                                  checked={!!team.judge_exempt} 
                                  onChange={(e) => toggleJudgeExempt(team.id, e.target.checked)} 
                                />
                                <span style={{fontSize:'0.85rem'}}>심사 제외</span>
                            </label>
                        </td>
                        <td style={{padding: '10px', minWidth:'280px'}}>
                            <div style={{display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px'}}>
                                {isEditing ? (
                                    <>
                                        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => saveEdit(team.id)}>저장</button>
                                        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={cancelEdit}>취소</button>
                                    </>
                                ) : (
                                    <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => startEdit(team)}>✏️ 수정</button>
                                )}
                            </div>
                            <div style={{display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px'}}>
                                <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#222', border: '1px solid #444' }} onClick={() => updateStatus(team.id, 'HIDDEN')}>숨김</button>
                                <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => updateStatus(team.id, 'WAITING')}>대기</button>
                                <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', background: 'red' }} onClick={() => updateStatus(team.id, 'LIVE')}>라이브</button>
                                <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#555' }} onClick={() => updateStatus(team.id, 'DONE')}>완료</button>
                            </div>
                            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#333', border: '1px solid #555' }} onClick={async () => {
                                if(confirm('정말 이 팀을 삭제하시겠습니까? (되돌릴 수 없습니다!)')) {
                                    await apiFetch(`/api/admin/team/${team.id}`, { method: 'DELETE' });
                                    // SSE handles update, but optimistic update is good too
                                    setTeams(prev => prev.filter(t => t.id !== team.id));
                                }
                            }}>🗑️ 삭제</button>
                        </td>
                    </tr>
                );})}
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

                apiFetch('/api/admin/team', {
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
                        apiFetch('/api/teams').then(res => res.json()).then(setTeams);
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
