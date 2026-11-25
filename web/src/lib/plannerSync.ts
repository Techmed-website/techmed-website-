// Keeps the Study Planner's localStorage copy in step with the student's plan in the database
// (cbt.study_plans via cbt.get_study_plan / cbt.save_study_plan), so it follows them to a new phone
// and shows on KAIRO's home. localStorage stays the working copy; the server copy is a mirror.
// Signed-out or offline: everything keeps working locally and syncs next time.
import { getSupabase } from './supabase';

const P = 'techmed-study-planner:';
// blob field -> localStorage key suffix
const FIELDS: Record<string, string> = {
  input: 'plan',
  completed: 'completed',
  notes: 'notes',
  snapshot: 'previous-snapshot',
  current_week: 'current-week',
};
const SYNCED_AT = `${P}synced-at`;
export const PLANNER_CHANGED = 'planner-changed';

const ls = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

function readLocal(): Record<string, unknown> {
  const store = ls();
  const out: Record<string, unknown> = {};
  if (!store) return out;
  for (const [field, suffix] of Object.entries(FIELDS)) {
    const raw = store.getItem(P + suffix);
    if (raw) { try { out[field] = JSON.parse(raw); } catch { /* skip corrupt value */ } }
  }
  return out;
}

async function signedIn(): Promise<boolean> {
  try { return !!(await getSupabase().auth.getSession()).data.session; } catch { return false; }
}

async function push(): Promise<void> {
  if (!(await signedIn())) return;
  const server = await getSupabase().schema('cbt').rpc('get_study_plan');
  const keep = ((server.data as { data?: Record<string, unknown> } | null)?.data) ?? {};
  // Keep fields we do not own (e.g. anything KAIRO adds later); overwrite the planner's own fields.
  const blob: Record<string, unknown> = { ...keep };
  for (const field of Object.keys(FIELDS)) delete blob[field];
  Object.assign(blob, readLocal());
  const { data, error } = await getSupabase().schema('cbt').rpc('save_study_plan', { p_data: blob });
  if (!error && data) ls()?.setItem(SYNCED_AT, String(data));
}

/** Call once before the planner reads storage. Server wins when it is newer than this device's last sync. */
export async function hydratePlanner(): Promise<void> {
  try {
    if (!(await signedIn())) return;
    const { data, error } = await getSupabase().schema('cbt').rpc('get_study_plan');
    if (error) return;
    const server = data as { data?: Record<string, unknown>; updated_at?: string } | null;
    const store = ls();
    if (!store) return;
    const hasLocal = !!store.getItem(P + 'plan');
    if (!server?.data || !Object.keys(server.data).length) {
      if (hasLocal) await push(); // first sign-in with an existing local plan: upload it
      return;
    }
    const last = store.getItem(SYNCED_AT);
    if (hasLocal && last && server.updated_at && new Date(server.updated_at) <= new Date(last)) return; // this device is current
    if (hasLocal && !last) { await push(); return; } // a local plan never synced: keep it, upload it
    for (const [field, suffix] of Object.entries(FIELDS)) {
      const v = server.data[field];
      if (v === undefined || v === null) store.removeItem(P + suffix);
      else store.setItem(P + suffix, JSON.stringify(v));
    }
    if (server.updated_at) store.setItem(SYNCED_AT, server.updated_at);
  } catch { /* offline or not set up yet: work locally */ }
}

let timer: ReturnType<typeof setTimeout> | undefined;
if (typeof window !== 'undefined') {
  window.addEventListener(PLANNER_CHANGED, () => {
    clearTimeout(timer);
    timer = setTimeout(() => { push().catch(() => {}); }, 1500);
  });
}
