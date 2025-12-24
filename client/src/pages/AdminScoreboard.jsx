import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { apiFetch } from '../apiClient';

function AdminScoreboard() {
  const [scores, setScores] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/api/scores').then(res => res.json()).then(setScores);
    const interval = setInterval(() => {
        apiFetch('/api/scores').then(res => res.json()).then(setScores);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const groupScores = scores.filter(s => s.category === 'GROUP');
  const indScores = scores.filter(s => s.category === 'INDIVIDUAL');

  const createChartData = (data, label) => ({
      labels: data.map(d => d.team_name),
      datasets: [{
          label,
          data: data.map(d => d.grand_total),
          backgroundColor: 'rgba(54, 162, 235, 0.6)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1
      }]
  });

  return (
    <div className="container" style={{maxWidth: '1000px'}}>
      <div style={{marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
           <h2 style={{margin:0, fontSize: '2rem'}}>🏆 최종 스코어보드</h2>
           <button className="btn btn-secondary btn-compact" onClick={() => navigate('/admin/dashboard')}>
               ← 대시보드
           </button>
      </div>
      
      <div className="card">
          <h3>단체 부문 결과 (Group)</h3>
          <Bar data={createChartData(groupScores, '총점')} options={{indexAxis: 'y'}} />
          <table>
              <thead>
                  <tr><th>순위</th><th>팀명</th><th>총점</th><th>심사위원 수</th></tr>
              </thead>
              <tbody>
                  {groupScores.map((s, i) => (
                      <tr key={s.team_id}>
                          <td>{i+1}</td>
                          <td>{s.team_name}</td>
                          <td>{s.grand_total}</td>
                          <td>{s.judge_count}</td>
                      </tr>
                  ))}
              </tbody>
          </table>
      </div>

      <div className="card">
          <h3>개인 부문 결과 (Individual)</h3>
          <Bar data={createChartData(indScores, '총점')} options={{indexAxis: 'y'}} />
           <table>
              <thead>
                  <tr><th>순위</th><th>참가자</th><th>총점</th><th>심사위원 수</th></tr>
              </thead>
              <tbody>
                  {indScores.map((s, i) => (
                      <tr key={s.team_id}>
                          <td>{i+1}</td>
                          <td>{s.team_name}</td>
                          <td>{s.grand_total}</td>
                          <td>{s.judge_count}</td>
                      </tr>
                  ))}
              </tbody>
          </table>
      </div>
    </div>
  );
}

export default AdminScoreboard;
