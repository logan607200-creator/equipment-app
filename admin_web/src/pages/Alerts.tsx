import { useEffect, useState } from 'react';
import { api, Job } from '../api';
import { JobDetail } from '../components/JobDetail';
import { ago, jobSummary, phone, TYPE } from '../format';

/** 자동 배차에 실패한 호출. 근처 이용자에게 전화로 확인한 뒤 직접 배정한다. */
export function Alerts() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    const list = await api<Job[]>('GET', '/admin/jobs?status=alert');
    setJobs(list);
    setSelected((s) => s ?? list[0]?.id ?? null);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <header className="page-head">
        <h1>미배차</h1>
        <span className="muted">반경 20km까지 넓혀도 수락한 이용자가 없는 호출이에요. 전화로 확인한 뒤 배정해 주세요.</span>
      </header>
      <section className="split">
        <div className="col">
          <div className="card">
            {jobs === null ? <p className="muted">불러오는 중…</p> : jobs.length === 0 ? <p className="muted">미배차 호출이 없어요.</p> : (
              <table className="table clickable">
                <thead><tr><th>장비</th><th>내용</th><th>위치</th><th>사용자</th><th>접수</th></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} onClick={() => setSelected(j.id)} className={selected === j.id ? 'sel' : ''}>
                      <td>{TYPE[j.typeCode]}</td>
                      <td>{jobSummary(j)}</td>
                      <td className="ellipsis">{j.address ?? '-'}</td>
                      <td>{phone(j.customerPhone)}</td>
                      <td className="danger-text">{ago(j.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="col side-col">
          {selected && <JobDetail jobId={selected} onChanged={() => { setSelected(null); load(); }} />}
        </div>
      </section>
    </>
  );
}
