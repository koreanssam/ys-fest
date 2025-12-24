import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../apiClient';

const MAX_USAGE = 3;

function BoothOps() {
  const [booths, setBooths] = useState([]);
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('booth_ops_session') || 'null');
    } catch (e) {
      return null;
    }
  });
  const [selectedBooth, setSelectedBooth] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('booth_ops_session') || 'null');
      return saved?.boothId || '';
    } catch (e) {
      return '';
    }
  });
  const [students, setStudents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ search: '', grade: '', class_no: '' });
  const [loginForm, setLoginForm] = useState({ className: '', password: '' });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isUsing, setIsUsing] = useState(null);
  const [voidingId, setVoidingId] = useState(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

  const persistSession = (nextSession) => {
    setSession(nextSession);
    if (nextSession) {
      localStorage.setItem('booth_ops_session', JSON.stringify(nextSession));
    } else {
      localStorage.removeItem('booth_ops_session');
      setSummary(null);
      setStudents([]);
    }
  };

  const authFetch = (path, options = {}) => {
    const headers = { ...(options.headers || {}), 'x-admin-token': session?.token || '' };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return apiFetch(path, { ...options, headers });
  };

  // Load booth list for dropdown and default context
  useEffect(() => {
    apiFetch('/api/booths')
      .then(res => res.json())
      .then(data => {
        setBooths(data || []);
        if (!selectedBooth && data?.length) {
          const preferred = session?.boothId || data[0].id;
          setSelectedBooth(preferred);
        }
        if (!loginForm.className && session?.className) {
          setLoginForm(prev => ({ ...prev, className: session.className }));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch students once per session (143 rows, light enough)
  useEffect(() => {
    if (!session?.token) return;
    const loadStudents = async () => {
      const res = await authFetch('/api/students');
      if (res.status === 401) {
        persistSession(null);
        setError('세션이 만료되어 다시 로그인해주세요.');
        return;
      }
      setStudents(await res.json());
    };
    loadStudents();
  }, [session?.token]);

  const loadSummary = async (silent = false) => {
    if (!session?.token || !selectedBooth) return;
    if (!silent) setIsLoadingSummary(true);
    const res = await authFetch(`/api/booths/${selectedBooth}/usages/summary`);
    if (res.status === 401) {
      persistSession(null);
      setError('세션이 만료되어 다시 로그인해주세요.');
      setIsLoadingSummary(false);
      return;
    }
    const data = await res.json();
    setSummary(data);
    if (!silent) setIsLoadingSummary(false);
  };

  // Poll summary (5-7s)
  useEffect(() => {
    if (!session?.token || !selectedBooth) return;
    loadSummary();
    const interval = setInterval(() => loadSummary(true), 7000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, selectedBooth]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('');
    setIsLoggingIn(true);
    try {
      const res = await apiFetch('/api/admin/booth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '로그인 실패');
      const nextSession = { token: data.token, className: data.className, boothId: data.boothId };
      persistSession(nextSession);
      const fallbackBooth = data.boothId || selectedBooth || booths[0]?.id || '';
      setSelectedBooth(fallbackBooth);
      setStatus('로그인 완료');
      setError('');
    } catch (err) {
      const detail = err?.message || '';
      const friendly = detail.includes('BAD_API_RESPONSE') ? 'API 응답이 올바르지 않습니다. 잠시 후 다시 시도하세요.' : detail;
      setError(friendly || '로그인 실패');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const remainingFor = (studentId) => {
    if (!summary) return MAX_USAGE;
    const used = summary.perStudentCounts?.[studentId] || 0;
    return Math.max(0, MAX_USAGE - used);
  };

  const handleUse = async (studentId) => {
    if (!selectedBooth) return;
    setIsUsing(studentId);
    setError('');
    setStatus('');
    const res = await authFetch(`/api/booths/${selectedBooth}/use`, {
      method: 'POST',
      body: JSON.stringify({ studentId })
    });
    if (res.status === 401) {
      persistSession(null);
      setError('세션이 만료되어 다시 로그인해주세요.');
      setIsUsing(null);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error === 'OVER_LIMIT' ? '남은 이용 횟수를 초과했습니다.' : (data.error || '체크 실패'));
    } else {
      setStatus(`${data.recentEntry?.student_name || '학생'} 체크 완료`);
      await loadSummary(true);
    }
    setIsUsing(null);
  };

  const handleVoid = async (usageId) => {
    if (!selectedBooth) return;
    setVoidingId(usageId);
    setError('');
    const res = await authFetch(`/api/booths/${selectedBooth}/use/${usageId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'undo' })
    });
    if (res.status === 401) {
      persistSession(null);
      setError('세션이 만료되어 다시 로그인해주세요.');
      setVoidingId(null);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error === 'VOID_WINDOW_EXPIRED' ? '1분이 지나 되돌릴 수 없습니다.' : (data.error || '되돌리기 실패'));
    } else {
      setStatus('가장 최근 체크를 되돌렸습니다.');
      await loadSummary(true);
    }
    setVoidingId(null);
  };

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      if (filters.grade && String(s.grade) !== String(filters.grade)) return false;
      if (filters.class_no && String(s.class_no) !== String(filters.class_no)) return false;
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const hay = `${s.name}${s.grade}${s.class_no}${s.student_no}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [students, filters]);

  const formatTime = (val) => {
    if (!val) return '';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return val;
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const canVoid = (entry) => {
    if (!entry?.used_at) return false;
    return Date.now() - new Date(entry.used_at).getTime() <= 60 * 1000;
  };

  const lastEntry = summary?.recent?.[0];
  const canVoidLast = lastEntry && canVoid(lastEntry);

  if (!session?.token) {
    return (
      <div className="container" style={{ maxWidth: '760px' }}>
        <div className="card ops-card">
          <div className="title-row" style={{ justifyContent: 'space-between', marginBottom: '8px' }}>
            <div>
              <p className="section-sub" style={{ margin: 0 }}>반별 부스 운영 로그인</p>
              <h2 style={{ margin: '4px 0' }}>Booth Ops</h2>
            </div>
            <div className="chip chip--accent">최대 3회 체크</div>
          </div>
          <form onSubmit={handleLogin} className="login-form">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <select value={loginForm.className} onChange={e => setLoginForm(f => ({ ...f, className: e.target.value }))} required>
                <option value="">학급 선택</option>
                {booths.map(b => <option key={b.id} value={b.class_name}>{b.class_name}</option>)}
              </select>
              <input type="password" placeholder="비밀번호/PIN" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} required />
            </div>
            <button className="btn" type="submit" disabled={isLoggingIn}>{isLoggingIn ? '로그인 중...' : '로그인'}</button>
          </form>
          {error && <p style={{ color: '#ff9cae' }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '1200px' }}>
      <div className="title-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="section-sub" style={{ margin: 0 }}>반별 부스 운영 UX</p>
          <h2 style={{ margin: '4px 0' }}>Booth Ops</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="chip chip--success">로그인: {session.className}</div>
          <button className="btn btn-secondary btn-compact" onClick={() => persistSession(null)}>로그아웃</button>
        </div>
      </div>

      <div className="card ops-card">
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ minWidth: '220px' }}>
            <label className="section-sub" style={{ display: 'block', marginBottom: '6px' }}>운영 부스 선택</label>
            <select value={selectedBooth || ''} onChange={e => setSelectedBooth(Number(e.target.value))}>
              {booths.map(b => <option key={b.id} value={b.id}>{b.class_name} · {b.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="chip chip--warn">학생당 최대 {MAX_USAGE}회</span>
            {isLoadingSummary && <span className="pill">통계 새로고침...</span>}
            <button className="btn btn-secondary btn-compact" onClick={() => loadSummary()} style={{ padding: '8px 12px' }}>즉시 새로고침</button>
          </div>
        </div>
        <div className="ops-grid">
          <div className="ops-panel">
            <div className="filter-row">
              <input placeholder="이름 / 학번 검색" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
              <select value={filters.grade} onChange={e => setFilters(f => ({ ...f, grade: e.target.value }))}>
                <option value="">학년 전체</option>
                <option value="1">1학년</option>
                <option value="2">2학년</option>
                <option value="3">3학년</option>
              </select>
              <select value={filters.class_no} onChange={e => setFilters(f => ({ ...f, class_no: e.target.value }))}>
                <option value="">반 전체</option>
                <option value="1">1반</option>
                <option value="2">2반</option>
                <option value="3">3반</option>
              </select>
            </div>
            <div className="table-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>학반번호</th>
                    <th>남은 횟수</th>
                    <th>체크</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map(s => {
                    const remaining = remainingFor(s.id);
                    const disabled = remaining <= 0 || isUsing === s.id;
                    return (
                      <tr key={s.id} className={remaining <= 0 ? 'row-disabled' : ''}>
                        <td><strong>{s.name}</strong></td>
                        <td className="muted">{s.grade}-{s.class_no}-{String(s.student_no).padStart(2, '0')}</td>
                        <td>
                          <span className={`badge-remaining ${remaining === 0 ? 'zero' : ''}`}>
                            {remaining} / {MAX_USAGE}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-compact" disabled={disabled} onClick={() => handleUse(s.id)}>
                            {isUsing === s.id ? '체크 중...' : '체크'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ops-panel secondary">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '12px' }}>
              <div className="summary-card">
                <p className="section-sub" style={{ margin: 0 }}>총 이용</p>
                <h3 style={{ margin: '4px 0' }}>{summary?.totalUsage ?? 0}회</h3>
              </div>
              <div className="summary-card">
                <p className="section-sub" style={{ margin: 0 }}>고유 인원</p>
                <h3 style={{ margin: '4px 0' }}>{summary?.uniqueStudents ?? 0}명</h3>
              </div>
              <div className="summary-card">
                <p className="section-sub" style={{ margin: 0 }}>TOP 반</p>
                <div>
                  {(summary?.topClasses || []).map((c, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', color: '#cfd4e0' }}>
                      <span>{c.class_name}</span>
                      <span>{c.count}회</span>
                    </div>
                  ))}
                  {!summary?.topClasses?.length && <span className="muted">데이터 없음</span>}
                </div>
              </div>
            </div>

            <div className="summary-card" style={{ marginBottom: '12px' }}>
              <p className="section-sub" style={{ margin: 0 }}>잔여 가능 인원 분포</p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                {[3, 2, 1, 0].map(k => (
                  <span key={k} className="pill">
                    남은 {k}회: {summary?.remainingBuckets?.[k] ?? 0}명
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="title-row" style={{ marginBottom: '6px' }}>
                <h3 style={{ margin: 0 }}>최근 체크 20건</h3>
                {canVoidLast && (
                  <button className="btn btn-secondary btn-compact" onClick={() => handleVoid(lastEntry.id)} disabled={voidingId === lastEntry.id}>
                    {voidingId === lastEntry.id ? '되돌리는 중...' : '마지막 되돌리기'}
                  </button>
                )}
              </div>
              <div className="history-list">
                {(summary?.recent || []).map(entry => (
                  <div key={entry.id} className="history-row">
                    <div>
                      <strong>{entry.student_name}</strong>
                      <span className="muted"> · {entry.grade}-{entry.class_no}-{String(entry.student_no).padStart(2, '0')}</span>
                      <span className="muted"> · 처리: {entry.admin_class || '미상'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className="pill">{formatTime(entry.used_at)}</span>
                      {canVoid(entry) && (
                        <button className="btn btn-secondary btn-compact" onClick={() => handleVoid(entry.id)} disabled={voidingId === entry.id}>
                          {voidingId === entry.id ? '취소 중...' : '되돌리기'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!summary?.recent?.length && <p className="muted">아직 체크 이력이 없습니다.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {(status || error) && (
        <div className="card" style={{ background: 'rgba(24,25,34,0.9)', borderColor: error ? 'rgba(255,59,127,0.45)' : 'rgba(60,210,165,0.35)' }}>
          {status && <p style={{ color: '#c5ffe7', margin: 0 }}>{status}</p>}
          {error && <p style={{ color: '#ff9cae', margin: 0 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

export default BoothOps;
