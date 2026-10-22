-- Noéé : table des contacts (à coller dans Supabase > SQL Editor)
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  type text not null check (type in ('estimation', 'division')),
  nom text,
  telephone text,
  email text,
  adresse text,
  insee text,
  statut text not null default 'nouveau',
  donnees jsonb not null default '{}'::jsonb
);

alter table public.leads enable row level security;

-- Le site (clé anon) peut seulement AJOUTER un contact, jamais lire.
drop policy if exists "insertion publique" on public.leads;
create policy "insertion publique" on public.leads
  for insert to anon
  with check (char_length(coalesce(nom, '')) <= 120 and char_length(coalesce(email, '')) <= 200);

create index if not exists leads_cree_le_idx on public.leads (cree_le desc);
