-- ============================================================
-- Setup tabel Web Push untuk aplikasi Cek Kesiapan Kamar
-- Jalankan di Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_name text,
  role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Perangkat (anon key) boleh menyimpan/memperbarui langganannya sendiri.
-- Edge Function memakai service_role key sehingga melewati RLS ini.
drop policy if exists "anon_insert_push_subs" on public.push_subscriptions;
create policy "anon_insert_push_subs" on public.push_subscriptions
  for insert to anon with check (true);

drop policy if exists "anon_update_push_subs" on public.push_subscriptions;
create policy "anon_update_push_subs" on public.push_subscriptions
  for update to anon using (true) with check (true);

drop policy if exists "anon_select_push_subs" on public.push_subscriptions;
create policy "anon_select_push_subs" on public.push_subscriptions
  for select to anon using (true);

create index if not exists idx_push_subs_updated on public.push_subscriptions (updated_at desc);

-- ============================================================
-- Opsional: Database Webhook (lebih mudah lewat Dashboard)
-- Supabase Dashboard → Database → Webhooks → New webhook:
--   Table:   public.room_inspections
--   Events:  INSERT (+ UPDATE bila ingin notifikasi saat jadi SIAP PAKAI)
--   Method:  POST
--   URL:     https://<project-ref>.supabase.co/functions/v1/send-room-push
--   Headers: x-webhook-secret: <isi PUSH_WEBHOOK_SECRET yang sama>
-- Payload template default berisi { "record": { ... } } — sudah didukung fungsi.
-- ============================================================
