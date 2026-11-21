# Perbaikan Aplikasi Cek Kesiapan Kamar — v6.8

Tiga perbaikan yang diminta:

1. **Navigasi "Cek Kamar" untuk akun Petugas**
2. **Tombol "Batalkan Pasien Masuk" di bagian Perawat**
3. **Notifikasi tetap berbunyi walaupun aplikasi tidak sedang dibuka**

File utama yang digantikan: `index.html`, `app.js`, `sw.js`.
File pendukung push ada di folder `supabase/`.

---

## 1. Navigasi Cek Kamar untuk Petugas

- **Sebelumnya:** pada akun Petugas, tombol navigasi **Cek Kamar** disembunyikan, sehingga Petugas tidak bisa kembali ke form cek kamar dari menu Perbaikan/Analitik (navigasi hanya 2 kolom).
- **Sekarang:** tombol **Cek Kamar** tampil di navigasi bawah Petugas; layout menjadi 3 kolom: **Cek Kamar · Perbaikan · Analitik**. Tab Dasbor dan Pengaturan tetap disembunyikan untuk Petugas sesuai aturan lama.

## 2. Tombol Pembatalan Pasien Masuk (Perawat)

- Muncul di kartu kamar Perawat ketika permintaan **Siapkan Kamar** (pasien masuk) masih aktif — yaitu belum ditutup dengan laporan "Pasien Pulang" dan kamar belum berstatus Siap Pakai.
- Tombol **Batalkan Pasien Masuk** (garis putus-rose) menjalankan:
  - Menandai laporan permintaan dengan `[REQ_CANCELLED: pasien_masuk]` dan shift "Dibatalkan Pasien Masuk • jam WIB".
  - Mengosongkan stempel kamar sehingga keluar dari antrean pengingat + notifikasi persistent Petugas.
  - Menutup notifikasi sistem yang sedang terbuka untuk kamar tersebut.
  - Membuka kembali tombol **Siapkan Kamar** (tidak lagi terkunci).
  - Membunyikan chime + suara "Permintaan pasien masuk kamar … dibatalkan" dan getaran.
- Riwayat laporan dan menu Notifikasi menampilkan badge **DIBATALKAN** (abu-abu); tombol "Cek & Siapkan Kamar Ini" untuk laporan yang dibatalkan disembunyikan.

## 3. Notifikasi tetap berbunyi saat aplikasi tidak dibuka

### Bagian A — Langsung aktif tanpa server (aplikasi di latar layar / minimized)

Browser memblokir chime Web Audio dan suara bicara (SpeechSynthesis) saat halaman tidak tampil, jadi perbaikan memakai **notifikasi sistem dari Service Worker**:

- `sw.js` menangani pesan `SHOW_ALERT` dari halaman dan menampilkannya dengan `vibrate`, `renotify: true`, `requireInteraction: true`, `silent: false` — nada notifikasi sistem Android berbunyi ulang setiap putaran pengingat (15 detik) untuk permintaan perawat yang belum ditindaklanjuti, dan setiap laporan baru masuk.
- Pada saat aplikasi tampil, chime + suara bahasa Indonesia tetap seperti semula; saat di latar, nada sistem + getar yang dipakai.
- Persyaratan di HP:
  1. Tekan **Izinkan** saat browser meminta izin Notifikasi (atau di menu Pengaturan → "Izinkan").
  2. Pasang aplikasi sebagai PWA (tombol Install di layar login) untuk pengalaman penuh.
  3. Di Android, jangan aktifkan pembatasan baterai/bakground untuk browser yang dipakai (Pengaturan → Aplikasi → browser → Baterai → Tanpa pembatasan).

### Bagian B — Web Push: bunyi saat aplikasi tertutup total (opsional)

Kalau aplikasi benar-benar ditutup (diklik swipe dari recent apps), hanya **Web Push** yang bisa membangunkan Service Worker. Sudah disediakan:

| Berkas | Fungsi |
|---|---|
| `supabase/setup_push.sql` | Tabel `push_subscriptions` + RLS |
| `supabase/functions/send-room-push/index.ts` | Edge Function pengirim Web Push ke semua perangkat |
| `supabase/.env.push.example` | Pasangan kunci VAPID + contoh secret webhook |
| `sw.js` | Handler `push` yang menampilkan notifikasi + getar |
| `app.js` | Pendaftaran langganan push perangkat (`pushManager.subscribe`) |

Langkah deploy:

1. Jalankan `supabase/setup_push.sql` di **Supabase Dashboard → SQL Editor**.
2. Deploy fungsi:
   - CLI: `supabase functions deploy send-room-push`
   - atau unggah folder `supabase/functions/send-room-push` lewat Dashboard Edge Functions.
3. Isi Secrets (Dashboard → Edge Functions → Environment Secrets):
   - `VAPID_PUBLIC_KEY` (nilainya sudah sama dengan yang terpasang di `app.js`)
   - `VAPID_PRIVATE_KEY` (rahasia, lihat `.env.push.example`)
   - `PUSH_WEBHOOK_SECRET` (string acak panjang; ganti nilai contoh)
4. Buat **Database Webhook** (Dashboard → Database → Webhooks → New):
   - Table: `public.room_inspections`
   - Events: `INSERT` (tambahkan `UPDATE` bila ingin notifikasi saat kamar jadi Siap Pakai)
   - Method POST ke `https://<project-ref>.supabase.co/functions/v1/send-room-push`
   - Header: `x-webhook-secret: <nilai PUSH_WEBHOOK_SECRET>`
5. Di tiap HP, izinkan notifikasi (tombol **Izinkan**); langganan push tersimpan otomatis. Tombol **Bunyi Saat Tertutup** di menu Pengaturan untuk mengecek status.

Catatan kompatibilitas: Web Push paling stabil di Chrome/Edge Android. iOS Safari mendukung Web Push sejak versi 16.4 untuk PWA yang terpasang di Home Screen.

---

## Catatan teknis kecil

- Policy RLS anon pada `push_subscriptions` hanya menyimpan endpoint push + nama/role (bukan data medis sensitif). Bila ingin lebih ketat, arahkan pendaftaran ke akun Supabase Auth dan batasi policy per pengguna.
- Bila Bagian B belum di-deploy, Bagian A tetap berjalan normal; tombol Bunyi Saat Tertutup akan menampilkan pesan konfigurasi yang jelas, bukan error.
