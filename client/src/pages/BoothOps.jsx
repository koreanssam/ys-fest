import React, { useEffect, useMemo, useState } from 'react';
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
import { apiFetch } from '../apiClient';

const MAX_USAGE = 3;
const VOID_WINDOW_MS = 2 * 60 * 1000;
const SUPERADMIN_LABEL = '통합관리자';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const parseDbTimestamp = (val) => {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(val)) {
    return new Date(val.replace(' ', 'T') + 'Z');
  }
  return new Date(val);
};

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
  const [dashboard, setDashboard] = useState(null);
  const [filters, setFilters] = useState({ search: '', grade: '', class_no: '' });
  const [loginForm, setLoginForm] = useState({ className: '', password: '' });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isUsing, setIsUsing] = useState(null);
  const [voidingId, setVoidingId] = useState(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [pinEdits, setPinEdits] = useState({});
  const [savingPinFor, setSavingPinFor] = useState(null);

  const persistSession = (nextSession) => {
    setSession(nextSession);
    if (nextSession) {
      localStorage.setItem('booth_ops_session', JSON.stringify(nextSession));
    } else {
      localStorage.removeItem('booth_ops_session');
      setSummary(null);
      setDashboard(null);
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

  // Super admin dashboard
  const loadDashboard = async (silent = false) => {
    if (!session?.token || !session?.isSuperAdmin) return;
    if (!silent) setIsLoadingDashboard(true);
    const res = await authFetch('/api/admin/booth-ops/dashboard');
    if (res.status === 401) {
      persistSession(null);
      setError('세션이 만료되어 다시 로그인해주세요.');
      setIsLoadingDashboard(false);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      if (!silent) setError(data?.error || '대시보드 불러오기 실패');
      if (!silent) setIsLoadingDashboard(false);
      return;
    }
    setDashboard(data);
    if (!silent) setIsLoadingDashboard(false);
  };

  useEffect(() => {
    if (!session?.token || !session?.isSuperAdmin) return;
    loadDashboard();
    const interval = setInterval(() => loadDashboard(true), 7000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, session?.isSuperAdmin]);

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
    if (!res.ok) {
      if (!silent) {
        const msg = data?.error === 'FORBIDDEN' ? '이 부스를 조회할 권한이 없습니다.' : (data?.error || '통계 불러오기 실패');
        setError(msg);
      }
      if (!silent) setIsLoadingSummary(false);
      return;
    }
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
      const nextSession = { token: data.token, className: data.className, boothId: data.boothId, isSuperAdmin: !!data.isSuperAdmin };
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
      setError(data.error === 'VOID_WINDOW_EXPIRED' ? '2분이 지나 되돌릴 수 없습니다.' : (data.error || '되돌리기 실패'));
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
    const d = parseDbTimestamp(val);
    if (Number.isNaN(d.getTime())) return val;
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const canVoid = (entry) => {
    if (!entry?.used_at) return false;
    const usedAt = parseDbTimestamp(entry.used_at);
    if (!usedAt || Number.isNaN(usedAt.getTime())) return false;
    return Date.now() - usedAt.getTime() <= VOID_WINDOW_MS;
  };

  const lastEntry = summary?.recent?.[0];
  const canVoidLast = lastEntry && canVoid(lastEntry);

  // Lock class admins to their own booth
  useEffect(() => {
    if (!session?.token) return;
    if (session?.isSuperAdmin) return;
    if (!session?.boothId) return;
    if (selectedBooth !== session.boothId) setSelectedBooth(session.boothId);
  }, [session?.token, session?.isSuperAdmin, session?.boothId, selectedBooth]);

  const boothUsageChart = useMemo(() => {
    if (!dashboard?.booths?.length) return null;
    const sorted = [...dashboard.booths].sort((a, b) => a.id - b.id);
    return {
      data: {
        labels: sorted.map(b => `${b.class_name} · ${b.name}`),
        datasets: [
          {
            label: '총 이용(회)',
            data: sorted.map(b => b.totalUsage),
            backgroundColor: 'rgba(60,210,165,0.7)',
            borderColor: 'rgba(60,210,165,1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    };
  }, [dashboard]);

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
                <option value={SUPERADMIN_LABEL}>{SUPERADMIN_LABEL}</option>
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

  const availableBooths = session?.isSuperAdmin
    ? booths
    : booths.filter(b => b.id === session?.boothId);

  const resetAllUsage = async () => {
    if (!session?.isSuperAdmin) return;
    const confirmed = window.confirm('전체 부스 이용 데이터를 초기화할까요? (되돌릴 수 없습니다)');
    if (!confirmed) return;
    setStatus('');
    setError('');
    try {
      const res = await authFetch('/api/admin/booth-ops/reset', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '초기화 실패');
      setStatus('이용 데이터 초기화 완료');
      await loadDashboard(true);
      await loadSummary(true);
    } catch (err) {
      setError(err?.message || '초기화 실패');
    }
  };

  const saveAdminPin = async (className) => {
    if (!session?.isSuperAdmin) return;
    const password = (pinEdits?.[className] || '').trim();
    if (!password) {
      setError('새 PIN을 입력해주세요.');
      return;
    }
    const confirmed = window.confirm(`${className} 관리자 PIN을 변경할까요? (기존 로그인은 종료됩니다)`);
    if (!confirmed) return;

    setSavingPinFor(className);
    setStatus('');
    setError('');
    try {
      const res = await authFetch(`/api/admin/booth-ops/booth-admins/${encodeURIComponent(className)}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password })
      });
      if (res.status === 401) {
        persistSession(null);
        setError('세션이 만료되어 다시 로그인해주세요.');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '저장 실패');
      setPinEdits(prev => ({ ...prev, [className]: '' }));
      setStatus(`${className} PIN 변경 완료`);
    } catch (err) {
      setError(err?.message || '저장 실패');
    } finally {
      setSavingPinFor(null);
    }
  };

  return (
    <div className="container" style={{ maxWidth: '1200px' }}>
      <div className="title-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="section-sub" style={{ margin: 0 }}>반별 부스 운영 UX</p>
          <h2 style={{ margin: '4px 0' }}>Booth Ops</h2>
	        </div>
		        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
		          <div className={`chip ${session?.isSuperAdmin ? 'chip--accent' : 'chip--success'}`}>로그인: {session.className}</div>
		          <button className="btn btn-secondary btn-compact" onClick={() => persistSession(null)}>로그아웃</button>
		        </div>
		      </div>

      {session?.isSuperAdmin && (
        <div className="card ops-card" style={{ marginBottom: '14px' }}>
          <div className="title-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <p className="section-sub" style={{ margin: 0 }}>교사용 통합관리자</p>
              <h3 style={{ margin: '4px 0' }}>이용현황 대시보드</h3>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {isLoadingDashboard && <span className="pill">대시보드 새로고침...</span>}
              <button className="btn btn-secondary btn-compact" onClick={() => loadDashboard()} style={{ padding: '8px 12px' }}>대시보드 새로고침</button>
              <button className="btn btn-compact" onClick={resetAllUsage} style={{ padding: '8px 12px' }}>전체 초기화</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginTop: '12px' }}>
            <div className="summary-card">
              <p className="section-sub" style={{ margin: 0 }}>전체 이용</p>
              <h3 style={{ margin: '4px 0' }}>{dashboard?.totalUsage ?? 0}회</h3>
            </div>
            <div className="summary-card">
              <p className="section-sub" style={{ margin: 0 }}>참여 인원</p>
              <h3 style={{ margin: '4px 0' }}>{dashboard?.uniqueStudents ?? 0}명</h3>
            </div>
            <div className="summary-card">
              <p className="section-sub" style={{ margin: 0 }}>전체 학생</p>
              <h3 style={{ margin: '4px 0' }}>{dashboard?.totalStudents ?? 0}명</h3>
            </div>
          </div>

          {boothUsageChart && (
            <div style={{ height: '260px', marginTop: '12px' }}>
              <Bar data={boothUsageChart.data} options={boothUsageChart.options} />
            </div>
          )}

	          {dashboard?.booths?.length ? (
	            <div style={{ marginTop: '12px' }}>
	              <div className="title-row" style={{ marginBottom: '6px' }}>
	                <h3 style={{ margin: 0 }}>부스별 현황</h3>
	              </div>
	              <div className="table-scroll">
	                <table className="ops-table">
	                  <thead>
	                    <tr>
	                      <th>부스</th>
	                      <th>총 이용</th>
	                      <th>고유 인원</th>
	                      <th>최근 이용</th>
	                      <th>관리자 PIN</th>
	                    </tr>
	                  </thead>
	                  <tbody>
	                    {dashboard.booths
	                      .slice()
	                      .sort((a, b) => a.id - b.id)
	                      .map(b => (
	                        <tr key={b.id}>
	                          <td><strong>{b.class_name}</strong><span className="muted"> · {b.name}</span></td>
	                          <td>{b.totalUsage}회</td>
	                          <td>{b.uniqueStudents}명</td>
	                          <td className="muted">{b.lastUsedAt ? formatTime(b.lastUsedAt) : '-'}</td>
	                          <td>
	                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
	                              <input
	                                type="password"
	                                placeholder="새 PIN"
	                                value={pinEdits?.[b.class_name] || ''}
	                                onChange={e => setPinEdits(prev => ({ ...prev, [b.class_name]: e.target.value }))}
	                                style={{ maxWidth: '140px' }}
	                              />
	                              <button
	                                className="btn btn-secondary btn-compact"
	                                onClick={() => saveAdminPin(b.class_name)}
	                                disabled={savingPinFor === b.class_name}
	                              >
	                                {savingPinFor === b.class_name ? '저장 중...' : '저장'}
	                              </button>
	                            </div>
	                          </td>
	                        </tr>
	                      ))}
	                  </tbody>
	                </table>
	              </div>
	            </div>
	          ) : null}
        </div>
      )}

	      <div className="card ops-card">
	        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
	          <div style={{ minWidth: '220px' }}>
	            <label className="section-sub" style={{ display: 'block', marginBottom: '6px' }}>운영 부스 선택</label>
	            <select
	              value={selectedBooth || ''}
	              onChange={e => setSelectedBooth(Number(e.target.value))}
	              disabled={!session?.isSuperAdmin}
	            >
	              {!availableBooths.length && <option value="">부스 불러오는 중...</option>}
	              {availableBooths.map(b => <option key={b.id} value={b.id}>{b.class_name} · {b.name}</option>)}
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
