import { io, Socket } from 'socket.io-client';

/** 서버 주소. 빌드할 때 VITE_API_URL 로 바꾼다. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let token: string | null = localStorage.getItem('adminToken');
let socket: Socket | null = null;

export const isLoggedIn = () => !!token;

export function logout() {
  token = null;
  localStorage.removeItem('adminToken');
  socket?.disconnect();
  socket = null;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) logout();
    const msg = data?.message;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('\n') : msg ?? '요청에 실패했어요');
  }
  return data as T;
}

export async function login(phone: string, code: string) {
  const res = await api<{ token: string }>('POST', '/auth/otp/verify', { phone, code, role: 'ADMIN' });
  token = res.token;
  localStorage.setItem('adminToken', token);
}

/** 미배차 경보를 실시간으로 받는다 */
export function onAdminAlert(fn: (data: any) => void) {
  if (!token) return () => {};
  socket ??= io(`${API_URL}/ws`, { auth: { token }, transports: ['websocket'] });
  socket.on('admin.alert', fn);
  return () => socket?.off('admin.alert', fn);
}

// ---- 타입 ----

export interface Job {
  id: string;
  typeCode: string;
  status: string;
  options: Record<string, any>;
  requiredSpec: Record<string, number>;
  lat: number;
  lng: number;
  address: string | null;
  destAddress: string | null;
  memo: string | null;
  scheduledAt: string | null;
  providerId: string | null;
  providerName?: string | null;
  customerPhone?: string | null;
  estimate: { amount: number; min: number; max: number; lines: { label: string; amount: number }[]; distanceKm?: number };
  finalFare: number | null;
  cancelFee: number;
  cancelledBy: string | null;
  unassignedAlert: boolean;
  createdAt: string;
  matchedAt: string | null;
  completedAt: string | null;
  adjustments?: { id: string; amount: number; reason: string; status: string }[];
}

export interface Provider {
  id: string;
  companyName: string | null;
  bizRegNo: string | null;
  phone: string | null;
  verified: boolean;
  online: boolean;
  currentJobId: string | null;
  rating: number;
  ratingCount: number;
  acceptanceRate: number;
  offersReceived: number;
  cancelCount: number;
  equipment: { id: string; typeCode: string; plateNo: string | null; spec: Record<string, number> }[];
  location: { lat: number; lng: number; ts: number } | null;
  createdAt: string;
}

export interface EquipmentType {
  code: string;
  name: string;
  pricingModel: 'DISTANCE' | 'TIME';
  specKeys: string[];
  rates: Record<string, any>;
}
