/* ==========================================================================
   CEK KESIAPAN KAMAR v6.5 — RS KHUSUS BEDAH SS MEDIKA
   Terhubung penuh ke database asli Supabase (master_units, master_items,
   room_inspections, app_users) tanpa mengubah atau menghapus data lama.
   ========================================================================== */

const APP_VERSION = 'v6.5';
const SUPABASE_URL = 'https://ymxpxrrjxnujygabrhsg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlteHB4cnJqeG51anlnYWJyaHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MDk0MjAsImV4cCI6MjExMDQ4NTQyMH0.tFMCbg1_R-I08KEIs-h6wwxXhYLP2Z0oYgnDGC7T2YU';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Bersihkan otomatis cache Service Worker versi lama saat pertama kali naik ke v6.5
(async function autoClearOldCache() {
  try {
    if (localStorage.getItem('ck_ver') !== APP_VERSION) {
      localStorage.setItem('ck_ver', APP_VERSION);
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.update();
      }
    }
  } catch (e) {}
})();

const SHIFT_CATEGORY_KEY = '__SHIFT__';
const APPROVAL_CONFIG_KEY = '__CONFIG_APPROVAL__';
const REPAIR_RECORD_TAG = '[JENIS_LAPORAN: CEK_PERBAIKAN]';
const CHECKOUT_RECORD_TAG = '[JENIS_LAPORAN: PASIEN_PULANG]';
const NURSE_REQ_TAG = '[JENIS_LAPORAN: PERMINTAAN_PERAWAT]';
const TEKNISI_REQ_TAG = '[JENIS_LAPORAN: TUGAS_TEKNISI]';

const TEKNISI_CHECKLIST_ITEMS = [
  { id: 'tek-1', category: 'Tata Udara', item_name: 'AC berfungsi baik, suhu dingin stabil & tidak bocor' },
  { id: 'tek-2', category: 'Hiburan', item_name: 'TV menyala jernih, saluran normal & remote berfungsi' },
  { id: 'tek-3', category: 'Kelistrikan', item_name: 'Lampu kamar, lampu baca & stopkontak berfungsi normal' },
  { id: 'tek-4', category: 'Sanitasi & Air', item_name: 'Keran air panas/dingin, shower & flush closet normal' },
  { id: 'tek-5', category: 'Sistem Panggil', item_name: 'Bel perawat (Nurse Call) & telepon kamar berfungsi' }
];

// Kompatibel dengan sesi lama (ck_user) maupun baru
function loadSavedSession() {
  try {
    const u = JSON.parse(localStorage.getItem('ck_user') || 'null');
    if (u && (u.username || u.full_name)) return u;
  } catch (e) {}
  return null;
}

const STATE = {
  user: loadSavedSession(),
  online: navigator.onLine,
  loading: false,
  activeTab: 'main', // main | perbaikan | analitik | pengaturan
  approvalMode: localStorage.getItem('ck_approval_mode') || 'manajemen', // off | perawat | manajemen | all
  units: [],
  items: [],
  users: [],
  inspections: [],
  // State form petugas kebersihan
  petugasFormOpen: false,
  petugasFormUnitId: '',
  petugasFormOriginReqId: null,
  petugasChecklist: {},
  petugasNotes: '',
  petugasPhotoRoom: '',
  petugasPhotoToilet: '',
  petugasStartTime: null,
  // State form manajemen manual
  mgmtFormUnitId: '',
  mgmtChecklist: {},
  mgmtNotes: '',
  mgmtPhotoRoom: '',
  // State form teknisi
  teknisiFormOpen: false,
  teknisiFormUnitId: '',
  teknisiFormOriginReqId: null,
  teknisiChecklist: {},
  teknisiNotes: '',
  teknisiPhotoData: '',
  teknisiStartTime: null,
  // State perbaikan fasilitas
  repairUnitId: '',
  repairCategory: 'AC / Pendingin Ruangan',
  repairDesc: '',
  repairPhotoBefore: '',
  // State analitik & rekap
  filterPeriod: 'hari', // hari | minggu | bulan | tahun | semua
  filterDate: new Date().toISOString().slice(0, 10),
  filterMonth: new Date().toISOString().slice(0, 7),
  filterYear: String(new Date().getFullYear()),
  // Alarm & notifikasi
  soundEnabled: localStorage.getItem('ck_sound_enabled') !== 'false',
  mutedAlarmKeys: JSON.parse(sessionStorage.getItem('ck_muted_alarms') || '[]'),
  lastSpokenAt: 0,
  selectedDetailReport: null,
  toastMsg: ''
};

let alarmLoopInterval = null;
let syncInterval = null;
let realtimeChannel = null;

/* ==========================================================================
   HELPER & UTILITAS
   ========================================================================== */

function showToast(msg) {
  STATE.toastMsg = msg;
  render();
  setTimeout(() => {
    if (STATE.toastMsg === msg) {
      STATE.toastMsg = '';
      render();
    }
  }, 3200);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTimeID(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

function formatTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function getUnitByIdOrName(unitId, unitName) {
  let found = null;
  if (unitId) {
    found = STATE.units.find((u) => String(u.id) === String(unitId));
  }
  if (!found && unitName) {
    found = STATE.units.find(
      (u) =>
        String(u.unit_name || '').toLowerCase() === String(unitName).toLowerCase() ||
        String(u.unit_code || '').toLowerCase() === String(unitName).toLowerCase()
    );
  }
  if (found) return found;
  return {
    id: unitId || '',
    unit_code: 'KMR',
    unit_name: unitName || 'Unit Kamar',
    floor: 'Lantai 2',
    status: 'kotor'
  };
}

function extractRoomNumberSpeech(unit) {
  const raw = `${unit.unit_code || ''} ${unit.unit_name || ''}`;
  const match = raw.match(/(\d{2,4})/);
  const num = match ? match[1] : (unit.unit_name || unit.unit_code);
  const floor = unit.floor || 'Lantai 2';
  return { num, floor };
}

function getApprovalModeLabel(mode) {
  switch (mode) {
    case 'off': return 'OFF (Langsung Siap Pakai)';
    case 'perawat': return 'ON untuk Perawat';
    case 'manajemen': return 'ON untuk Manajemen';
    case 'all': return 'ON All (Perawat & Manajemen)';
    default: return 'ON untuk Manajemen';
  }
}

function isSystemMetaCategory(category) {
  return category === SHIFT_CATEGORY_KEY || category === APPROVAL_CONFIG_KEY;
}

function getRealChecklistItems() {
  return STATE.items.filter((i) => !isSystemMetaCategory(i.category));
}

/* ==========================================================================
   SUARA NOTIFIKASI & BACKGROUND NOTIFICATION
   ========================================================================== */

function speakIndonesian(text) {
  if (!STATE.soundEnabled || !text) return;
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'id-ID';
      utter.rate = 0.96;
      utter.pitch = 1.05;
      utter.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const idVoice = voices.find((v) => v.lang && v.lang.toLowerCase().includes('id'));
      if (idVoice) utter.voice = idVoice;
      window.speechSynthesis.speak(utter);
    }
  } catch (e) {}
}

async function triggerSystemNotification(title, body, tag) {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_ALARM_NOTIFICATION',
        title,
        body,
        tag
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: 'https://ssmedika.co.id/wp-content/uploads/2023/08/logo-ss-medika.png',
        tag,
        renotify: true,
        requireInteraction: true
      });
    }
  } catch (e) {}
}

function getActiveAlarmsForCurrentUser() {
  if (!STATE.user) return [];
  const role = String(STATE.user.role || '').toLowerCase();
  const alarms = [];

  if (role === 'petugas') {
    const reqs = getOpenNurseRequestsForPetugas();
    reqs.forEach((r) => {
      const unit = getUnitByIdOrName(r.unit_id, r.unit_name);
      const { num, floor } = extractRoomNumberSpeech(unit);
      const reqType = parseNurseActionType(r);
      let speech = `Perhatian petugas, tolong siapkan kamar nomor ${num}, ${floor}, untuk pasien baru.`;
      if (reqType === 'Minta Dibersihkan') {
        speech = `Perhatian petugas, kamar nomor ${num}, ${floor}, minta segera dibersihkan.`;
      } else if (reqType === 'Pasien Pulang') {
        speech = `Perhatian petugas, pasien kamar nomor ${num}, ${floor}, sudah pulang, tolong segera dibersihkan.`;
      } else if (reqType === 'Tambah Extrabed') {
        speech = `Perhatian petugas, tolong tambahkan extrabed di kamar nomor ${num}, ${floor}.`;
      }
      alarms.push({
        key: `petugas-${r.id}`,
        title: `${reqType} — ${unit.unit_name}`,
        body: `${unit.floor || 'Lantai 2'} • Diminta oleh ${r.inspector_name || 'Tim Perawat'} (${formatTimeShort(r.created_at)})`,
        speech
      });
    });

    const revisions = getRevisionReportsForPetugas();
    revisions.forEach((r) => {
      const unit = getUnitByIdOrName(r.unit_id, r.unit_name);
      const { num, floor } = extractRoomNumberSpeech(unit);
      alarms.push({
        key: `revisi-${r.id}`,
        title: `Perlu Perbaikan Ulang — ${unit.unit_name}`,
        body: `${unit.floor || 'Lantai 2'} • Komplain perlu diperbaiki`,
        speech: `Perhatian petugas, kamar nomor ${num}, ${floor}, perlu dicek dan diperbaiki kembali.`
      });
    });
  }

  if (role === 'teknisi') {
    const tekTasks = getOpenTasksForTeknisi();
    tekTasks.forEach((t) => {
      const unit = getUnitByIdOrName(t.unit_id, t.unit_name);
      const { num, floor } = extractRoomNumberSpeech(unit);
      alarms.push({
        key: `teknisi-${t.id}`,
        title: `Tugas Teknisi — ${unit.unit_name}`,
        body: `${unit.floor || 'Lantai 2'} • Cek AC, TV, Listrik & Air (${formatTimeShort(t.created_at)})`,
        speech: `Perhatian teknisi, harap periksa AC, TV, dan fasilitas kamar nomor ${num}, ${floor}.`
      });
    });
  }

  if (role === 'perawat' || role === 'manajemen') {
    const pending = getPendingApprovalsForRole(role);
    pending.forEach((p) => {
      const unit = getUnitByIdOrName(p.unit_id, p.unit_name);
      const { num, floor } = extractRoomNumberSpeech(unit);
      alarms.push({
        key: `approve-${role}-${p.id}`,
        title: `Menunggu Approval — ${unit.unit_name}`,
        body: `${unit.floor || 'Lantai 2'} • Selesai disiapkan oleh ${p.inspector_name}`,
        speech: `Laporan kesiapan kamar nomor ${num}, ${floor}, menunggu persetujuan ${role === 'perawat' ? 'perawat' : 'manajemen'}.`
      });
    });
  }

  return alarms.filter((a) => !STATE.mutedAlarmKeys.includes(a.key));
}

function runAlarmReminderCycle(forceImmediate = false) {
  if (!STATE.user || !STATE.soundEnabled) return;
  const alarms = getActiveAlarmsForCurrentUser();
  if (!alarms.length) return;

  const now = Date.now();
  if (!forceImmediate && now - STATE.lastSpokenAt < 24000) return;

  STATE.lastSpokenAt = now;
  const top = alarms[0];
  speakIndonesian(top.speech);
  triggerSystemNotification(top.title, top.body, top.key);
}

function muteCurrentAlarms() {
  const alarms = getActiveAlarmsForCurrentUser();
  alarms.forEach((a) => {
    if (!STATE.mutedAlarmKeys.includes(a.key)) {
      STATE.mutedAlarmKeys.push(a.key);
    }
  });
  sessionStorage.setItem('ss_muted_alarms', JSON.stringify(STATE.mutedAlarmKeys));
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  showToast('Pengingat suara untuk tugas saat ini dimatikan.');
  render();
}

/* ==========================================================================
   SINKRONISASI DATA SUPABASE ASLI
   ========================================================================== */

async function syncAllData(silent = false) {
  if (!silent) {
    STATE.loading = true;
    render();
  }

  try {
    const [uRes, iRes, usrRes, insRes] = await Promise.all([
      sb.from('master_units').select('*').order('unit_code', { ascending: true }),
      sb.from('master_items').select('*').order('created_at', { ascending: true }),
      sb.from('app_users').select('*').order('created_at', { ascending: true }),
      sb.from('room_inspections').select('*').order('created_at', { ascending: false }).limit(500)
    ]);

    if (!uRes.error && Array.isArray(uRes.data)) STATE.units = uRes.data;
    if (!iRes.error && Array.isArray(iRes.data)) STATE.items = iRes.data;
    if (!usrRes.error && Array.isArray(usrRes.data)) STATE.users = usrRes.data;
    if (!insRes.error && Array.isArray(insRes.data)) STATE.inspections = insRes.data;

    // Sinkronkan mode approval dari master_items bila tersimpan di server
    const cfgRow = STATE.items.find((i) => i.category === APPROVAL_CONFIG_KEY);
    if (cfgRow && cfgRow.item_name) {
      const val = String(cfgRow.item_name).toLowerCase();
      if (['off', 'perawat', 'manajemen', 'all'].includes(val)) {
        STATE.approvalMode = val;
        localStorage.setItem('ck_approval_mode', val);
      } else if (val === 'on') {
        STATE.approvalMode = 'manajemen';
      }
    }
  } catch (e) {
    console.warn('Sync Supabase:', e);
  }

  STATE.loading = false;
  render();
  runAlarmReminderCycle(false);
}

