import { useEffect, useMemo, useState } from 'react';
import { api, Job, Provider } from '../api';
import { JobDetail } from '../components/JobDetail';
import { MapPanel, MapPoint } from '../components/MapPanel';
import { ago, duration, jobSummary, STATUS, TYPE, won } from '../format';

export function Dashboard({ onOpenAlerts }: { onOpenAlerts: () => void }) {
  const [stats, setStats] = useState<any>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    const [s, j, p] = await Promise.all([api('GET', '/admin/stats'), api<Job[]>('GET', '/admin/jobs?status=active'), api<Provider[]>('GET', '/admin/providers?verified=true')]);
    setStats(s);
    setJobs(j);
    setProviders(p);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const points = useMemo<MapPoint[]>(() => [
    ...jobs.map((j) => ({ id: j.id, lat: j.lat, lng: j.lng, kind: j.unassignedAlert ? 'alert' as const : 'job' as const, label: `${TYPE[j.typeCode]} ${STATUS[j.status]}` })),
    ...providers.filter((p) => p.online && p.location).map((p) => ({
      id: p.id, lat: p.location!.lat, lng: p.location!.lng, kind: p.currentJobId ? 'busy' as const : 'provider' as const, label: p.companyName ?? '이용자',
    })),
  ], [jobs, providers]);

  return (
    <>
      <header className="page-head">
        <h1>관제</h1>
        <span className="muted">5초마다 새로 고침</span>
      </header>
      {stats && (
        <section className="stats">
          <Stat label="오늘 호출" value={`${stats.requested}건`} />
          <Stat label="배차 성공률" value={stats.matchRate == null ? '-' : `${Math.round(stats.matchRate * 100)}%`} hint="목표 90%" />
          <Stat label="평균 배차 시간" value={duration(stats.avgDispatchSec)} hint="목표 3분" />
          <Stat label="완료 / 취소" value={`${stats.completed} / ${stats.cancelled}`} />
          <Stat label="오늘 매출" value={won(stats.gross)} hint={`수수료 ${won(stats.commission)}`} />
          <Stat label="출근 이용자" value={`${stats.onlineProviders}명`} />
          <Stat label="진행 중" value={`${stats.active}건`} />
          <Stat label="미배차 경보" value={`${stats.openAlerts}건`} danger={stats.openAlerts > 0} onClick={stats.openAlerts ? onOpenAlerts : undefined} />
        </section>
      )}
      <section className="split">
        <div className="col">
          <MapPanel points={points} onPick={setSelected} />
          <div className="card">
            <h3>진행 중 호출</h3>
            {jobs.length === 0 ? <p className="muted">진행 중인 호출이 없어요.</p> : (
              <table className="table clickable">
                <thead><tr><th>상태</th><th>장비</th><th>내용</th><th>위치</th><th>이용자</th><th>접수</th></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} onClick={() => setSelected(j.id)} className={selected === j.id ? 'sel' : ''}>
                      <td><span className={`pill s-${j.unassignedAlert ? 'alert' : j.status}`}>{j.unassignedAlert ? '미배차' : STATUS[j.status]}</span></td>
                      <td>{TYPE[j.typeCode]}</td>
                      <td>{jobSummary(j)}</td>
                      <td className="ellipsis">{j.address ?? '-'}</td>
                      <td>{j.providerName ?? '-'}</td>
                      <td>{ago(j.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="col side-col">
          {selected ? <JobDetail jobId={selected} onChanged={load} onClose={() => setSelected(null)} /> : <div className="panel muted">호출을 고르면 자세한 내용과 조치가 여기에 나와요.</div>}
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, hint, danger, onClick }: { label: string; value: string; hint?: string; danger?: boolean; onClick?: () => void }) {
  return (
    <div className={`stat ${danger ? 'danger' : ''} ${onClick ? 'link' : ''}`} onClick={onClick}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
