import { useEffect, useMemo, useState } from 'react';
import { api, Job } from '../api';
import { JobDetail } from '../components/JobDetail';
import { dateTime, jobSummary, phone, STATUS, TYPE, won } from '../format';

export function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = () => api<Job[]>('GET', '/admin/jobs?status=all').then(setJobs);
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => jobs.filter((j) => (!status || j.status === status) && (!type || j.typeCode === type)), [jobs, status, type]);

  return (
    <>
      <header className="page-head">
        <h1>호출 내역</h1>
        <span className="muted">최근 200건</span>
      </header>
      <div className="row gap filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">전체 상태</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">전체 장비</option>
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load}>새로 고침</button>
      </div>
      <section className="split">
        <div className="col">
          <div className="card">
            <table className="table clickable">
              <thead><tr><th>접수</th><th>장비</th><th>내용</th><th>상태</th><th>사용자</th><th>이용자</th><th className="num">요금</th></tr></thead>
              <tbody>
                {shown.map((j) => (
                  <tr key={j.id} onClick={() => setSelected(j.id)} className={selected === j.id ? 'sel' : ''}>
                    <td>{dateTime(j.createdAt)}</td>
                    <td>{TYPE[j.typeCode]}</td>
                    <td>{jobSummary(j)}</td>
                    <td><span className={`pill s-${j.status}`}>{STATUS[j.status]}</span></td>
                    <td>{phone(j.customerPhone)}</td>
                    <td>{j.providerName ?? '-'}</td>
                    <td className="num">{won(j.finalFare ?? (j.status === 'CANCELLED' ? j.cancelFee : j.estimate.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="muted">조건에 맞는 호출이 없어요.</p>}
          </div>
        </div>
        <div className="col side-col">
          {selected ? <JobDetail jobId={selected} onChanged={load} onClose={() => setSelected(null)} /> : <div className="panel muted">호출을 고르면 자세한 내용이 나와요.</div>}
        </div>
      </section>
    </>
  );
}
