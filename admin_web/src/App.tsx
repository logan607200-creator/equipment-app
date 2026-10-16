import { useEffect, useState } from 'react';
import { api, isLoggedIn, login, logout, onAdminAlert } from './api';
import { Alerts } from './pages/Alerts';
import { Dashboard } from './pages/Dashboard';
import { Jobs } from './pages/Jobs';
import { Providers } from './pages/Providers';
import { Rates } from './pages/Rates';

const PAGES = [
  { key: 'dashboard', label: '관제' },
  { key: 'alerts', label: '미배차' },
  { key: 'jobs', label: '호출 내역' },
  { key: 'providers', label: '이용자' },
  { key: 'rates', label: '요금표' },
] as const;
type PageKey = (typeof PAGES)[number]['key'];

export function App() {
  const [authed, setAuthed] = useState(isLoggedIn());
  const [page, setPage] = useState<PageKey>(() => (location.hash.slice(1) as PageKey) || 'dashboard');
  const [badges, setBadges] = useState({ alerts: 0, pending: 0 });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    location.hash = page;
  }, [page]);

  useEffect(() => {
    if (!authed) return;
    const refresh = () =>
      api('GET', '/admin/stats')
        .then((s) => setBadges({ alerts: s.openAlerts, pending: s.pendingVerification }))
        .catch(() => setAuthed(isLoggedIn()));
    refresh();
    const t = setInterval(refresh, 5000);
    const off = onAdminAlert((d) => {
      setToast(`미배차 경보: 자동 배차에 실패한 호출이 있어요 (${d.typeCode})`);
      refresh();
    });
    return () => {
      clearInterval(t);
      off();
    };
  }, [authed]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">
          <span className="logo">⚒</span> 장비 호출 운영
        </div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.key} className={page === p.key ? 'nav active' : 'nav'} onClick={() => setPage(p.key)}>
              {p.label}
              {p.key === 'alerts' && badges.alerts > 0 && <span className="badge danger">{badges.alerts}</span>}
              {p.key === 'providers' && badges.pending > 0 && <span className="badge">{badges.pending}</span>}
            </button>
          ))}
        </nav>
        <button
          className="nav logout"
          onClick={() => {
            logout();
            setAuthed(false);
          }}
        >
          로그아웃
        </button>
      </aside>
      <main className="main">
        {toast && (
          <div className="toast" onClick={() => { setToast(null); setPage('alerts'); }}>
            {toast} <u>확인하기</u>
          </div>
        )}
        {page === 'dashboard' && <Dashboard onOpenAlerts={() => setPage('alerts')} />}
        {page === 'alerts' && <Alerts />}
        {page === 'jobs' && <Jobs />}
        {page === 'providers' && <Providers />}
        {page === 'rates' && <Rates />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!sent) {
        await api('POST', '/auth/otp/request', { phone });
        setSent(true);
      } else {
        await login(phone, code);
        onDone();
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="login">
      <form onSubmit={submit} className="card login-card">
        <div className="brand big">
          <span className="logo">⚒</span> 장비 호출 운영
        </div>
        <p className="muted">운영자로 등록된 휴대폰 번호로 로그인하세요.</p>
        <label>
          휴대폰 번호
          <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} disabled={sent} placeholder="01012345678" />
        </label>
        {sent && (
          <label>
            인증번호
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus maxLength={6} />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={sent ? code.length !== 6 : phone.length < 10}>
          {sent ? '로그인' : '인증번호 받기'}
        </button>
      </form>
    </div>
  );
}
