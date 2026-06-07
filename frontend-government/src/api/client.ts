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

export interface NewTown extends Destination {
  region: string;
  available_units: number;
  planned_units: number;
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

export type DocType = 'certificate' | 'proof_of_move';
export interface DocMeta {
  id: number; filename: string; size: number; content_type: string; uploaded_at: string;
  doc_type?: DocType;
}

export type CaseEventKind = 'note' | 'contact' | 'visit' | 'followup'
  | 'document' | 'system' | 'status';

export interface CaseEvent {
  id: number; created_at: string; author: string;
  kind: CaseEventKind;
  title_en: string; title_tc: string;
  body: string | null;
  meta: Record<string, unknown>;
}

export interface Application {
  id: number; created_at: string; status: string;
  applicant_name: string; origin_address: string;
  profile: Profile; destinations: Destination[]; documents: DocMeta[];
  events: CaseEvent[];
  top_destination: Destination | null; note: string | null; decided_at: string | null;
  moved_at?: string | null; proof_pending?: boolean;
}

export interface DestStat {
  id: string; name_en: string; name_tc: string; count: number; avg_score: number;
  moved?: number;
}

/** A GBA city plotted on the stats map: applicant count + settled (moved) count. */
export interface StatPin {
  id: string; name_en: string; name_tc: string; lat: number; lng: number;
  count: number; avg_score: number; moved?: number; settled_label?: string;
}
export interface CareLevelStat { level: number; count: number; }
export interface MonthStat { month: string; count: number; }

export interface Stats {
  total: number;
  by_status: { submitted: number; under_review: number; approved: number; rejected: number; moved: number; };
  settled_total: number;
  units_freed: number;
  pending: number;
  approval_rate: number | null;
  avg_match_score: number | null;
  avg_days_to_decision: number | null;
  by_destination: DestStat[];
  by_care_level: CareLevelStat[];
  step_free_count: number;
  step_free_pct: number;
  avg_income: number | null;
  by_month: MonthStat[];
  total_events: number;
  events_by_kind: Partial<Record<CaseEventKind, number>>;
}

export type Metric = 'age' | 'density' | 'nolift';
export type FeatureCollection = { type: 'FeatureCollection'; features: any[] };

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export const api = {
  districts: () => jget<District[]>('/api/districts'),
  destinations: () => jget<Destination[]>('/api/destinations'),
  newTowns: () => jget<NewTown[]>('/api/new_towns'),
  rank: (profile: Profile) => jpost<Destination[]>('/api/destinations/rank', profile),
  search: (q: string) => jget<BdRecord[]>(`/api/buildings/search?q=${encodeURIComponent(q)}&limit=12`),
  building: (id: number) => jget<BdRecord>(`/api/buildings/${id}`),
  heatmap: (metric: Metric) => jget<FeatureCollection>(`/api/heatmap?metric=${metric}`),
  footprints: (bbox: string) => jget<FeatureCollection>(`/api/buildings?bbox=${bbox}`),
  createApplication: (payload: {
    applicant_name: string; origin_address: string; profile: Profile; destinations: Destination[];
  }) => jpost<{ id: number; status: string }>('/api/applications', payload),
  uploadDocument: async (appId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`/api/applications/${appId}/documents`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(`upload ${r.status}`);
    return r.json();
  },
  applications: () => jget<Application[]>('/api/applications'),
  application: (id: number) => jget<Application>(`/api/applications/${id}`),
  decide: (id: number, decision: string, note: string) =>
    jpost<Application>(`/api/applications/${id}/decision`, { decision, note }),
  events: (id: number) => jget<CaseEvent[]>(`/api/applications/${id}/events`),
  stats: () => jget<Stats>('/api/stats'),
  addEvent: (id: number, payload: {
    kind: CaseEventKind; body?: string; title_en?: string; title_tc?: string;
    author?: string;
  }) => jpost<CaseEvent>(`/api/applications/${id}/events`, payload),
};
