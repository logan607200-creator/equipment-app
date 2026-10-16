export interface LatLng {
  lat: number;
  lng: number;
}

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/** 직선 거리를 도로 거리로 어림하는 계수. 실제 경로 API(T맵 등)로 바꾸기 전까지 쓴다. */
export const ROAD_FACTOR = 1.35;
