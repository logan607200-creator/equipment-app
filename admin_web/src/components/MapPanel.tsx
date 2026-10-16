import L from 'leaflet';
import { useEffect, useRef } from 'react';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  kind: 'job' | 'alert' | 'provider' | 'busy';
  label: string;
}

const COLORS = { job: '#b87a00', alert: '#d64545', provider: '#2e9e5b', busy: '#1b2430' };

/** 진행 중 호출과 출근한 이용자 위치. 지도 타일은 출시 전 카카오·네이버로 바꾼다. */
export function MapPanel({ points, onPick }: { points: MapPoint[]; onPick?: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true }).setView([37.5326, 127.0246], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const g = layer.current;
    if (!g || !map.current) return;
    g.clearLayers();
    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: p.kind === 'alert' ? 10 : 8,
        color: '#fff',
        weight: 2,
        fillColor: COLORS[p.kind],
        fillOpacity: 1,
      }).bindTooltip(p.label, { permanent: p.kind !== 'provider', direction: 'top', offset: [0, -8], className: `tip tip-${p.kind}` });
      if (onPick && p.kind !== 'provider' && p.kind !== 'busy') m.on('click', () => onPick(p.id));
      m.addTo(g);
    }
    if (!fitted.current && points.length) {
      map.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.3), { maxZoom: 14 });
      fitted.current = true;
    }
  }, [points, onPick]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div className="legend">
        <span><i style={{ background: COLORS.alert }} />미배차</span>
        <span><i style={{ background: COLORS.job }} />진행 중 호출</span>
        <span><i style={{ background: COLORS.provider }} />대기 중 이용자</span>
        <span><i style={{ background: COLORS.busy }} />작업 중 이용자</span>
      </div>
    </div>
  );
}