/* ==========================================================================
   KLASIFIKASI JENIS RECORD DI TABEL room_inspections ASLI
   ========================================================================== */

function isNurseQuickRequest(rec) {
  const n = String(rec.notes || '');
  const s = String(rec.shift || '');
  return (
    n.includes(NURSE_REQ_TAG) ||
    n.includes(CHECKOUT_RECORD_TAG) ||
    s.startsWith('Siapkan Kamar') ||
    s.startsWith('Tambahan Extrabed') ||
    s.startsWith('Minta Dibersihkan') ||
    s.startsWith('Pasien Pulang')
  );
}

function isTeknisiTaskRecord(rec) {
  const n = String(rec.notes || '');
  const s = String(rec.shift || '');
  return (
    n.includes(TEKNISI_REQ_TAG) ||
    n.includes(REPAIR_RECORD_TAG) ||
    s.startsWith('Tugas Teknisi') ||
    s.startsWith('Cek Teknisi') ||
    s.startsWith('Perbaikan')
  );
}

function parseNurseActionType(rec) {
  const s = String(rec.shift || '') + ' ' + String(rec.notes || '');
  if (s.includes('Siapkan Kamar')) return 'Siapkan Kamar';
  if (s.includes('Tambahan Extrabed') || s.includes('Tambah Extrabed')) return 'Tambah Extrabed';
  if (s.includes('Minta Dibersihkan')) return 'Minta Dibersihkan';
  if (s.includes('Pasien Pulang')) return 'Pasien Pulang';
  return 'Permintaan Perawat';
}

function getOpenNurseRequestsForPetugas() {
  return STATE.inspections.filter((r) => {
    if (!isNurseQuickRequest(r)) return false;
    const n = String(r.notes || '');
    return !n.includes('[STATUS_PERMINTAAN: SELESAI]') && r.final_status !== 'siap';
  });
}

function getRevisionReportsForPetugas() {
  return STATE.inspections.filter((r) => {
    if (isNurseQuickRequest(r) || isTeknisiTaskRecord(r)) return false;
    const n = String(r.notes || '');
    return r.final_status !== 'siap' && (n.includes('Perlu Perbaikan') || n.includes('Revisi'));
  });
}

function getOpenTasksForTeknisi() {
  return STATE.inspections.filter((r) => {
    if (!isTeknisiTaskRecord(r)) return false;
    const n = String(r.notes || '');
    return r.final_status !== 'siap' && !n.includes('[STATUS_TEKNISI: SELESAI]');
  });
}

function getPendingApprovalsForRole(role) {
  const mode = STATE.approvalMode;
  if (mode === 'off') return [];
  if (mode === 'perawat' && role !== 'perawat') return [];
  if (mode === 'manajemen' && role !== 'manajemen') return [];

  return STATE.inspections.filter((r) => {
    if (isNurseQuickRequest(r) || isTeknisiTaskRecord(r)) return false;
    const n = String(r.notes || '');
    return (
      r.final_status !== 'siap' &&
      !n.includes('Perlu Perbaikan') &&
      !n.includes('Revisi')
    );
  });
}

function getInfoReportsForRole() {
  return STATE.inspections
    .filter((r) => !isNurseQuickRequest(r))
    .slice(0, 8);
}

function getUnitCurrentState(unit) {
  const unitLogs = STATE.inspections.filter(
    (r) =>
      (unit.id && String(r.unit_id) === String(unit.id)) ||
      String(r.unit_name || '').toLowerCase() === String(unit.unit_name || '').toLowerCase()
  );

  // Kunci tombol "Siapkan Kamar" jika sudah dipencet dan belum ada "Pasien Pulang" setelahnya
  let siapkanLocked = false;
  for (let i = 0; i < unitLogs.length; i++) {
    const act = parseNurseActionType(unitLogs[i]);
    if (act === 'Pasien Pulang') {
      siapkanLocked = false;
      break;
    }
    if (act === 'Siapkan Kamar') {
      siapkanLocked = true;
      break;
    }
  }

  const latestMain = unitLogs.find((r) => !isTeknisiTaskRecord(r));
  let badge = 'KOSONG';
  let badgeColor = 'bg-slate-100 text-slate-600';
  let subText = 'Belum dicek (Kosong)';

  if (unit.status === 'maintenance') {
    badge = 'MAINTENANCE';
    badgeColor = 'bg-rose-100 text-rose-700';
    subText = unit.last_checked_by || 'Dalam perbaikan fasilitas';
  } else if (latestMain) {
    const n = String(latestMain.notes || '');
    if (isNurseQuickRequest(latestMain) && !n.includes('[STATUS_PERMINTAAN: SELESAI]')) {
      const act = parseNurseActionType(latestMain);
      badge = 'PERMINTAAN PERAWAT';
      badgeColor = 'bg-amber-100 text-amber-800';
      subText = `${act}: ${latestMain.inspector_name || 'Tim Perawat'} (${formatTimeShort(latestMain.created_at)})`;
    } else if (n.includes('Perlu Perbaikan') || n.includes('Revisi')) {
      badge = 'PERLU REVISI';
      badgeColor = 'bg-rose-100 text-rose-700';
      subText = 'Sedang diperbaiki ulang oleh petugas';
    } else if (latestMain.final_status !== 'siap' && !isNurseQuickRequest(latestMain)) {
      badge = 'MENUNGGU APPROVAL';
      badgeColor = 'bg-blue-100 text-blue-800';
      subText = `Dicek oleh: ${latestMain.inspector_name || '-'}`;
    } else if (latestMain.final_status === 'siap' || unit.status === 'siap') {
      badge = siapkanLocked ? 'SIAP PAKAI • TERISI' : 'SIAP PAKAI';
      badgeColor = 'bg-emerald-100 text-emerald-800';
      subText = unit.last_checked_by || `Siap Pakai (${latestMain.inspector_name || '-'})`;
    } else if (parseNurseActionType(latestMain) === 'Pasien Pulang') {
      badge = 'KOSONG / KOTOR';
      badgeColor = 'bg-orange-100 text-orange-800';
      subText = `Pasien pulang (${formatTimeShort(latestMain.created_at)})`;
    }
  } else if (unit.status === 'siap') {
    badge = siapkanLocked ? 'SIAP PAKAI • TERISI' : 'SIAP PAKAI';
    badgeColor = 'bg-emerald-100 text-emerald-800';
    subText = unit.last_checked_by || 'Siap Pakai';
  }

  return { siapkanLocked, badge, badgeColor, subText };
}

/* ==========================================================================
   AKSI PERAWAT (4 TOMBOL CEPAT + PEMICU OTOMATIS TEKNISI)
   ========================================================================== */

async function handleNurseQuickAction(unitId, actionType) {
  const unit = getUnitByIdOrName(unitId, '');
  const { siapkanLocked } = getUnitCurrentState(unit);

  if (actionType === 'Siapkan Kamar' && siapkanLocked) {
    showToast('Kamar sudah dipesan/disiapkan. Tombol aktif kembali setelah Pasien Pulang.');
    return;
  }

  const now = new Date();
  const timeStr = formatTimeShort(now.toISOString());
  const { num, floor } = extractRoomNumberSpeech(unit);
  const nurseName = STATE.user?.full_name || STATE.user?.username || 'Tim Perawat';

  let noteDetail = `Tolong siapkan kamar nomor ${num} (${floor}) untuk pasien baru.`;
  if (actionType === 'Tambah Extrabed') {
    noteDetail = `Tolong tambahkan extrabed di kamar nomor ${num} (${floor}).`;
  } else if (actionType === 'Minta Dibersihkan') {
    noteDetail = `Ruangan kamar nomor ${num} (${floor}) minta dibersihkan.`;
  } else if (actionType === 'Pasien Pulang') {
    noteDetail = `Pasien kamar nomor ${num} (${floor}) sudah pulang, tolong dibersihkan.`;
  }

  const nextUnitStatus = actionType === 'Tambah Extrabed' && unit.status === 'siap' ? 'siap' : 'kotor';

  await sb.from('master_units').update({
    status: nextUnitStatus,
    last_checked_by: `${actionType}: ${nurseName} (${timeStr})`,
    last_checked_at: now.toISOString()
  }).eq('id', unit.id);

  // 1. Kirim permintaan ke Petugas Kebersihan
  await sb.from('room_inspections').insert([{
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: nurseName,
    inspector_role: STATE.user?.role || 'perawat',
    shift: `${actionType} • ${timeStr} WIB`,
    readiness_score: 0,
    final_status: nextUnitStatus,
    duration_seconds: 0,
    checklist_data: [{ item: actionType, checked: true }],
    notes: `${NURSE_REQ_TAG}\n${actionType} (Dilaporkan oleh ${nurseName}) • ${noteDetail}`
  }]);

  // 2. Jika Siapkan Kamar atau Minta Dibersihkan -> Otomatis kirim tugas pengecekan ke Teknisi
  if (actionType === 'Siapkan Kamar' || actionType === 'Minta Dibersihkan') {
    await sb.from('room_inspections').insert([{
      unit_id: unit.id,
      unit_name: unit.unit_name,
      inspector_name: nurseName,
      inspector_role: 'teknisi',
      shift: `Tugas Teknisi • ${timeStr} WIB`,
      readiness_score: 0,
      final_status: 'kotor',
      duration_seconds: 0,
      checklist_data: [],
      notes: `${TEKNISI_REQ_TAG}\nPengecekan otomatis (${actionType} oleh ${nurseName}): Cek AC, TV & Remote, Lampu, Stopkontak, Air & Nurse Call di ${unit.unit_name} (${floor}).`
    }]);
  }

  speakIndonesian(`Permintaan ${actionType} untuk kamar nomor ${num}, ${floor}, telah dikirim.`);
  showToast(`${actionType} untuk ${unit.unit_name} (${floor}) terkirim!`);
  await syncAllData(true);
}

/* ==========================================================================
   AKSI PETUGAS KEBERSIHAN (CEK & SIAPKAN KAMAR -> CHECKLIST -> APPROVAL)
   ========================================================================== */

