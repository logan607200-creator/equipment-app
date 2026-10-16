import { useEffect, useState } from 'react';
import { api, EquipmentType } from '../api';
import { won } from '../format';

type Field = { path: string[]; label: string; unit: '원' | 'km' | '%' | '시간' };

const DISTANCE_FIELDS: Field[] = [
  { path: ['base', 'CAR'], label: '기본료 · 승용', unit: '원' },
  { path: ['base', 'SUV'], label: '기본료 · SUV', unit: '원' },
  { path: ['base', 'TRUCK_1T'], label: '기본료 · 1톤 이하', unit: '원' },
  { path: ['includedKm'], label: '기본료 포함 거리', unit: 'km' },
  { path: ['perKm'], label: '초과 km당', unit: '원' },
  { path: ['emergency', 'BATTERY'], label: '긴급출동 · 배터리', unit: '원' },
  { path: ['emergency', 'TIRE'], label: '긴급출동 · 타이어', unit: '원' },
  { path: ['emergency', 'LOCKOUT'], label: '긴급출동 · 잠금 해제', unit: '원' },
  { path: ['surcharge', 'night'], label: '야간 할증 (22~06시)', unit: '%' },
  { path: ['surcharge', 'holiday'], label: '주말 할증', unit: '%' },
  { path: ['surcharge', 'highway'], label: '고속도로 할증', unit: '%' },
  { path: ['rangePct'], label: '예상 요금 범위 (±)', unit: '%' },
  { path: ['cancelFee'], label: '출동 후 취소 수수료', unit: '원' },
];

const TIME_FIELDS: Field[] = [
  { path: ['hourly'], label: '시간당', unit: '원' },
  { path: ['minHours'], label: '최소 시간', unit: '시간' },
  { path: ['halfDay'], label: '반나절 (4시간)', unit: '원' },
  { path: ['day'], label: '하루 (8시간)', unit: '원' },
  { path: ['surcharge', 'night'], label: '야간 할증 (22~06시)', unit: '%' },
  { path: ['surcharge', 'holiday'], label: '주말 할증', unit: '%' },
  { path: ['cancelFee'], label: '출동 후 취소 수수료', unit: '원' },
];

const get = (o: any, p: string[]) => p.reduce((v, k) => v?.[k], o);
function set(o: any, p: string[], value: number) {
  const copy = structuredClone(o ?? {});
  let cur = copy;
  p.slice(0, -1).forEach((k) => (cur = cur[k] ??= {}));
  cur[p[p.length - 1]] = value;
  return copy;
}

/** 장비별 요금표. 기본값은 가정치라 운영 전에 실제 금액으로 바꿔야 한다. */
export function Rates() {
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [code, setCode] = useState('TOW');
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api<EquipmentType[]>('GET', '/equipment-types').then(setTypes); }, []);
  const type = types.find((t) => t.code === code);
  // 장비를 바꿀 때만 초안을 새로 잡는다 (저장 직후 안내 문구가 지워지지 않도록)
  useEffect(() => {
    const t = types.find((x) => x.code === code);
    if (t) { setDraft(structuredClone(t.rates)); setMsg(null); }
  }, [code, types.length]);

  if (!type || !draft) return <p className="muted">불러오는 중…</p>;
  const fields = type.pricingModel === 'DISTANCE' ? DISTANCE_FIELDS : TIME_FIELDS;
  const dirty = JSON.stringify(draft) !== JSON.stringify(type.rates);

  const save = async () => {
    const saved = await api<EquipmentType>('PUT', `/admin/equipment-types/${code}`, { rates: draft });
    setTypes((ts) => ts.map((t) => (t.code === code ? saved : t)));
    setDraft(structuredClone(saved.rates));
    setMsg(`${type.name} 요금표를 저장했어요. 새 호출부터 적용돼요.`);
  };

  return (
    <>
      <header className="page-head">
        <h1>요금표</h1>
        <span className="muted">지금 값은 구조를 보여주기 위한 가정치예요. 국토부 운임표와 업체 협의를 거쳐 실제 금액으로 바꿔 주세요.</span>
      </header>
      <div className="tabs">
        {types.map((t) => (
          <button key={t.code} className={code === t.code ? 'tab active' : 'tab'} onClick={() => setCode(t.code)}>{t.name}</button>
        ))}
      </div>
      <div className="card rates">
        <p className="muted">{type.pricingModel === 'DISTANCE' ? '거리 요금: 기본료 + 초과 거리 + 할증' : '대여 요금: 시간·반나절·하루 단위 + 할증'}</p>
        <div className="grid">
          {fields.map((f) => {
            const raw = get(draft, f.path) ?? 0;
            const shown = f.unit === '%' ? Math.round(raw * 1000) / 10 : raw;
            return (
              <label key={f.path.join('.')}>
                {f.label}
                <div className="input-unit">
                  <input
                    type="number"
                    value={shown}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setDraft(set(draft, f.path, f.unit === '%' ? v / 100 : v));
                    }}
                  />
                  <span>{f.unit}</span>
                </div>
                {f.unit === '원' && <small className="muted">{won(raw)}</small>}
              </label>
            );
          })}
        </div>
        {msg && <p className="note">{msg}</p>}
        <div className="row end gap">
          <button disabled={!dirty} onClick={() => setDraft(structuredClone(type.rates))}>되돌리기</button>
          <button className="primary" disabled={!dirty} onClick={save}>저장</button>
        </div>
      </div>
    </>
  );
}
