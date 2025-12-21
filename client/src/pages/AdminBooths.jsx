import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

function AdminBooths() {
  const [booths, setBooths] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [forms, setForms] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/booths').then(r => r.json()).then(setBooths);
  }, []);

  const handleChange = (id, field, val) => {
    setForms(prev => ({
        ...prev,
        [id]: { ...prev[id], [field]: val }
    }));
  };

  const startEdit = (booth) => {
      setEditingId(booth.id);
      setForms(prev => ({
          ...prev,
          [booth.id]: { ...booth }
      }));
  };

  const save = async (id) => {
      const data = forms[id];
      // We need an endpoint PUT /api/admin/booth/:id
      // Assuming we'll implement it shortly in server.js
      await fetch(`/api/admin/booth/${id}`, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(data)
      });
      setEditingId(null);
      // Refresh
      fetch('/api/booths').then(r => r.json()).then(setBooths);
  };

  return (
    <div className="container">
      <div style={{marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
           <h2>🏫 부스 관리 (Booth Management)</h2>
           <button className="btn btn-secondary" onClick={() => navigate('/admin/dashboard')}>
               ← 대시보드로 돌아가기
           </button>
      </div>

      <div className="card">
        <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
                <tr style={{borderBottom:'1px solid #444', textAlign:'left'}}>
                    <th style={{padding:'10px'}}>학급</th>
                    <th style={{padding:'10px'}}>부스명</th>
                    <th style={{padding:'10px'}}>설명</th>
                    <th style={{padding:'10px'}}>위치</th>
                    <th style={{padding:'10px'}}>관리</th>
                </tr>
            </thead>
            <tbody>
                {booths.map(b => (
                    <tr key={b.id} style={{borderBottom:'1px solid #333'}}>
                        <td style={{padding:'10px'}}>
                            {editingId === b.id ? (
                                <input value={forms[b.id]?.class_name} onChange={e => handleChange(b.id, 'class_name', e.target.value)} style={{width:'60px'}} />
                            ) : b.class_name}
                        </td>
                        <td style={{padding:'10px'}}>
                            {editingId === b.id ? (
                                <input value={forms[b.id]?.name} onChange={e => handleChange(b.id, 'name', e.target.value)} />
                            ) : <b>{b.name}</b>}
                        </td>
                        <td style={{padding:'10px'}}>
                             {editingId === b.id ? (
                                <input value={forms[b.id]?.description} onChange={e => handleChange(b.id, 'description', e.target.value)} style={{width:'100%'}} />
                            ) : <span style={{color:'#ccc'}}>{b.description}</span>}
                        </td>
                         <td style={{padding:'10px'}}>
                             {editingId === b.id ? (
                                <input value={forms[b.id]?.location} onChange={e => handleChange(b.id, 'location', e.target.value)} />
                            ) : b.location}
                        </td>
                        <td style={{padding:'10px'}}>
                            {editingId === b.id ? (
                                <>
                                    <button className="btn" style={{padding:'4px 8px', fontSize:'0.8rem', marginRight:'4px'}} onClick={() => save(b.id)}>저장</button>
                                    <button className="btn btn-secondary" style={{padding:'4px 8px', fontSize:'0.8rem'}} onClick={() => setEditingId(null)}>취소</button>
                                </>
                            ) : (
                                <button className="btn btn-secondary" style={{padding:'4px 8px', fontSize:'0.8rem'}} onClick={() => startEdit(b)}>수정</button>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminBooths;
