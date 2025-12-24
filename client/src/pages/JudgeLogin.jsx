import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../apiClient';

function JudgeLogin() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
        const res = await apiFetch('/api/judge/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password })
        });
        const data = await res.json();
        if (data.success) {
            localStorage.setItem('judge_token', JSON.stringify(data.judge));
            navigate('/judge/vote');
        } else {
            alert('Invalid Login');
        }
    } catch (err) {
        console.error(err);
        alert('Login Error');
    }
  };

  return (
    <div className="container" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <h2>🧑‍⚖️ 심사위원 로그인</h2>
        <form onSubmit={handleLogin}>
          <input 
            type="text" 
            placeholder="심사위원 성명 (예: 이대호)" 
            value={name} 
            onChange={e => setName(e.target.value)}
          />
          <input 
            type="password" 
            placeholder="PIN 번호" 
            value={password} 
            onChange={e => setPassword(e.target.value)}
          />
          <button type="submit" className="btn">입장하기</button>
        </form>
      </div>
    </div>
  );
}

export default JudgeLogin;
