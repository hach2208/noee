// Noéé : enregistrement des contacts (Supabase, webhook, et copie locale).
import { CONFIG } from './config.js';
import { utmSession } from './ui.js';

const L = CONFIG.leads;
const CLE = 'noee_leads';

export async function enregistrerLead(lead) {
  const complet = {
    ...lead,
    utm: utmSession(),
    page: location.pathname,
    cree_le: new Date().toISOString(),
  };
  const envois = [];

  if (L.supabaseUrl && L.supabaseAnonKey) {
    envois.push(fetch(`${L.supabaseUrl.replace(/\/$/, '')}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        apikey: L.supabaseAnonKey,
        Authorization: `Bearer ${L.supabaseAnonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        type: complet.type,
        nom: complet.contact?.nom || null,
        telephone: complet.contact?.telephone || null,
        email: complet.contact?.email || null,
        adresse: complet.bien?.adresse || null,
        insee: complet.bien?.insee || null,
        donnees: complet,
      }),
    }).then((r) => { if (!r.ok) throw new Error(`Supabase ${r.status}`); }));
  }
  if (L.webhookUrl) {
    envois.push(fetch(L.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(complet) })
      .then((r) => { if (!r.ok) throw new Error(`Webhook ${r.status}`); }));
  }

  // Copie locale : toujours, pour ne jamais perdre un contact
  try {
    const liste = JSON.parse(localStorage.getItem(CLE) || '[]');
    liste.unshift(complet);
    localStorage.setItem(CLE, JSON.stringify(liste.slice(0, 500)));
  } catch { /* stockage indisponible */ }

  const res = await Promise.allSettled(envois);
  const echecs = res.filter((r) => r.status === 'rejected');
  if (echecs.length) console.warn('Envoi du contact incomplet', echecs.map((e) => e.reason?.message));
  return { ok: echecs.length < res.length || !res.length, distant: res.length > 0 };
}

export function leadsLocaux() {
  try { return JSON.parse(localStorage.getItem(CLE) || '[]'); } catch { return []; }
}

export function viderLeadsLocaux() {
  try { localStorage.removeItem(CLE); } catch { /* rien */ }
}

export const telValide = (t) => /^(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}$/.test(String(t).trim());
export const emailValide = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim());
