/* ==========================================================================
   CEK KESIAPAN KAMAR v6.5 — RS KHUSUS BEDAH SS MEDIKA
   - Layar HP Presisi Anti Geser Kiri-Kanan
   - Alur Petugas tanpa tab Cek Kamar (Form muncul dari Permintaan Perawat)
   - 4 Mode Approval: off | perawat | manajemen | all
   - Tombol Siapkan Kamar terkunci otomatis sampai Pasien Pulang
   - Role Baru: Teknisi (Otomatis dapat tugas saat Perawat minta siapkan/bersihkan)
   - Notifikasi Latar Belakang & Pengingat Suara Berulang (Kamar + Lantai)
   - Rekap PDF & Excel (CSV) dengan Okupansi Kamar & Kedisiplinan Tiap Petugas
   ========================================================================== */

const APP_VERSION = 'v6.5';
const SUPABASE_URL = 'https://komdvmccltnyzofmoxsr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvbWR2bWNjbHRueXpvZm1veHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MzU2MjgsImV4cCI6MjA4OTUxMTYyOH0.w42014c_1P8J732fS4k_L7L5fS7S5s_L7L5fS7S5s_w';

// Ambil konfigurasi tersimpan bila user sebelumnya memakai kredensial lokal
const savedSbUrl = localStorage.getItem('ss_sb_url') || SUPABASE_URL;
const savedSbKey = localStorage.getItem('ss_sb_key') || SUPABASE_ANON_KEY;

let sb = null;
try {
  if (window.supabase && savedSbUrl && savedSbKey) {
    sb = window.supabase.createClient(savedSbUrl, savedSbKey);
  }
} catch (e) {
  console.warn('Supabase init fallback:', e);
}

const DEFAULT_UNITS = [
  { unit_code: 'KMR-201', unit_name: 'Kamar 201 - SVIP', floor: 'Lantai 2', room_type: 'SVIP' },
  { unit_code: 'KMR-202', unit_name: 'Kamar 202 - VIP', floor: 'Lantai 2', room_type: 'VIP' },
  { unit_code: 'KMR-203', unit_name: 'Kamar 203 - Kelas 1', floor: 'Lantai 2', room_type: 'Kelas 1' },
  { unit_code: 'KMR-205', unit_name: 'Kamar 205 - SVIP', floor: 'Lantai 2', room_type: 'SVIP' },
  { unit_code: 'KMR-207', unit_name: 'Kamar 207 - Kelas 1', floor: 'Lantai 2', room_type: 'Kelas 1' }
];

const DEFAULT_ITEMS = [
  { id: 'itm-1', category: 'Kebersihan Umum', item_name: 'Lantai disapu, dipel bersih & kering tanpa bau' },
  { id: 'itm-2', category: 'Tempat Tidur', item_name: 'Bed pasien rapi, sprei & sarung bantal baru bersih' },
  { id: 'itm-3', category: 'Kamar Mandi', item_name: 'Toilet, wastafel & lantai kamar mandi bersih kesat' },
  { id: 'itm-4', category: 'Fasilitas Medis', item_name: 'Oksigen dinding, suction & nurse call berfungsi' },
  { id: 'itm-5', category: 'Elektronik & AC', item_name: 'AC dingin normal, TV & lampu menyala baik' },
  { id: 'itm-6', category: 'Perlengkapan Pasien', item_name: 'Tisu, sabun, handuk & tempat sampah siap' }
];

const TEKNISI_ITEMS = [
  { id: 'tek-1', category: 'Tata Udara', item_name: 'AC berfungsi baik, suhu dingin stabil & tidak bocor' },
  { id: 'tek-2', category: 'Hiburan', item_name: 'TV menyala jernih, saluran normal & remote berfungsi' },
  { id: 'tek-3', category: 'Kelistrikan', item_name: 'Lampu kamar, lampu baca & stopkontak berfungsi normal' },
  { id: 'tek-4', category: 'Sanitasi & Air', item_name: 'Keran air panas/dingin, shower & flush closet normal' },
  { id: 'tek-5', category: 'Sistem Panggil', item_name: 'Bel perawat (Nurse Call) & telepon kamar berfungsi' }
];

const DEFAULT_USERS = [
  { id: 'u-1', name: 'Manajemen', role: 'manajemen', pin: '1234', active: true },
  { id: 'u-2', name: 'Azis Munandar', role: 'petugas', pin: '1111', active: true },
  { id: 'u-3', name: 'Tim Perawat', role: 'perawat', pin: '2222', active: true },
  { id: 'u-4', name: 'St Nining', role: 'perawat', pin: '2222', active: true },
  { id: 'u-5', name: 'Tim Teknisi', role: 'teknisi', pin: '3333', active: true }
];

const STATE = {
  user: JSON.parse(localStorage.getItem('ss_current_user') || 'null'),
  online: navigator.onLine,
  loading: false,
  activeTab: 'main', // main | perbaikan | analitik | pengaturan
  approvalMode: localStorage.getItem('ss_approval_mode') || 'manajemen', // off | perawat | manajemen | all
  units: [],
  items: [],
  users: [],
  inspections: [],
  // State form petugas
  petugasFormOpen: false,
  petugasFormUnit: '',
  petugasFormOriginReqId: null,
  petugasChecklist: {},
  petugasNotes: '',
  petugasPhotoData: '',
  petugasStartTime: null,
  petugasElapsedSec: 0,
  // State form manajemen manual
  mgmtFormUnit: '',
  mgmtChecklist: {},
  mgmtNotes: '',
  mgmtPhotoData: '',
  mgmtStartTime: null,
  mgmtElapsedSec: 0,
  // State form teknisi
  teknisiFormOpen: false,
  teknisiFormUnit: '',
  teknisiFormOriginReqId: null,
  teknisiChecklist: {},
  teknisiNotes: '',
  teknisiPhotoData: '',
  teknisiStartTime: null,
  // State perbaikan
  repairUnit: '',
  repairCategory: 'Teknisi (AC / TV / Listrik / Air)',
  repairDesc: '',
  repairPhoto: '',
  // State analitik & rekap
  filterPeriod: 'hari', // hari | minggu | bulan | tahun | semua
  filterDate: new Date().toISOString().slice(0, 10),
  filterMonth: new Date().toISOString().slice(0, 7),
  filterYear: String(new Date().getFullYear()),
  // Alarm & notifikasi
  soundEnabled: localStorage.getItem('ss_sound_enabled') !== 'false',
  mutedAlarmKeys: JSON.parse(sessionStorage.getItem('ss_muted_alarms') || '[]'),
  lastSpokenAt: 0,
  selectedDetailReport: null,
  toastMsg: ''
};

let timerInterval = null;
let alarmLoopInterval = null;
let syncInterval = null;

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

function getUnitInfo(unitCodeOrName) {
  const found = STATE.units.find(
    (u) => u.unit_code === unitCodeOrName || u.unit_name === unitCodeOrName
  );
  if (found) return found;
  return {
    unit_code: unitCodeOrName || 'KMR',
    unit_name: unitCodeOrName || 'Unit Kamar',
    floor: 'Lantai 2',
    room_type: 'Rawat Inap'
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

/* ==========================================================================
   SUARA NOTIFIKASI & BACKGROUND NOTIFICATION
   ========================================================================== */

function speakIndonesian(text) {
  if (!STATE.soundEnabled) return;
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
  } catch (e) {
    console.warn('TTS error:', e);
  }
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
  } catch (e) {
    console.warn('Notification error:', e);
  }
}

