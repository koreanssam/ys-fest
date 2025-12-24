import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const ADMIN_PASSWORD = 'dudtkswnd1!'; // Hardcoded as per PRD

function AdminLogin() {
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      localStorage.setItem('admin_token', 'true');
      navigate('/admin/dashboard');
    } else {
      alert('Wrong password');
    }
  };

  return (
    <div className="container" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <h2>관리자 로그인</h2>
        <form onSubmit={handleLogin}>
          <input 
            type="password" 
            placeholder="비밀번호" 
            value={password} 
            onChange={e => setPassword(e.target.value)}
            style={{ 
                width: '100%', padding: '12px', marginBottom: '16px', 
                borderRadius: '8px', border: '1px solid #444', 
                background: '#333', color: 'white' 
            }}
          />
          <button type="submit" className="btn" style={{ width: '100%' }}>로그인</button>
        </form>
      </div>
    </div>
  );
}

export default AdminLogin;
