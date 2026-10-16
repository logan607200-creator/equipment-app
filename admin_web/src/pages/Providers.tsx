import { useEffect, useState } from 'react';
import { api, Provider } from '../api';
import { dateTime, phone, specText, TYPE } from '../format';

/** 이용자 검수: 서류(면허, 차량등록증, 사업자등록증, 보험)를 확인한 뒤 승인한다 */
export function Providers() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [list, setList] = useState<Provider[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api<Provider[]>('GET', tab === 'pending' ? '/admin/providers?verified=false' : '/admin/providers').then(setList);
  useEffect(() => { load(); }, [tab]);

  const verify = async (p: Provider, verified: boolean) => {
    if (!verified && !confirm(`${p.companyName ?? '이 이용자'}의 승인을 취소할까요? 바로 퇴근 처리되고 호출을 받지 못해요.`)) return;
    await api('POST', `/admin/providers/${p.id}/verify`, { verified });
    setMsg(`${p.companyName ?? '이용자'}를 ${verified ? '승인' : '승인 취소'}했어요`);
    load();
  };

  return (
    <>
      <header className="page-head">
        <h1>이용자</h1>
        <span className="muted">장비 기사·업체</span>
      </header>
      <div className="tabs">
        <button className={tab === 'pending' ? 'tab active' : 'tab'} onClick={() => setTab('pending')}>승인 대기</button>
        <button className={tab === 'all' ? 'tab active' : 'tab'} onClick={() => setTab('all')}>전체</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      <div className="card">
        {list.length === 0 ? <p className="muted">{tab === 'pending' ? '승인을 기다리는 이용자가 없어요.' : '이용자가 없어요.'}</p> : (
          <table className="table">
            <thead>
              <tr><th>업체</th><th>연락처</th><th>사업자번호</th><th>장비</th><th>평점</th><th>수락률</th><th>취소</th><th>상태</th><th>가입</th><th /></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.companyName ?? '(미입력)'}</b></td>
                  <td>{phone(p.phone)}</td>
                  <td>{p.bizRegNo ?? <span className="danger-text">미입력</span>}</td>
                  <td>
                    {p.equipment.length === 0 ? <span className="danger-text">없음</span> : p.equipment.map((e) => (
                      <div key={e.id}>{TYPE[e.typeCode]} {specText(e.spec)} <span className="muted">{e.plateNo}</span></div>
                    ))}
                  </td>
                  <td>★{p.rating.toFixed(1)} <span className="muted">({p.ratingCount})</span></td>
                  <td>{p.offersReceived ? `${Math.round(p.acceptanceRate * 100)}%` : '-'}</td>
                  <td>{p.cancelCount}</td>
                  <td>{!p.verified ? <span className="pill">승인 대기</span> : p.currentJobId ? <span className="pill s-IN_PROGRESS">작업 중</span> : p.online ? <span className="pill s-COMPLETED">출근</span> : <span className="pill">퇴근</span>}</td>
                  <td>{dateTime(p.createdAt)}</td>
                  <td>
                    {p.verified
                      ? <button className="ghost sm" onClick={() => verify(p, false)}>승인 취소</button>
                      : <button className="primary sm" disabled={!p.equipment.length} onClick={() => verify(p, true)}>승인</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted small">서류 사진 제출은 이용자 앱에 곧 추가돼요. 지금은 서류를 따로 받아 확인한 뒤 승인해 주세요.</p>
    </>
  );
}