function getActiveAlarmsForCurrentUser() {
  if (!STATE.user) return [];
  const role = STATE.user.role;
  const alarms = [];

  if (role === 'petugas') {
    const reqs = getOpenNurseRequestsForPetugas();
    reqs.forEach((r) => {
      const unit = getUnitInfo(r.unit_code);
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
        body: `${unit.floor} • Diminta oleh ${r.inspector_name || 'Tim Perawat'} (${formatTimeShort(r.created_at)})`,
        speech
      });
    });

    const revisions = getRevisionReportsForPetugas();
    revisions.forEach((r) => {
      const unit = getUnitInfo(r.unit_code);
      const { num, floor } = extractRoomNumberSpeech(unit);
      alarms.push({
        key: `revisi-${r.id}`,
        title: `Perlu Perbaikan Ulang — ${unit.unit_name}`,
        body: `${unit.floor} • Komplain dari ${r.approved_by || 'Pemeriksa'}`,
        speech: `Perhatian petugas, kamar nomor ${num}, ${floor}, perlu dicek dan diperbaiki kembali.`
      });
    });
  }

  if (role === 'teknisi') {
    const tekTasks = getOpenTasksForTeknisi();
    tekTasks.forEach((t) => {
      const unit = getUnitInfo(t.unit_code);
      const { num, floor } = extractRoomNumberSpeech(unit);
      alarms.push({
        key: `teknisi-${t.id}`,
        title: `Tugas Teknisi — ${unit.unit_name}`,
        body: `${unit.floor} • Cek AC, TV, Listrik & Air (${formatTimeShort(t.created_at)})`,
        speech: `Perhatian teknisi, harap periksa AC, TV, dan fasilitas kamar nomor ${num}, ${floor}.`
      });
    });
  }

  if (role === 'perawat' || role === 'manajemen') {
    const pending = getPendingApprovalsForRole(role);
    pending.forEach((p) => {
      const unit = getUnitInfo(p.unit_code);
      const { num, floor } = extractRoomNumberSpeech(unit);
      alarms.push({
        key: `approve-${role}-${p.id}`,
        title: `Menunggu Approval — ${unit.unit_name}`,
        body: `${unit.floor} • Selesai disiapkan oleh ${p.staff_name}`,
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
   SINKRONISASI DATA SUPABASE & LOCAL FALLBACK
   ========================================================================== */

function loadLocalCache() {
  try {
    const u = JSON.parse(localStorage.getItem('ss_cache_units') || 'null');
    const i = JSON.parse(localStorage.getItem('ss_cache_items') || 'null');
    const usr = JSON.parse(localStorage.getItem('ss_cache_users') || 'null');
    const ins = JSON.parse(localStorage.getItem('ss_cache_inspections') || 'null');
    STATE.units = Array.isArray(u) && u.length ? u : [...DEFAULT_UNITS];
    STATE.items = Array.isArray(i) && i.length ? i : [...DEFAULT_ITEMS];
    STATE.users = Array.isArray(usr) && usr.length ? usr : [...DEFAULT_USERS];
    STATE.inspections = Array.isArray(ins) ? ins : [];
  } catch (e) {
    STATE.units = [...DEFAULT_UNITS];
    STATE.items = [...DEFAULT_ITEMS];
    STATE.users = [...DEFAULT_USERS];
    STATE.inspections = [];
  }
}

function saveLocalCache() {
  try {
    localStorage.setItem('ss_cache_units', JSON.stringify(STATE.units));
    localStorage.setItem('ss_cache_items', JSON.stringify(STATE.items));
    localStorage.setItem('ss_cache_users', JSON.stringify(STATE.users));
    localStorage.setItem('ss_cache_inspections', JSON.stringify(STATE.inspections));
  } catch (e) {
    console.warn('Cache save warning:', e);
  }
}

async function syncAllData(silent = false) {
  if (!silent) {
    STATE.loading = true;
    render();
  }

  if (sb && navigator.onLine) {
    try {
      const [uRes, iRes, usrRes, insRes] = await Promise.all([
        sb.from('master_units').select('*').order('unit_code', { ascending: true }),
        sb.from('master_items').select('*').order('id', { ascending: true }),
        sb.from('app_users').select('*').order('name', { ascending: true }),
        sb.from('room_inspections').select('*').order('created_at', { ascending: false }).limit(600)
      ]);

      if (!uRes.error && Array.isArray(uRes.data) && uRes.data.length) {
        STATE.units = uRes.data;
      }
      if (!iRes.error && Array.isArray(iRes.data) && iRes.data.length) {
        STATE.items = iRes.data;
      }
      if (!usrRes.error && Array.isArray(usrRes.data) && usrRes.data.length) {
        STATE.users = usrRes.data;
      }
      if (!insRes.error && Array.isArray(insRes.data)) {
        STATE.inspections = insRes.data;
      }
      saveLocalCache();
    } catch (e) {
      console.warn('Sync Supabase error, menggunakan data lokal:', e);
    }
  }

  STATE.loading = false;
  render();
  runAlarmReminderCycle(false);
}

async function insertInspectionRecord(record) {
  const newRec = {
    id: record.id || `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: record.created_at || new Date().toISOString(),
    ...record
  };

  // Simpan langsung ke state & localStorage agar respons instan di HP
  STATE.inspections.unshift(newRec);
  saveLocalCache();

  if (sb && navigator.onLine) {
    try {
      const payload = { ...newRec };
      if (String(payload.id).startsWith('loc-')) delete payload.id;
      const { data, error } = await sb.from('room_inspections').insert([payload]).select();
      if (!error && data && data[0]) {
        const idx = STATE.inspections.findIndex((x) => x.id === newRec.id);
        if (idx !== -1) STATE.inspections[idx] = data[0];
        saveLocalCache();
      }
    } catch (e) {
      console.warn('Insert Supabase fallback lokal:', e);
    }
  }
  return newRec;
}

async function updateInspectionRecord(id, patch) {
  const idx = STATE.inspections.findIndex((x) => String(x.id) === String(id));
  if (idx !== -1) {
    STATE.inspections[idx] = { ...STATE.inspections[idx], ...patch };
    saveLocalCache();
  }

  if (sb && navigator.onLine && !String(id).startsWith('loc-')) {
    try {
      await sb.from('room_inspections').update(patch).eq('id', id);
    } catch (e) {
      console.warn('Update Supabase fallback lokal:', e);
    }
  }
}

/* ==========================================================================
   LOGIKA STATUS KAMAR, PERMINTAAN PERAWAT, TEKNISI & APPROVAL
   ========================================================================== */

function isNurseQuickRequest(rec) {
  const shiftStr = String(rec.shift || '');
  const statusStr = String(rec.status || '').toUpperCase();
  return (
    statusStr === 'PERMINTAAN_PERAWAT' ||
    shiftStr.startsWith('Siapkan Kamar') ||
    shiftStr.startsWith('Tambahan Extrabed') ||
    shiftStr.startsWith('Minta Dibersihkan') ||
    shiftStr.startsWith('Pasien Pulang')
  );
}

function isTeknisiTaskRecord(rec) {
  const statusStr = String(rec.status || '').toUpperCase();
  const shiftStr = String(rec.shift || '');
  return (
    statusStr === 'TUGAS_TEKNISI' ||
    statusStr === 'SELESAI_TEKNISI' ||
    shiftStr.startsWith('Tugas Teknisi') ||
    shiftStr.startsWith('Cek Teknisi')
  );
}

function parseNurseActionType(rec) {
  const s = String(rec.shift || '');
  if (s.includes('Siapkan Kamar')) return 'Siapkan Kamar';
  if (s.includes('Tambahan Extrabed')) return 'Tambah Extrabed';
  if (s.includes('Minta Dibersihkan')) return 'Minta Dibersihkan';
  if (s.includes('Pasien Pulang')) return 'Pasien Pulang';
  return 'Permintaan Perawat';
}

function getOpenNurseRequestsForPetugas() {
  return STATE.inspections.filter((r) => {
    if (!isNurseQuickRequest(r)) return false;
    const st = String(r.status || '').toUpperCase();
    // Jika belum ditandai selesai oleh petugas
    return st !== 'SELESAI_PERMINTAAN' && st !== 'SIAP PAKAI';
  });
}

function getRevisionReportsForPetugas() {
  return STATE.inspections.filter((r) => {
    const st = String(r.status || '').toUpperCase();
    return st === 'PERLU PERBAIKAN' || st === 'REVISI';
  });
}

function getOpenTasksForTeknisi() {
  return STATE.inspections.filter((r) => {
    const st = String(r.status || '').toUpperCase();
    return st === 'TUGAS_TEKNISI';
  });
}

function getPendingApprovalsForRole(role) {
  const mode = STATE.approvalMode;
  if (mode === 'off') return [];
  if (mode === 'perawat' && role !== 'perawat') return [];
  if (mode === 'manajemen' && role !== 'manajemen') return [];

  return STATE.inspections.filter((r) => {
    const st = String(r.status || '').toUpperCase();
    return st === 'MENUNGGU APPROVAL';
  });
}

function getInfoReportsForRole(role) {
  // Laporan selesai terbaru untuk dipantau oleh Perawat/Manajemen walau bukan approver
  return STATE.inspections
    .filter((r) => {
      if (isNurseQuickRequest(r)) return false;
      const st = String(r.status || '').toUpperCase();
      return st === 'SIAP PAKAI' || st === 'MENUNGGU APPROVAL' || st === 'SELESAI_TEKNISI';
    })
    .slice(0, 8);
}

function getUnitCurrentState(unitCode) {
  const unitLogs = STATE.inspections.filter((r) => r.unit_code === unitCode);

  // Cek apakah tombol "Siapkan Kamar" sedang terkunci (sudah dipencet dan belum ada "Pasien Pulang" setelahnya)
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

  // Tentukan badge status kamar terkini
  const latestMain = unitLogs.find((r) => !isTeknisiTaskRecord(r));
  let badge = 'KOSONG';
  let badgeColor = 'bg-slate-100 text-slate-600';
  let subText = 'Belum dicek (Kosong)';

  if (latestMain) {
    const st = String(latestMain.status || '').toUpperCase();
    if (isNurseQuickRequest(latestMain) && st !== 'SELESAI_PERMINTAAN') {
      const act = parseNurseActionType(latestMain);
      badge = 'PERMINTAAN PERAWAT';
      badgeColor = 'bg-amber-100 text-amber-800';
      subText = `${act}: ${latestMain.inspector_name || 'Tim Perawat'} (${formatTimeShort(latestMain.created_at)})`;
    } else if (st === 'MENUNGGU APPROVAL') {
      badge = 'MENUNGGU APPROVAL';
      badgeColor = 'bg-blue-100 text-blue-800';
      subText = `Dicek oleh: ${latestMain.staff_name || '-'}`;
    } else if (st === 'PERLU PERBAIKAN' || st === 'REVISI') {
      badge = 'PERLU REVISI';
      badgeColor = 'bg-rose-100 text-rose-700';
      subText = `Catatan: ${latestMain.notes || 'Perlu dicek ulang'}`;
    } else if (st === 'SIAP PAKAI') {
      badge = siapkanLocked ? 'SIAP PAKAI • TERISI' : 'SIAP PAKAI';
      badgeColor = 'bg-emerald-100 text-emerald-800';
      subText = `Ditangani: ${latestMain.staff_name || '-'}`;
    } else if (parseNurseActionType(latestMain) === 'Pasien Pulang') {
      badge = 'KOSONG / KOTOR';
      badgeColor = 'bg-orange-100 text-orange-800';
      subText = `Pasien pulang (${formatTimeShort(latestMain.created_at)})`;
    }
  }

  return { siapkanLocked, badge, badgeColor, subText };
}

/* ==========================================================================
   AKSI PERAWAT (4 TOMBOL CEPAT + PEMICU OTOMATIS TEKNISI)
   ========================================================================== */

async function handleNurseQuickAction(unitCode, actionType) {
  const unit = getUnitInfo(unitCode);
  const { siapkanLocked } = getUnitCurrentState(unitCode);

  if (actionType === 'Siapkan Kamar' && siapkanLocked) {
    showToast('Kamar sudah dipesan/disiapkan. Tombol aktif kembali setelah Pasien Pulang.');
    return;
  }

  const now = new Date();
  const timeStr = formatTimeShort(now.toISOString());
  const { num, floor } = extractRoomNumberSpeech(unit);
  const nurseName = STATE.user?.name || 'Tim Perawat';

  let noteDetail = `Tolong siapkan kamar nomor ${num} (${floor}) untuk pasien baru.`;
  if (actionType === 'Tambah Extrabed') {
    noteDetail = `Tolong tambahkan extrabed di kamar nomor ${num} (${floor}).`;
  } else if (actionType === 'Minta Dibersihkan') {
    noteDetail = `Ruangan kamar nomor ${num} (${floor}) minta dibersihkan.`;
  } else if (actionType === 'Pasien Pulang') {
    noteDetail = `Pasien kamar nomor ${num} (${floor}) sudah pulang, tolong dibersihkan.`;
  }

  // 1. Kirim permintaan ke Petugas Kebersihan
  await insertInspectionRecord({
    unit_code: unit.unit_code,
    unit_name: unit.unit_name,
    inspector_name: nurseName,
    staff_name: nurseName,
    shift: `${actionType} • ${timeStr} WIB`,
    score: 0,
    status: 'PERMINTAAN_PERAWAT',
    notes: `${actionType} (Dilaporkan oleh ${nurseName}) • Keterangan: ${noteDetail}`,
    checklist_data: [],
    duration_seconds: 0
  });

  // 2. Jika Perawat meminta Siapkan Kamar atau Minta Dibersihkan -> Otomatis kirim tugas pengecekan ke Teknisi
  if (actionType === 'Siapkan Kamar' || actionType === 'Minta Dibersihkan') {
    await insertInspectionRecord({
      unit_code: unit.unit_code,
      unit_name: unit.unit_name,
      inspector_name: nurseName,
      staff_name: 'Tim Teknisi',
      shift: `Tugas Teknisi • ${timeStr} WIB`,
      score: 0,
      status: 'TUGAS_TEKNISI',
      notes: `Pengecekan otomatis (${actionType} oleh ${nurseName}): Cek AC, TV & Remote, Lampu, Stopkontak, Air & Nurse Call di ${unit.unit_name} (${floor}).`,
      checklist_data: [],
      duration_seconds: 0
    });
  }

  speakIndonesian(`Permintaan ${actionType} untuk kamar nomor ${num}, ${floor}, telah dikirim.`);
  showToast(`${actionType} untuk ${unit.unit_name} (${floor}) terkirim!`);
  render();
}

/* ==========================================================================
   AKSI PETUGAS KEBERSIHAN (CEK & SIAPKAN KAMAR -> CHECKLIST -> APPROVAL)
   ========================================================================== */

function openPetugasChecklistForm(unitCode, originReqId = null) {
  STATE.petugasFormOpen = true;
  STATE.petugasFormUnit = unitCode;
  STATE.petugasFormOriginReqId = originReqId;
  STATE.petugasChecklist = {};
  STATE.items.forEach((it) => {
    STATE.petugasChecklist[it.id] = false;
  });
  STATE.petugasNotes = '';
  STATE.petugasPhotoData = '';
  STATE.petugasStartTime = Date.now();
  STATE.petugasElapsedSec = 0;

  // Matikan pengingat suara untuk item yang sedang dibuka petugas
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
  STATE.petugasFormUnit = '';
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
  const unit = getUnitInfo(STATE.petugasFormUnit);
  const score = calcChecklistScore(STATE.petugasChecklist, STATE.items);

  if (score < 100) {
    showToast('Harap centang seluruh item kesiapan kamar hingga 100% sebelum mengirim.');
    return;
  }

  const staffName = STATE.user?.name || 'Petugas';
  const mode = STATE.approvalMode;
  const finalStatus = mode === 'off' ? 'SIAP PAKAI' : 'MENUNGGU APPROVAL';
  const approverTarget =
    mode === 'off'
      ? 'Auto-Approve (Sistem)'
      : mode === 'perawat'
      ? 'Tim Perawat'
      : mode === 'manajemen'
      ? 'Manajemen'
      : 'Perawat & Manajemen';

  const checklistPayload = STATE.items.map((it) => ({
    id: it.id,
    category: it.category,
    item_name: it.item_name,
    checked: !!STATE.petugasChecklist[it.id]
  }));

  const duration = STATE.petugasStartTime
    ? Math.max(5, Math.round((Date.now() - STATE.petugasStartTime) / 1000))
    : 30;

  await insertInspectionRecord({
    unit_code: unit.unit_code,
    unit_name: unit.unit_name,
    inspector_name: approverTarget,
    staff_name: staffName,
    shift: `Pengecekan Kamar • ${formatTimeShort(new Date().toISOString())} WIB`,
    score,
    status: finalStatus,
    notes: STATE.petugasNotes || 'Kamar telah dibersihkan dan disiapkan lengkap sesuai standar.',
    photo_url: STATE.petugasPhotoData || '',
    checklist_data: checklistPayload,
    duration_seconds: duration
  });

  // Tandai permintaan asal / revisi asal sebagai selesai agar hilang dari antrean petugas
  if (STATE.petugasFormOriginReqId) {
    await updateInspectionRecord(STATE.petugasFormOriginReqId, {
      status: 'SELESAI_PERMINTAAN'
    });
  } else {
    // Tutup permintaan perawat yang terbuka untuk unit ini
    const openReqs = getOpenNurseRequestsForPetugas().filter((r) => r.unit_code === unit.unit_code);
    for (const r of openReqs) {
      await updateInspectionRecord(r.id, { status: 'SELESAI_PERMINTAAN' });
    }
  }

  closePetugasChecklistForm();
  showToast(
    finalStatus === 'SIAP PAKAI'
      ? `${unit.unit_name} langsung berstatus SIAP PAKAI!`
      : `Laporan ${unit.unit_name} terkirim ke ${approverTarget} untuk di-Approve.`
  );
}

/* ==========================================================================
   AKSI TEKNISI (CHECKLIST AC, TV, LISTRIK, AIR, NURSE CALL)
   ========================================================================== */

function openTeknisiForm(unitCode, originReqId = null) {
  STATE.teknisiFormOpen = true;
  STATE.teknisiFormUnit = unitCode;
  STATE.teknisiFormOriginReqId = originReqId;
  STATE.teknisiChecklist = {};
  TEKNISI_ITEMS.forEach((it) => {
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
  STATE.teknisiFormUnit = '';
  STATE.teknisiFormOriginReqId = null;
  render();
}

async function submitTeknisiChecklist() {
  const unit = getUnitInfo(STATE.teknisiFormUnit);
  const score = calcChecklistScore(STATE.teknisiChecklist, TEKNISI_ITEMS);
  if (score < 100) {
    showToast('Centang semua pengecekan teknis (AC, TV, Listrik, Air, Bel) hingga 100%.');
    return;
  }

  const tekName = STATE.user?.name || 'Tim Teknisi';
  const duration = STATE.teknisiStartTime
    ? Math.max(5, Math.round((Date.now() - STATE.teknisiStartTime) / 1000))
    : 30;

  const checklistPayload = TEKNISI_ITEMS.map((it) => ({
    id: it.id,
    category: it.category,
    item_name: it.item_name,
    checked: !!STATE.teknisiChecklist[it.id]
  }));

  await insertInspectionRecord({
    unit_code: unit.unit_code,
    unit_name: unit.unit_name,
    inspector_name: 'Teknisi Lapangan',
    staff_name: tekName,
    shift: `Cek Teknisi • ${formatTimeShort(new Date().toISOString())} WIB`,
    score,
    status: 'SELESAI_TEKNISI',
    notes: STATE.teknisiNotes || 'AC, TV, kelistrikan, sanitasi & nurse call dalam kondisi baik.',
    photo_url: STATE.teknisiPhotoData || '',
    checklist_data: checklistPayload,
    duration_seconds: duration
  });

  if (STATE.teknisiFormOriginReqId) {
    await updateInspectionRecord(STATE.teknisiFormOriginReqId, {
      status: 'SELESAI_TEKNISI'
    });
  }

  closeTeknisiForm();
  showToast(`Pengecekan teknis ${unit.unit_name} selesai disimpan.`);
}

/* ==========================================================================
   AKSI APPROVAL & KOMPLAIN (PERAWAT & MANAJEMEN)
   ========================================================================== */

async function handleApproveInspection(reportId) {
  const approverName = STATE.user?.name || 'Pemeriksa';
  const roleLabel = STATE.user?.role === 'perawat' ? 'Perawat' : 'Manajemen';
  await updateInspectionRecord(reportId, {
    status: 'SIAP PAKAI',
    approved_by: `${approverName} (${roleLabel})`,
    approved_at: new Date().toISOString()
  });
  showToast('Kamar berhasil di-Approve menjadi SIAP PAKAI.');
  render();
}

async function handleRejectInspection(reportId) {
  const reason = prompt('Masukkan catatan bagian mana yang perlu diperbaiki petugas:');
  if (reason === null) return;
  const approverName = STATE.user?.name || 'Pemeriksa';
  await updateInspectionRecord(reportId, {
    status: 'PERLU PERBAIKAN',
    approved_by: approverName,
    notes: `Revisi dari ${approverName}: ${reason || 'Mohon cek ulang kebersihan & kelengkapan kamar.'}`
  });
  showToast('Laporan dikembalikan ke Petugas untuk diperbaiki.');
  render();
}

/* ==========================================================================
   PERHITUNGAN REKAP OKUPANSI KAMAR & KEDISIPLINAN TIAP PETUGAS (PDF & EXCEL)
   ========================================================================== */

function getFilteredInspectionsForAnalytics() {
  const now = new Date();
  return STATE.inspections.filter((r) => {
    const d = new Date(r.created_at);
    if (isNaN(d.getTime())) return true;

    if (STATE.filterPeriod === 'hari') {
      return d.toISOString().slice(0, 10) === STATE.filterDate;
    }
    if (STATE.filterPeriod === 'minggu') {
      const target = new Date(STATE.filterDate + 'T00:00:00');
      const dayOfWeek = target.getDay(); // 0 = Minggu
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
      return d.toISOString().slice(0, 7) === STATE.filterMonth;
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

  // Hitung kamar terpakai dalam periode terpilih (berdasarkan aktivitas Siapkan Kamar / Siap Pakai)
  const usedRoomSet = new Set();
  rows.forEach((r) => {
    const st = String(r.status || '').toUpperCase();
    const act = parseNurseActionType(r);
    if (act === 'Siapkan Kamar' || st === 'SIAP PAKAI' || st === 'MENUNGGU APPROVAL') {
      if (r.unit_code) usedRoomSet.add(r.unit_code);
    }
  });

  const usedRoomsCount = usedRoomSet.size;
  const unusedRoomsCount = Math.max(0, totalRooms - usedRoomsCount);
  const occupancyPct = Math.round((usedRoomsCount / totalRooms) * 100);

  // Pisahkan laporan checklist asli (Petugas & Teknisi) dari log tombol cepat Perawat
  const workReports = rows.filter((r) => !isNurseQuickRequest(r));
  const avgScore = workReports.length
    ? Math.round(workReports.reduce((acc, r) => acc + (Number(r.score) || 0), 0) / workReports.length)
    : 0;

  // Hitung kedisiplinan tiap petugas & teknisi
  const staffMap = {};
  workReports.forEach((r) => {
    const name = r.staff_name || 'Petugas';
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
    const st = String(r.status || '').toUpperCase();
    if (st === 'PERLU PERBAIKAN' || st === 'REVISI') {
      staffMap[name].revisionTasks += 1;
    } else if ((Number(r.score) || 0) >= 100) {
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
  lines.push(['No', 'Waktu', 'Unit Kamar', 'Lantai', 'Pemeriksa', 'Pelaksana', 'Keterangan Aktivitas', 'Skor', 'Status', 'Catatan']);

  summary.rows.forEach((r, idx) => {
    const unit = getUnitInfo(r.unit_code);
    lines.push([
      idx + 1,
      formatDateTimeID(r.created_at),
      unit.unit_name,
      unit.floor,
      r.inspector_name || '-',
      r.staff_name || '-',
      r.shift || '-',
      `${r.score || 0}%`,
      r.status || '-',
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
      const unit = getUnitInfo(r.unit_code);
      return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(formatDateTimeID(r.created_at))}</td>
        <td><strong>${escapeHtml(unit.unit_name)}</strong><br><small>${escapeHtml(unit.floor)}</small></td>
        <td>${escapeHtml(r.inspector_name || '-')}</td>
        <td>${escapeHtml(r.staff_name || '-')}</td>
        <td>${escapeHtml(r.shift || '-')}</td>
        <td style="text-align:center;">${r.score || 0}%</td>
        <td><strong>${escapeHtml(r.status || '-')}</strong></td>
        <td>${escapeHtml(r.notes || '-')}</td>
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
        <th>Pemeriksa</th>
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
   HANDLER FOTO & LOGIN / LOGOUT
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

function handleLoginSubmit(e) {
  e.preventDefault();
  const selId = document.getElementById('loginUserSelect')?.value;
  const pinVal = document.getElementById('loginPinInput')?.value || '';
  const found = STATE.users.find((u) => String(u.id) === String(selId));
  if (!found) {
    showToast('Pilih akun terlebih dahulu.');
    return;
  }
  if (found.pin && String(found.pin) !== String(pinVal)) {
    showToast('PIN salah. Silakan coba kembali.');
    return;
  }

  STATE.user = found;
  STATE.activeTab = 'main';
  STATE.petugasFormOpen = false;
  STATE.teknisiFormOpen = false;
  localStorage.setItem('ss_current_user', JSON.stringify(found));

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  speakIndonesian(`Selamat bertugas, ${found.name}.`);
  render();
  setTimeout(() => runAlarmReminderCycle(true), 1200);
}

function handleLogout() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  STATE.user = null;
  STATE.petugasFormOpen = false;
  STATE.teknisiFormOpen = false;
  localStorage.removeItem('ss_current_user');
  render();
}

/* ==========================================================================
   RENDER KOMPONEN UI (PRESISI ANTI GESER KIRI-KANAN)
   ========================================================================== */

function renderHeader() {
  const roleBadgeColor =
    STATE.user.role === 'manajemen'
      ? 'bg-purple-100 text-purple-800'
      : STATE.user.role === 'perawat'
      ? 'bg-amber-100 text-amber-800'
      : STATE.user.role === 'teknisi'
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
            <span class="px-1.5 py-0.5 text-[9px] font-extrabold uppercase rounded ${roleBadgeColor} shrink-0">${escapeHtml(STATE.user.role)}</span>
            <p class="text-[11px] font-medium text-slate-600 truncate">Halo, ${escapeHtml(STATE.user.name)}</p>
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
  localStorage.setItem('ss_sound_enabled', String(STATE.soundEnabled));
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
   TAMPILAN KHUSUS PERAWAT (4 TOMBOL CEPAT + PENGUNCIAN SIAPKAN KAMAR + APPROVAL)
   ========================================================================== */

function renderPerawatMainView() {
  const pendingApprovals = getPendingApprovalsForRole('perawat');
  const infoReports = getInfoReportsForRole('perawat');

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
                const u = getUnitInfo(rep.unit_code);
                return `
                <div class="w-full rounded-xl bg-white border border-blue-200 p-3 space-y-2 shadow-sm">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
                      <p class="text-[11px] text-slate-500">${escapeHtml(u.floor)} • Petugas: <strong>${escapeHtml(rep.staff_name)}</strong> (${formatTimeShort(rep.created_at)})</p>
                    </div>
                    <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold shrink-0">Skor ${rep.score}%</span>
                  </div>
                  <p class="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2 break-words">${escapeHtml(rep.notes || '-')}</p>
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
      <h3 class="text-sm font-extrabold text-slate-900 mb-2">Status Unit Kamar</h3>
      <div class="space-y-3">
        ${STATE.units
          .map((u) => {
            const st = getUnitCurrentState(u.unit_code);
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
                  onclick="handleNurseQuickAction('${escapeHtml(u.unit_code)}', 'Siapkan Kamar')"
                  ${st.siapkanLocked ? 'disabled' : ''}
                  class="py-2.5 px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
                    st.siapkanLocked
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-sky-600 text-white shadow-sm active:scale-95'
                  }">
                  <span>${st.siapkanLocked ? '🔒 Sudah Dipesan' : '🛏️ Siapkan Kamar'}</span>
                </button>

                <button
                  onclick="handleNurseQuickAction('${escapeHtml(u.unit_code)}', 'Tambah Extrabed')"
                  class="py-2.5 px-2.5 rounded-xl bg-purple-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95">
                  <span>➕ Tambah Extrabed</span>
                </button>

                <button
                  onclick="handleNurseQuickAction('${escapeHtml(u.unit_code)}', 'Minta Dibersihkan')"
                  class="py-2.5 px-2.5 rounded-xl bg-amber-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95">
                  <span>🧹 Minta Dibersihkan</span>
                </button>

                <button
                  onclick="handleNurseQuickAction('${escapeHtml(u.unit_code)}', 'Pasien Pulang')"
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
                  const u = getUnitInfo(r.unit_code);
                  return `
                  <div onclick="openReportDetail('${r.id}')" class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 cursor-pointer">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</p>
                      <p class="text-[11px] text-slate-500 truncate">Oleh: ${escapeHtml(r.staff_name)} • ${formatTimeShort(r.created_at)}</p>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                      r.status === 'SIAP PAKAI' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                    }">${escapeHtml(r.status)}</span>
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
   TAMPILAN KHUSUS PETUGAS (TANPA TAB CEK KAMAR — FORM MUNCUL DARI TOMBOL PERMINTAAN)
   ========================================================================== */

function renderPetugasMainView() {
  const openReqs = getOpenNurseRequestsForPetugas();
  const revisions = getRevisionReportsForPetugas();
  const currentScore = calcChecklistScore(STATE.petugasChecklist, STATE.items);

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
                const u = getUnitInfo(rev.unit_code);
                return `
                <div class="w-full rounded-xl bg-white border border-rose-200 p-3 space-y-2">
                  <p class="text-xs font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</p>
                  <p class="text-xs text-rose-700 break-words">${escapeHtml(rev.notes || 'Mohon periksa kembali kamar ini.')}</p>
                  <div class="flex justify-end">
                    <button onclick="openPetugasChecklistForm('${escapeHtml(u.unit_code)}', '${rev.id}')" class="px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-extrabold shadow-sm active:scale-95">
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
                const u = getUnitInfo(req.unit_code);
                const act = parseNurseActionType(req);
                return `
                <div class="w-full rounded-xl bg-white border border-amber-200 p-3.5 shadow-sm space-y-2.5">
                  <div>
                    <p class="text-sm font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
                    <p class="text-[11px] font-semibold text-slate-500">${escapeHtml(u.floor)} • ${escapeHtml(u.room_type || 'Rawat Inap')}</p>
                    <p class="text-xs font-bold text-amber-700 mt-1">
                      ${escapeHtml(act)}: ${escapeHtml(req.inspector_name || 'Tim Perawat')} (${formatTimeShort(req.created_at)})
                    </p>
                  </div>
                  <div class="flex justify-end">
                    <button
                      onclick="openPetugasChecklistForm('${escapeHtml(u.unit_code)}', '${req.id}')"
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
        ? renderPetugasChecklistBox(currentScore)
        : ''
    }
  </div>`;
}

function renderPetugasChecklistBox(currentScore) {
  const unit = getUnitInfo(STATE.petugasFormUnit);
  return `
  <div id="petugasChecklistSection" class="w-full rounded-2xl bg-white border-2 border-teal-600 p-4 shadow-md space-y-3.5">
    <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
      <div class="min-w-0 flex-1">
        <span class="px-2 py-0.5 rounded bg-teal-50 text-teal-800 text-[10px] font-extrabold uppercase">Form Cek Kesiapan Kamar</span>
        <h3 class="text-base font-extrabold text-slate-900 mt-1 break-words">${escapeHtml(unit.unit_code)} - ${escapeHtml(unit.unit_name)}</h3>
        <p class="text-xs text-slate-500">${escapeHtml(unit.floor)} • Petugas: <strong>${escapeHtml(STATE.user.name)}</strong></p>
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
      ${STATE.items
        .map((it, idx) => {
          const checked = !!STATE.petugasChecklist[it.id];
          return `
          <label class="w-full flex items-start gap-2.5 p-3 rounded-xl border ${
            checked ? 'bg-teal-50/70 border-teal-400' : 'bg-slate-50 border-slate-200'
          } cursor-pointer">
            <input
              type="checkbox"
              ${checked ? 'checked' : ''}
              onchange="togglePetugasItem('${it.id}')"
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
        placeholder="Contoh: AC sudah dinyalakan suhu 22°C, sprei & handuk baru..."
        class="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:outline-none focus:border-teal-600">${escapeHtml(STATE.petugasNotes)}</textarea>
    </div>

    <div class="space-y-1.5">
      <label class="block text-xs font-bold text-slate-700">Foto Bukti Kesiapan Kamar</label>
      <input type="file" accept="image/*" capture="environment" onchange="handlePhotoUpload(event, 'petugasPhotoData')" class="w-full text-xs text-slate-600" />
      ${
        STATE.petugasPhotoData
          ? `<img src="${STATE.petugasPhotoData}" alt="Preview" class="w-full h-36 object-cover rounded-xl border border-slate-200 mt-1" />`
          : ''
      }
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

function togglePetugasItem(itemId) {
  STATE.petugasChecklist[itemId] = !STATE.petugasChecklist[itemId];
  render();
}

/* ==========================================================================
   TAMPILAN KHUSUS TEKNISI (TUGAS OTOMATIS SAAT PERAWAT MINTA SIAPKAN/BERSIHKAN)
   ========================================================================== */

function renderTeknisiMainView() {
  const tekTasks = getOpenTasksForTeknisi();
  const tekScore = calcChecklistScore(STATE.teknisiChecklist, TEKNISI_ITEMS);
  const recentTekLogs = STATE.inspections.filter((r) => isTeknisiTaskRecord(r) && r.status === 'SELESAI_TEKNISI').slice(0, 6);

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
                const u = getUnitInfo(t.unit_code);
                return `
                <div class="w-full rounded-xl bg-white border border-sky-200 p-3.5 space-y-2 shadow-sm">
                  <div>
                    <p class="text-sm font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
                    <p class="text-[11px] font-bold text-sky-700">${escapeHtml(u.floor)} • Masuk pukul ${formatTimeShort(t.created_at)}</p>
                    <p class="text-xs text-slate-600 mt-1 break-words">${escapeHtml(t.notes || 'Periksa AC, TV, lampu & sanitasi kamar.')}</p>
                  </div>
                  <div class="flex justify-end">
                    <button onclick="openTeknisiForm('${escapeHtml(u.unit_code)}', '${t.id}')" class="px-4 py-2 rounded-xl bg-sky-700 text-white text-xs font-extrabold shadow-sm active:scale-95">
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
            const u = getUnitInfo(STATE.teknisiFormUnit);
            return `
            <div class="w-full rounded-2xl bg-white border-2 border-sky-600 p-4 shadow-md space-y-3">
              <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div class="min-w-0 flex-1">
                  <span class="px-2 py-0.5 rounded bg-sky-50 text-sky-800 text-[10px] font-extrabold uppercase">Checklist Teknisi</span>
                  <h3 class="text-sm font-extrabold text-slate-900 mt-1 break-words">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</h3>
                </div>
                <div class="text-right shrink-0">
                  <span class="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-extrabold">Skor: ${tekScore}%</span>
                  <button onclick="closeTeknisiForm()" class="block text-[11px] font-bold text-rose-600 underline mt-1">Tutup</button>
                </div>
              </div>

              <div class="space-y-2">
                ${TEKNISI_ITEMS.map((it, idx) => {
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
                const u = getUnitInfo(r.unit_code);
                return `
                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</p>
                    <p class="text-[11px] text-slate-500 truncate">${escapeHtml(r.staff_name)} • ${formatTimeShort(r.created_at)}</p>
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
  const infoReports = getInfoReportsForRole('manajemen');
  if (!STATE.mgmtFormUnit && STATE.units.length) {
    STATE.mgmtFormUnit = STATE.units[0].unit_code;
  }
  const mgmtScore = calcChecklistScore(STATE.mgmtChecklist, STATE.items);

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
                const u = getUnitInfo(rep.unit_code);
                return `
                <div class="w-full rounded-xl bg-white border border-purple-200 p-3 space-y-2 shadow-sm">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
                      <p class="text-[11px] text-slate-500">${escapeHtml(u.floor)} • Petugas: <strong>${escapeHtml(rep.staff_name)}</strong> (${formatTimeShort(rep.created_at)})</p>
                    </div>
                    <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold shrink-0">Skor ${rep.score}%</span>
                  </div>
                  <p class="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2 break-words">${escapeHtml(rep.notes || '-')}</p>
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
                const u = getUnitInfo(r.unit_code);
                return `
                <div onclick="openReportDetail('${r.id}')" class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 cursor-pointer">
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</p>
                    <p class="text-[11px] text-slate-500 truncate">Petugas: ${escapeHtml(r.staff_name)} • ${formatTimeShort(r.created_at)}</p>
                  </div>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                    r.status === 'SIAP PAKAI' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                  }">${escapeHtml(r.status)}</span>
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
        <select onchange="STATE.mgmtFormUnit = this.value; render();" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold bg-white">
          ${STATE.units
            .map(
              (u) =>
                `<option value="${escapeHtml(u.unit_code)}" ${STATE.mgmtFormUnit === u.unit_code ? 'selected' : ''}>${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</option>`
            )
            .join('')}
        </select>
      </div>

      <div class="space-y-2">
        ${STATE.items
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
  const unit = getUnitInfo(STATE.mgmtFormUnit);
  const score = calcChecklistScore(STATE.mgmtChecklist, STATE.items);
  if (score < 100) {
    showToast('Centang seluruh checklist hingga 100% terlebih dahulu.');
    return;
  }
  await insertInspectionRecord({
    unit_code: unit.unit_code,
    unit_name: unit.unit_name,
    inspector_name: STATE.user.name,
    staff_name: STATE.user.name,
    shift: `Inspeksi Manajemen • ${formatTimeShort(new Date().toISOString())} WIB`,
    score,
    status: 'SIAP PAKAI',
    notes: 'Diperiksa langsung oleh Manajemen.',
    checklist_data: STATE.items.map((it) => ({ ...it, checked: true })),
    duration_seconds: 30
  });
  STATE.mgmtChecklist = {};
  showToast(`Inspeksi ${unit.unit_name} tersimpan sebagai SIAP PAKAI.`);
  render();
}

/* ==========================================================================
   TAB PERBAIKAN FASILITAS (TERHUBUNG OTOMATIS KE TEKNISI)
   ========================================================================== */

function renderPerbaikanView() {
  if (!STATE.repairUnit && STATE.units.length) STATE.repairUnit = STATE.units[0].unit_code;
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
        <select onchange="STATE.repairUnit = this.value" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold bg-white">
          ${STATE.units
            .map(
              (u) =>
                `<option value="${escapeHtml(u.unit_code)}" ${STATE.repairUnit === u.unit_code ? 'selected' : ''}>${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</option>`
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
                const u = getUnitInfo(r.unit_code);
                const done = r.status === 'SELESAI_TEKNISI';
                return `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-xs font-extrabold text-slate-900 truncate">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</p>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                      done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }">${done ? 'SELESAI' : 'PROSES TEKNISI'}</span>
                  </div>
                  <p class="text-[11px] text-slate-600 break-words">${escapeHtml(r.notes || '-')}</p>
                </div>`;
              })
              .join('')
      }
    </div>
  </div>`;
}

async function submitRepairTicket() {
  const unit = getUnitInfo(STATE.repairUnit);
  if (!STATE.repairDesc.trim()) {
    showToast('Isi keterangan kerusakan terlebih dahulu.');
    return;
  }
  const { num, floor } = extractRoomNumberSpeech(unit);
  await insertInspectionRecord({
    unit_code: unit.unit_code,
    unit_name: unit.unit_name,
    inspector_name: STATE.user?.name || 'Pelapor',
    staff_name: 'Tim Teknisi',
    shift: `Tugas Teknisi • ${formatTimeShort(new Date().toISOString())} WIB`,
    score: 0,
    status: 'TUGAS_TEKNISI',
    notes: `[${STATE.repairCategory}] ${STATE.repairDesc.trim()} (Dilaporkan oleh ${STATE.user?.name || 'Staf'})`,
    checklist_data: [],
    duration_seconds: 0
  });
  STATE.repairDesc = '';
  speakIndonesian(`Laporan perbaikan ${STATE.repairCategory} kamar nomor ${num}, ${floor}, telah dikirim ke teknisi.`);
  showToast('Tiket perbaikan berhasil dikirim ke Teknisi.');
  render();
}

/* ==========================================================================
   TAB ANALITIK & DOWNLOAD REKAP PDF / EXCEL (OKUPANSI + KEDISIPLINAN PETUGAS)
   ========================================================================== */

function renderAnalitikView() {
  const summary = computeAnalyticsSummary();

  return `
  <div class="w-full px-3 pt-3 pb-24 space-y-3">
    <div class="w-full rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-sm">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-extrabold text-slate-900">Rekap Okupansi & Kedisiplinan</h2>
          <p class="text-[11px] text-slate-500">Filter Harian, Mingguan, Bulanan & Tahunan</p>
        </div>
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
   TAB PENGATURAN MANAJEMEN (4 PILIHAN APPROVAL, MASTER KAMAR, AKUN & PANDUAN HP)
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
      <h3 class="text-sm font-extrabold text-slate-900">Tambah Akun Pengguna Baru</h3>
      <div class="space-y-2">
        <input id="newUserName" type="text" placeholder="Nama Lengkap (misal: Budi Teknisi)" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs" />
        <div class="grid grid-cols-2 gap-2">
          <select id="newUserRole" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold bg-white">
            <option value="petugas">Petugas Kebersihan</option>
            <option value="teknisi">Teknisi</option>
            <option value="perawat">Perawat</option>
            <option value="manajemen">Manajemen</option>
          </select>
          <input id="newUserPin" type="text" maxlength="6" placeholder="PIN (misal: 1234)" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs" />
        </div>
        <button onclick="addNewAppUser()" class="w-full py-2.5 rounded-xl bg-teal-700 text-white text-xs font-extrabold">
          + Tambah Akun
        </button>
      </div>
      <div class="space-y-1.5 pt-2 border-t border-slate-100">
        ${STATE.users
          .map(
            (u) => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-xs">
            <span class="font-bold text-slate-800 truncate">${escapeHtml(u.name)}</span>
            <span class="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-extrabold uppercase shrink-0">${escapeHtml(u.role)} • PIN ${escapeHtml(u.pin || '-')}</span>
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

function setApprovalMode(mode) {
  STATE.approvalMode = mode;
  localStorage.setItem('ss_approval_mode', mode);
  showToast(`Mode approval diubah ke: ${getApprovalModeLabel(mode)}`);
  render();
}

async function addNewAppUser() {
  const name = document.getElementById('newUserName')?.value.trim();
  const role = document.getElementById('newUserRole')?.value || 'petugas';
  const pin = document.getElementById('newUserPin')?.value.trim() || '1234';
  if (!name) {
    showToast('Masukkan nama akun terlebih dahulu.');
    return;
  }
  const newUser = { id: `u-${Date.now()}`, name, role, pin, active: true };
  STATE.users.push(newUser);
  saveLocalCache();
  if (sb && navigator.onLine) {
    try {
      await sb.from('app_users').insert([{ name, role, pin, active: true }]);
    } catch (e) {}
  }
  showToast(`Akun ${name} (${role}) berhasil ditambahkan.`);
  render();
}

/* ==========================================================================
   NAVIGASI BAWAH (SESUAI ROLE — PETUGAS TANPA TAB CEK KAMAR)
   ========================================================================== */

function renderBottomNav() {
  const role = STATE.user.role;
  let tabs = [];

  if (role === 'petugas') {
    // Sesuai permintaan: navigasi Cek Kamar dihilangkan khusus Petugas
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
    // Manajemen
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
  const u = getUnitInfo(rep.unit_code);
  const items = Array.isArray(rep.checklist_data) ? rep.checklist_data : [];

  return `
  <div class="fixed inset-0 z-50 bg-slate-900/60 flex items-end sm:items-center justify-center p-3">
    <div class="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-4 space-y-3 shadow-2xl">
      <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-extrabold text-slate-900 break-words">${escapeHtml(u.unit_name)} (${escapeHtml(u.floor)})</h3>
          <p class="text-[11px] text-slate-500">${escapeHtml(formatDateTimeID(rep.created_at))}</p>
        </div>
        <button onclick="closeReportDetail()" class="w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold shrink-0">✕</button>
      </div>

      <div class="text-xs space-y-1 text-slate-700">
        <p><strong>Pelaksana:</strong> ${escapeHtml(rep.staff_name || '-')}</p>
        <p><strong>Pemeriksa / Target:</strong> ${escapeHtml(rep.inspector_name || '-')}</p>
        <p><strong>Status:</strong> ${escapeHtml(rep.status || '-')} (Skor ${rep.score || 0}%)</p>
        <p class="break-words"><strong>Catatan:</strong> ${escapeHtml(rep.notes || '-')}</p>
      </div>

      ${
        items.length
          ? `<div class="space-y-1 border-t border-slate-100 pt-2">
              <p class="text-[11px] font-extrabold text-slate-700">Item Checklist Terverifikasi:</p>
              ${items
                .map(
                  (it) =>
                    `<p class="text-[11px] text-slate-600">✅ ${escapeHtml(it.item_name || it.category)}</p>`
                )
                .join('')}
            </div>`
          : ''
      }

      ${
        rep.photo_url
          ? `<img src="${rep.photo_url}" alt="Bukti" class="w-full h-44 object-cover rounded-xl border border-slate-200" />`
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
          <label class="block text-xs font-bold text-slate-700 mb-1">Pilih Akun & Role Bertugas</label>
          <select id="loginUserSelect" class="w-full rounded-xl border border-slate-300 p-3 text-xs font-bold bg-slate-50">
            ${STATE.users
              .map(
                (u) =>
                  `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)} — [${escapeHtml(u.role.toUpperCase())}]</option>`
              )
              .join('')}
          </select>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">PIN Akses</label>
          <input id="loginPinInput" type="password" inputmode="numeric" maxlength="6" placeholder="Masukkan PIN (default: 1111 / 2222 / 3333 / 1234)" class="w-full rounded-xl border border-slate-300 p-3 text-xs font-bold tracking-widest" />
        </div>

        <button type="submit" class="w-full py-3.5 rounded-xl bg-teal-700 text-white text-xs font-extrabold shadow-lg active:scale-98">
          Masuk ke Sistem →
        </button>
      </form>

      <div class="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 space-y-0.5">
        <p class="font-bold text-slate-800">PIN Default Role:</p>
        <p>• Manajemen: <strong>1234</strong> | Petugas: <strong>1111</strong></p>
        <p>• Perawat: <strong>2222</strong> | Teknisi: <strong>3333</strong></p>
      </div>
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

  let bodyHtml = '';
  if (STATE.activeTab === 'perbaikan') {
    bodyHtml = renderPerbaikanView();
  } else if (STATE.activeTab === 'analitik') {
    bodyHtml = renderAnalitikView();
  } else if (STATE.activeTab === 'pengaturan' && STATE.user.role === 'manajemen') {
    bodyHtml = renderPengaturanView();
  } else {
    if (STATE.user.role === 'perawat') bodyHtml = renderPerawatMainView();
    else if (STATE.user.role === 'petugas') bodyHtml = renderPetugasMainView();
    else if (STATE.user.role === 'teknisi') bodyHtml = renderTeknisiMainView();
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
  loadLocalCache();
  render();
  syncAllData(true);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=6.5').catch((err) => {
      console.warn('SW register warning:', err);
    });
  }

  // Sinkronisasi otomatis setiap 12 detik
  syncInterval = setInterval(() => {
    if (STATE.user) syncAllData(true);
  }, 12000);

  // Pengulangan notifikasi & suara pengingat setiap 25 detik selama tugas belum dibuka/ditangani
  alarmLoopInterval = setInterval(() => {
    if (STATE.user) runAlarmReminderCycle(false);
  }, 25000);
})();