function openPetugasChecklistForm(unitId, originReqId = null) {
  STATE.petugasFormOpen = true;
  STATE.petugasFormUnitId = unitId;
  STATE.petugasFormOriginReqId = originReqId;
  STATE.petugasChecklist = {};
  getRealChecklistItems().forEach((it) => {
    STATE.petugasChecklist[it.id] = false;
  });
  STATE.petugasNotes = '';
  STATE.petugasPhotoRoom = '';
  STATE.petugasPhotoToilet = '';
  STATE.petugasStartTime = Date.now();

  if (originReqId) {
    const k1 = `petugas-${originReqId}`;
    const k2 = `revisi-${originReqId}`;
    if (!STATE.mutedAlarmKeys.includes(k1)) STATE.mutedAlarmKeys.push(k1);
    if (!STATE.mutedAlarmKeys.includes(k2)) STATE.mutedAlarmKeys.push(k2);
    sessionStorage.setItem('ss_muted_alarms', JSON.stringify(STATE.mutedAlarmKeys));
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();

  render();
  setTimeout(() => {
    const el = document.getElementById('petugasChecklistSection');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function closePetugasChecklistForm() {
  STATE.petugasFormOpen = false;
  STATE.petugasFormUnitId = '';
  STATE.petugasFormOriginReqId = null;
  render();
}

function calcChecklistScore(checklistObj, itemsList) {
  if (!itemsList.length) return 100;
  let checkedCount = 0;
  itemsList.forEach((it) => {
    if (checklistObj[it.id]) checkedCount++;
  });
  return Math.round((checkedCount / itemsList.length) * 100);
}

async function submitPetugasChecklist() {
  const unit = getUnitByIdOrName(STATE.petugasFormUnitId, '');
  const realItems = getRealChecklistItems();
  const score = calcChecklistScore(STATE.petugasChecklist, realItems);

  if (score < 100) {
    showToast('Harap centang seluruh item kesiapan kamar hingga 100% sebelum mengirim.');
    return;
  }

  const staffName = STATE.user?.full_name || STATE.user?.username || 'Petugas';
  const mode = STATE.approvalMode;
  const isAutoSiap = mode === 'off';
  const finalStatus = isAutoSiap ? 'siap' : 'kotor';
  const targetLabel =
    mode === 'off'
      ? 'Otomatis Siap Pakai (Approval OFF)'
      : mode === 'perawat'
      ? 'Menunggu Approval Perawat'
      : mode === 'manajemen'
      ? 'Menunggu Approval Manajemen'
      : 'Menunggu Approval Perawat & Manajemen';

  const checklistPayload = realItems.map((it) => ({
    item: it.item_name,
    checked: !!STATE.petugasChecklist[it.id]
  }));

  const duration = STATE.petugasStartTime
    ? Math.max(5, Math.round((Date.now() - STATE.petugasStartTime) / 1000))
    : 30;

  await sb.from('room_inspections').insert([{
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: staffName,
    inspector_role: STATE.user?.role || 'petugas',
    shift: `Pengecekan Kamar • ${formatTimeShort(new Date().toISOString())} WIB`,
    readiness_score: score,
    final_status: finalStatus,
    duration_seconds: duration,
    checklist_data: checklistPayload,
    notes: `[Pelaksana: ${staffName}]\n[Tanggapan Pemeriksa: ${targetLabel}]\n${STATE.petugasNotes || 'Kamar telah dibersihkan dan disiapkan lengkap sesuai standar.'}`,
    photo_room_url: STATE.petugasPhotoRoom || null,
    photo_toilet_url: STATE.petugasPhotoToilet || null
  }]);

  await sb.from('master_units').update({
    status: finalStatus,
    last_checked_by: isAutoSiap ? `Siap Pakai (${staffName})` : `${staffName} (${targetLabel})`,
    last_checked_at: new Date().toISOString()
  }).eq('id', unit.id);

  // Tutup permintaan perawat asal agar hilang dari daftar permintaan petugas
  if (STATE.petugasFormOriginReqId) {
    const orig = STATE.inspections.find((r) => String(r.id) === String(STATE.petugasFormOriginReqId));
    if (orig) {
      await sb.from('room_inspections').update({
        notes: `${orig.notes || ''}\n[STATUS_PERMINTAAN: SELESAI]`,
        final_status: 'siap'
      }).eq('id', orig.id);
    }
  } else {
    const openReqs = getOpenNurseRequestsForPetugas().filter((r) => String(r.unit_id) === String(unit.id));
    for (const r of openReqs) {
      await sb.from('room_inspections').update({
        notes: `${r.notes || ''}\n[STATUS_PERMINTAAN: SELESAI]`,
        final_status: 'siap'
      }).eq('id', r.id);
    }
  }

  closePetugasChecklistForm();
  showToast(
    isAutoSiap
      ? `${unit.unit_name} langsung berstatus SIAP PAKAI!`
      : `Laporan ${unit.unit_name} terkirim (${targetLabel}).`
  );
  await syncAllData(true);
}

/* ==========================================================================
   AKSI TEKNISI (CHECKLIST AC, TV, LISTRIK, AIR, NURSE CALL)
   ========================================================================== */

function openTeknisiForm(unitId, originReqId = null) {
  STATE.teknisiFormOpen = true;
  STATE.teknisiFormUnitId = unitId;
  STATE.teknisiFormOriginReqId = originReqId;
  STATE.teknisiChecklist = {};
  TEKNISI_CHECKLIST_ITEMS.forEach((it) => {
    STATE.teknisiChecklist[it.id] = false;
  });
  STATE.teknisiNotes = '';
  STATE.teknisiPhotoData = '';
  STATE.teknisiStartTime = Date.now();

  if (originReqId) {
    const k = `teknisi-${originReqId}`;
    if (!STATE.mutedAlarmKeys.includes(k)) STATE.mutedAlarmKeys.push(k);
    sessionStorage.setItem('ss_muted_alarms', JSON.stringify(STATE.mutedAlarmKeys));
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  render();
}

function closeTeknisiForm() {
  STATE.teknisiFormOpen = false;
  STATE.teknisiFormUnitId = '';
  STATE.teknisiFormOriginReqId = null;
  render();
}

async function submitTeknisiChecklist() {
  const unit = getUnitByIdOrName(STATE.teknisiFormUnitId, '');
  const score = calcChecklistScore(STATE.teknisiChecklist, TEKNISI_CHECKLIST_ITEMS);
  if (score < 100) {
    showToast('Centang semua pengecekan teknis (AC, TV, Listrik, Air, Bel) hingga 100%.');
    return;
  }

  const tekName = STATE.user?.full_name || STATE.user?.username || 'Tim Teknisi';
  const duration = STATE.teknisiStartTime
    ? Math.max(5, Math.round((Date.now() - STATE.teknisiStartTime) / 1000))
    : 30;

  const checklistPayload = TEKNISI_CHECKLIST_ITEMS.map((it) => ({
    item: it.item_name,
    checked: !!STATE.teknisiChecklist[it.id]
  }));

  await sb.from('room_inspections').insert([{
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: tekName,
    inspector_role: 'teknisi',
    shift: `Cek Teknisi • ${formatTimeShort(new Date().toISOString())} WIB`,
    readiness_score: score,
    final_status: 'siap',
    duration_seconds: duration,
    checklist_data: checklistPayload,
    notes: `${TEKNISI_REQ_TAG}\n[STATUS_TEKNISI: SELESAI]\n[Pelaksana: ${tekName}]\n${STATE.teknisiNotes || 'AC, TV, kelistrikan, sanitasi & nurse call berfungsi normal.'}`,
    photo_room_url: STATE.teknisiPhotoData || null
  }]);

  if (STATE.teknisiFormOriginReqId) {
    const orig = STATE.inspections.find((r) => String(r.id) === String(STATE.teknisiFormOriginReqId));
    if (orig) {
      await sb.from('room_inspections').update({
        final_status: 'siap',
        notes: `${orig.notes || ''}\n[STATUS_TEKNISI: SELESAI]`
      }).eq('id', orig.id);
    }
  }

  closeTeknisiForm();
  showToast(`Pengecekan teknis ${unit.unit_name} selesai disimpan.`);
  await syncAllData(true);
}

/* ==========================================================================
   AKSI APPROVAL & KOMPLAIN (PERAWAT & MANAJEMEN)
   ========================================================================== */

async function handleApproveInspection(reportId) {
  const rep = STATE.inspections.find((r) => String(r.id) === String(reportId));
  if (!rep) return;
  const approverName = STATE.user?.full_name || 'Pemeriksa';
  const roleLabel = String(STATE.user?.role || '').toLowerCase() === 'perawat' ? 'Perawat' : 'Manajemen';

  await sb.from('room_inspections').update({
    final_status: 'siap',
    notes: `${rep.notes || ''}\n[Tanggapan Pemeriksa: Sesuai Standar (Approved oleh ${approverName} - ${roleLabel})]`
  }).eq('id', rep.id);

  if (rep.unit_id) {
    await sb.from('master_units').update({
      status: 'siap',
      last_checked_by: `Approved: ${approverName} (${roleLabel})`,
      last_checked_at: new Date().toISOString()
    }).eq('id', rep.unit_id);
  }

  showToast('Kamar berhasil di-Approve menjadi SIAP PAKAI.');
  await syncAllData(true);
}

async function handleRejectInspection(reportId) {
  const rep = STATE.inspections.find((r) => String(r.id) === String(reportId));
  if (!rep) return;
  const reason = prompt('Masukkan catatan bagian mana yang perlu diperbaiki petugas:');
  if (reason === null) return;
  const approverName = STATE.user?.full_name || 'Pemeriksa';

  await sb.from('room_inspections').update({
    final_status: 'kotor',
    notes: `${rep.notes || ''}\n[Tanggapan Pemeriksa: Perlu Perbaikan (Komplain oleh ${approverName}) — Bagian Perbaikan: ${reason || 'Mohon cek ulang kebersihan kamar'}]`
  }).eq('id', rep.id);

  if (rep.unit_id) {
    await sb.from('master_units').update({
      status: 'kotor',
      last_checked_by: `Perlu Perbaikan: ${reason || 'Cek ulang'}`,
      last_checked_at: new Date().toISOString()
    }).eq('id', rep.unit_id);
  }

  showToast('Laporan dikembalikan ke Petugas untuk diperbaiki.');
  await syncAllData(true);
}

/* ==========================================================================
   PERHITUNGAN REKAP OKUPANSI KAMAR & KEDISIPLINAN TIAP PETUGAS (PDF & EXCEL)
   ========================================================================== */

function getFilteredInspectionsForAnalytics() {
  return STATE.inspections.filter((r) => {
    const d = new Date(r.created_at);
    if (isNaN(d.getTime())) return true;
    const pad = (n) => String(n).padStart(2, '0');
    const localYmd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (STATE.filterPeriod === 'hari') {
      return localYmd === STATE.filterDate;
    }
    if (STATE.filterPeriod === 'minggu') {
      const target = new Date(STATE.filterDate + 'T00:00:00');
      const dayOfWeek = target.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const weekStart = new Date(target);
      weekStart.setDate(target.getDate() + mondayOffset);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      return d >= weekStart && d <= weekEnd;
    }
    if (STATE.filterPeriod === 'bulan') {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` === STATE.filterMonth;
    }
    if (STATE.filterPeriod === 'tahun') {
      return String(d.getFullYear()) === String(STATE.filterYear);
    }
    return true;
  });
}

function getFilterPeriodTitle() {
  if (STATE.filterPeriod === 'hari') return `Harian (${STATE.filterDate})`;
  if (STATE.filterPeriod === 'minggu') return `Mingguan (Pekan ${STATE.filterDate})`;
  if (STATE.filterPeriod === 'bulan') return `Bulanan (${STATE.filterMonth})`;
  if (STATE.filterPeriod === 'tahun') return `Tahunan (${STATE.filterYear})`;
  return 'Semua Periode';
}

function computeAnalyticsSummary() {
  const rows = getFilteredInspectionsForAnalytics();
  const totalRooms = STATE.units.length || 1;

  // Hitung kamar terpakai dalam periode terpilih
  const usedRoomSet = new Set();
  rows.forEach((r) => {
    const act = parseNurseActionType(r);
    if (act === 'Siapkan Kamar' || r.final_status === 'siap') {
      const key = r.unit_id || r.unit_name;
      if (key) usedRoomSet.add(String(key));
    }
  });

  const usedRoomsCount = Math.min(totalRooms, usedRoomSet.size);
  const unusedRoomsCount = Math.max(0, totalRooms - usedRoomsCount);
  const occupancyPct = Math.round((usedRoomsCount / totalRooms) * 100);

  // Laporan kerja murni (Petugas & Teknisi) tanpa log tombol cepat Perawat
  const workReports = rows.filter((r) => !isNurseQuickRequest(r));
  const avgScore = workReports.length
    ? Math.round(workReports.reduce((acc, r) => acc + (Number(r.readiness_score) || 0), 0) / workReports.length)
    : 0;

  // Hitung kedisiplinan tiap petugas & teknisi
  const staffMap = {};
  workReports.forEach((r) => {
    const name = r.inspector_name || 'Petugas';
    if (!staffMap[name]) {
      staffMap[name] = {
        name,
        totalTasks: 0,
        passedTasks: 0,
        revisionTasks: 0,
        totalDuration: 0
      };
    }
    staffMap[name].totalTasks += 1;
    staffMap[name].totalDuration += Number(r.duration_seconds) || 30;
    const n = String(r.notes || '');
    if (n.includes('Perlu Perbaikan') || n.includes('Revisi')) {
      staffMap[name].revisionTasks += 1;
    } else if ((Number(r.readiness_score) || 0) >= 100) {
      staffMap[name].passedTasks += 1;
    }
  });

  const staffDisciplineList = Object.values(staffMap).map((s) => {
    const disciplinePct = s.totalTasks
      ? Math.round((s.passedTasks / s.totalTasks) * 100)
      : 0;
    const avgSec = s.totalTasks ? Math.round(s.totalDuration / s.totalTasks) : 0;
    return {
      ...s,
      disciplinePct,
      avgDurationLabel: `${Math.floor(avgSec / 60)}m ${avgSec % 60}d`
    };
  });

  return {
    rows,
    workReports,
    totalRooms,
    usedRoomsCount,
    unusedRoomsCount,
    occupancyPct,
    avgScore,
    staffDisciplineList
  };
}

function downloadRekapExcelCSV() {
  const summary = computeAnalyticsSummary();
  const periodLabel = getFilterPeriodTitle();
  const lines = [];

  lines.push(['REKAPITULASI LAPORAN KESIAPAN & OKUPANSI KAMAR — RS KHUSUS BEDAH SS MEDIKA']);
  lines.push(['Periode Filter', periodLabel, 'Dicetak Pada', formatDateTimeID(new Date().toISOString())]);
  lines.push([]);
  lines.push(['RINGKASAN OKUPANSI KAMAR DALAM PERIODE']);
  lines.push(['Total Unit Kamar', 'Kamar Terpakai', 'Kamar Tidak Terpakai (Kosong)', 'Persentase Okupansi', 'Rata-Rata Skor Kesiapan']);
  lines.push([
    summary.totalRooms,
    summary.usedRoomsCount,
    summary.unusedRoomsCount,
    `${summary.occupancyPct}%`,
    `${summary.avgScore}%`
  ]);
  lines.push([]);
  lines.push(['KEDISIPLINAN & KINERJA TIAP PETUGAS / TEKNISI']);
  lines.push(['Nama Petugas / Teknisi', 'Total Pengecekan', 'Lolos 100% Tanpa Revisi', 'Jumlah Revisi', 'Rata-Rata Durasi', 'Persentase Kedisiplinan']);
  summary.staffDisciplineList.forEach((s) => {
    lines.push([
      s.name,
      s.totalTasks,
      s.passedTasks,
      s.revisionTasks,
      s.avgDurationLabel,
      `${s.disciplinePct}%`
    ]);
  });
  lines.push([]);
  lines.push(['DETAIL RIWAYAT AKTIVITAS & PENGECEKAN KAMAR']);
  lines.push(['No', 'Waktu', 'Unit Kamar', 'Lantai', 'Pelaksana / Pemeriksa', 'Aktivitas / Shift', 'Skor', 'Status', 'Catatan']);

  summary.rows.forEach((r, idx) => {
    const unit = getUnitByIdOrName(r.unit_id, r.unit_name);
    lines.push([
      idx + 1,
      formatDateTimeID(r.created_at),
      unit.unit_name,
      unit.floor || 'Lantai 2',
      r.inspector_name || '-',
      r.shift || '-',
      `${r.readiness_score || 0}%`,
      String(r.final_status || '-').toUpperCase(),
      (r.notes || '-').replace(/[\r\n]+/g, ' ')
    ]);
  });

  const csvContent =
    '\uFEFF' +
    lines
      .map((row) =>
        row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Rekap_Kamar_SSMedika_${STATE.filterPeriod}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('File Excel (CSV) rekap kamar & kedisiplinan berhasil diunduh.');
}

function openPrintRekapWindow() {
  const summary = computeAnalyticsSummary();
  const periodLabel = getFilterPeriodTitle();
  const printedAt = formatDateTimeID(new Date().toISOString());

  const staffRowsHtml = summary.staffDisciplineList.length
    ? summary.staffDisciplineList
        .map(
          (s, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${escapeHtml(s.name)}</strong></td>
          <td style="text-align:center;">${s.totalTasks}</td>
          <td style="text-align:center;">${s.passedTasks}</td>
          <td style="text-align:center;">${s.revisionTasks}</td>
          <td style="text-align:center;">${escapeHtml(s.avgDurationLabel)}</td>
          <td style="text-align:center;font-weight:700;color:#0f766e;">${s.disciplinePct}%</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="7" style="text-align:center;color:#64748b;">Belum ada data pengecekan petugas pada periode ini.</td></tr>`;

  const detailRowsHtml = summary.rows
    .map((r, i) => {
      const unit = getUnitByIdOrName(r.unit_id, r.unit_name);
      return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(formatDateTimeID(r.created_at))}</td>
        <td><strong>${escapeHtml(unit.unit_name)}</strong><br><small>${escapeHtml(unit.floor || 'Lantai 2')}</small></td>
        <td>${escapeHtml(r.inspector_name || '-')}</td>
        <td>${escapeHtml(r.shift || '-')}</td>
        <td style="text-align:center;">${r.readiness_score || 0}%</td>
        <td><strong>${escapeHtml(String(r.final_status || '-').toUpperCase())}</strong></td>
        <td>${escapeHtml((r.notes || '-').replace(/\n/g, ' • '))}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>Rekapitulasi Laporan Kesiapan Kamar</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; padding: 20px; font-size: 12px; }
    .toolbar { margin-bottom: 16px; display: flex; gap: 10px; }
    .btn { background: #0f766e; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; }
    .btn-dark { background: #1e293b; }
    h1 { color: #0f766e; font-size: 18px; margin: 0 0 4px 0; }
    .sub { color: #475569; margin-bottom: 14px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .card .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; }
    .card .val { font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    h2 { font-size: 13px; color: #0f172a; margin: 16px 0 8px 0; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 700; }
    @media print { .toolbar { display: none; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn" onclick="window.print()">Cetak / Simpan PDF</button>
    <button class="btn btn-dark" onclick="window.close()">Tutup</button>
  </div>
  <h1>REKAPITULASI LAPORAN KESIAPAN & OKUPANSI KAMAR</h1>
  <div class="sub">RS Khusus Bedah SS Medika • Filter: <strong>${escapeHtml(periodLabel)}</strong> • Dicetak: ${escapeHtml(printedAt)}</div>

  <div class="cards">
    <div class="card"><div class="lbl">Kamar Terpakai</div><div class="val" style="color:#0f766e;">${summary.usedRoomsCount} / ${summary.totalRooms} (${summary.occupancyPct}%)</div></div>
    <div class="card"><div class="lbl">Kamar Tidak Terpakai</div><div class="val" style="color:#d97706;">${summary.unusedRoomsCount} Kamar</div></div>
    <div class="card"><div class="lbl">Pengecekan Selesai</div><div class="val">${summary.workReports.length} Laporan</div></div>
    <div class="card"><div class="lbl">Rata-Rata Skor Kesiapan</div><div class="val" style="color:#059669;">${summary.avgScore}%</div></div>
  </div>

  <h2>1. Kedisiplinan & Kinerja Tiap Petugas / Teknisi</h2>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>Nama Petugas / Teknisi</th>
        <th style="text-align:center;">Total Tugas</th>
        <th style="text-align:center;">Lolos 100%</th>
        <th style="text-align:center;">Revisi</th>
        <th style="text-align:center;">Rata-Rata Waktu</th>
        <th style="text-align:center;">Kedisiplinan (%)</th>
      </tr>
    </thead>
    <tbody>${staffRowsHtml}</tbody>
  </table>

  <h2>2. Rincian Aktivitas & Pengecekan Kamar</h2>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>Waktu</th>
        <th>Unit Kamar</th>
        <th>Pelaksana</th>
        <th>Aktivitas / Shift</th>
        <th style="text-align:center;">Skor</th>
        <th>Status</th>
        <th>Catatan</th>
      </tr>
    </thead>
    <tbody>${detailRowsHtml}</tbody>
  </table>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } else {
    showToast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak PDF.');
  }
}

/* ==========================================================================
   HANDLER FOTO & LOGIN / LOGOUT (MENGGUNAKAN TABEL app_users ASLI ANDA)
   ========================================================================== */

function handlePhotoUpload(event, targetField) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 720;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      STATE[targetField] = canvas.toDataURL('image/jpeg', 0.72);
      render();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = (document.getElementById('loginUsernameInput')?.value || '').trim();
  const password = (document.getElementById('loginPasswordInput')?.value || '').trim();

  if (!username || !password) {
    showToast('Masukkan username dan password.');
    return;
  }

  let matchedUser = STATE.users.find(
    (u) => String(u.username || '').toLowerCase() === username.toLowerCase() && String(u.password || '') === password
  );

  if (!matchedUser && navigator.onLine) {
    const { data } = await sb
      .from('app_users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .maybeSingle();
    if (data) matchedUser = data;
  }

  // Akun cadangan bawaan jika offline
  if (!matchedUser) {
    if (username === 'admin' && password === 'azis123') {
      matchedUser = { username: 'admin', full_name: 'Supervisor Manajemen', role: 'manajemen' };
    } else if (username === 'petugas1' && password === 'petugas123') {
      matchedUser = { username: 'petugas1', full_name: 'Petugas Kebersihan', role: 'petugas' };
    } else if (username === 'perawat1' && password === 'perawat123') {
      matchedUser = { username: 'perawat1', full_name: 'Tim Perawat', role: 'perawat' };
    } else if (username === 'teknisi1' && password === 'teknisi123') {
      matchedUser = { username: 'teknisi1', full_name: 'Tim Teknisi', role: 'teknisi' };
    }
  }

  if (!matchedUser) {
    showToast('Username atau password salah.');
    return;
  }

  STATE.user = matchedUser;
  STATE.activeTab = 'main';
  STATE.petugasFormOpen = false;
  STATE.teknisiFormOpen = false;
  localStorage.setItem('ck_user', JSON.stringify(matchedUser));

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  speakIndonesian(`Selamat bertugas, ${matchedUser.full_name || matchedUser.username}.`);
  render();
  setTimeout(() => runAlarmReminderCycle(true), 1200);
}

function handleLogout() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  STATE.user = null;
  STATE.petugasFormOpen = false;
  STATE.teknisiFormOpen = false;
  localStorage.removeItem('ck_user');
  render();
}

/* ==========================================================================
   RENDER KOMPONEN UI (PRESISI ANTI GESER KIRI-KANAN)
   ========================================================================== */

function renderHeader() {
  const role = String(STATE.user.role || '').toLowerCase();
  const displayName = STATE.user.full_name || STATE.user.username || 'Staf';
  const roleBadgeColor =
    role === 'manajemen'
      ? 'bg-purple-100 text-purple-800'
      : role === 'perawat'
      ? 'bg-amber-100 text-amber-800'
      : role === 'teknisi'
      ? 'bg-sky-100 text-sky-800'
      : 'bg-teal-100 text-teal-800';

  const alarms = getActiveAlarmsForCurrentUser();

  return `
  <header class="sticky top-0 z-30 w-full bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-2.5">
    <div class="w-full flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <div class="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center font-extrabold text-xs shrink-0 shadow-sm">
          SS
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <h1 class="text-sm font-extrabold text-slate-900 truncate">Cek Kesiapan Kamar</h1>
            <span class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-teal-50 text-teal-700 border border-teal-200 shrink-0">${APP_VERSION}</span>
          </div>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="px-1.5 py-0.5 text-[9px] font-extrabold uppercase rounded ${roleBadgeColor} shrink-0">${escapeHtml(role)}</span>
            <p class="text-[11px] font-medium text-slate-600 truncate">Halo, ${escapeHtml(displayName)}</p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <button onclick="toggleSoundSetting()" title="Suara Notifikasi" class="relative w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-700 bg-slate-50 active:scale-95">
          ${STATE.soundEnabled ? '🔔' : '🔕'}
          ${alarms.length ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-extrabold flex items-center justify-center">${alarms.length}</span>` : ''}
        </button>
        <button onclick="syncAllData(false)" title="Sinkronkan Data" class="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-700 bg-slate-50 active:scale-95">
          🔄
        </button>
        <span class="px-2 py-1 rounded-full text-[10px] font-bold ${STATE.online ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
          ● ${STATE.online ? 'Online' : 'Offline'}
        </span>
        <button onclick="handleLogout()" title="Keluar" class="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 bg-slate-50 active:scale-95">
          🚪
        </button>
      </div>
    </div>

    ${
      alarms.length
        ? `<div class="mt-2 w-full rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 flex items-center justify-between gap-2 alarm-pulse">
            <div class="min-w-0 flex-1">
              <p class="text-[11px] font-extrabold text-amber-900 truncate">🔊 ${escapeHtml(alarms[0].title)}</p>
              <p class="text-[10px] text-amber-800 truncate">${escapeHtml(alarms[0].body)} (Berulang otomatis)</p>
            </div>
            <button onclick="muteCurrentAlarms()" class="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white text-[10px] font-bold shrink-0 active:scale-95">
              Matikan Suara
            </button>
          </div>`
        : ''
    }
  </header>`;
}

function toggleSoundSetting() {
  STATE.soundEnabled = !STATE.soundEnabled;
  localStorage.setItem('ck_sound_enabled', String(STATE.soundEnabled));
  if (STATE.soundEnabled) {
    speakIndonesian('Notifikasi suara diaktifkan.');
    runAlarmReminderCycle(true);
  } else if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  showToast(STATE.soundEnabled ? 'Suara notifikasi aktif.' : 'Suara notifikasi dimatikan.');
  render();
}

/* ==========================================================================
   TAMPILAN KHUSUS PERAWAT (4 TOMBOL CEPAT + KUNCI SIAPKAN KAMAR + APPROVAL)
   ========================================================================== */

function renderPerawatMainView() {
  const pendingApprovals = getPendingApprovalsForRole('perawat');
  const infoReports = getInfoReportsForRole();

  return `
  <div class="w-full px-3 pt-3 pb-24 space-y-3">
    <div class="w-full rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white p-4 shadow-sm">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <span class="inline-block px-2 py-0.5 rounded-md bg-white/20 text-[10px] font-extrabold tracking-wide uppercase">Nurse Station</span>
          <h2 class="text-base font-extrabold mt-1">Permintaan Layanan Kamar (1 Ketuk)</h2>
          <p class="text-xs text-amber-50 mt-0.5 leading-relaxed">
            Pilih kamar di bawah lalu ketuk tombol sesuai kebutuhan (suara pengingat otomatis berbunyi di HP Petugas & Teknisi).
          </p>
        </div>
        <button onclick="runAlarmReminderCycle(true)" class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-lg shrink-0">
          🔊
        </button>
      </div>
    </div>

    ${
      pendingApprovals.length
        ? `<div class="w-full rounded-2xl bg-blue-50 border-2 border-blue-300 p-3.5 space-y-2.5">
            <div class="flex items-center justify-between">
              <h3 class="text-xs font-extrabold text-blue-900 uppercase tracking-wide">
                ✅ Menunggu Approval Perawat (${pendingApprovals.length})
              </h3>
              <span class="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">Perlu ACC</span>
            </div>
            ${pendingApprovals
              .map((rep) => {
                const u = getUnitByIdOrName(rep.unit_id, rep.unit_name);
                return `
                <div class="w-full rounded-xl bg-white border border-blue-200 p-3 space-y-2 shadow-sm">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
                      <p class="text-[11px] text-slate-500">${escapeHtml(u.floor || 'Lantai 2')} • Petugas: <strong>${escapeHtml(rep.inspector_name)}</strong> (${formatTimeShort(rep.created_at)})</p>
                    </div>
                    <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold shrink-0">Skor ${rep.readiness_score}%</span>
                  </div>
                  <div class="grid grid-cols-3 gap-1.5 pt-1">
                    <button onclick="openReportDetail('${rep.id}')" class="py-2 px-2 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold">
                      Detail
                    </button>
                    <button onclick="handleApproveInspection('${rep.id}')" class="py-2 px-2 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold shadow-sm">
                      ✓ Approve
                    </button>
                    <button onclick="handleRejectInspection('${rep.id}')" class="py-2 px-2 rounded-lg bg-rose-100 text-rose-700 text-[11px] font-bold">
                      Revisi
                    </button>
                  </div>
                </div>`;
              })
              .join('')}
          </div>`
        : ''
    }

    <div class="pt-1">
      <h3 class="text-sm font-extrabold text-slate-900 mb-2">Status Unit Kamar (${STATE.units.length} Kamar)</h3>
      <div class="space-y-3">
        ${STATE.units
          .map((u) => {
            const st = getUnitCurrentState(u);
            return `
            <div class="w-full rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm space-y-3">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <p class="text-[11px] font-bold text-slate-400">${escapeHtml(u.unit_code)} • ${escapeHtml(u.floor || 'Lantai 2')}</p>
                  <h4 class="text-sm font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_name)}</h4>
                  <p class="text-xs font-medium text-amber-700 mt-0.5 break-words">${escapeHtml(st.subText)}</p>
                </div>
                <span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase shrink-0 ${st.badgeColor}">
                  ${escapeHtml(st.badge)}
                </span>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <button
                  onclick="handleNurseQuickAction('${escapeHtml(u.id)}', 'Siapkan Kamar')"
                  ${st.siapkanLocked ? 'disabled' : ''}
                  class="py-2.5 px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
                    st.siapkanLocked
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-sky-600 text-white shadow-sm active:scale-95'
                  }">
                  <span>${st.siapkanLocked ? '🔒 Sudah Dipesan' : '🛏️ Siapkan Kamar'}</span>
                </button>

                <button
                  onclick="handleNurseQuickAction('${escapeHtml(u.id)}', 'Tambah Extrabed')"
                  class="py-2.5 px-2.5 rounded-xl bg-purple-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95">
                  <span>➕ Tambah Extrabed</span>
                </button>

                <button
                  onclick="handleNurseQuickAction('${escapeHtml(u.id)}', 'Minta Dibersihkan')"
                  class="py-2.5 px-2.5 rounded-xl bg-amber-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95">
                  <span>🧹 Minta Dibersihkan</span>
                </button>

                <button
                  onclick="handleNurseQuickAction('${escapeHtml(u.id)}', 'Pasien Pulang')"
                  class="py-2.5 px-2.5 rounded-xl bg-orange-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95">
                  <span>🚪 Pasien Pulang</span>
                </button>
              </div>
            </div>`;
          })
          .join('')}
      </div>
    </div>

    ${
      infoReports.length
        ? `<div class="w-full rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2">
            <h3 class="text-xs font-extrabold text-slate-700 uppercase">📋 Laporan Kesiapan Kamar Terbaru</h3>
            <div class="space-y-2">
              ${infoReports
                .slice(0, 5)
                .map((r) => {
                  const u = getUnitByIdOrName(r.unit_id, r.unit_name);
                  return `
                  <div onclick="openReportDetail('${r.id}')" class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 cursor-pointer">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</p>
                      <p class="text-[11px] text-slate-500 truncate">Oleh: ${escapeHtml(r.inspector_name)} • ${formatTimeShort(r.created_at)}</p>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                      r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                    }">${r.final_status === 'siap' ? 'SIAP PAKAI' : 'PROSES'}</span>
                  </div>`;
                })
                .join('')}
            </div>
          </div>`
        : ''
    }
  </div>`;
}

/* ==========================================================================
   TAMPILAN KHUSUS PETUGAS (TANPA TAB CEK KAMAR — FORM MUNCUL DARI PERMINTAAN)
   ========================================================================== */

function renderPetugasMainView() {
  const openReqs = getOpenNurseRequestsForPetugas();
  const revisions = getRevisionReportsForPetugas();
  const realItems = getRealChecklistItems();
  const currentScore = calcChecklistScore(STATE.petugasChecklist, realItems);

  return `
  <div class="w-full px-3 pt-3 pb-24 space-y-3">
    ${
      revisions.length
        ? `<div class="w-full rounded-2xl bg-rose-50 border-2 border-rose-300 p-3.5 space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-extrabold text-rose-900 uppercase">⚠️ PERLU PERBAIKAN / REVISI (${revisions.length})</span>
              <span class="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold">Segera</span>
            </div>
            ${revisions
              .map((rev) => {
                const u = getUnitByIdOrName(rev.unit_id, rev.unit_name);
                return `
                <div class="w-full rounded-xl bg-white border border-rose-200 p-3 space-y-2">
                  <p class="text-xs font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</p>
                  <p class="text-xs text-rose-700 break-words">${escapeHtml((rev.notes || '').replace(/\n/g, ' • '))}</p>
                  <div class="flex justify-end">
                    <button onclick="openPetugasChecklistForm('${escapeHtml(u.id)}', '${rev.id}')" class="px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-extrabold shadow-sm active:scale-95">
                      ✨ Cek & Perbaiki Kamar
                    </button>
                  </div>
                </div>`;
              })
              .join('')}
          </div>`
        : ''
    }

    <div class="w-full rounded-2xl bg-amber-50/90 border-2 border-amber-300 p-3.5 space-y-2.5">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
          <h2 class="text-xs font-extrabold text-amber-950 uppercase tracking-wide truncate">
            PERMINTAAN PERAWAT (${openReqs.length} KAMAR)
          </h2>
        </div>
        <span class="px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-extrabold shrink-0">Nurse Station</span>
      </div>

      ${
        openReqs.length === 0
          ? `<div class="w-full rounded-xl bg-white border border-amber-200 p-5 text-center">
              <p class="text-xs font-bold text-slate-700">Belum ada permintaan kamar baru dari Perawat.</p>
              <p class="text-[11px] text-slate-400 mt-1">Form cek kesiapan kamar akan otomatis muncul saat Anda menekan tombol <strong>Cek & Siapkan Kamar</strong> pada permintaan yang masuk.</p>
            </div>`
          : openReqs
              .map((req) => {
                const u = getUnitByIdOrName(req.unit_id, req.unit_name);
                const act = parseNurseActionType(req);
                return `
                <div class="w-full rounded-xl bg-white border border-amber-200 p-3.5 shadow-sm space-y-2.5">
                  <div>
                    <p class="text-sm font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
                    <p class="text-[11px] font-semibold text-slate-500">${escapeHtml(u.floor || 'Lantai 2')}</p>
                    <p class="text-xs font-bold text-amber-700 mt-1">
                      ${escapeHtml(act)}: ${escapeHtml(req.inspector_name || 'Tim Perawat')} (${formatTimeShort(req.created_at)})
                    </p>
                  </div>
                  <div class="flex justify-end">
                    <button
                      onclick="openPetugasChecklistForm('${escapeHtml(u.id)}', '${req.id}')"
                      class="px-4 py-2.5 rounded-xl bg-teal-700 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm active:scale-95">
                      <span>✨ Cek & Siapkan Kamar</span>
                    </button>
                  </div>
                </div>`;
              })
              .join('')
      }
    </div>

    ${
      STATE.petugasFormOpen
        ? renderPetugasChecklistBox(currentScore, realItems)
        : ''
    }
  </div>`;
}

function renderPetugasChecklistBox(currentScore, realItems) {
  const unit = getUnitByIdOrName(STATE.petugasFormUnitId, '');
  const staffName = STATE.user?.full_name || STATE.user?.username || 'Petugas';

  return `
  <div id="petugasChecklistSection" class="w-full rounded-2xl bg-white border-2 border-teal-600 p-4 shadow-md space-y-3.5">
    <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
      <div class="min-w-0 flex-1">
        <span class="px-2 py-0.5 rounded bg-teal-50 text-teal-800 text-[10px] font-extrabold uppercase">Form Cek Kesiapan Kamar</span>
        <h3 class="text-base font-extrabold text-slate-900 mt-1 break-words">${escapeHtml(unit.unit_code)} - ${escapeHtml(unit.unit_name)}</h3>
        <p class="text-xs text-slate-500">${escapeHtml(unit.floor || 'Lantai 2')} • Petugas: <strong>${escapeHtml(staffName)}</strong></p>
      </div>
      <div class="flex flex-col items-end gap-1.5 shrink-0">
        <span class="px-2.5 py-1 rounded-full text-xs font-extrabold ${
          currentScore === 100 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
        }">Skor: ${currentScore}%</span>
        <button onclick="closePetugasChecklistForm()" class="text-[11px] font-bold text-rose-600 underline">
          Tutup Form
        </button>
      </div>
    </div>

    <div class="space-y-2">
      <p class="text-xs font-extrabold text-slate-700">Checklist Kesiapan Standar Kamar:</p>
      ${realItems
        .map((it, idx) => {
          const checked = !!STATE.petugasChecklist[it.id];
          return `
          <label class="w-full flex items-start gap-2.5 p-3 rounded-xl border ${
            checked ? 'bg-teal-50/70 border-teal-400' : 'bg-slate-50 border-slate-200'
          } cursor-pointer">
            <input
              type="checkbox"
              ${checked ? 'checked' : ''}
              onchange="STATE.petugasChecklist['${it.id}'] = !STATE.petugasChecklist['${it.id}']; render();"
              class="mt-0.5 w-4 h-4 accent-teal-700 shrink-0" />
            <div class="min-w-0 flex-1">
              <span class="text-[10px] font-bold uppercase text-teal-700">${idx + 1}. ${escapeHtml(it.category)}</span>
              <p class="text-xs font-semibold text-slate-800 break-words">${escapeHtml(it.item_name)}</p>
            </div>
          </label>`;
        })
        .join('')}
    </div>

    <div class="space-y-1.5">
      <label class="block text-xs font-bold text-slate-700">Catatan Petugas (Opsional)</label>
      <textarea
        rows="2"
        oninput="STATE.petugasNotes = this.value"
        placeholder="Contoh: AC sudah dinyalakan, sprei & handuk baru..."
        class="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:outline-none focus:border-teal-600">${escapeHtml(STATE.petugasNotes)}</textarea>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div class="space-y-1">
        <label class="block text-[11px] font-bold text-slate-700">Foto Area Kamar</label>
        <input type="file" accept="image/*" capture="environment" onchange="handlePhotoUpload(event, 'petugasPhotoRoom')" class="w-full text-[11px] text-slate-600" />
        ${STATE.petugasPhotoRoom ? `<img src="${STATE.petugasPhotoRoom}" class="w-full h-24 object-cover rounded-lg border" />` : ''}
      </div>
      <div class="space-y-1">
        <label class="block text-[11px] font-bold text-slate-700">Foto Kamar Mandi</label>
        <input type="file" accept="image/*" capture="environment" onchange="handlePhotoUpload(event, 'petugasPhotoToilet')" class="w-full text-[11px] text-slate-600" />
        ${STATE.petugasPhotoToilet ? `<img src="${STATE.petugasPhotoToilet}" class="w-full h-24 object-cover rounded-lg border" />` : ''}
      </div>
    </div>

    <div class="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600">
      Mode Approval Aktif: <strong>${escapeHtml(getApprovalModeLabel(STATE.approvalMode))}</strong>
    </div>

    <button
      onclick="submitPetugasChecklist()"
      class="w-full py-3 rounded-xl bg-teal-700 text-white text-xs font-extrabold shadow-md active:scale-98">
      ✅ Simpan & Kirim Laporan Kesiapan Kamar
    </button>
  </div>`;
}

/* ==========================================================================
   TAMPILAN KHUSUS TEKNISI (OTOMATIS DAPAT TUGAS SAAT PERAWAT MINTA SIAPKAN/BERSIHKAN)
   ========================================================================== */

function renderTeknisiMainView() {
  const tekTasks = getOpenTasksForTeknisi();
  const tekScore = calcChecklistScore(STATE.teknisiChecklist, TEKNISI_CHECKLIST_ITEMS);
  const recentTekLogs = STATE.inspections
    .filter((r) => isTeknisiTaskRecord(r) && r.final_status === 'siap')
    .slice(0, 6);

  return `
  <div class="w-full px-3 pt-3 pb-24 space-y-3">
    <div class="w-full rounded-2xl bg-gradient-to-r from-sky-700 to-cyan-700 text-white p-4 shadow-sm">
      <span class="inline-block px-2 py-0.5 rounded bg-white/20 text-[10px] font-extrabold uppercase">Divisi Teknisi & Sarpras</span>
      <h2 class="text-base font-extrabold mt-1">Antrean Pengecekan Teknis Kamar</h2>
      <p class="text-xs text-sky-100 mt-0.5">
        Otomatis terisi saat Perawat meminta penyiapan/pembersihan kamar (cek AC, TV, listrik, sanitasi & nurse call).
      </p>
    </div>

    <div class="w-full rounded-2xl bg-sky-50 border-2 border-sky-300 p-3.5 space-y-2.5">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-extrabold text-sky-950 uppercase">🔧 Tugas Teknisi Masuk (${tekTasks.length})</h3>
        <span class="px-2 py-0.5 rounded-full bg-sky-600 text-white text-[10px] font-bold">Aktif</span>
      </div>

      ${
        tekTasks.length === 0
          ? `<div class="rounded-xl bg-white border border-sky-200 p-4 text-center">
              <p class="text-xs font-bold text-slate-700">Semua fasilitas kamar sudah dicek.</p>
              <p class="text-[11px] text-slate-400 mt-1">Tugas baru akan muncul otomatis saat Perawat meminta siapkan atau bersihkan kamar.</p>
            </div>`
          : tekTasks
              .map((t) => {
                const u = getUnitByIdOrName(t.unit_id, t.unit_name);
                return `
                <div class="w-full rounded-xl bg-white border border-sky-200 p-3.5 space-y-2 shadow-sm">
                  <div>
                    <p class="text-sm font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
                    <p class="text-[11px] font-bold text-sky-700">${escapeHtml(u.floor || 'Lantai 2')} • Masuk pukul ${formatTimeShort(t.created_at)}</p>
                    <p class="text-xs text-slate-600 mt-1 break-words">${escapeHtml((t.notes || '').replace(TEKNISI_REQ_TAG, '').trim())}</p>
                  </div>
                  <div class="flex justify-end">
                    <button onclick="openTeknisiForm('${escapeHtml(u.id)}', '${t.id}')" class="px-4 py-2 rounded-xl bg-sky-700 text-white text-xs font-extrabold shadow-sm active:scale-95">
                      🔧 Cek & Tangani Kamar
                    </button>
                  </div>
                </div>`;
              })
              .join('')
      }
    </div>

    ${
      STATE.teknisiFormOpen
        ? (() => {
            const u = getUnitByIdOrName(STATE.teknisiFormUnitId, '');
            return `
            <div class="w-full rounded-2xl bg-white border-2 border-sky-600 p-4 shadow-md space-y-3">
              <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div class="min-w-0 flex-1">
                  <span class="px-2 py-0.5 rounded bg-sky-50 text-sky-800 text-[10px] font-extrabold uppercase">Checklist Teknisi</span>
                  <h3 class="text-sm font-extrabold text-slate-900 mt-1 break-words">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</h3>
                </div>
                <div class="text-right shrink-0">
                  <span class="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-extrabold">Skor: ${tekScore}%</span>
                  <button onclick="closeTeknisiForm()" class="block text-[11px] font-bold text-rose-600 underline mt-1">Tutup</button>
                </div>
              </div>

              <div class="space-y-2">
                ${TEKNISI_CHECKLIST_ITEMS.map((it, idx) => {
                  const checked = !!STATE.teknisiChecklist[it.id];
                  return `
                  <label class="w-full flex items-start gap-2.5 p-3 rounded-xl border ${
                    checked ? 'bg-sky-50 border-sky-400' : 'bg-slate-50 border-slate-200'
                  } cursor-pointer">
                    <input type="checkbox" ${checked ? 'checked' : ''} onchange="STATE.teknisiChecklist['${it.id}'] = !STATE.teknisiChecklist['${it.id}']; render();" class="mt-0.5 w-4 h-4 accent-sky-700 shrink-0" />
                    <div class="min-w-0 flex-1">
                      <span class="text-[10px] font-bold uppercase text-sky-700">${idx + 1}. ${escapeHtml(it.category)}</span>
                      <p class="text-xs font-semibold text-slate-800 break-words">${escapeHtml(it.item_name)}</p>
                    </div>
                  </label>`;
                }).join('')}
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">Catatan Hasil Pengecekan Teknis</label>
                <textarea rows="2" oninput="STATE.teknisiNotes = this.value" placeholder="Contoh: Suhu AC 21°C normal, baterai remote TV baru..." class="w-full rounded-xl border border-slate-300 p-2.5 text-xs">${escapeHtml(STATE.teknisiNotes)}</textarea>
              </div>

              <button onclick="submitTeknisiChecklist()" class="w-full py-3 rounded-xl bg-sky-700 text-white text-xs font-extrabold shadow-md">
                ✅ Selesaikan Tugas Teknisi
              </button>
            </div>`;
          })()
        : ''
    }

    ${
      recentTekLogs.length
        ? `<div class="w-full rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2">
            <h3 class="text-xs font-extrabold text-slate-700 uppercase">Riwayat Pengecekan Teknisi Selesai</h3>
            ${recentTekLogs
              .map((r) => {
                const u = getUnitByIdOrName(r.unit_id, r.unit_name);
                return `
                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</p>
                    <p class="text-[11px] text-slate-500 truncate">${escapeHtml(r.inspector_name)} • ${formatTimeShort(r.created_at)}</p>
                  </div>
                  <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold shrink-0">Selesai</span>
                </div>`;
              })
              .join('')}
          </div>`
        : ''
    }
  </div>`;
}

/* ==========================================================================
   TAMPILAN KHUSUS MANAJEMEN (APPROVAL / PANTAUAN + CHECKLIST MANUAL)
   ========================================================================== */

function renderManajemenMainView() {
  const pendingApprovals = getPendingApprovalsForRole('manajemen');
  const infoReports = getInfoReportsForRole();
  const realItems = getRealChecklistItems();
  if (!STATE.mgmtFormUnitId && STATE.units.length) {
    STATE.mgmtFormUnitId = STATE.units[0].id;
  }
  const mgmtScore = calcChecklistScore(STATE.mgmtChecklist, realItems);

  return `
  <div class="w-full px-3 pt-3 pb-24 space-y-3">
    <div class="w-full rounded-2xl bg-white border border-slate-200 p-3.5 flex items-center justify-between gap-2">
      <div class="min-w-0 flex-1">
        <p class="text-[10px] font-bold uppercase text-slate-400">Mode Approval Saat Ini</p>
        <p class="text-xs font-extrabold text-teal-800 truncate">${escapeHtml(getApprovalModeLabel(STATE.approvalMode))}</p>
      </div>
      <button onclick="STATE.activeTab = 'pengaturan'; render();" class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-bold shrink-0">
        ⚙️ Ubah Mode
      </button>
    </div>

    ${
      pendingApprovals.length
        ? `<div class="w-full rounded-2xl bg-purple-50 border-2 border-purple-300 p-3.5 space-y-2.5">
            <div class="flex items-center justify-between">
              <h3 class="text-xs font-extrabold text-purple-900 uppercase">✅ Menunggu Approval Manajemen (${pendingApprovals.length})</h3>
              <span class="px-2 py-0.5 rounded-full bg-purple-700 text-white text-[10px] font-bold">Perlu ACC</span>
            </div>
            ${pendingApprovals
              .map((rep) => {
                const u = getUnitByIdOrName(rep.unit_id, rep.unit_name);
                return `
                <div class="w-full rounded-xl bg-white border border-purple-200 p-3 space-y-2 shadow-sm">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
                      <p class="text-[11px] text-slate-500">${escapeHtml(u.floor || 'Lantai 2')} • Petugas: <strong>${escapeHtml(rep.inspector_name)}</strong> (${formatTimeShort(rep.created_at)})</p>
                    </div>
                    <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold shrink-0">Skor ${rep.readiness_score}%</span>
                  </div>
                  <div class="grid grid-cols-3 gap-1.5">
                    <button onclick="openReportDetail('${rep.id}')" class="py-2 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold">Detail</button>
                    <button onclick="handleApproveInspection('${rep.id}')" class="py-2 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold">✓ Approve</button>
                    <button onclick="handleRejectInspection('${rep.id}')" class="py-2 rounded-lg bg-rose-100 text-rose-700 text-[11px] font-bold">Revisi</button>
                  </div>
                </div>`;
              })
              .join('')}
          </div>`
        : ''
    }

    <div class="w-full rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2">
      <h3 class="text-xs font-extrabold text-slate-700 uppercase">📊 Pantauan Laporan Kesiapan Kamar Terbaru</h3>
      ${
        infoReports.length === 0
          ? `<p class="text-xs text-slate-400 py-2">Belum ada laporan kesiapan kamar.</p>`
          : infoReports
              .slice(0, 6)
              .map((r) => {
                const u = getUnitByIdOrName(r.unit_id, r.unit_name);
                return `
                <div onclick="openReportDetail('${r.id}')" class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 cursor-pointer">
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</p>
                    <p class="text-[11px] text-slate-500 truncate">Pelaksana: ${escapeHtml(r.inspector_name)} • ${formatTimeShort(r.created_at)}</p>
                  </div>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                    r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                  }">${r.final_status === 'siap' ? 'SIAP PAKAI' : 'PROSES'}</span>
                </div>`;
              })
              .join('')
      }
    </div>

    <div class="w-full rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-extrabold text-slate-900">Inspeksi Manual Manajemen</h3>
        <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-extrabold">Skor: ${mgmtScore}%</span>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 mb-1">Pilih Unit Kamar</label>
        <select onchange="STATE.mgmtFormUnitId = this.value; render();" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold bg-white">
          ${STATE.units
            .map(
              (u) =>
                `<option value="${escapeHtml(u.id)}" ${String(STATE.mgmtFormUnitId) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</option>`
            )
            .join('')}
        </select>
      </div>

      <div class="space-y-2">
        ${realItems
          .map((it, idx) => {
            const checked = !!STATE.mgmtChecklist[it.id];
            return `
            <label class="w-full flex items-start gap-2.5 p-2.5 rounded-xl border ${
              checked ? 'bg-teal-50 border-teal-400' : 'bg-slate-50 border-slate-200'
            } cursor-pointer">
              <input type="checkbox" ${checked ? 'checked' : ''} onchange="STATE.mgmtChecklist['${it.id}'] = !STATE.mgmtChecklist['${it.id}']; render();" class="mt-0.5 w-4 h-4 accent-teal-700 shrink-0" />
              <div class="min-w-0 flex-1">
                <span class="text-[10px] font-bold text-teal-700 uppercase">${idx + 1}. ${escapeHtml(it.category)}</span>
                <p class="text-xs font-semibold text-slate-800 break-words">${escapeHtml(it.item_name)}</p>
              </div>
            </label>`;
          })
          .join('')}
      </div>

      <button onclick="submitMgmtManualInspection()" class="w-full py-3 rounded-xl bg-teal-700 text-white text-xs font-extrabold shadow-sm">
        ✅ Simpan Hasil Inspeksi Manajemen
      </button>
    </div>
  </div>`;
}

async function submitMgmtManualInspection() {
  const unit = getUnitByIdOrName(STATE.mgmtFormUnitId, '');
  const realItems = getRealChecklistItems();
  const score = calcChecklistScore(STATE.mgmtChecklist, realItems);
  if (score < 100) {
    showToast('Centang seluruh checklist hingga 100% terlebih dahulu.');
    return;
  }
  const actorName = STATE.user?.full_name || 'Manajemen';
  await sb.from('room_inspections').insert([{
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: actorName,
    inspector_role: 'manajemen',
    shift: `Inspeksi Manajemen • ${formatTimeShort(new Date().toISOString())} WIB`,
    readiness_score: score,
    final_status: 'siap',
    duration_seconds: 30,
    checklist_data: realItems.map((it) => ({ item: it.item_name, checked: true })),
    notes: `[Pelaksana: ${actorName}]\n[Tanggapan Pemeriksa: Sesuai Standar (Approved oleh ${actorName})]`
  }]);
  await sb.from('master_units').update({
    status: 'siap',
    last_checked_by: `Approved: ${actorName}`,
    last_checked_at: new Date().toISOString()
  }).eq('id', unit.id);

  STATE.mgmtChecklist = {};
  showToast(`Inspeksi ${unit.unit_name} tersimpan sebagai SIAP PAKAI.`);
  await syncAllData(true);
}

/* ==========================================================================
   TAB PERBAIKAN FASILITAS (TERHUBUNG OTOMATIS KE TEKNISI)
   ========================================================================== */

function renderPerbaikanView() {
  if (!STATE.repairUnitId && STATE.units.length) STATE.repairUnitId = STATE.units[0].id;
  const repairLogs = STATE.inspections.filter((r) => isTeknisiTaskRecord(r)).slice(0, 12);

  return `
  <div class="w-full px-3 pt-3 pb-24 space-y-3">
    <div class="w-full rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-sm">
      <div>
        <h2 class="text-base font-extrabold text-slate-900">Laporkan Kerusakan / Tugas Teknisi</h2>
        <p class="text-xs text-slate-500">Laporan kerusakan fasilitas langsung masuk ke antrean tugas Teknisi.</p>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 mb-1">Unit Kamar</label>
        <select onchange="STATE.repairUnitId = this.value" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold bg-white">
          ${STATE.units
            .map(
              (u) =>
                `<option value="${escapeHtml(u.id)}" ${String(STATE.repairUnitId) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</option>`
            )
            .join('')}
        </select>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 mb-1">Kategori Kerusakan</label>
        <select onchange="STATE.repairCategory = this.value" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold bg-white">
          <option value="AC / Pendingin Ruangan">AC / Pendingin Ruangan</option>
          <option value="TV / Remote / Hiburan">TV / Remote / Hiburan</option>
          <option value="Lampu / Stopkontak / Listrik">Lampu / Stopkontak / Listrik</option>
          <option value="Air / Keran / Toilet">Air / Keran / Toilet</option>
          <option value="Bed Pasien / Nurse Call">Bed Pasien / Nurse Call</option>
        </select>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 mb-1">Keterangan Kerusakan</label>
        <textarea rows="2" oninput="STATE.repairDesc = this.value" placeholder="Jelaskan kendala fasilitas secara singkat..." class="w-full rounded-xl border border-slate-300 p-2.5 text-xs">${escapeHtml(STATE.repairDesc)}</textarea>
      </div>

      <button onclick="submitRepairTicket()" class="w-full py-3 rounded-xl bg-sky-700 text-white text-xs font-extrabold shadow-sm">
        🔧 Kirim Laporan ke Teknisi
      </button>
    </div>

    <div class="w-full rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2">
      <h3 class="text-xs font-extrabold text-slate-700 uppercase">Riwayat Tiket Perbaikan & Tugas Teknisi</h3>
      ${
        repairLogs.length === 0
          ? `<p class="text-xs text-slate-400">Belum ada tiket perbaikan.</p>`
          : repairLogs
              .map((r) => {
                const u = getUnitByIdOrName(r.unit_id, r.unit_name);
                const done = r.final_status === 'siap';
                return `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-xs font-extrabold text-slate-900 truncate">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</p>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                      done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }">${done ? 'SELESAI' : 'PROSES TEKNISI'}</span>
                  </div>
                  <p class="text-[11px] text-slate-600 break-words">${escapeHtml((r.notes || '-').replace(TEKNISI_REQ_TAG, '').replace(REPAIR_RECORD_TAG, '').trim())}</p>
                </div>`;
              })
              .join('')
      }
    </div>
  </div>`;
}

async function submitRepairTicket() {
  const unit = getUnitByIdOrName(STATE.repairUnitId, '');
  if (!STATE.repairDesc.trim()) {
    showToast('Isi keterangan kerusakan terlebih dahulu.');
    return;
  }
  const { num, floor } = extractRoomNumberSpeech(unit);
  const reporter = STATE.user?.full_name || 'Staf';

  await sb.from('room_inspections').insert([{
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: reporter,
    inspector_role: STATE.user?.role || 'petugas',
    shift: `Tugas Teknisi • ${formatTimeShort(new Date().toISOString())} WIB`,
    readiness_score: 0,
    final_status: 'kotor',
    duration_seconds: 0,
    checklist_data: [{ item: STATE.repairCategory, checked: false }],
    notes: `${TEKNISI_REQ_TAG}\n[${STATE.repairCategory}] ${STATE.repairDesc.trim()} (Dilaporkan oleh ${reporter})`
  }]);

  STATE.repairDesc = '';
  speakIndonesian(`Laporan perbaikan ${STATE.repairCategory} kamar nomor ${num}, ${floor}, telah dikirim ke teknisi.`);
  showToast('Tiket perbaikan berhasil dikirim ke Teknisi.');
  await syncAllData(true);
}

/* ==========================================================================
   TAB ANALITIK & DOWNLOAD REKAP PDF / EXCEL (OKUPANSI + KEDISIPLINAN PETUGAS)
   ========================================================================== */

function renderAnalitikView() {
  const summary = computeAnalyticsSummary();

  return `
  <div class="w-full px-3 pt-3 pb-24 space-y-3">
    <div class="w-full rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-sm">
      <div>
        <h2 class="text-base font-extrabold text-slate-900">Rekap Okupansi & Kedisiplinan</h2>
        <p class="text-[11px] text-slate-500">Filter Harian, Mingguan, Bulanan & Tahunan</p>
      </div>

      <div class="grid grid-cols-5 gap-1">
        ${['hari', 'minggu', 'bulan', 'tahun', 'semua']
          .map(
            (p) => `
          <button
            onclick="STATE.filterPeriod = '${p}'; render();"
            class="py-2 px-1 rounded-xl text-[11px] font-extrabold capitalize ${
              STATE.filterPeriod === p
                ? 'bg-teal-700 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600'
            }">
            ${p}
          </button>`
          )
          .join('')}
      </div>

      ${
        STATE.filterPeriod === 'hari' || STATE.filterPeriod === 'minggu'
          ? `<div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">${
                STATE.filterPeriod === 'minggu' ? 'Pilih Salah Satu Tanggal dalam Minggu Tersebut:' : 'Pilih Tanggal:'
              }</label>
              <input type="date" value="${STATE.filterDate}" onchange="STATE.filterDate = this.value; render();" class="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold" />
            </div>`
          : STATE.filterPeriod === 'bulan'
          ? `<div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">Pilih Bulan:</label>
              <input type="month" value="${STATE.filterMonth}" onchange="STATE.filterMonth = this.value; render();" class="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold" />
            </div>`
          : STATE.filterPeriod === 'tahun'
          ? `<div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">Pilih Tahun:</label>
              <input type="number" min="2024" max="2035" value="${STATE.filterYear}" onchange="STATE.filterYear = this.value; render();" class="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold" />
            </div>`
          : ''
      }

      <div class="grid grid-cols-2 gap-2 pt-1">
        <button onclick="openPrintRekapWindow()" class="py-2.5 px-3 rounded-xl bg-teal-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95">
          <span>📄 Download PDF / Cetak</span>
        </button>
        <button onclick="downloadRekapExcelCSV()" class="py-2.5 px-3 rounded-xl bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95">
          <span>📊 Download Excel (CSV)</span>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2.5">
      <div class="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm">
        <p class="text-[10px] font-extrabold text-slate-400 uppercase">Kamar Terpakai</p>
        <p class="text-xl font-extrabold text-teal-700 mt-1">${summary.usedRoomsCount} <span class="text-xs font-bold text-slate-500">/ ${summary.totalRooms} Kamar</span></p>
        <p class="text-[11px] font-bold text-teal-600 mt-0.5">Okupansi: ${summary.occupancyPct}%</p>
      </div>

      <div class="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm">
        <p class="text-[10px] font-extrabold text-slate-400 uppercase">Kamar Tidak Terpakai</p>
        <p class="text-xl font-extrabold text-amber-600 mt-1">${summary.unusedRoomsCount} <span class="text-xs font-bold text-slate-500">Kamar</span></p>
        <p class="text-[11px] font-bold text-slate-500 mt-0.5">Kosong di periode ini</p>
      </div>

      <div class="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm">
        <p class="text-[10px] font-extrabold text-slate-400 uppercase">Pengecekan Selesai</p>
        <p class="text-xl font-extrabold text-slate-900 mt-1">${summary.workReports.length} <span class="text-xs font-bold text-slate-500">Laporan</span></p>
        <p class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(getFilterPeriodTitle())}</p>
      </div>

      <div class="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm">
        <p class="text-[10px] font-extrabold text-slate-400 uppercase">Rata-Rata Skor Kesiapan</p>
        <p class="text-xl font-extrabold text-emerald-600 mt-1">${summary.avgScore}%</p>
        <p class="text-[11px] text-slate-500 mt-0.5">Skor murni checklist</p>
      </div>
    </div>

    <div class="w-full rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2.5 shadow-sm">
      <h3 class="text-xs font-extrabold text-slate-800 uppercase">🏅 Kedisiplinan Tiap Petugas & Teknisi (%)</h3>
      ${
        summary.staffDisciplineList.length === 0
          ? `<p class="text-xs text-slate-400 py-2">Belum ada data penilaian petugas pada periode ini.</p>`
          : summary.staffDisciplineList
              .map(
                (s) => `
              <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs font-extrabold text-slate-900 truncate">${escapeHtml(s.name)}</p>
                  <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                    s.disciplinePct >= 90
                      ? 'bg-emerald-100 text-emerald-800'
                      : s.disciplinePct >= 75
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-rose-100 text-rose-800'
                  }">${s.disciplinePct}% Disiplin</span>
                </div>
                <div class="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div class="h-full bg-teal-600 rounded-full" style="width: ${s.disciplinePct}%"></div>
                </div>
                <p class="text-[11px] text-slate-500">
                  Total Tugas: <strong>${s.totalTasks}</strong> • Lolos 100%: <strong>${s.passedTasks}</strong> • Revisi: <strong>${s.revisionTasks}</strong> • Rata Waktu: <strong>${escapeHtml(s.avgDurationLabel)}</strong>
                </p>
              </div>`
              )
              .join('')
      }
    </div>
  </div>`;
}

/* ==========================================================================
   TAB PENGATURAN MANAJEMEN (4 PILIHAN APPROVAL, MASTER KAMAR, AKUN)
   ========================================================================== */

function renderPengaturanView() {
  const modes = [
    {
      id: 'off',
      title: '1. OFF (Langsung Siap Pakai)',
      desc: 'Petugas simpan laporan 100% -> kamar otomatis SIAP PAKAI. Perawat & Manajemen hanya terima laporan.'
    },
    {
      id: 'perawat',
      title: '2. ON untuk Perawat',
      desc: 'Laporan masuk ke akun Perawat untuk di-Approve. Manajemen hanya mendapatkan laporannya saja.'
    },
    {
      id: 'manajemen',
      title: '3. ON untuk Manajemen',
      desc: 'Laporan masuk ke akun Manajemen untuk di-Approve. Perawat hanya mendapatkan laporannya saja.'
    },
    {
      id: 'all',
      title: '4. ON All (Perawat & Manajemen)',
      desc: 'Perawat maupun Manajemen sama-sama mendapat tombol Approve untuk mengesahkan kamar.'
    }
  ];

  return `
  <div class="w-full px-3 pt-3 pb-24 space-y-3">
    <div class="w-full rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-sm">
      <div>
        <h2 class="text-base font-extrabold text-slate-900">Pengaturan Alur Approval Kamar</h2>
        <p class="text-xs text-slate-500">Pilih siapa yang berwenang melakukan Approve setelah petugas selesai menyiapkan kamar:</p>
      </div>

      <div class="space-y-2">
        ${modes
          .map((m) => {
            const active = STATE.approvalMode === m.id;
            return `
            <button
              onclick="setApprovalMode('${m.id}')"
              class="w-full text-left p-3 rounded-xl border-2 transition ${
                active ? 'border-teal-600 bg-teal-50/70' : 'border-slate-200 bg-slate-50'
              }">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-extrabold ${active ? 'text-teal-900' : 'text-slate-800'}">${escapeHtml(m.title)}</p>
                <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  active ? 'border-teal-700 bg-teal-700 text-white text-[10px]' : 'border-slate-400'
                }">${active ? '✓' : ''}</span>
              </div>
              <p class="text-[11px] text-slate-600 mt-1 leading-relaxed">${escapeHtml(m.desc)}</p>
            </button>`;
          })
          .join('')}
      </div>
    </div>

    <div class="w-full rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-sm">
      <h3 class="text-sm font-extrabold text-slate-900">Kelola Akun Pengguna (${STATE.users.length} Akun)</h3>
      <div class="space-y-2">
        <input id="newUserFullName" type="text" placeholder="Nama Lengkap (misal: Budi Teknisi)" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs" />
        <div class="grid grid-cols-2 gap-2">
          <input id="newUserUsername" type="text" placeholder="Username login" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs" />
          <input id="newUserPassword" type="text" placeholder="Password login" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs" />
        </div>
        <select id="newUserRole" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold bg-white">
          <option value="petugas">Petugas Kebersihan</option>
          <option value="teknisi">Teknisi</option>
          <option value="perawat">Perawat</option>
          <option value="manajemen">Manajemen</option>
        </select>
        <button onclick="addNewAppUser()" class="w-full py-2.5 rounded-xl bg-teal-700 text-white text-xs font-extrabold">
          + Simpan Akun Baru
        </button>
      </div>
      <div class="space-y-1.5 pt-2 border-t border-slate-100">
        ${STATE.users
          .map(
            (u) => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-xs gap-2">
            <div class="min-w-0 flex-1">
              <p class="font-bold text-slate-800 truncate">${escapeHtml(u.full_name || u.username)}</p>
              <p class="text-[10px] text-slate-500 font-mono truncate">User: ${escapeHtml(u.username)} • Pass: ${escapeHtml(u.password)}</p>
            </div>
            <span class="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-extrabold uppercase shrink-0">${escapeHtml(u.role)}</span>
          </div>`
          )
          .join('')}
      </div>
    </div>

    <div class="w-full rounded-2xl bg-amber-50 border border-amber-200 p-3.5 space-y-1">
      <p class="text-xs font-extrabold text-amber-900">💡 Tips Notifikasi HP Tetap Bunyi di Luar Aplikasi:</p>
      <p class="text-[11px] text-amber-800 leading-relaxed">
        Buka <strong>Pengaturan HP → Aplikasi → Chrome → Baterai</strong> lalu pilih <strong>Tidak Dibatasi (Unrestricted)</strong>, serta aktifkan izin <strong>Notifikasi</strong> agar pengingat suara tetap berjalan saat layar terkunci.
      </p>
    </div>
  </div>`;
}

async function setApprovalMode(mode) {
  STATE.approvalMode = mode;
  localStorage.setItem('ck_approval_mode', mode);
  showToast(`Mode approval diubah ke: ${getApprovalModeLabel(mode)}`);
  render();

  try {
    const existingCfg = STATE.items.find((i) => i.category === APPROVAL_CONFIG_KEY);
    if (existingCfg) {
      await sb.from('master_items').update({ item_name: mode }).eq('id', existingCfg.id);
    } else {
      await sb.from('master_items').insert([{
        item_name: mode,
        category: APPROVAL_CONFIG_KEY,
        is_critical: false
      }]);
    }
  } catch (e) {}
}

async function addNewAppUser() {
  const fullName = document.getElementById('newUserFullName')?.value.trim();
  const username = document.getElementById('newUserUsername')?.value.trim();
  const password = document.getElementById('newUserPassword')?.value.trim();
  const role = document.getElementById('newUserRole')?.value || 'petugas';
  if (!fullName || !username || !password) {
    showToast('Lengkapi Nama, Username, dan Password terlebih dahulu.');
    return;
  }
  const { error } = await sb.from('app_users').insert([{
    full_name: fullName,
    username,
    password,
    role
  }]);
  if (error) {
    showToast('Gagal menyimpan akun: ' + error.message);
    return;
  }
  showToast(`Akun ${fullName} (${role}) berhasil ditambahkan.`);
  await syncAllData(true);
}

/* ==========================================================================
   NAVIGASI BAWAH (SESUAI ROLE — PETUGAS TANPA TAB CEK KAMAR)
   ========================================================================== */

function renderBottomNav() {
  const role = String(STATE.user.role || '').toLowerCase();
  let tabs = [];

  if (role === 'petugas') {
    tabs = [
      { id: 'main', icon: '🔔', label: 'Permintaan' },
      { id: 'perbaikan', icon: '🔧', label: 'Perbaikan' },
      { id: 'analitik', icon: '📊', label: 'Analitik' }
    ];
  } else if (role === 'perawat') {
    tabs = [
      { id: 'main', icon: '🏥', label: 'Kamar' },
      { id: 'perbaikan', icon: '🔧', label: 'Perbaikan' },
      { id: 'analitik', icon: '📊', label: 'Analitik' }
    ];
  } else if (role === 'teknisi') {
    tabs = [
      { id: 'main', icon: '🛠️', label: 'Tugas Teknisi' },
      { id: 'perbaikan', icon: '📋', label: 'Laporan' },
      { id: 'analitik', icon: '📊', label: 'Analitik' }
    ];
  } else {
    tabs = [
      { id: 'main', icon: '📋', label: 'Cek Kamar' },
      { id: 'perbaikan', icon: '🔧', label: 'Perbaikan' },
      { id: 'analitik', icon: '📊', label: 'Analitik' },
      { id: 'pengaturan', icon: '⚙️', label: 'Pengaturan' }
    ];
  }

  return `
  <nav class="fixed bottom-0 left-0 right-0 z-30 w-full bg-white border-t border-slate-200 px-2 py-1.5 shadow-lg">
    <div class="w-full grid grid-cols-${tabs.length} gap-1">
      ${tabs
        .map((t) => {
          const active = STATE.activeTab === t.id;
          return `
          <button
            onclick="STATE.activeTab = '${t.id}'; render();"
            class="py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition ${
              active ? 'bg-teal-50 text-teal-800 font-extrabold' : 'text-slate-500 font-semibold'
            }">
            <span class="text-base leading-none">${t.icon}</span>
            <span class="text-[11px] truncate">${escapeHtml(t.label)}</span>
          </button>`;
        })
        .join('')}
    </div>
  </nav>`;
}

/* ==========================================================================
   MODAL DETAIL LAPORAN & HALAMAN LOGIN
   ========================================================================== */

function openReportDetail(id) {
  STATE.selectedDetailReport = STATE.inspections.find((r) => String(r.id) === String(id)) || null;
  render();
}

function closeReportDetail() {
  STATE.selectedDetailReport = null;
  render();
}

function renderDetailModal() {
  const rep = STATE.selectedDetailReport;
  if (!rep) return '';
  const u = getUnitByIdOrName(rep.unit_id, rep.unit_name);
  const items = Array.isArray(rep.checklist_data) ? rep.checklist_data : [];

  return `
  <div class="fixed inset-0 z-50 bg-slate-900/60 flex items-end sm:items-center justify-center p-3">
    <div class="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-4 space-y-3 shadow-2xl">
      <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor || 'Lantai 2')})</h3>
          <p class="text-[11px] text-slate-500">${escapeHtml(formatDateTimeID(rep.created_at))}</p>
        </div>
        <button onclick="closeReportDetail()" class="w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold shrink-0">✕</button>
      </div>

      <div class="text-xs space-y-1 text-slate-700">
        <p><strong>Pelaksana:</strong> ${escapeHtml(rep.inspector_name || '-')}</p>
        <p><strong>Skor Kesiapan:</strong> ${rep.readiness_score || 0}%</p>
        <p class="break-words"><strong>Catatan:</strong> ${escapeHtml((rep.notes || '-').replace(/\n/g, ' • '))}</p>
      </div>

      ${
        items.length
          ? `<div class="space-y-1 border-t border-slate-100 pt-2">
              <p class="text-[11px] font-extrabold text-slate-700">Item Checklist:</p>
              ${items
                .map(
                  (it) =>
                    `<p class="text-[11px] text-slate-600">${it.checked ? '✅' : '❌'} ${escapeHtml(it.item || '')}</p>`
                )
                .join('')}
            </div>`
          : ''
      }

      ${
        rep.photo_room_url
          ? `<img src="${rep.photo_room_url}" alt="Bukti Kamar" class="w-full h-40 object-cover rounded-xl border border-slate-200" />`
          : ''
      }
      ${
        rep.photo_toilet_url
          ? `<img src="${rep.photo_toilet_url}" alt="Bukti Toilet" class="w-full h-40 object-cover rounded-xl border border-slate-200" />`
          : ''
      }

      <button onclick="closeReportDetail()" class="w-full py-2.5 rounded-xl bg-slate-800 text-white text-xs font-extrabold">
        Tutup Detail
      </button>
    </div>
  </div>`;
}

function renderLoginScreen() {
  return `
  <div class="min-h-screen w-full flex flex-col justify-center px-4 py-8 bg-gradient-to-b from-teal-800 to-slate-900">
    <div class="w-full max-w-sm mx-auto rounded-3xl bg-white p-6 shadow-2xl space-y-5">
      <div class="text-center space-y-1.5">
        <div class="w-14 h-14 rounded-2xl bg-teal-700 text-white font-extrabold text-xl flex items-center justify-center mx-auto shadow-md">
          SS
        </div>
        <h1 class="text-lg font-extrabold text-slate-900">Cek Kesiapan Kamar</h1>
        <p class="text-xs text-slate-500">RS Khusus Bedah SS Medika • Versi ${APP_VERSION}</p>
      </div>

      <form onsubmit="handleLoginSubmit(event)" class="space-y-3.5">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">Username</label>
          <input id="loginUsernameInput" type="text" required placeholder="Masukkan username akun Anda" class="w-full rounded-xl border border-slate-300 p-3 text-xs font-bold bg-slate-50" />
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">Password</label>
          <input id="loginPasswordInput" type="password" required placeholder="Masukkan password" class="w-full rounded-xl border border-slate-300 p-3 text-xs font-bold bg-slate-50" />
        </div>

        <button type="submit" class="w-full py-3.5 rounded-xl bg-teal-700 text-white text-xs font-extrabold shadow-lg active:scale-98">
          Masuk ke Sistem →
        </button>
      </form>
    </div>
  </div>`;
}

/* ==========================================================================
   MAIN RENDER & INISIALISASI
   ========================================================================== */

function render() {
  const root = document.getElementById('appRoot');
  if (!root) return;

  if (!STATE.user) {
    root.innerHTML = renderLoginScreen() + renderToastHtml();
    return;
  }

  const role = String(STATE.user.role || '').toLowerCase();
  let bodyHtml = '';
  if (STATE.activeTab === 'perbaikan') {
    bodyHtml = renderPerbaikanView();
  } else if (STATE.activeTab === 'analitik') {
    bodyHtml = renderAnalitikView();
  } else if (STATE.activeTab === 'pengaturan' && role === 'manajemen') {
    bodyHtml = renderPengaturanView();
  } else {
    if (role === 'perawat') bodyHtml = renderPerawatMainView();
    else if (role === 'petugas') bodyHtml = renderPetugasMainView();
    else if (role === 'teknisi') bodyHtml = renderTeknisiMainView();
    else bodyHtml = renderManajemenMainView();
  }

  root.innerHTML =
    renderHeader() +
    `<main class="w-full flex-1 overflow-x-hidden">${bodyHtml}</main>` +
    renderBottomNav() +
    renderDetailModal() +
    renderToastHtml();
}

function renderToastHtml() {
  if (!STATE.toastMsg) return '';
  return `
  <div class="fixed bottom-20 left-3 right-3 z-50 flex justify-center pointer-events-none">
    <div class="max-w-sm w-full rounded-xl bg-slate-900/95 text-white px-4 py-3 text-xs font-bold shadow-xl text-center">
      ${escapeHtml(STATE.toastMsg)}
    </div>
  </div>`;
}

window.addEventListener('online', () => {
  STATE.online = true;
  syncAllData(true);
});

window.addEventListener('offline', () => {
  STATE.online = false;
  render();
});

(function initApp() {
  render();
  syncAllData(true);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=6.5').catch(() => {});
  }

  // Supabase Realtime untuk update instan lintas HP
  realtimeChannel = sb
    .channel('cek-kamar-v65-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_inspections' }, () => {
      if (STATE.user) syncAllData(true);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'master_units' }, () => {
      if (STATE.user) syncAllData(true);
    })
    .subscribe();

  syncInterval = setInterval(() => {
    if (STATE.user && navigator.onLine) syncAllData(true);
  }, 15000);

  // Pengulangan notifikasi & suara pengingat setiap 25 detik sampai petugas/teknisi merespons
  alarmLoopInterval = setInterval(() => {
    if (STATE.user) runAlarmReminderCycle(false);
  }, 25000);
})();
