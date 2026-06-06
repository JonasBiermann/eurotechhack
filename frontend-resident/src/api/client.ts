// Typed API client. URLs are relative — Vite proxies /api to the FastAPI backend.

export interface District {
  id: string; name_en: string; name_tc: string;
  center: [number, number]; bbox: [number, number, number, number];
  count: number; mean_age: number | null; oldest_age: number | null; pct_no_lift: number | null;
}

export interface Factor {
  key: string; label_en: string; label_tc: string;
  weight: number; value: number; contribution: number;
}
export interface MatchResult { score: number; factors: Factor[]; }

export interface Destination {
  id: string; name_en: string; name_tc: string; blurb_en: string; blurb_tc: string;
  lat: number; lng: number; monthly_cost: number; step_free_housing: number;
  care_capacity: number; healthcare_score: number; livability: number;
  hk_community: number; travel_time_hr: number; match?: MatchResult;
}

export interface BdRecord {
  id: number; address_en: string; address_tc: string;
  district_en: string; district_tc: string; region_en: string; region_tc: string;
  block_id: string; op_number: string; op_date: string; op_year: number | null;
  age_years: number | null; type_en: string; type_tc: string;
  usage_en: string; usage_tc: string; lat: number; lng: number;
  footprint_id: number | null; height_m: number | null; storeys_est: number | null;
  no_lift: number | null; lift_likely: number | null;
}

export interface Profile {
  monthly_income?: number; savings?: number; monthly_budget?: number;
  needs_step_free?: boolean; mobility_level?: number;
  care_level?: number; needs_clinic_nearby?: boolean;
  pref_near_family?: number; pref_green_space?: number;
  pref_community?: number; pref_quiet?: number;
}

export interface DocMeta {
  id: number; filename: string; size: number; content_type: string; uploaded_at: string;
}

export interface Application {
  id: number; created_at: string; status: string;
  applicant_name: string; origin_address: string;
  profile: Profile; destinations: Destination[]; documents: DocMeta[];
  top_destination: Destination | null; note: string | null; decided_at: string | null;
}

export type Metric = 'age' | 'density' | 'nolift';
export type FeatureCollection = { type: 'FeatureCollection'; features: any[] };

export interface Resident { id: number; hkid: string; name: string; }
export interface AuthResult { token: string; resident: Resident; }

/** Error carrying the HTTP status so the UI can branch on 404/409/400 etc. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const TOKEN_KEY = 'silverlink.token';
let authToken: string | null = localStorage.getItem(TOKEN_KEY);

export function setAuthToken(t: string | null): void {
  authToken = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getAuthToken(): string | null { return authToken; }

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra || {}) };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

async function detail(r: Response): Promise<string> {
  try { return (await r.json()).detail ?? r.statusText; } catch { return r.statusText; }
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new ApiError(r.status, await detail(r));
  return r.json();
}
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new ApiError(r.status, await detail(r));
  return r.json();
}

export const api = {
  register: (hkid: string, name: string) => jpost<AuthResult>('/api/auth/register', { hkid, name }),
  login: (hkid: string) => jpost<AuthResult>('/api/auth/login', { hkid }),
  me: () => jget<Resident>('/api/auth/me'),
  logout: () => jpost<{ ok: boolean }>('/api/auth/logout', {}),
  myApplications: () => jget<Application[]>('/api/applications/mine'),
  districts: () => jget<District[]>('/api/districts'),
  destinations: () => jget<Destination[]>('/api/destinations'),
  rank: (profile: Profile) => jpost<Destination[]>('/api/destinations/rank', profile),
  search: (q: string) => jget<BdRecord[]>(`/api/buildings/search?q=${encodeURIComponent(q)}&limit=12`),
  building: (id: number) => jget<BdRecord>(`/api/buildings/${id}`),
  heatmap: (metric: Metric) => jget<FeatureCollection>(`/api/heatmap?metric=${metric}`),
  footprints: (bbox: string) => jget<FeatureCollection>(`/api/buildings?bbox=${bbox}`),
  createApplication: (payload: {
    origin_address: string; profile: Profile; destinations: Destination[];
  }) => jpost<{ id: number; status: string }>('/api/applications', payload),
  uploadDocument: async (appId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`/api/applications/${appId}/documents`, {
      method: 'POST', headers: authHeaders(), body: fd,
    });
    if (!r.ok) throw new ApiError(r.status, `upload ${r.status}`);
    return r.json();
  },
  applications: () => jget<Application[]>('/api/applications'),
  application: (id: number) => jget<Application>(`/api/applications/${id}`),
  decide: (id: number, decision: string, note: string) =>
    jpost<Application>(`/api/applications/${id}/decision`, { decision, note }),
};
