import { useCallback, useEffect, useState } from 'react';
import { api, Job } from '../api';
import { dateTime, jobSummary, specText, STATUS, TYPE, won } from '../format';

interface Candidate {
  providerId: string;
  companyName: string | null;
  online: boolean;
  busy: boolean;
  rating: number;
  distanceKm: number | null;
  locationFrom: 'live' | 'base' | null;
  lastOffer: string | null;
  equipment: { plateNo: string | null; spec: Record<string, number> }[];
}

const OFFER: Record<string, string> = { REJECTED: '거절함', EXPIRED: '무응답', CLOSED: '마감', CANCELLED_BY_PROVIDER: '배정 후 취소', PENDING: '제안 중', ACCEPTED: '수락' };

/** 호출 상세와 운영자 조치: 수동 배정, 재배차, 취소 */
export function JobDetail({ jobId, onChanged, onClose }: { jobId: string; onChanged?: () => void; onClose?: () => void }) {
  const [job, setJob] = useState<(Job & { provider?: any; equipment?: any }) | null>(null);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await api('GET', `/jobs/${jobId}`);
    setJob(j);
    setCands(j.status === 'REQUESTED' ? await api('GET', `/admin/jobs/${jobId}/candidates`) : null);
  }, [jobId]);

  useEffect(() => {
    setJob(null);
    setMsg(null);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      await load();
      onChanged?.();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!job) return <div className="panel"><p className="muted">불러오는 중…</p></div>;
  const active = !['COMPLETED', 'CANCELLED'].includes(job.status);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>{TYPE[job.typeCode]} · {jobSummary(job)}</h3>
          <span className={`pill s-${job.status}`}>{STATUS[job.status]}</span>
          {job.unassignedAlert && <span className="pill s-alert">미배차 경보</span>}
          {job.scheduledAt && <span className="pill">예약 {dateTime(job.scheduledAt)}</span>}
        </div>
        {onClose && <button className="ghost" onClick={onClose}>닫기</button>}
      </div>

      <dl className="kv">
        <dt>접수</dt><dd>{dateTime(job.createdAt)}</dd>
        <dt>위치</dt><dd>{job.address ?? `${job.lat.toFixed(5)}, ${job.lng.toFixed(5)}`}</dd>
        {job.destAddress && (<><dt>목적지</dt><dd>{job.destAddress}</dd></>)}
        {job.memo && (<><dt>요청 사항</dt><dd className="pre">{job.memo}</dd></>)}
        <dt>이용자</dt>
        <dd>{job.provider ? `${job.provider.companyName ?? '-'} · ★${job.provider.rating.toFixed(1)}${job.equipment ? ` · ${job.equipment.plateNo ?? ''} ${specText(job.equipment.spec)}` : ''}` : '-'}</dd>
      </dl>

      <table className="lines">
        <tbody>
          {job.estimate.lines.map((l, i) => (<tr key={i}><td>{l.label}</td><td className="num">{won(l.amount)}</td></tr>))}
          {job.adjustments?.map((a) => (
            <tr key={a.id} className={a.status === 'REJECTED' ? 'muted' : ''}>
              <td>추가 · {a.reason} <span className="pill">{a.status === 'APPROVED' ? '승인' : a.status === 'REJECTED' ? '거절' : '승인 대기'}</span></td>
              <td className="num">{won(a.amount)}</td>
            </tr>
          ))}
          <tr className="total">
            <td>{job.status === 'COMPLETED' ? '최종 요금' : job.status === 'CANCELLED' ? '취소 수수료' : '예상 요금'}</td>
            <td className="num">{won(job.status === 'COMPLETED' ? job.finalFare : job.status === 'CANCELLED' ? job.cancelFee : job.estimate.amount)}</td>
          </tr>
        </tbody>
      </table>
      {job.status === 'CANCELLED' && <p className="muted">취소한 쪽: {job.cancelledBy === 'ADMIN' ? '운영자' : job.cancelledBy === 'CUSTOMER' ? '사용자' : job.cancelledBy ?? '-'}</p>}

      {msg && <p className="note">{msg}</p>}

      {job.status === 'REQUESTED' && (
        <>
          <div className="row gap">
            <h4 className="grow">배정할 이용자</h4>
            <button disabled={busy} onClick={() => act(() => api('POST', `/admin/jobs/${job.id}/redispatch`), '자동 배차를 다시 시작했어요')}>자동 배차 다시 시작</button>
          </div>
          {cands?.length === 0 && <p className="muted">이 호출에 맞는 장비를 가진 승인된 이용자가 없어요.</p>}
          {!!cands?.length && (
            <table className="table">
              <thead><tr><th>이용자</th><th>장비</th><th>거리</th><th>상태</th><th>이번 호출</th><th /></tr></thead>
              <tbody>
                {cands.map((c) => (
                  <tr key={c.providerId}>
                    <td>{c.companyName ?? '-'} <span className="muted">★{c.rating.toFixed(1)}</span></td>
                    <td>{c.equipment.map((e) => `${e.plateNo ?? ''} ${specText(e.spec)}`).join(', ')}</td>
                    <td>{c.distanceKm == null ? '-' : `${c.distanceKm}km`} <span className="muted">{c.locationFrom === 'base' ? '(차고지)' : ''}</span></td>
                    <td>{c.busy ? '작업 중' : c.online ? '대기 중' : '퇴근'}</td>
                    <td>{c.lastOffer ? OFFER[c.lastOffer] : '-'}</td>
                    <td>
                      <button
                        className="primary sm"
                        disabled={busy || (c.busy && !job.scheduledAt)}
                        onClick={() => confirm(`${c.companyName ?? '이 이용자'}에게 배정할까요? 전화로 먼저 확인했는지 확인하세요.`) &&
                          act(() => api('POST', `/admin/jobs/${job.id}/assign`, { providerId: c.providerId }), '배정했어요')}
                      >
                        배정
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {active && (
        <div className="row end">
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              const reason = prompt('취소 사유 (사용자에게 요금은 청구되지 않아요)');
              if (reason !== null) act(() => api('POST', `/admin/jobs/${job.id}/cancel`, { reason }), '취소했어요');
            }}
          >
            운영자 취소
          </button>
        </div>
      )}
    </div>
  );
}
