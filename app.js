const APP_VERSION = '6.5';
const SUPABASE_URL = 'https://ymxpxrrjxnujygabrhsg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInJlZiI6InlteHB4cnJqeG51anlnYWJyaHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MDk0MjAsImV4cCI6MjExMDQ4NTQyMH0.tFMCbg1_R-I08KEIs-h6wwxXhYLP2Z0oYgnDGC7T2YU';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

const CREATOR_PIN = '1908';
let creatorDeleteUnlocked = false;
let secretTapCount = 0;
let secretTapTimer = null;

const SHIFT_CATEGORY_KEY = '__SHIFT__';
const APPROVAL_CONFIG_KEY = '__CONFIG_APPROVAL__';
const REPAIR_RECORD_TAG = '[JENIS_LAPORAN: CEK_PERBAIKAN]';
const CHECKOUT_RECORD_TAG = '[JENIS_LAPORAN: PASIEN_PULANG]';
const NURSE_REQ_TAG = '[JENIS_LAPORAN: PERMINTAAN_PERAWAT]';
const TECH_CHECK_TAG = '[JENIS_LAPORAN: CEK_TEKNISI]';

// 4 Mode Approval: 'off' | 'perawat' | 'manajemen' | 'all'
function normalizeApprovalMode(raw) {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'off' || val === 'false') return 'off';
  if (val === 'perawat') return 'perawat';
  if (val === 'all') return 'all';
  return 'manajemen';
}

let approvalMode = normalizeApprovalMode(localStorage.getItem('ck_approval_mode') || (localStorage.getItem('ck_require_approval') === 'false' ? 'off' : 'manajemen'));
let requireApprovalMode = approvalMode !== 'off';

const APPROVAL_MODE_OPTIONS = {
  off: {
    key: 'off',
    title: '1. OFF (Langsung Siap Pakai)',
    shortLabel: 'OFF (Langsung Siap Pakai)',
    desc: 'Petugas simpan laporan 100% → kamar otomatis SIAP PAKAI. Perawat & Manajemen hanya terima laporan.'
  },
  perawat: {
    key: 'perawat',
    title: '2. ON untuk Perawat',
    shortLabel: 'ON untuk Perawat',
    desc: 'Laporan masuk ke akun Perawat untuk di-Approve. Manajemen hanya mendapatkan laporannya saja.'
  },
  manajemen: {
    key: 'manajemen',
    title: '3. ON untuk Manajemen',
    shortLabel: 'ON untuk Manajemen',
    desc: 'Laporan masuk ke akun Manajemen untuk di-Approve. Perawat hanya mendapatkan laporannya saja.'
  },
  all: {
    key: 'all',
    title: '4. ON All (Perawat & Manajemen)',
    shortLabel: 'ON All (Perawat & Manajemen)',
    desc: 'Perawat maupun Manajemen sama-sama mendapat tombol Approve untuk mengesahkan kamar.'
  }
};

const TECHNICIAN_CHECKLIST_ITEMS = [
  { id: 'tech-ac', label: 'AC & Suhu Ruangan Berfungsi Dingin Normal' },
  { id: 'tech-tv', label: 'TV & Remote Berfungsi Baik' },
  { id: 'tech-electric', label: 'Lampu & Stopkontak Menyala Normal' },
  { id: 'tech-water', label: 'Air & Sanitasi (Keran, Shower, Closet) Lancar' },
  { id: 'tech-nursecall', label: 'Nurse Call / Bel Panggil Perawat Berfungsi' }
];

const NURSE_REQUEST_TYPES = {
  siapkan: {
    key: 'siapkan',
    label: 'Siapkan Kamar',
    shortTag: 'SIAPKAN KAMAR',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-300',
    toastTitle: 'SIAPKAN KAMAR 🛏️',
    speak: (roomLabel) => `Tolong siapkan kamar ${roomLabel} untuk pasien baru.`
  },
  extrabed: {
    key: 'extrabed',
    label: 'Tambahan Extrabed',
    shortTag: 'TAMBAH EXTRABED',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
    toastTitle: 'TAMBAHAN EXTRABED ➕',
    speak: (roomLabel) => `Tolong tambahkan extrabed di kamar ${roomLabel}.`
  },
  bersihkan: {
    key: 'bersihkan',
    label: 'Ruangan Minta Dibersihkan',
    shortTag: 'MINTA DIBERSIHKAN',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
    toastTitle: 'MINTA DIBERSIHKAN 🧹',
    speak: (roomLabel) => `Ruangan kamar ${roomLabel} minta dibersihkan.`
  },
  pulang: {
    key: 'pulang',
    label: 'Pasien Pulang',
    shortTag: 'PASIEN PULANG',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
    toastTitle: 'PASIEN PULANG 🚪',
    speak: (roomLabel) => `Pasien kamar ${roomLabel} sudah pulang, tolong dibersihkan.`
  }
};

const DEFAULT_SHIFTS = [
  { id: 'def-pagi', name: 'Shift Pagi', hours: '07:00 - 14:00', isLocal: true },
  { id: 'def-siang', name: 'Shift Siang', hours: '14:00 - 21:00', isLocal: true },
  { id: 'def-malam', name: 'Shift Malam', hours: '21:00 - 07:00', isLocal: true }
];

function getInitialShifts() {
  try {
    const saved = JSON.parse(localStorage.getItem('ck_shifts') || 'null');
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch (e) {}
  return [...DEFAULT_SHIFTS];
}

let shiftsData = getInitialShifts();
let currentUser = JSON.parse(localStorage.getItem('ck_user') || 'null');
let unitsData = [];
let itemsData = [];
let inspectionsData = [];
let usersData = [];
let watermarkedPhotos = { room: null, toilet: null };
let repairPhotos = { before: null, after: null };
let activeRepairReportId = null;
let timerInterval = null;
let secondsElapsed = 0;
let qrScannerInstance = null;
let statusChart = null;
let activeQrMeta = { code: '', name: '' };
let deferredInstallPrompt = null;
let activeWaPayload = null;
let currentPublicReport = null;
let activeTabName = 'dashboard';
let activeReviewReportId = null;
let officerFormUnlocked = false;

let realtimeChannel = null;
let pollingInterval = null;
let reminderRepeatInterval = null;
let lastKnownReportId = localStorage.getItem('ck_last_seen_id') || null;
let unreadNotifCount = 0;
let latestNotifReport = null;
let toastTimeout = null;

if (window.lucide) lucide.createIcons();

// ==================== MESIN SUARA NOTIFIKASI BAHASA INDONESIA + LANTAI + PENGINGAT 25 DETIK ====================

function extractSpokenRoomLabel(unitName, floorName = '') {
  const raw = String(unitName || '').trim();
  const matchedUnit = unitsData.find(u =>
    normalizeText(u.unit_name) === normalizeText(raw) ||
    (u.unit_code && normalizeText(raw).includes(normalizeText(u.unit_code)))
  );
  const resolvedFloor = String(floorName || matchedUnit?.floor || '').trim();
  const floorPart = resolvedFloor
    ? (resolvedFloor.toLowerCase().startsWith('lantai') ? `, ${resolvedFloor}` : `, Lantai ${resolvedFloor}`)
    : '';

  const numMatch = raw.match(/(?:kamar|kmr|ruang)?\s*(\d+[a-zA-Z]?)/i);
  if (numMatch && numMatch[1]) {
    return `nomor ${numMatch[1]}${floorPart}`;
  }
  return `${raw.replace(/^kamar\s*/i, '')}${floorPart}`;
}

function speakIndonesianAlert(text) {
  if (!text || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'id-ID';
    utter.rate = 0.96;
    utter.pitch = 1.04;
    utter.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const idVoice = voices.find(v => (v.lang || '').toLowerCase().includes('id'));
    if (idVoice) utter.voice = idVoice;

    setTimeout(() => {
      try { window.speechSynthesis.speak(utter); } catch (e) {}
    }, 350);
  } catch (e) {}
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    try { window.speechSynthesis.getVoices(); } catch (e) {}
  };
}

function getSpokenTextForReport(report) {
  if (!report) return '';
  const unitObj = unitsData.find(u => String(u.id) === String(report.unit_id));
  const roomLabel = extractSpokenRoomLabel(report.unit_name, unitObj?.floor || '');
  const notesStr = String(report.notes || '');
  const shiftStr = String(report.shift || '');

  if (isTechCheckRecord(report)) {
    return `Perhatian Teknisi, tolong cek AC, TV, lampu, air, dan nurse call di kamar ${roomLabel}.`;
  }
  if (notesStr.includes('[REQ_TYPE: siapkan]') || shiftStr.startsWith('Siapkan Kamar')) {
    return NURSE_REQUEST_TYPES.siapkan.speak(roomLabel);
  }
  if (notesStr.includes('[REQ_TYPE: extrabed]') || shiftStr.startsWith('Tambahan Extrabed')) {
    return NURSE_REQUEST_TYPES.extrabed.speak(roomLabel);
  }
  if (notesStr.includes('[REQ_TYPE: bersihkan]') || shiftStr.startsWith('Minta Dibersihkan')) {
    return NURSE_REQUEST_TYPES.bersihkan.speak(roomLabel);
  }
  if (notesStr.includes('[REQ_TYPE: pulang]') || notesStr.includes(CHECKOUT_RECORD_TAG) || shiftStr.startsWith('Pasien Pulang')) {
    return NURSE_REQUEST_TYPES.pulang.speak(roomLabel);
  }
  if (isRepairRecord(report)) {
    return report.final_status === 'siap'
      ? `Perbaikan fasilitas kamar ${roomLabel} sudah selesai.`
      : `Ada pengajuan perbaikan fasilitas di kamar ${roomLabel}.`;
  }
  if (isInspectionOfficiallyApproved(report)) {
    return `Kamar ${roomLabel} sudah siap pakai.`;
  }
  if (isRevisionRequested(report)) {
    return `Perhatian, kamar ${roomLabel} perlu perbaikan kebersihan.`;
  }
  return `Laporan cek kesiapan kamar ${roomLabel} menunggu approval.`;
}

function startPeriodicTaskReminder() {
  clearInterval(reminderRepeatInterval);
  reminderRepeatInterval = setInterval(() => {
    if (!currentUser) return;

    if (isPetugasRole()) {
      // Hentikan pengingat jika petugas sedang membuka form checklist
      if (officerFormUnlocked) return;
      const nurseUnits = unitsData.filter(u => isNurseMarkedUnit(u.last_checked_by));
      const revReports = getRoomChecklistReports().filter(r => isRevisionRequested(r));
      if (nurseUnits.length > 0) {
        const u = nurseUnits[0];
        const roomLabel = extractSpokenRoomLabel(u.unit_name, u.floor);
        playNotificationChime();
        speakIndonesianAlert(`Pengingat petugas, masih ada permintaan untuk kamar ${roomLabel}.`);
      } else if (revReports.length > 0) {
        const r = revReports[0];
        const roomLabel = extractSpokenRoomLabel(r.unit_name);
        playNotificationChime();
        speakIndonesianAlert(`Pengingat petugas, kamar ${roomLabel} perlu perbaikan kebersihan.`);
      }
    } else if (isTeknisiRole()) {
      const pendingTech = getTechCheckReports().filter(r => r.final_status !== 'siap');
      const pendingRepair = getRepairReports().filter(r => r.final_status !== 'siap');
      if (pendingTech.length > 0) {
        const roomLabel = extractSpokenRoomLabel(pendingTech[0].unit_name);
        playNotificationChime();
        speakIndonesianAlert(`Pengingat teknisi, cek fasilitas teknis di kamar ${roomLabel}.`);
      } else if (pendingRepair.length > 0) {
        const roomLabel = extractSpokenRoomLabel(pendingRepair[0].unit_name);
        playNotificationChime();
        speakIndonesianAlert(`Pengingat teknisi, ada pengajuan perbaikan di kamar ${roomLabel}.`);
      }
    } else if (canCurrentUserApprove()) {
      const pendingUnits = unitsData.filter(u => getEffectiveUnitStatus(u) === 'pending_approval');
      if (pendingUnits.length > 0) {
        const roomLabel = extractSpokenRoomLabel(pendingUnits[0].unit_name, pendingUnits[0].floor);
        playNotificationChime();
        speakIndonesianAlert(`Pengingat approval, kamar ${roomLabel} menunggu persetujuan.`);
      }
    }
  }, 25000);
}

// =================================================================================

function isSystemMetaCategory(category) {
  return category === SHIFT_CATEGORY_KEY || category === APPROVAL_CONFIG_KEY;
}

function isRepairRecord(rep) {
  if (!rep) return false;
  return String(rep.notes || '').includes(REPAIR_RECORD_TAG) || String(rep.shift || '').startsWith('Perbaikan');
}

function isTechCheckRecord(rep) {
  if (!rep) return false;
  return String(rep.notes || '').includes(TECH_CHECK_TAG) || String(rep.shift || '').startsWith('Cek Teknis');
}

function isNurseRequestRecord(rep) {
  if (!rep) return false;
  const n = String(rep.notes || '');
  const s = String(rep.shift || '');
  return n.includes(NURSE_REQ_TAG) || n.includes(CHECKOUT_RECORD_TAG) ||
    s.startsWith('Pasien Pulang') || s.startsWith('Siapkan Kamar') ||
    s.startsWith('Tambahan Extrabed') || s.startsWith('Minta Dibersihkan');
}

function isCheckoutRecord(rep) {
  return isNurseRequestRecord(rep);
}

function getNurseRequestTypeFromString(str) {
  const s = String(str || '');
  if (s.includes('[REQ_TYPE: siapkan]') || s.startsWith('Siapkan Kamar')) return NURSE_REQUEST_TYPES.siapkan;
  if (s.includes('[REQ_TYPE: extrabed]') || s.startsWith('Tambahan Extrabed')) return NURSE_REQUEST_TYPES.extrabed;
  if (s.includes('[REQ_TYPE: bersihkan]') || s.startsWith('Minta Dibersihkan')) return NURSE_REQUEST_TYPES.bersihkan;
  if (s.includes('[REQ_TYPE: pulang]') || s.includes(CHECKOUT_RECORD_TAG) || s.startsWith('Pasien Pulang')) return NURSE_REQUEST_TYPES.pulang;
  return NURSE_REQUEST_TYPES.pulang;
}

function getRoomChecklistReports() {
  return inspectionsData.filter(r => !isRepairRecord(r) && !isNurseRequestRecord(r) && !isTechCheckRecord(r));
}

function getRepairReports() {
  return inspectionsData.filter(r => isRepairRecord(r));
}

function getTechCheckReports() {
  return inspectionsData.filter(r => isTechCheckRecord(r));
}

function canCurrentUserApprove() {
  if (!currentUser || approvalMode === 'off') return false;
  if (approvalMode === 'all') return isManagerRole() || isPerawatRole();
  if (approvalMode === 'perawat') return isPerawatRole();
  return isManagerRole();
}

function getApprovalTargetLabel() {
  if (approvalMode === 'perawat') return 'Perawat';
  if (approvalMode === 'all') return 'Perawat / Manajemen';
  return 'Manajemen';
}

function syncApprovalConfigFromItems() {
  const cfgRow = itemsData.find(i => i.category === APPROVAL_CONFIG_KEY);
  if (cfgRow) {
    approvalMode = normalizeApprovalMode(cfgRow.item_name);
    requireApprovalMode = approvalMode !== 'off';
    localStorage.setItem('ck_approval_mode', approvalMode);
    localStorage.setItem('ck_require_approval', requireApprovalMode ? 'true' : 'false');
  }
  renderApprovalToggleCard();
}

function renderApprovalToggleCard() {
  const masterSection = document.getElementById('tab-master');
  if (!masterSection) return;

  let card = document.getElementById('approval-mode-config-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'approval-mode-config-card';
    masterSection.insertBefore(card, masterSection.firstChild);
  }

  if (!isManagerRole()) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  card.innerHTML = `
    <div class="glass-card rounded-3xl p-4 sm:p-5 shadow-sm border border-indigo-200/80 mb-4 space-y-3">
      <div>
        <h2 class="text-sm font-extrabold text-slate-900">Pengaturan Alur Approval Kamar</h2>
        <p class="text-[11px] text-slate-500 mt-0.5">Pilih siapa yang berwenang melakukan Approve setelah petugas selesai menyiapkan kamar:</p>
      </div>
      <div class="space-y-2">
        ${Object.values(APPROVAL_MODE_OPTIONS).map(opt => {
          const isSelected = approvalMode === opt.key;
          return `
            <button type="button" onclick="setApprovalMode('${opt.key}')" class="w-full text-left p-3 rounded-2xl border-2 transition flex items-start justify-between gap-3 ${isSelected ? 'border-teal-600 bg-teal-50/60 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}">
              <div class="space-y-0.5">
                <p class="text-xs font-extrabold text-slate-900">${opt.title}</p>
                <p class="text-[11px] text-slate-600 leading-relaxed">${opt.desc}</p>
              </div>
              <span class="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${isSelected ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white'}">
                ${isSelected ? '<i data-lucide="check" class="w-3 h-3"></i>' : ''}
              </span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
  lucide.createIcons();
}

async function setApprovalMode(nextMode) {
  if (!isManagerRole()) return;
  const normalized = normalizeApprovalMode(nextMode);
  approvalMode = normalized;
  requireApprovalMode = approvalMode !== 'off';
  localStorage.setItem('ck_approval_mode', approvalMode);
  localStorage.setItem('ck_require_approval', requireApprovalMode ? 'true' : 'false');

  renderApprovalToggleCard();
  populateOfficerDropdown();
  renderDashboard();

  if (navigator.onLine) {
    try {
      const valueStr = approvalMode.toUpperCase();
      const existingCfg = itemsData.find(i => i.category === APPROVAL_CONFIG_KEY);
      if (existingCfg) {
        await db.from('master_items').update({ item_name: valueStr }).eq('id', existingCfg.id);
        existingCfg.item_name = valueStr;
      } else {
        const { data } = await db.from('master_items').insert([{
          item_name: valueStr,
          category: APPROVAL_CONFIG_KEY,
          is_critical: false
        }]).select();
        if (Array.isArray(data) && data[0]) itemsData.push(data[0]);
      }
    } catch (e) {}
  }

  playNotificationChime();
}

async function toggleApprovalMode() {
  const next = approvalMode === 'off' ? 'manajemen' : 'off';
  await setApprovalMode(next);
}

async function ensureDefaultShiftsInDb() {
  if (!navigator.onLine) return;
  try {
    const dbShifts = itemsData.filter(i => i.category === SHIFT_CATEGORY_KEY);
    if (dbShifts.length === 0) {
      const seedPayload = DEFAULT_SHIFTS.map(s => ({
        item_name: `${s.name}||${s.hours}`,
        category: SHIFT_CATEGORY_KEY,
        is_critical: false
      }));
      const { data, error } = await db.from('master_items').insert(seedPayload).select();
      if (!error && Array.isArray(data) && data.length > 0) {
        itemsData = itemsData.concat(data);
      }
    }
  } catch (e) {}
}

function rebuildShiftsFromItems() {
  const dbShifts = itemsData.filter(i => i.category === SHIFT_CATEGORY_KEY);
  if (dbShifts.length > 0) {
    shiftsData = dbShifts.map(r => {
      const parts = String(r.item_name || '').split('||');
      return {
        id: r.id,
        name: (parts[0] || '').trim(),
        hours: (parts[1] || '').trim(),
        isLocal: false
      };
    });
    localStorage.setItem('ck_shifts', JSON.stringify(shiftsData));
  } else if (!Array.isArray(shiftsData) || shiftsData.length === 0) {
    shiftsData = getInitialShifts();
  }
  populateShiftDropdown();
  renderMasterShifts();
}

function populateShiftDropdown() {
  const sel = document.getElementById('inspect-shift');
  if (!sel) return;
  const prevVal = sel.value;
  sel.innerHTML = shiftsData.map(s => {
    const label = s.hours ? `${s.name} (${s.hours})` : s.name;
    return `<option value="${s.name}">${label}</option>`;
  }).join('');
  if (prevVal) {
    if (!Array.from(sel.options).some(o => o.value === prevVal)) {
      const opt = document.createElement('option');
      opt.value = prevVal;
      opt.textContent = prevVal;
      sel.prepend(opt);
    }
    sel.value = prevVal;
  }
}

function renderMasterShifts() {
  const list = document.getElementById('master-shift-list');
  if (!list) return;
  if (!Array.isArray(shiftsData) || shiftsData.length === 0) {
    shiftsData = getInitialShifts();
  }
  list.innerHTML = shiftsData.map(s => `
    <div class="py-3 flex items-center justify-between gap-2">
      <div>
        <p class="text-xs font-extrabold text-slate-900">${s.name}</p>
        <p class="text-[11px] text-slate-500">${s.hours || 'Jam kerja fleksibel'}</p>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="editShift('${s.id}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-[11px] font-bold">Edit</button>
        <button type="button" onclick="deleteShift('${s.id}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-[11px] font-bold">Hapus</button>
      </div>
    </div>
  `).join('');
}

function editShift(id) {
  if (!isManagerRole()) return;
  const s = shiftsData.find(item => String(item.id) === String(id));
  if (!s) return;
  document.getElementById('edit-shift-id').value = s.id;
  document.getElementById('shift-name').value = s.name;
  document.getElementById('shift-hours').value = s.hours || '';
  document.getElementById('btn-save-shift').textContent = 'Perbarui Shift';
  document.getElementById('shift-name').focus();
}

async function deleteShift(id) {
  if (!isManagerRole()) return;
  if (shiftsData.length <= 1) return alert('Minimal harus ada 1 shift kerja yang terdaftar.');
  if (!confirm('Hapus shift kerja ini?')) return;

  const target = shiftsData.find(item => String(item.id) === String(id));
  shiftsData = shiftsData.filter(item => String(item.id) !== String(id));
  localStorage.setItem('ck_shifts', JSON.stringify(shiftsData));
  populateShiftDropdown();
  renderMasterShifts();

  if (target && !target.isLocal && navigator.onLine) {
    try {
      await db.from('master_items').delete().eq('id', target.id);
    } catch (e) {}
  }
}

document.getElementById('form-add-shift')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isManagerRole()) return;
  const id = document.getElementById('edit-shift-id').value;
  const name = document.getElementById('shift-name').value.trim();
  const hours = document.getElementById('shift-hours').value.trim();
  if (!name) return;

  const btn = document.getElementById('btn-save-shift');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const existing = shiftsData.find(item => String(item.id) === String(id));
  const localId = existing ? existing.id : ('loc-' + Date.now());

  if (existing) {
    shiftsData = shiftsData.map(item => String(item.id) === String(id) ? { ...item, name, hours } : item);
  } else {
    shiftsData.push({ id: localId, name, hours, isLocal: true });
  }
  localStorage.setItem('ck_shifts', JSON.stringify(shiftsData));
  populateShiftDropdown();
  renderMasterShifts();

  if (navigator.onLine) {
    try {
      const encodedName = `${name}||${hours}`;
      if (existing && !existing.isLocal) {
        await db.from('master_items').update({ item_name: encodedName }).eq('id', existing.id);
      } else {
        const { data } = await db.from('master_items').insert([{
          item_name: encodedName,
          category: SHIFT_CATEGORY_KEY,
          is_critical: false
        }]).select();
        if (Array.isArray(data) && data[0]) {
          shiftsData = shiftsData.map(item => String(item.id) === String(localId) ? { ...item, id: data[0].id, isLocal: false } : item);
          localStorage.setItem('ck_shifts', JSON.stringify(shiftsData));
          renderMasterShifts();
        }
      }
    } catch (err) {}
  }

  e.target.reset();
  document.getElementById('edit-shift-id').value = '';
  btn.disabled = false;
  btn.textContent = '+ Simpan Shift';
});

function isManagerRole() {
  return currentUser && (currentUser.role || '').toLowerCase() === 'manajemen';
}

function isPerawatRole() {
  return currentUser && (currentUser.role || '').toLowerCase() === 'perawat';
}

function isTeknisiRole() {
  return currentUser && (currentUser.role || '').toLowerCase() === 'teknisi';
}

function isPetugasRole() {
  return currentUser && !isManagerRole() && !isPerawatRole() && !isTeknisiRole();
}

function ensurePerawatRoleOptionInAccountForm() {
  const roleSel = document.getElementById('new-user-role');
  if (!roleSel) return;
  const requiredOptions = [
    { value: 'petugas', text: 'Role: Petugas Kebersihan' },
    { value: 'teknisi', text: 'Role: Teknisi (Cek AC, TV, Lampu, Air, Nurse Call)' },
    { value: 'perawat', text: 'Role: Perawat (Permintaan Kamar & Pasien Pulang)' },
    { value: 'manajemen', text: 'Role: Manajemen' }
  ];
  requiredOptions.forEach(item => {
    if (!Array.from(roleSel.options).some(o => o.value === item.value)) {
      const opt = document.createElement('option');
      opt.value = item.value;
      opt.textContent = item.text;
      roleSel.appendChild(opt);
    }
  });
}

function isRevisionRequested(rep) {
  if (!rep) return false;
  const meta = parseNotesMetadata(rep.notes);
  return !isInspectionOfficiallyApproved(rep) && (
    meta.feedbackStatus.includes('Perlu Perbaikan') ||
    meta.feedbackStatus.includes('Wajib Diperbaiki') ||
    meta.feedbackStatus.includes('Revisi')
  );
}

async function forceRefreshApp() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
  } catch (e) {}
  window.location.href = window.location.pathname + '?v=' + Date.now();
}

function openModalWithHistory(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.remove('hidden');
  try { window.history.pushState({ modal: modalId, tab: activeTabName }, ''); } catch (e) {}
}

function closeActiveModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('hidden');
}

window.addEventListener('popstate', () => {
  const openModals = ['modal-photo-zoom', 'modal-qr-scanner', 'modal-qr-print', 'modal-wa-share', 'modal-notifications', 'modal-about'];
  for (const id of openModals) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) {
      if (id === 'modal-qr-scanner') closeQrScanner();
      else el.classList.add('hidden');
      return;
    }
  }
  const defaultTab = (isManagerRole() || isPerawatRole()) ? 'dashboard' : isTeknisiRole() ? 'repair' : 'inspect';
  if (activeTabName !== defaultTab) switchTab(defaultTab, true);
});

function normalizeText(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getLatestInspectionForUnit(unitId, unitName = '') {
  const unitObj = unitsData.find(u => String(u.id) === String(unitId));
  const targetName = normalizeText(unitName || unitObj?.unit_name || '');
  const targetCode = normalizeText(unitObj?.unit_code || '');

  return getRoomChecklistReports().find(r => {
    if (unitId && r.unit_id && String(r.unit_id) === String(unitId)) return true;
    const repName = normalizeText(r.unit_name);
    if (targetName && repName && repName === targetName) return true;
    if (targetCode && repName && repName.includes(targetCode)) return true;
    return false;
  }) || null;
}

function isInspectionOfficiallyApproved(rep) {
  if (!rep) return false;
  const meta = parseNotesMetadata(rep.notes);
  return rep.final_status === 'siap' && (meta.feedbackStatus.includes('Approved') || meta.feedbackStatus.includes('Otomatis Siap Pakai'));
}

function isNurseMarkedUnit(checkedByStr) {
  const s = String(checkedByStr || '');
  return s.startsWith('Pasien Pulang:') || s.startsWith('Siapkan Kamar:') || s.startsWith('Tambahan Extrabed:') || s.startsWith('Minta Dibersihkan:');
}

function isRoomBookedByNurse(u) {
  const s = String(u?.last_checked_by || '');
  if (s.startsWith('Siapkan Kamar:')) return true;
  const latestNurse = getNurseRequestReportsForUnit(u.id, u.unit_name)[0];
  if (!latestNurse) return false;
  const reqType = getNurseRequestTypeFromString((latestNurse.notes || '') + ' ' + (latestNurse.shift || ''));
  return reqType.key === 'siapkan';
}

function getNurseRequestReportsForUnit(unitId, unitName = '') {
  const targetName = normalizeText(unitName);
  return inspectionsData.filter(r => {
    if (!isNurseRequestRecord(r)) return false;
    if (unitId && r.unit_id && String(r.unit_id) === String(unitId)) return true;
    return targetName && normalizeText(r.unit_name) === targetName;
  });
}

function getEffectiveUnitStatus(u) {
  if (u.status === 'maintenance') return 'maintenance';

  const latestRep = getLatestInspectionForUnit(u.id, u.unit_name);
  const checkedByStr = String(u.last_checked_by || '');
  const hasApprovedStampOnUnit = checkedByStr.includes('Approved:') || checkedByStr.includes('Siap Pakai');
  const unitUpdatedAt = u.last_checked_at ? new Date(u.last_checked_at).getTime() : 0;
  const repCreatedAt = latestRep?.created_at ? new Date(latestRep.created_at).getTime() : 0;

  const isExplicitlyClearedAfterReport = (
    u.status === 'kotor' &&
    (!checkedByStr || isNurseMarkedUnit(checkedByStr)) &&
    unitUpdatedAt > (repCreatedAt + 2000)
  );
  if (isExplicitlyClearedAfterReport) return 'kosong';

  if (latestRep && !isInspectionOfficiallyApproved(latestRep)) {
    const meta = parseNotesMetadata(latestRep.notes);
    if (
      meta.feedbackStatus.includes('Perlu Perbaikan') ||
      meta.feedbackStatus.includes('Wajib Diperbaiki') ||
      meta.feedbackStatus.includes('Revisi')
    ) return 'perlu_perbaikan';
    if (meta.feedbackStatus.includes('Sedang Dibersihkan')) return 'dibersihkan';
    return 'pending_approval';
  }

  if (latestRep && isInspectionOfficiallyApproved(latestRep)) return 'siap';
  if (u.status === 'siap' && hasApprovedStampOnUnit) return 'siap';
  if (checkedByStr.includes('Perlu Perbaikan')) return 'perlu_perbaikan';
  if (checkedByStr && !isNurseMarkedUnit(checkedByStr) && !hasApprovedStampOnUnit) return 'pending_approval';

  return 'kosong';
}

function openFirstPendingApproval() {
  const pendingUnit = unitsData.find(u => getEffectiveUnitStatus(u) === 'pending_approval');
  if (pendingUnit) {
    quickInspect(pendingUnit.id);
    return;
  }
  const pendingRep = getRoomChecklistReports().find(r => !isInspectionOfficiallyApproved(r));
  if (pendingRep) {
    openReportInForm(pendingRep.id);
    return;
  }
  openNotificationDrawer();
}

async function requestRevisionByManagement(unitId, unitName, reportId = null) {
  if (!canCurrentUserApprove()) {
    return alert('Anda tidak memiliki wewenang Approve/Komplain pada mode approval yang aktif saat ini.');
  }

  let targetRep = reportId
    ? inspectionsData.find(r => String(r.id) === String(reportId))
    : getLatestInspectionForUnit(unitId, unitName);

  const existingDetail = targetRep ? parseNotesMetadata(targetRep.notes).feedbackDetail : '';
  const formDetail = document.getElementById('inspect-feedback-detail')?.value.trim() || '';
  const defaultComplaint = formDetail || existingDetail || '';

  const complaintInput = prompt(
    `Komplain / Bagian yang Harus Diperbaiki untuk "${unitName}":\n(Contoh: Lantai kamar mandi masih basah / Sprei belum rapi)`,
    defaultComplaint
  );
  if (complaintInput === null) return;
  const cleanComplaint = complaintInput.trim();
  if (!cleanComplaint) {
    return alert('Mohon isi keterangan bagian mana yang perlu diperbaiki agar petugas mengetahui detail komplain.');
  }

  const approverRoleLabel = isPerawatRole() ? 'Perawat' : 'Supervisor Manajemen';
  const supervisorName = currentUser.full_name || approverRoleLabel;

  if (targetRep) {
    const meta = parseNotesMetadata(targetRep.notes);
    const executorName = meta.executor || targetRep.inspector_name || 'Petugas';
    const updatedNotes = composeNotesWithMetadata(
      executorName,
      `Perlu Perbaikan (Komplain oleh ${supervisorName})`,
      cleanComplaint,
      meta.cleanNotes
    );

    const { error } = await db.from('room_inspections').update({
      final_status: 'kotor',
      notes: updatedNotes,
      created_at: new Date().toISOString()
    }).eq('id', targetRep.id);

    if (error) return alert('Gagal mengirim komplain perbaikan: ' + error.message);

    const matchedUnit = unitsData.find(u => String(u.id) === String(targetRep.unit_id) || normalizeText(u.unit_name) === normalizeText(targetRep.unit_name));
    const finalUnitId = matchedUnit ? matchedUnit.id : (unitId || targetRep.unit_id);

    if (finalUnitId) {
      await db.from('master_units').update({
        status: 'kotor',
        last_checked_by: `Perlu Perbaikan: ${cleanComplaint}`,
        last_checked_at: new Date().toISOString()
      }).eq('id', finalUnitId);
    }
  } else if (unitId) {
    await db.from('master_units').update({
      status: 'kotor',
      last_checked_by: `Perlu Perbaikan: ${cleanComplaint}`,
      last_checked_at: new Date().toISOString()
    }).eq('id', unitId);
  }

  clearBottomFormReviewBar();
  activeReviewReportId = null;
  document.getElementById('prefill-review-banner')?.classList.add('hidden');
  playNotificationChime();
  await loadAllData();
  alert(`Komplain terkirim ke Petugas! Status ${unitName} kini ditandai PERLU PERBAIKAN.`);
}

async function requestRevisionFromActiveForm() {
  const unitId = document.getElementById('inspect-unit')?.value;
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  const unitName = unit ? unit.unit_name : 'Kamar';
  await requestRevisionByManagement(unitId, unitName, activeReviewReportId);
  switchTab('dashboard');
}

async function approveReportById(reportId) {
  if (!canCurrentUserApprove()) {
    return alert('Akun Anda tidak memiliki tombol Approve pada pengaturan mode approval saat ini.');
  }
  const rep = inspectionsData.find(r => String(r.id) === String(reportId));
  if (!rep) return alert('Data laporan form tidak ditemukan.');

  if (!confirm(`Approve form laporan "${rep.unit_name}" (Skor ${rep.readiness_score}%) menjadi SIAP PAKAI sekarang?`)) return;

  const approverName = currentUser.full_name || (isPerawatRole() ? 'Perawat' : 'Supervisor Manajemen');
  const meta = parseNotesMetadata(rep.notes);
  const updatedNotes = composeNotesWithMetadata(
    meta.executor || rep.inspector_name,
    `Sesuai Standar (Approved oleh ${approverName})`,
    '',
    meta.cleanNotes
  );

  const { error } = await db.from('room_inspections').update({
    final_status: 'siap',
    notes: updatedNotes
  }).eq('id', rep.id);

  if (error) return alert('Gagal approve form laporan: ' + error.message);

  const matchedUnit = unitsData.find(u => String(u.id) === String(rep.unit_id) || normalizeText(u.unit_name) === normalizeText(rep.unit_name));
  const targetUnitId = matchedUnit ? matchedUnit.id : rep.unit_id;

  if (targetUnitId) {
    await db.from('master_units').update({
      status: 'siap',
      last_checked_by: `Approved: ${approverName}`,
      last_checked_at: new Date().toISOString()
    }).eq('id', targetUnitId);
  }

  clearBottomFormReviewBar();
  activeReviewReportId = null;
  document.getElementById('prefill-review-banner')?.classList.add('hidden');
  playNotificationChime();
  await loadAllData();
  alert(`Berhasil! Form laporan ${rep.unit_name} telah di-Approve menjadi SIAP PAKAI.`);
}

async function approveUnitByManagement(unitId, unitName) {
  if (!canCurrentUserApprove()) {
    return alert('Akun Anda tidak memiliki wewenang Approve pada pengaturan mode approval saat ini.');
  }
  const latestRep = getLatestInspectionForUnit(unitId, unitName);
  if (latestRep && !isInspectionOfficiallyApproved(latestRep)) {
    return approveReportById(latestRep.id);
  }

  if (!confirm(`Approve "${unitName}" sebagai SIAP PAKAI sekarang?`)) return;
  const approverName = currentUser.full_name || (isPerawatRole() ? 'Perawat' : 'Supervisor Manajemen');
  const { error } = await db.from('master_units').update({
    status: 'siap',
    last_checked_by: `Approved: ${approverName}`,
    last_checked_at: new Date().toISOString()
  }).eq('id', unitId);

  if (error) return alert('Gagal melakukan approval: ' + error.message);
  playNotificationChime();
  await loadAllData();
  alert(`Berhasil! ${unitName} kini berstatus SIAP PAKAI.`);
}

async function approveActiveFormReport() {
  if (activeReviewReportId) {
    await approveReportById(activeReviewReportId);
    switchTab('dashboard');
  } else {
    const unitId = document.getElementById('inspect-unit')?.value;
    const unit = unitsData.find(u => String(u.id) === String(unitId));
    if (unit) {
      await approveUnitByManagement(unit.id, unit.unit_name);
      switchTab('dashboard');
    }
  }
}

// ==================== AKSI CEPAT PERAWAT (4 TOMBOL + PENGUNCIAN + TUGAS OTOMATIS TEKNISI) ====================

async function createAutomaticTechnicianTask(unitId, unitName, nurseName, jamReq, triggerLabel) {
  if (!navigator.onLine) return;
  try {
    const existingOpenTech = getTechCheckReports().find(r =>
      r.final_status !== 'siap' &&
      (String(r.unit_id) === String(unitId) || normalizeText(r.unit_name) === normalizeText(unitName))
    );
    if (existingOpenTech) return;

    const unitObj = unitsData.find(u => String(u.id) === String(unitId));
    const roomLabel = extractSpokenRoomLabel(unitName, unitObj?.floor || '');
    const techChecklist = TECHNICIAN_CHECKLIST_ITEMS.map(it => ({ item: it.label, checked: false }));

    const techPayload = {
      unit_id: unitId,
      unit_name: unitName,
      inspector_name: nurseName,
      inspector_role: 'perawat',
      shift: `Cek Teknis • ${jamReq} WIB`,
      readiness_score: 0,
      final_status: 'kotor',
      duration_seconds: 0,
      checklist_data: techChecklist,
      notes: composeNotesWithMetadata(
        'Tim Teknisi',
        `Tugas Cek Teknis (${triggerLabel} oleh ${nurseName})`,
        'AC, TV, Lampu, Air/Sanitasi, Nurse Call',
        `${TECH_CHECK_TAG}\nPengecekan teknis otomatis untuk kamar ${roomLabel}.`
      ),
      photo_room_url: null,
      photo_toilet_url: null
    };
    await db.from('room_inspections').insert([techPayload]);
  } catch (e) {}
}

async function sendNurseRoomAction(unitId, unitName, actionKey) {
  if (!isManagerRole() && !isPerawatRole()) return;
  const currentUnit = unitsData.find(u => String(u.id) === String(unitId));

  // Cegah tekan ulang Siapkan Kamar jika kamar sudah dipesan / sedang dipakai sampai Pasien Pulang ditekan
  if (actionKey === 'siapkan' && currentUnit && isRoomBookedByNurse(currentUnit)) {
    return alert(`Tombol "Siapkan Kamar" untuk ${unitName} sedang terkunci karena kamar sudah dipesan / terisi. Tekan "Pasien Pulang" terlebih dahulu untuk membukanya kembali.`);
  }

  const cfg = NURSE_REQUEST_TYPES[actionKey] || NURSE_REQUEST_TYPES.pulang;
  const roomLabel = extractSpokenRoomLabel(unitName, currentUnit?.floor || '');

  const ok = confirm(`Kirim permintaan "${cfg.label}" untuk ${unitName} sekarang?`);
  if (!ok) return;

  const nurseName = currentUser?.full_name || 'Perawat';
  const jamReq = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  const prefixMap = {
    siapkan: 'Siapkan Kamar',
    extrabed: 'Tambahan Extrabed',
    bersihkan: 'Minta Dibersihkan',
    pulang: 'Pasien Pulang'
  };
  const prefixTitle = prefixMap[cfg.key] || 'Pasien Pulang';
  const unitStamp = `${prefixTitle}: ${nurseName} (${jamReq})`;

  const currentEff = currentUnit ? getEffectiveUnitStatus(currentUnit) : 'kosong';
  const nextDbStatus = (cfg.key === 'extrabed' && currentEff === 'siap') ? 'siap' : 'kotor';

  const { error } = await db.from('master_units').update({
    status: nextDbStatus,
    last_checked_by: unitStamp,
    last_checked_at: new Date().toISOString()
  }).eq('id', unitId);

  if (error) return alert('Gagal mengirim permintaan kamar: ' + error.message);

  try {
    const spokenMessage = cfg.speak(roomLabel);
    const reqPayload = {
      unit_id: unitId,
      unit_name: unitName,
      inspector_name: nurseName,
      inspector_role: currentUser?.role || 'perawat',
      shift: `${prefixTitle} • ${jamReq} WIB`,
      readiness_score: 0,
      final_status: nextDbStatus,
      duration_seconds: 0,
      checklist_data: [
        { item: cfg.label, checked: true }
      ],
      notes: composeNotesWithMetadata(
        nurseName,
        `${cfg.label} (Dilaporkan oleh ${nurseName})`,
        spokenMessage,
        `${NURSE_REQ_TAG}\n[REQ_TYPE: ${cfg.key}]\n${spokenMessage}`
      ),
      photo_room_url: null,
      photo_toilet_url: null
    };
    const { data: insertedRows } = await db.from('room_inspections').insert([reqPayload]).select();
    if (insertedRows?.[0]) {
      lastKnownReportId = insertedRows[0].id;
      localStorage.setItem('ck_last_seen_id', insertedRows[0].id);
    }

    // Jika Siapkan Kamar atau Minta Dibersihkan -> otomatis buat tugas untuk Teknisi
    if (cfg.key === 'siapkan' || cfg.key === 'bersihkan') {
      await createAutomaticTechnicianTask(unitId, unitName, nurseName, jamReq, cfg.label);
    }
  } catch (e) {}

  playNotificationChime();
  speakIndonesianAlert(`Permintaan ${cfg.label} kamar ${roomLabel} terkirim.`);
  await loadAllData();
  alert(`Terkirim! Permintaan "${cfg.label}" untuk ${unitName} sudah masuk ke layar & suara notifikasi tim.`);
}

async function confirmPatientCheckout(unitId, unitName) {
  return sendNurseRoomAction(unitId, unitName, 'pulang');
}

// ================================================================================

async function quickChangeUnitStatus(unitId, newMode) {
  if (!isManagerRole()) {
    alert('Hanya Manajemen yang dapat mengubah status kamar secara manual.');
    return renderDashboard();
  }
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  const latestRep = getLatestInspectionForUnit(unitId, unit?.unit_name);

  if (newMode === 'siap') {
    if (latestRep && !isInspectionOfficiallyApproved(latestRep)) {
      renderDashboard();
      return approveReportById(latestRep.id);
    }
    renderDashboard();
    return approveUnitByManagement(unitId, unit ? unit.unit_name : 'Kamar');
  }

  if (newMode === 'perlu_perbaikan') {
    renderDashboard();
    return requestRevisionByManagement(unitId, unit ? unit.unit_name : 'Kamar', latestRep?.id || null);
  }

  let dbStatus = 'kotor';
  let checkedBy = null;
  if (newMode === 'pending_approval') checkedBy = 'Menunggu Approval';
  else if (newMode === 'dibersihkan') checkedBy = currentUser ? currentUser.full_name : 'Petugas';
  else if (newMode === 'maintenance') { dbStatus = 'maintenance'; checkedBy = 'Maintenance / Perbaikan'; }

  const { error } = await db.from('master_units').update({
    status: dbStatus,
    last_checked_by: checkedBy,
    last_checked_at: new Date().toISOString()
  }).eq('id', unitId);

  if (error) return alert('Gagal mengubah status: ' + error.message);
  await loadAllData();
}

async function markIssueResolvedByOfficer(reportId) {
  const report = inspectionsData.find(r => String(r.id) === String(reportId));
  if (!report) return;

  const autoApprove = !requireApprovalMode;
  const confirmMsg = autoApprove
    ? `Konfirmasi perbaikan pada "${report.unit_name}" sudah selesai? Status kamar akan langsung menjadi SIAP PAKAI.`
    : `Konfirmasi perbaikan pada "${report.unit_name}" sudah selesai?\n\nNotifikasi akan dikirim ke ${getApprovalTargetLabel()} agar segera di-approve menjadi Siap Pakai.`;

  if (!confirm(confirmMsg)) return;

  const meta = parseNotesMetadata(report.notes);
  const actorName = currentUser ? currentUser.full_name : 'Petugas';

  if (canCurrentUserApprove() && isManagerRole()) {
    await approveReportById(report.id);
  } else if (!requireApprovalMode) {
    const autoNote = composeNotesWithMetadata(
      actorName,
      `Sesuai Standar (Otomatis Siap Pakai - Selesai Perbaikan oleh ${actorName})`,
      '',
      meta.cleanNotes
    );
    const { error } = await db.from('room_inspections').update({
      final_status: 'siap',
      readiness_score: 100,
      notes: autoNote,
      created_at: new Date().toISOString()
    }).eq('id', report.id);

    if (error) return alert('Gagal memperbarui laporan: ' + error.message);

    const matchedUnit = unitsData.find(u => String(u.id) === String(report.unit_id) || normalizeText(u.unit_name) === normalizeText(report.unit_name));
    const targetUnitId = matchedUnit ? matchedUnit.id : report.unit_id;

    if (targetUnitId) {
      await db.from('master_units').update({
        status: 'siap',
        last_checked_by: `Siap Pakai (${actorName})`,
        last_checked_at: new Date().toISOString()
      }).eq('id', targetUnitId);
    }

    clearBottomFormReviewBar();
    activeReviewReportId = null;
    officerFormUnlocked = false;
    document.getElementById('prefill-review-banner')?.classList.add('hidden');
    playNotificationChime();
    await loadAllData();
    alert(`Berhasil! Perbaikan pada ${report.unit_name} selesai dan kamar langsung berstatus SIAP PAKAI.`);
  } else {
    const targetApprovalLabel = getApprovalTargetLabel();
    const pendingNote = composeNotesWithMetadata(
      actorName,
      `Menunggu Approval ${targetApprovalLabel} (Selesai Perbaikan oleh ${actorName})`,
      '',
      meta.cleanNotes
    );
    const { error } = await db.from('room_inspections').update({
      final_status: 'kotor',
      readiness_score: 100,
      notes: pendingNote,
      created_at: new Date().toISOString()
    }).eq('id', report.id);

    if (error) return alert('Gagal mengirim pengajuan approval: ' + error.message);

    const matchedUnit = unitsData.find(u => String(u.id) === String(report.unit_id) || normalizeText(u.unit_name) === normalizeText(report.unit_name));
    const targetUnitId = matchedUnit ? matchedUnit.id : report.unit_id;

    if (targetUnitId) {
      await db.from('master_units').update({
        status: 'kotor',
        last_checked_by: `${actorName} (Selesai Perbaikan - Menunggu Approval)`,
        last_checked_at: new Date().toISOString()
      }).eq('id', targetUnitId);
    }

    clearBottomFormReviewBar();
    activeReviewReportId = null;
    officerFormUnlocked = false;
    document.getElementById('prefill-review-banner')?.classList.add('hidden');
    playNotificationChime();
    await loadAllData();
    alert(`Terkirim ke ${targetApprovalLabel}! Perbaikan pada ${report.unit_name} sudah dilaporkan selesai dan menunggu approval.`);
  }
}

async function acknowledgeNurseTask(unitId, unitName) {
  const actorName = currentUser ? currentUser.full_name : 'Petugas';
  if (!confirm(`Tandai permintaan perawat untuk "${unitName}" sudah dikerjakan?`)) return;
  const { error } = await db.from('master_units').update({
    last_checked_by: `Ditangani: ${actorName}`,
    last_checked_at: new Date().toISOString()
  }).eq('id', unitId);
  if (error) return alert('Gagal memperbarui status: ' + error.message);
  await loadAllData();
}

function closeOfficerChecklistForm() {
  officerFormUnlocked = false;
  clearPrefillFormState();
  renderOfficerRevisionBanner();
}

function updateInspectFormVisibilityForRole() {
  const formWrapper = document.getElementById('inspect-form-wrapper');
  const closeBtn = document.getElementById('btn-close-officer-form');
  if (!formWrapper) return;

  if (isPetugasRole()) {
    formWrapper.classList.toggle('hidden', !officerFormUnlocked);
    if (closeBtn) closeBtn.classList.toggle('hidden', !officerFormUnlocked);
  } else {
    formWrapper.classList.remove('hidden');
    if (closeBtn) closeBtn.classList.add('hidden');
  }
}

function renderOfficerRevisionBanner() {
  const inspectSection = document.getElementById('tab-inspect');
  if (!inspectSection) return;

  let container = document.getElementById('officer-revision-alert-box');
  if (!container) {
    container = document.createElement('div');
    container.id = 'officer-revision-alert-box';
    inspectSection.insertBefore(container, inspectSection.firstChild);
  }

  updateInspectFormVisibilityForRole();

  if (!isPetugasRole()) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  const revisionReports = getRoomChecklistReports().filter(r => isRevisionRequested(r));
  const nurseTaskUnits = unitsData.filter(u => isNurseMarkedUnit(u.last_checked_by));

  if (revisionReports.length === 0 && nurseTaskUnits.length === 0) {
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="glass-card rounded-2xl p-6 text-center space-y-2 border border-slate-200">
        <div class="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <i data-lucide="check-circle-2" class="w-6 h-6"></i>
        </div>
        <h3 class="text-xs font-extrabold text-slate-900">Belum Ada Permintaan Kamar Masuk</h3>
        <p class="text-[11px] text-slate-500">Form checklist akan otomatis muncul saat ada permintaan dari Perawat atau komplain revisi.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const resolveBtnLabel = requireApprovalMode ? 'Selesai Perbaikan & Minta Approve' : 'Selesai Perbaikan (Siap Pakai)';

  const nurseTasksHtml = nurseTaskUnits.length > 0 ? `
    <div class="mb-3 rounded-2xl bg-amber-50 border-2 border-amber-300 p-3.5 shadow-sm space-y-2.5">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
          <h3 class="text-xs font-extrabold text-amber-950 uppercase tracking-wide">Permintaan Perawat (${nurseTaskUnits.length} Kamar)</h3>
        </div>
        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">Nurse Station</span>
      </div>
      <div class="space-y-2">
        ${nurseTaskUnits.map(u => {
          const safeName = (u.unit_name || '').replace(/'/g, "\\'");
          const isExtraOrCleanOnly = String(u.last_checked_by || '').startsWith('Tambahan Extrabed:') || String(u.last_checked_by || '').startsWith('Minta Dibersihkan:');
          return `
            <div class="bg-white rounded-xl p-3 border border-amber-200 space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-xs font-extrabold text-slate-900">${u.unit_code} - ${u.unit_name} ${u.floor ? `(${u.floor})` : ''}</p>
                  <p class="text-[11px] font-bold text-amber-800">${u.last_checked_by || ''}</p>
                </div>
              </div>
              <div class="flex items-center gap-1.5 justify-end">
                ${isExtraOrCleanOnly ? `
                  <button type="button" onclick="acknowledgeNurseTask('${u.id}', '${safeName}')" class="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-lg text-[10.5px] flex items-center gap-1 shadow-sm transition">
                    <i data-lucide="check" class="w-3.5 h-3.5"></i> Sudah Dikerjakan
                  </button>
                ` : ''}
                <button type="button" onclick="quickInspect('${u.id}')" class="py-1.5 px-3 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-extrabold rounded-lg text-[10.5px] flex items-center gap-1 shadow-sm transition">
                  <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Cek & Siapkan Kamar
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  const revisionHtml = revisionReports.length > 0 ? `
    <div class="mb-4 rounded-2xl bg-rose-50 border-2 border-rose-300 p-3.5 shadow-sm space-y-2.5">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping"></span>
          <h3 class="text-xs font-extrabold text-rose-900 uppercase tracking-wide">Perlu Perbaikan (${revisionReports.length} Kamar)</h3>
        </div>
        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-200 text-rose-900">Komplain Revisi</span>
      </div>
      <div class="space-y-2">
        ${revisionReports.map(rep => {
          const meta = parseNotesMetadata(rep.notes);
          const waktu = rep.created_at ? new Date(rep.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div class="bg-white rounded-xl p-3 border border-rose-200 space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-xs font-extrabold text-slate-900">${rep.unit_name}</p>
                  <p class="text-[11px] font-bold text-rose-700 mt-0.5">Komplain: ${meta.feedbackDetail || 'Periksa kembali kelengkapan & kebersihan kamar'}</p>
                </div>
                <span class="text-[10px] text-slate-400 shrink-0">${waktu}</span>
              </div>
              <div class="grid grid-cols-2 gap-1.5 pt-1">
                <button type="button" onclick="openReportInForm('${rep.id}')" class="py-2 px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-extrabold rounded-lg text-[10.5px] flex items-center justify-center gap-1 transition">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Buka & Perbaiki Form
                </button>
                <button type="button" onclick="markIssueResolvedByOfficer('${rep.id}')" class="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-lg text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                  <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> ${resolveBtnLabel}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  container.classList.remove('hidden');
  container.innerHTML = nurseTasksHtml + revisionHtml;
  lucide.createIcons();
}

// ==================== MODUL TEKNISI & FORM CEK PERBAIKAN FASILITAS ====================

async function completeTechCheckTask(reportId) {
  const rep = getTechCheckReports().find(r => String(r.id) === String(reportId));
  if (!rep) return;

  const chks = Array.from(document.querySelectorAll(`.tech-chk-${reportId}`));
  const updatedChecklist = TECHNICIAN_CHECKLIST_ITEMS.map((item, idx) => ({
    item: item.label,
    checked: chks[idx] ? chks[idx].checked : true
  }));
  const checkedCount = updatedChecklist.filter(c => c.checked).length;
  const score = Math.round((checkedCount / updatedChecklist.length) * 100);

  if (checkedCount < updatedChecklist.length) {
    if (!confirm(`Baru ${checkedCount} dari ${updatedChecklist.length} item teknis yang dicentang. Tetap tandai tugas teknis "${rep.unit_name}" selesai?`)) return;
  } else {
    if (!confirm(`Konfirmasi seluruh fasilitas teknis (AC, TV, Lampu, Air, Nurse Call) di "${rep.unit_name}" sudah dicek & normal?`)) return;
  }

  const techName = currentUser?.full_name || 'Teknisi';
  const meta = parseNotesMetadata(rep.notes);
  const updatedNotes = composeNotesWithMetadata(
    techName,
    `Selesai Cek Teknis oleh ${techName} (Skor ${score}%)`,
    'AC, TV, Lampu, Air/Sanitasi, Nurse Call',
    meta.cleanNotes
  );

  const { error } = await db.from('room_inspections').update({
    final_status: 'siap',
    readiness_score: score,
    checklist_data: updatedChecklist,
    notes: updatedNotes,
    created_at: new Date().toISOString()
  }).eq('id', rep.id);

  if (error) return alert('Gagal menyimpan laporan teknisi: ' + error.message);

  playNotificationChime();
  await loadAllData();
  alert(`Berhasil! Pengecekan teknis kamar ${rep.unit_name} selesai dicatat oleh ${techName}.`);
}

function renderTechnicianTaskSection() {
  const repairSection = document.getElementById('tab-repair');
  if (!repairSection) return;

  let techBox = document.getElementById('technician-auto-tasks-box');
  if (!techBox) {
    techBox = document.createElement('div');
    techBox.id = 'technician-auto-tasks-box';
    repairSection.insertBefore(techBox, repairSection.firstChild);
  }

  const techTasks = getTechCheckReports();
  const openTasks = techTasks.filter(r => r.final_status !== 'siap');

  if (!isTeknisiRole() && openTasks.length === 0) {
    techBox.innerHTML = '';
    techBox.classList.add('hidden');
    return;
  }

  techBox.classList.remove('hidden');
  techBox.innerHTML = `
    <div class="glass-card rounded-3xl p-4 shadow-sm border-2 ${openTasks.length > 0 ? 'border-sky-300 bg-sky-50/40' : 'border-slate-200'} space-y-3 mb-4">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${openTasks.length > 0 ? 'bg-sky-600 animate-ping' : 'bg-emerald-500'}"></span>
          <div>
            <h3 class="text-xs sm:text-sm font-extrabold text-slate-900">Tugas Pengecekan Fasilitas Teknis (${openTasks.length} Aktif)</h3>
            <p class="text-[10.5px] text-slate-500">Otomatis masuk saat Perawat menekan Siapkan Kamar / Minta Dibersihkan</p>
          </div>
        </div>
        <span class="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">Teknisi</span>
      </div>

      ${openTasks.length === 0 ? `
        <p class="text-xs text-slate-500 bg-white rounded-2xl p-3.5 border border-slate-200 text-center">Semua tugas pengecekan fasilitas teknis kamar sudah selesai.</p>
      ` : `
        <div class="space-y-3">
          ${openTasks.map(r => {
            const waktu = r.created_at ? new Date(r.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
            const unitObj = unitsData.find(u => String(u.id) === String(r.unit_id));
            return `
              <div class="bg-white rounded-2xl p-3.5 border border-sky-200 shadow-sm space-y-2.5">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <h4 class="text-xs font-extrabold text-slate-900">${r.unit_name} ${unitObj?.floor ? `• ${unitObj.floor}` : ''}</h4>
                    <p class="text-[11px] text-slate-500">Diminta oleh: <strong>${r.inspector_name}</strong> • ${waktu} WIB</p>
                  </div>
                  <span class="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">PERLU CEK TEKNIS</span>
                </div>
                <div class="space-y-1.5">
                  ${TECHNICIAN_CHECKLIST_ITEMS.map(it => `
                    <label class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] font-bold text-slate-800 cursor-pointer">
                      <span>${it.label}</span>
                      <input type="checkbox" checked class="tech-chk-${r.id} w-4 h-4 rounded text-teal-600" />
                    </label>
                  `).join('')}
                </div>
                <button type="button" onclick="completeTechCheckTask('${r.id}')" class="w-full py-2.5 px-3 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition">
                  <i data-lucide="check-circle-2" class="w-4 h-4"></i> Selesai Cek Teknis Kamar Ini
                </button>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
  lucide.createIcons();
}

function ensureRepairNavigationAndSection() {
  const navGrid = document.getElementById('bottom-nav-grid');
  if (navGrid && !document.getElementById('nav-item-repair')) {
    const repairBtn = document.createElement('button');
    repairBtn.type = 'button';
    repairBtn.id = 'nav-item-repair';
    repairBtn.dataset.tab = 'repair';
    repairBtn.className = 'nav-btn flex flex-col items-center justify-center py-2 px-1 rounded-xl text-slate-500 transition relative';
    repairBtn.onclick = () => switchTab('repair');
    repairBtn.innerHTML = `
      <i data-lucide="wrench" class="w-4 h-4 mb-0.5"></i>
      <span class="text-[10px] font-extrabold leading-tight">Perbaikan</span>
      <span id="repair-nav-badge" class="hidden absolute top-1 right-2 w-2 h-2 rounded-full bg-rose-500"></span>
    `;
    const analyticsBtn = Array.from(navGrid.querySelectorAll('.nav-btn')).find(b => b.dataset.tab === 'analytics');
    if (analyticsBtn) navGrid.insertBefore(repairBtn, analyticsBtn);
    else navGrid.appendChild(repairBtn);
  }

  const inspectSection = document.getElementById('tab-inspect');
  if (inspectSection && inspectSection.parentElement && !document.getElementById('tab-repair')) {
    const repairSection = document.createElement('section');
    repairSection.id = 'tab-repair';
    repairSection.className = 'page-section hidden space-y-4';
    repairSection.innerHTML = `
      <div class="glass-card rounded-3xl p-4 sm:p-5 shadow-sm border border-amber-200/80 space-y-4">
        <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-amber-500"></span>
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">Form Perbaikan & Maintenance</span>
            </div>
            <h2 class="text-base font-extrabold text-slate-900 mt-0.5">Form Cek Perbaikan Fasilitas</h2>
            <p class="text-[11px] text-slate-500">Ajukan perbaikan, penugasan teknisi oleh manajemen, & bukti selesai</p>
          </div>
          <span id="repair-mode-badge" class="shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">Pengajuan Baru</span>
        </div>

        <div id="repair-edit-banner" class="hidden rounded-2xl bg-indigo-50 border border-indigo-300 p-3 flex items-center justify-between gap-2">
          <p id="repair-edit-desc" class="text-[11px] text-indigo-950 font-semibold"></p>
          <button type="button" onclick="resetRepairForm()" class="shrink-0 px-2.5 py-1 bg-white border border-indigo-300 rounded-lg text-[10px] font-extrabold text-indigo-900">Buat Baru</button>
        </div>

        <form id="repair-inspection-form" class="space-y-3.5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-extrabold text-slate-700 mb-1">1. Unit Kamar / Area</label>
              <select id="repair-unit" required class="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 outline-none focus:border-amber-500"></select>
            </div>
            <div>
              <label class="block text-[11px] font-extrabold text-slate-700 mb-1">2. Shift Kerja</label>
              <select id="repair-shift" class="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 outline-none focus:border-amber-500"></select>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-extrabold text-slate-700 mb-1">3. Kategori Kerusakan</label>
              <select id="repair-category" class="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 outline-none focus:border-amber-500">
                <option value="Kelistrikan & Lampu">Kelistrikan & Lampu</option>
                <option value="AC & Sirkulasi Udara">AC & Sirkulasi Udara</option>
                <option value="Sanitasi, Keran & Toilet">Sanitasi, Keran & Toilet</option>
                <option value="Bed, Pintu & Furnitur">Bed, Pintu & Furnitur</option>
                <option value="Gas Medis & Alat">Gas Medis & Alat</option>
                <option value="Lainnya">Lainnya</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-extrabold text-slate-700 mb-1">4. Petugas Pelapor / Pengaju</label>
              <input type="text" id="repair-reporter-input" readonly class="w-full px-3 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 outline-none" />
            </div>
          </div>

          <div id="repair-assignment-box" class="rounded-2xl bg-indigo-50/80 border border-indigo-200 p-3 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-extrabold text-indigo-950 flex items-center gap-1.5">
                <i data-lucide="user-check" class="w-3.5 h-3.5 text-indigo-600"></i>
                5. Petugas / Teknisi yang Ditugaskan Memperbaiki
              </label>
              <span id="repair-assignee-lock-badge" class="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">Dipilih Manajemen</span>
            </div>
            <select id="repair-assignee-select" class="w-full px-3 py-2.5 rounded-xl bg-white border border-indigo-200 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"></select>
            <p id="repair-assignee-hint" class="text-[10.5px] text-indigo-700">Manajemen dapat memilih petugas/teknisi yang bertugas memperbaiki kerusakan ini.</p>
          </div>

          <div>
            <label class="block text-[11px] font-extrabold text-slate-700 mb-1">6. Detail Kerusakan / Keterangan Perbaikan</label>
            <textarea id="repair-notes" rows="2" required placeholder="Contoh: Keran wastafel bocor / lampu kamar mandi mati, mohon segera diperbaiki..." class="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 outline-none focus:border-amber-500"></textarea>
          </div>

          <div class="space-y-2">
            <label class="block text-[11px] font-extrabold text-slate-700">7. Dokumentasi Foto Perbaikan (Kamera / Album)</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div id="box-repair-before" class="rounded-2xl border-2 border-dashed border-slate-300 bg-gradient-to-b from-white to-slate-50 p-3 text-center space-y-2 transition">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-extrabold text-slate-800">Foto Kondisi Rusak (Awal)</span>
                  <button type="button" id="btn-clear-repair-before" onclick="clearRepairPhoto('before')" class="hidden text-[10px] font-bold text-rose-600 hover:underline">Hapus</button>
                </div>
                <div id="preview-wrap-repair-before" class="hidden">
                  <img id="preview-repair-before" onclick="zoomPhoto(this.src)" class="w-full h-36 object-cover rounded-xl border border-slate-200 cursor-pointer shadow-sm" />
                </div>
                <div id="placeholder-repair-before" class="py-3 text-slate-400">
                  <i data-lucide="camera" class="w-6 h-6 mx-auto mb-1 opacity-60"></i>
                  <p class="text-[10px]">Foto bagian yang rusak</p>
                </div>
                <div class="grid grid-cols-2 gap-1.5 pt-1">
                  <button type="button" onclick="triggerRepairPhotoPicker('before', 'camera')" class="py-2 px-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 shadow-sm transition">
                    <i data-lucide="camera" class="w-3.5 h-3.5"></i> Kamera
                  </button>
                  <button type="button" onclick="triggerRepairPhotoPicker('before', 'album')" class="py-2 px-2 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 shadow-sm transition">
                    <i data-lucide="image" class="w-3.5 h-3.5"></i> Album
                  </button>
                </div>
                <input type="file" id="input-camera-repair-before" accept="image/*" capture="environment" class="hidden" onchange="handleRepairPhoto(event, 'before')" />
                <input type="file" id="input-album-repair-before" accept="image/*" class="hidden" onchange="handleRepairPhoto(event, 'before')" />
              </div>

              <div id="box-repair-after" class="rounded-2xl border-2 border-dashed border-slate-300 bg-gradient-to-b from-white to-slate-50 p-3 text-center space-y-2 transition">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-extrabold text-slate-800">Foto Sesudah Diperbaiki</span>
                  <button type="button" id="btn-clear-repair-after" onclick="clearRepairPhoto('after')" class="hidden text-[10px] font-bold text-rose-600 hover:underline">Hapus</button>
                </div>
                <div id="preview-wrap-repair-after" class="hidden">
                  <img id="preview-repair-after" onclick="zoomPhoto(this.src)" class="w-full h-36 object-cover rounded-xl border border-slate-200 cursor-pointer shadow-sm" />
                </div>
                <div id="placeholder-repair-after" class="py-3 text-slate-400">
                  <i data-lucide="check-square" class="w-6 h-6 mx-auto mb-1 opacity-60"></i>
                  <p class="text-[10px]">Foto bukti setelah diperbaiki</p>
                </div>
                <div class="grid grid-cols-2 gap-1.5 pt-1">
                  <button type="button" onclick="triggerRepairPhotoPicker('after', 'camera')" class="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 shadow-sm transition">
                    <i data-lucide="camera" class="w-3.5 h-3.5"></i> Kamera
                  </button>
                  <button type="button" onclick="triggerRepairPhotoPicker('after', 'album')" class="py-2 px-2 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 shadow-sm transition">
                    <i data-lucide="image" class="w-3.5 h-3.5"></i> Album
                  </button>
                </div>
                <input type="file" id="input-camera-repair-after" accept="image/*" capture="environment" class="hidden" onchange="handleRepairPhoto(event, 'after')" />
                <input type="file" id="input-album-repair-after" accept="image/*" class="hidden" onchange="handleRepairPhoto(event, 'after')" />
              </div>
            </div>
          </div>

          <div id="repair-form-actions" class="space-y-2.5 pt-2">
            <div id="repair-request-buttons" class="grid grid-cols-2 gap-2.5">
              <button type="submit" id="btn-submit-repair-request" class="py-3.5 px-3 bg-amber-600 hover:bg-amber-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition">
                <i data-lucide="wrench" class="w-4 h-4"></i> Ajukan Perbaikan
              </button>
              <button type="button" id="btn-submit-repair-wa" onclick="saveRepairRequestAndWa()" class="py-3.5 px-3 bg-teal-600 hover:bg-teal-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition">
                <i data-lucide="send" class="w-4 h-4"></i> Ajukan & WA
              </button>
            </div>

            <button type="button" id="btn-assign-repair-worker" onclick="assignRepairWorkerFromForm()" class="hidden w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition">
              <i data-lucide="user-check" class="w-4 h-4"></i> Simpan & Tugaskan Petugas Perbaikan
            </button>

            <button type="button" id="btn-mark-repair-done" onclick="markActiveRepairAsDone()" class="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition">
              <i data-lucide="check-circle-2" class="w-4 h-4"></i> Sudah Diperbaiki (Selesai)
            </button>
          </div>
        </form>
      </div>

      <div class="space-y-2.5">
        <div class="flex items-center justify-between px-1">
          <h3 class="text-xs font-extrabold text-slate-800 uppercase tracking-wide">Daftar Pengajuan & Tugas Perbaikan</h3>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="refreshRepairListManual()" class="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-[10px] font-bold text-slate-700">Refresh</button>
            <span id="repair-history-count" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">0 Laporan</span>
          </div>
        </div>
        <div id="repair-history-list" class="space-y-3"></div>
      </div>
    `;
    inspectSection.parentElement.insertBefore(repairSection, inspectSection.nextSibling);
    document.getElementById('repair-inspection-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await processRepairRequestSubmit(false);
    });
  }
  renderTechnicianTaskSection();
  lucide.createIcons();
}

async function refreshRepairListManual() {
  const listEl = document.getElementById('repair-history-list');
  if (listEl) listEl.innerHTML = '<div class="text-center py-6 text-xs text-slate-400">Memuat data pengajuan perbaikan...</div>';
  await loadAllData();
}

function populateRepairFormDropdowns() {
  ensureRepairNavigationAndSection();

  const unitSel = document.getElementById('repair-unit');
  if (unitSel) {
    const prevUnit = unitSel.value;
    unitSel.innerHTML = unitsData.map(u => `<option value="${u.id}">${u.unit_code} - ${u.unit_name}</option>`).join('');
    if (prevUnit && unitsData.some(u => String(u.id) === String(prevUnit))) unitSel.value = prevUnit;
  }

  const shiftSel = document.getElementById('repair-shift');
  if (shiftSel) {
    const prevShift = shiftSel.value;
    shiftSel.innerHTML = shiftsData.map(s => `<option value="${s.name}">${s.hours ? `${s.name} (${s.hours})` : s.name}</option>`).join('');
    if (prevShift) shiftSel.value = prevShift;
  }

  const reporterInput = document.getElementById('repair-reporter-input');
  if (reporterInput && !activeRepairReportId && currentUser) {
    reporterInput.value = currentUser.full_name;
  }

  const assigneeSel = document.getElementById('repair-assignee-select');
  const assigneeBadge = document.getElementById('repair-assignee-lock-badge');
  const assigneeHint = document.getElementById('repair-assignee-hint');
  const btnAssign = document.getElementById('btn-assign-repair-worker');

  if (assigneeSel) {
    const prevAssignee = assigneeSel.value;
    const allStaff = usersData.length > 0
      ? usersData
      : [{ full_name: currentUser?.full_name || 'Petugas / Teknisi', role: 'teknisi' }];

    const optionsHtml = ['<option value="">-- Belum Ditentukan (Menunggu Penugasan Manajemen) --</option>']
      .concat(allStaff.map(u => `<option value="${u.full_name}">${u.full_name} (${u.role})</option>`))
      .join('');
    assigneeSel.innerHTML = optionsHtml;

    if (prevAssignee) assigneeSel.value = prevAssignee;

    if (isManagerRole()) {
      assigneeSel.disabled = false;
      if (assigneeBadge) {
        assigneeBadge.textContent = 'Pilih Pelaksana';
        assigneeBadge.className = 'text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-600 text-white';
      }
      if (assigneeHint) assigneeHint.textContent = 'Pilih petugas/teknisi yang harus mengerjakan perbaikan fasilitas ini.';
      if (btnAssign) btnAssign.classList.remove('hidden');
    } else {
      assigneeSel.disabled = true;
      if (assigneeBadge) {
        assigneeBadge.textContent = '🔒 Diatur Manajemen';
        assigneeBadge.className = 'text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700';
      }
      if (assigneeHint) assigneeHint.textContent = 'Bagian Manajemen yang akan menunjuk petugas/teknisi untuk memperbaiki laporan ini.';
      if (btnAssign) btnAssign.classList.add('hidden');
    }
  }
}

function triggerRepairPhotoPicker(slot, source) {
  const inputId = source === 'camera' ? `input-camera-repair-${slot}` : `input-album-repair-${slot}`;
  const el = document.getElementById(inputId);
  if (el) {
    el.value = '';
    el.click();
  }
}

function updateRepairPhotoBoxUI(slot, dataUrl) {
  const wrap = document.getElementById(`preview-wrap-repair-${slot}`);
  const prev = document.getElementById(`preview-repair-${slot}`);
  const ph = document.getElementById(`placeholder-repair-${slot}`);
  const box = document.getElementById(`box-repair-${slot}`);
  const btnClear = document.getElementById(`btn-clear-repair-${slot}`);

  if (dataUrl) {
    prev.src = dataUrl;
    wrap?.classList.remove('hidden');
    ph?.classList.add('hidden');
    btnClear?.classList.remove('hidden');
    if (box) {
      box.classList.remove('border-dashed', 'border-slate-300', 'from-white', 'to-slate-50');
      box.classList.add('border-solid', 'border-amber-400', 'bg-amber-50/30');
    }
  } else {
    wrap?.classList.add('hidden');
    ph?.classList.remove('hidden');
    btnClear?.classList.add('hidden');
    if (box) {
      box.classList.add('border-dashed', 'border-slate-300', 'from-white', 'to-slate-50');
      box.classList.remove('border-solid', 'border-amber-400', 'bg-amber-50/30');
    }
  }
}

function clearRepairPhoto(slot) {
  repairPhotos[slot] = null;
  updateRepairPhotoBoxUI(slot, null);
}

function resetRepairForm() {
  activeRepairReportId = null;
  repairPhotos = { before: null, after: null };
  clearRepairPhoto('before');
  clearRepairPhoto('after');
  document.getElementById('repair-edit-banner')?.classList.add('hidden');
  const badge = document.getElementById('repair-mode-badge');
  if (badge) {
    badge.textContent = 'Pengajuan Baru';
    badge.className = 'shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800';
  }
  const notesEl = document.getElementById('repair-notes');
  if (notesEl) notesEl.value = '';
  const btnReq = document.getElementById('btn-submit-repair-request');
  if (btnReq) btnReq.innerHTML = '<i data-lucide="wrench" class="w-4 h-4"></i> Ajukan Perbaikan';
  populateRepairFormDropdowns();
  const assigneeSel = document.getElementById('repair-assignee-select');
  if (assigneeSel) assigneeSel.value = '';
  lucide.createIcons();
}

function openRepairReportInForm(reportId) {
  const rep = getRepairReports().find(r => String(r.id) === String(reportId));
  if (!rep) return;
  switchTab('repair');
  populateRepairFormDropdowns();

  activeRepairReportId = rep.id;
  const meta = parseNotesMetadata(rep.notes);

  const unitSel = document.getElementById('repair-unit');
  if (unitSel && rep.unit_id) unitSel.value = rep.unit_id;

  const shiftSel = document.getElementById('repair-shift');
  const cleanShift = String(rep.shift || '').replace(/^Perbaikan\s*•\s*/i, '');
  if (shiftSel && cleanShift) shiftSel.value = cleanShift;

  const catSel = document.getElementById('repair-category');
  const savedCat = Array.isArray(rep.checklist_data) && rep.checklist_data[0]?.item ? rep.checklist_data[0].item : meta.feedbackDetail;
  if (catSel && savedCat) catSel.value = savedCat;

  const reporterInput = document.getElementById('repair-reporter-input');
  if (reporterInput) reporterInput.value = rep.inspector_name || '';

  const assigneeSel = document.getElementById('repair-assignee-select');
  if (assigneeSel) {
    const assignedName = meta.executor && meta.executor !== 'Belum Ditugaskan' ? meta.executor : '';
    if (assignedName && !Array.from(assigneeSel.options).some(o => o.value === assignedName)) {
      const opt = document.createElement('option');
      opt.value = assignedName;
      opt.textContent = assignedName;
      assigneeSel.appendChild(opt);
    }
    assigneeSel.value = assignedName;
  }

  const notesEl = document.getElementById('repair-notes');
  if (notesEl) notesEl.value = meta.cleanNotes.replace(REPAIR_RECORD_TAG, '').trim();

  repairPhotos = {
    before: rep.photo_room_url || null,
    after: rep.photo_toilet_url || null
  };
  updateRepairPhotoBoxUI('before', repairPhotos.before);
  updateRepairPhotoBoxUI('after', repairPhotos.after);

  const badge = document.getElementById('repair-mode-badge');
  if (badge) {
    badge.textContent = rep.final_status === 'siap' ? 'Sudah Diperbaiki' : 'Proses Perbaikan';
    badge.className = rep.final_status === 'siap'
      ? 'shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800'
      : 'shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800';
  }

  const banner = document.getElementById('repair-edit-banner');
  const desc = document.getElementById('repair-edit-desc');
  if (banner && desc) {
    desc.innerHTML = isManagerRole()
      ? `Mengelola pengajuan <strong>${rep.unit_name}</strong> (Pelapor: ${rep.inspector_name}). Pilih petugas pelaksana di bawah atau klik <strong>Sudah Diperbaiki</strong>.`
      : `Tugas perbaikan <strong>${rep.unit_name}</strong>${meta.executor && meta.executor !== 'Belum Ditugaskan' ? ` • Ditugaskan ke: <strong>${meta.executor}</strong>` : ''}. Upload foto sesudah lalu klik <strong>Sudah Diperbaiki</strong>.`;
    banner.classList.remove('hidden');
  }

  const btnReq = document.getElementById('btn-submit-repair-request');
  if (btnReq) btnReq.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Update Pengajuan';
  lucide.createIcons();
}

function handleRepairPhoto(e, slot) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 800 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      ctx.fillRect(0, canvas.height - 32, canvas.width, 32);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      const actor = currentUser ? currentUser.full_name : 'Petugas';
      const labelSlot = slot === 'before' ? 'SEBELUM' : 'SESUDAH';
      ctx.fillText(`[${labelSlot}] ${new Date().toLocaleString('id-ID')} • ${actor}`, 10, canvas.height - 12);
      repairPhotos[slot] = canvas.toDataURL('image/jpeg', 0.75);
      updateRepairPhotoBoxUI(slot, repairPhotos[slot]);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function processRepairRequestSubmit(alsoSendWa = false) {
  const unitId = document.getElementById('repair-unit')?.value;
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  if (!unit) return alert('Pilih unit kamar terlebih dahulu.');

  const shiftVal = document.getElementById('repair-shift')?.value || 'Shift Pagi';
  const categoryVal = document.getElementById('repair-category')?.value || 'Lainnya';
  const reporterVal = document.getElementById('repair-reporter-input')?.value.trim() || currentUser.full_name;
  const selectedAssignee = isManagerRole() ? (document.getElementById('repair-assignee-select')?.value || '') : '';
  const detailText = document.getElementById('repair-notes')?.value.trim();

  if (!detailText) return alert('Mohon isi detail kerusakan yang diajukan.');

  const executorStr = selectedAssignee || 'Belum Ditugaskan';
  const statusStr = selectedAssignee
    ? `Ditugaskan ke ${selectedAssignee} (Menunggu Perbaikan)`
    : 'Pengajuan Perbaikan Baru (Menunggu Penugasan Manajemen)';

  const composedNotes = composeNotesWithMetadata(
    executorStr,
    statusStr,
    categoryVal,
    `${REPAIR_RECORD_TAG}\n${detailText}`
  );

  const payload = {
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: reporterVal,
    inspector_role: currentUser.role,
    shift: `Perbaikan • ${shiftVal}`,
    readiness_score: 0,
    final_status: 'kotor',
    duration_seconds: 0,
    checklist_data: [
      { item: categoryVal, checked: false },
      { item: 'Foto Kondisi Rusak (Awal)', checked: Boolean(repairPhotos.before) },
      { item: 'Foto Sesudah Diperbaiki', checked: Boolean(repairPhotos.after) }
    ],
    notes: composedNotes,
    photo_room_url: repairPhotos.before,
    photo_toilet_url: repairPhotos.after
  };

  const btnReq = document.getElementById('btn-submit-repair-request');
  const btnWa = document.getElementById('btn-submit-repair-wa');
  if (btnReq) btnReq.disabled = true;
  if (btnWa) btnWa.disabled = true;

  let savedOk = false;
  let savedRecord = { ...payload, created_at: new Date().toISOString() };

  if (!navigator.onLine) {
    const q = JSON.parse(localStorage.getItem('ck_offline_queue') || '[]');
    q.push(payload);
    localStorage.setItem('ck_offline_queue', JSON.stringify(q));
    savedOk = true;
  } else if (activeRepairReportId) {
    const { data: updatedRows, error } = await db.from('room_inspections')
      .update({ ...payload, created_at: new Date().toISOString() })
      .eq('id', activeRepairReportId)
      .select();
    if (error) {
      alert('Gagal memperbarui pengajuan perbaikan: ' + error.message);
    } else {
      if (updatedRows?.[0]) savedRecord = updatedRows[0];
      await db.from('master_units').update({
        status: 'maintenance',
        last_checked_by: selectedAssignee ? `Perbaikan (${selectedAssignee})` : `Pengajuan Perbaikan: ${categoryVal}`,
        last_checked_at: new Date().toISOString()
      }).eq('id', unit.id);
      savedOk = true;
    }
  } else {
    const { data: insertedRows, error } = await db.from('room_inspections').insert([payload]).select();
    if (error) {
      alert('Gagal mengajukan perbaikan ke server: ' + error.message);
    } else {
      if (insertedRows?.[0]) {
        savedRecord = insertedRows[0];
        lastKnownReportId = savedRecord.id;
        localStorage.setItem('ck_last_seen_id', savedRecord.id);
      }
      await db.from('master_units').update({
        status: 'maintenance',
        last_checked_by: selectedAssignee ? `Perbaikan (${selectedAssignee})` : `Pengajuan Perbaikan: ${categoryVal}`,
        last_checked_at: new Date().toISOString()
      }).eq('id', unit.id);
      savedOk = true;
    }
  }

  if (btnReq) btnReq.disabled = false;
  if (btnWa) btnWa.disabled = false;

  if (savedOk) {
    resetRepairForm();
    playNotificationChime();
    await loadAllData();
    if (alsoSendWa) openWaShareModal(savedRecord);
    else alert(selectedAssignee
      ? `Pengajuan perbaikan tersimpan & ditugaskan kepada ${selectedAssignee}!`
      : 'Pengajuan perbaikan berhasil dikirim ke Manajemen!');
  }
}

async function saveRepairRequestAndWa() {
  await processRepairRequestSubmit(true);
}

async function assignRepairWorkerFromForm() {
  if (!isManagerRole()) return alert('Hanya Manajemen yang dapat menunjuk petugas perbaikan.');
  const chosenWorker = document.getElementById('repair-assignee-select')?.value || '';
  if (!chosenWorker) return alert('Silakan pilih terlebih dahulu nama petugas / teknisi yang harus memperbaiki.');

  if (!activeRepairReportId) {
    return processRepairRequestSubmit(false);
  }

  const rep = getRepairReports().find(r => String(r.id) === String(activeRepairReportId));
  if (!rep) return;

  const unitId = document.getElementById('repair-unit')?.value || rep.unit_id;
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  const categoryVal = document.getElementById('repair-category')?.value || 'Lainnya';
  const detailText = document.getElementById('repair-notes')?.value.trim() || parseNotesMetadata(rep.notes).cleanNotes.replace(REPAIR_RECORD_TAG, '').trim();
  const managerName = currentUser.full_name || 'Manajemen';

  const composedNotes = composeNotesWithMetadata(
    chosenWorker,
    `Ditugaskan ke ${chosenWorker} oleh ${managerName}`,
    categoryVal,
    `${REPAIR_RECORD_TAG}\n${detailText}`
  );

  const { error } = await db.from('room_inspections').update({
    unit_id: unit ? unit.id : rep.unit_id,
    unit_name: unit ? unit.unit_name : rep.unit_name,
    notes: composedNotes,
    photo_room_url: repairPhotos.before,
    photo_toilet_url: repairPhotos.after,
    created_at: new Date().toISOString()
  }).eq('id', rep.id);

  if (error) return alert('Gagal menugaskan petugas: ' + error.message);

  if (unit) {
    await db.from('master_units').update({
      status: 'maintenance',
      last_checked_by: `Perbaikan (${chosenWorker})`,
      last_checked_at: new Date().toISOString()
    }).eq('id', unit.id);
  }

  resetRepairForm();
  playNotificationChime();
  await loadAllData();
  alert(`Berhasil! Tugas perbaikan telah diberikan kepada ${chosenWorker}.`);
}

async function quickAssignRepairWorker(reportId, workerName) {
  if (!isManagerRole() || !workerName) return;
  const rep = getRepairReports().find(r => String(r.id) === String(reportId));
  if (!rep) return;

  const meta = parseNotesMetadata(rep.notes);
  const rawDetail = meta.cleanNotes.replace(REPAIR_RECORD_TAG, '').trim();
  const managerName = currentUser.full_name || 'Manajemen';

  const updatedNotes = composeNotesWithMetadata(
    workerName,
    `Ditugaskan ke ${workerName} oleh ${managerName}`,
    meta.feedbackDetail,
    `${REPAIR_RECORD_TAG}\n${rawDetail}`
  );

  const { error } = await db.from('room_inspections').update({
    notes: updatedNotes,
    created_at: new Date().toISOString()
  }).eq('id', rep.id);

  if (error) return alert('Gagal menugaskan petugas: ' + error.message);

  if (rep.unit_id) {
    await db.from('master_units').update({
      status: 'maintenance',
      last_checked_by: `Perbaikan (${workerName})`,
      last_checked_at: new Date().toISOString()
    }).eq('id', rep.unit_id);
  }

  playNotificationChime();
  await loadAllData();
}

async function markRepairCompletedById(reportId, overrideBefore = null, overrideAfter = null, overrideNotes = null) {
  const rep = getRepairReports().find(r => String(r.id) === String(reportId));
  if (!rep) return;

  if (!confirm(`Konfirmasi bahwa "${rep.unit_name}" SUDAH DIPERBAIKI?\n\nStatus kamar akan otomatis keluar dari Maintenance dan siap dibersihkan petugas.`)) return;

  const meta = parseNotesMetadata(rep.notes);
  const finisherName = currentUser ? currentUser.full_name : (meta.executor || 'Petugas');
  const rawDetail = overrideNotes !== null
    ? overrideNotes
    : meta.cleanNotes.replace(REPAIR_RECORD_TAG, '').trim();

  const updatedNotes = composeNotesWithMetadata(
    meta.executor && meta.executor !== 'Belum Ditugaskan' ? meta.executor : finisherName,
    `Sudah Diperbaiki (Selesai oleh ${finisherName})`,
    meta.feedbackDetail,
    `${REPAIR_RECORD_TAG}\n${rawDetail}`
  );

  const finalBefore = overrideBefore !== null ? overrideBefore : rep.photo_room_url;
  const finalAfter = overrideAfter !== null ? overrideAfter : rep.photo_toilet_url;

  const { error } = await db.from('room_inspections').update({
    final_status: 'siap',
    readiness_score: 100,
    checklist_data: [
      { item: meta.feedbackDetail || 'Perbaikan Fasilitas', checked: true },
      { item: 'Foto Kondisi Rusak (Awal)', checked: Boolean(finalBefore) },
      { item: 'Foto Sesudah Diperbaiki', checked: Boolean(finalAfter) }
    ],
    notes: updatedNotes,
    photo_room_url: finalBefore,
    photo_toilet_url: finalAfter,
    created_at: new Date().toISOString()
  }).eq('id', rep.id);

  if (error) return alert('Gagal memperbarui status sudah diperbaiki: ' + error.message);

  const matchedUnit = unitsData.find(u => String(u.id) === String(rep.unit_id) || normalizeText(u.unit_name) === normalizeText(rep.unit_name));
  const targetUnitId = matchedUnit ? matchedUnit.id : rep.unit_id;

  if (targetUnitId) {
    await db.from('master_units').update({
      status: 'kotor',
      last_checked_by: null,
      last_checked_at: new Date().toISOString()
    }).eq('id', targetUnitId);
  }

  resetRepairForm();
  playNotificationChime();
  await loadAllData();
  alert(`Berhasil! ${rep.unit_name} ditandai SUDAH DIPERBAIKI.`);
}

async function markActiveRepairAsDone() {
  if (activeRepairReportId) {
    const detailText = document.getElementById('repair-notes')?.value.trim() || '';
    await markRepairCompletedById(activeRepairReportId, repairPhotos.before, repairPhotos.after, detailText);
    return;
  }

  const unitId = document.getElementById('repair-unit')?.value;
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  if (!unit) return alert('Pilih unit kamar terlebih dahulu.');

  const shiftVal = document.getElementById('repair-shift')?.value || 'Shift Pagi';
  const categoryVal = document.getElementById('repair-category')?.value || 'Lainnya';
  const reporterVal = document.getElementById('repair-reporter-input')?.value.trim() || currentUser.full_name;
  const finisherName = currentUser ? currentUser.full_name : reporterVal;
  const detailText = document.getElementById('repair-notes')?.value.trim();

  if (!detailText) return alert('Mohon isi keterangan perbaikan yang sudah dikerjakan.');

  const composedNotes = composeNotesWithMetadata(
    finisherName,
    `Sudah Diperbaiki (Selesai oleh ${finisherName})`,
    categoryVal,
    `${REPAIR_RECORD_TAG}\n${detailText}`
  );

  const payload = {
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: reporterVal,
    inspector_role: currentUser.role,
    shift: `Perbaikan • ${shiftVal}`,
    readiness_score: 100,
    final_status: 'siap',
    duration_seconds: 0,
    checklist_data: [
      { item: categoryVal, checked: true },
      { item: 'Foto Kondisi Rusak (Awal)', checked: Boolean(repairPhotos.before) },
      { item: 'Foto Sesudah Diperbaiki', checked: Boolean(repairPhotos.after) }
    ],
    notes: composedNotes,
    photo_room_url: repairPhotos.before,
    photo_toilet_url: repairPhotos.after
  };

  const { error } = await db.from('room_inspections').insert([payload]);
  if (error) return alert('Gagal menyimpan laporan selesai perbaikan: ' + error.message);

  await db.from('master_units').update({
    status: 'kotor',
    last_checked_by: null,
    last_checked_at: new Date().toISOString()
  }).eq('id', unit.id);

  resetRepairForm();
  playNotificationChime();
  await loadAllData();
  alert(`Berhasil! Laporan perbaikan ${unit.unit_name} langsung tersimpan sebagai SUDAH DIPERBAIKI.`);
}

function renderRepairHistoryList() {
  const listEl = document.getElementById('repair-history-list');
  const countEl = document.getElementById('repair-history-count');
  const navBadge = document.getElementById('repair-nav-badge');
  if (!listEl) return;

  renderTechnicianTaskSection();

  const repairs = getRepairReports();
  const activeRepairsCount = repairs.filter(r => r.final_status !== 'siap').length;
  const activeTechCount = getTechCheckReports().filter(r => r.final_status !== 'siap').length;
  const totalActiveBadge = activeRepairsCount + (isTeknisiRole() ? activeTechCount : 0);

  if (countEl) countEl.textContent = `${repairs.length} Laporan`;
  if (navBadge) navBadge.classList.toggle('hidden', totalActiveBadge === 0);

  if (repairs.length === 0) {
    listEl.innerHTML = '<div class="text-center py-6 text-xs text-slate-400 bg-white/70 rounded-2xl border border-slate-200/70">Belum ada pengajuan perbaikan fasilitas.</div>';
    return;
  }

  listEl.innerHTML = repairs.map(r => {
    const waktuStr = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
    const meta = parseNotesMetadata(r.notes);
    const isDone = r.final_status === 'siap';
    const hasAssignee = meta.executor && meta.executor !== 'Belum Ditugaskan';
    const cleanDetail = meta.cleanNotes.replace(REPAIR_RECORD_TAG, '').trim();

    const badgeClass = isDone
      ? 'bg-emerald-100 text-emerald-700'
      : hasAssignee
        ? 'bg-indigo-100 text-indigo-800'
        : 'bg-amber-100 text-amber-800';
    const badgeText = isDone
      ? 'SUDAH DIPERBAIKI ✅'
      : hasAssignee
        ? 'SEDANG DITANGANI 🔧'
        : 'MENUNGGU PENUGASAN ⏳';

    const staffOptions = ['<option value="">-- Pilih Petugas yang Memperbaiki --</option>']
      .concat(usersData.map(u => `<option value="${u.full_name}" ${meta.executor === u.full_name ? 'selected' : ''}>${u.full_name} (${u.role})</option>`))
      .join('');

    return `
      <div class="glass-card rounded-2xl p-4 shadow-sm border ${isDone ? 'border-emerald-200' : 'border-amber-200'} space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h4 class="text-xs font-extrabold text-slate-900">${r.unit_name}</h4>
            <p class="text-[11px] text-slate-500">Pengaju: <strong>${r.inspector_name}</strong> • ${waktuStr}</p>
            <div class="flex flex-wrap items-center gap-1.5 mt-1">
              ${meta.feedbackDetail ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">${meta.feedbackDetail}</span>` : ''}
              <span class="text-[10px] font-extrabold px-2 py-0.5 rounded ${hasAssignee ? 'bg-indigo-50 text-indigo-800 border border-indigo-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                Pelaksana: ${hasAssignee ? meta.executor : 'Belum Ditugaskan'}
              </span>
            </div>
          </div>
          <span class="shrink-0 text-[9px] font-extrabold px-2.5 py-1 rounded-full ${badgeClass}">${badgeText}</span>
        </div>

        ${cleanDetail ? `<p class="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">${cleanDetail}</p>` : ''}

        ${(isManagerRole() && !isDone) ? `
          <div class="bg-indigo-50/80 border border-indigo-200 rounded-xl p-2.5 space-y-1.5">
            <label class="block text-[10px] font-extrabold text-indigo-950">Pilih Petugas / Teknisi yang Memperbaiki:</label>
            <select onchange="quickAssignRepairWorker('${r.id}', this.value)" class="w-full px-2.5 py-2 rounded-lg bg-white border border-indigo-200 text-xs font-bold text-slate-800 outline-none">
              ${staffOptions}
            </select>
          </div>
        ` : ''}

        ${(r.photo_room_url || r.photo_toilet_url) ? `
          <div class="grid grid-cols-2 gap-2">
            ${r.photo_room_url ? `
              <div class="space-y-1">
                <span class="text-[9.5px] font-bold text-slate-500 block">Foto Rusak (Awal)</span>
                <img src="${r.photo_room_url}" onclick="zoomPhoto(this.src)" class="w-full h-28 object-cover rounded-xl border cursor-pointer" />
              </div>
            ` : ''}
            ${r.photo_toilet_url ? `
              <div class="space-y-1">
                <span class="text-[9.5px] font-bold text-emerald-700 block">Foto Sesudah Diperbaiki</span>
                <img src="${r.photo_toilet_url}" onclick="zoomPhoto(this.src)" class="w-full h-28 object-cover rounded-xl border cursor-pointer" />
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div class="pt-1 flex items-center justify-end gap-1.5 flex-wrap">
          ${!isDone ? `
            <button type="button" onclick="openRepairReportInForm('${r.id}')" class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold rounded-xl flex items-center gap-1 transition">
              <i data-lucide="camera" class="w-3 h-3"></i> Upload Foto Sesudah
            </button>
            <button type="button" onclick="markRepairCompletedById('${r.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[11px] font-extrabold rounded-xl flex items-center gap-1 shadow-sm transition">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Sudah Diperbaiki
            </button>
          ` : ''}
          <button type="button" onclick="shareHistoryWaById('${r.id}')" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 shadow-sm transition">
            <i data-lucide="send" class="w-3 h-3"></i> Kirim WA
          </button>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

// =========================================================================

function getAppMainUrl() {
  const cleanPath = window.location.pathname.replace(/\/index\.html$/, '');
  const normalizedPath = cleanPath.endsWith('/') ? cleanPath : cleanPath + '/';
  return `${window.location.origin}${normalizedPath}`;
}

function sendAppInviteWa(targetRole) {
  const appUrl = getAppMainUrl();
  const lines = targetRole === 'manajemen' ? [
    '*UNDANGAN AKSES MONITORING*',
    '*Aplikasi Cek Kesiapan Kamar*',
    '*RS Khusus Bedah SS Medika*',
    '--------------------------------',
    'Yth. Bapak/Ibu Tim Manajemen,',
    '',
    'Berikut tautan aplikasi resmi untuk memantau status kesiapan kamar rawat inap, menugaskan perbaikan fasilitas, serta mengunduh rekap laporan (PDF/Excel):',
    '',
    '🔗 *Link Aplikasi:*',
    appUrl,
    '',
    'Terima kasih.'
  ] : [
    '*UNDANGAN OPERASIONAL TIM*',
    '*Aplikasi Cek Kesiapan Kamar*',
    '*RS Khusus Bedah SS Medika*',
    '--------------------------------',
    'Halo Rekan-Rekan Tim,',
    '',
    'Silakan akses aplikasi di bawah ini untuk melakukan permintaan kamar (Perawat), pengecekan kesiapan kamar, pengecekan teknis, dan dokumentasi foto:',
    '',
    '🔗 *Link Aplikasi:*',
    appUrl,
    '',
    'Selamat bertugas!'
  ];

  closeActiveModal('modal-about');
  window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
}

async function copyAppInviteLink() {
  const appUrl = getAppMainUrl();
  const btn = document.getElementById('btn-copy-invite');
  try {
    await navigator.clipboard.writeText(appUrl);
    if (btn) {
      btn.innerHTML = '<i data-lucide="check" class="w-3 h-3"></i> Tersalin!';
      lucide.createIcons();
      setTimeout(() => {
        btn.innerHTML = '<i data-lucide="copy" class="w-3 h-3"></i> Salin Link';
        lucide.createIcons();
      }, 2000);
    }
  } catch (e) {
    prompt('Salin link aplikasi berikut:', appUrl);
  }
}

function parseNotesMetadata(rawNotes) {
  const text = rawNotes || '';
  const lines = text.split('\n');
  let executor = '';
  let feedbackStatus = '';
  let feedbackDetail = '';
  const cleanLines = [];

  lines.forEach(line => {
    if (line.startsWith('[Pelaksana: ') && line.endsWith(']')) {
      executor = line.slice(12, -1).trim();
    } else if (line.startsWith('[Tanggapan Pemeriksa: ') && line.endsWith(']')) {
      const inner = line.slice(22, -1).trim();
      const splitIdx = inner.indexOf(' — Bagian Perbaikan: ');
      if (splitIdx !== -1) {
        feedbackStatus = inner.slice(0, splitIdx).trim();
        feedbackDetail = inner.slice(splitIdx + 21).trim();
      } else {
        feedbackStatus = inner;
      }
    } else {
      cleanLines.push(line);
    }
  });

  return { executor, feedbackStatus, feedbackDetail, cleanNotes: cleanLines.join('\n').trim() };
}

function composeNotesWithMetadata(executorName, feedbackStatus, feedbackDetail, extraNotes) {
  const parts = [];
  if (executorName && executorName !== '__same__') parts.push(`[Pelaksana: ${executorName}]`);
  if (feedbackStatus) {
    if (feedbackDetail) parts.push(`[Tanggapan Pemeriksa: ${feedbackStatus} — Bagian Perbaikan: ${feedbackDetail}]`);
    else parts.push(`[Tanggapan Pemeriksa: ${feedbackStatus}]`);
  }
  if (extraNotes) parts.push(extraNotes);
  return parts.join('\n');
}

function handleFeedbackStatusChange() {
  const st = document.getElementById('inspect-feedback-status')?.value || '';
  if (!canCurrentUserApprove() && requireApprovalMode && st.includes('Approved')) {
    document.getElementById('inspect-feedback-status').value = `Menunggu Approval ${getApprovalTargetLabel()}`;
    return;
  }
  const detailInput = document.getElementById('inspect-feedback-detail');
  if (detailInput && (st.includes('Perlu Perbaikan') || st.includes('Wajib Diperbaiki'))) detailInput.focus();
}

function handleSecretHistoryTap() {
  if (!isManagerRole()) return;
  secretTapCount++;
  clearTimeout(secretTapTimer);
  secretTapTimer = setTimeout(() => { secretTapCount = 0; }, 2000);
  if (secretTapCount >= 5) {
    secretTapCount = 0;
    if (creatorDeleteUnlocked) {
      creatorDeleteUnlocked = false;
      document.getElementById('creator-mode-badge')?.classList.add('hidden');
      renderAnalytics();
      return;
    }
    const pinInput = prompt('Masukkan PIN Pembuat Aplikasi:');
    if (pinInput === CREATOR_PIN) {
      creatorDeleteUnlocked = true;
      document.getElementById('creator-mode-badge')?.classList.remove('hidden');
      renderAnalytics();
    } else if (pinInput !== null) {
      alert('PIN tidak sesuai.');
    }
  }
}

async function deleteHistoryRecord(id, unitName, unitId) {
  if (!creatorDeleteUnlocked || !isManagerRole()) return;
  if (!confirm(`Hapus permanen riwayat laporan "${unitName}"?`)) return;
  const { error } = await db.from('room_inspections').delete().eq('id', id);
  if (error) return alert('Gagal menghapus riwayat: ' + error.message);

  inspectionsData = inspectionsData.filter(item => String(item.id) !== String(id));
  if (lastKnownReportId === id) {
    lastKnownReportId = inspectionsData[0]?.id || null;
    if (lastKnownReportId) localStorage.setItem('ck_last_seen_id', lastKnownReportId);
    else localStorage.removeItem('ck_last_seen_id');
  }

  if (unitId) {
    const remainingForUnit = getRoomChecklistReports().filter(item => String(item.unit_id) === String(unitId));
    if (remainingForUnit.length > 0) {
      const latest = remainingForUnit[0];
      const approved = isInspectionOfficiallyApproved(latest);
      await db.from('master_units').update({
        status: approved ? 'siap' : 'kotor',
        last_checked_at: latest.created_at,
        last_checked_by: approved ? `Approved: ${latest.inspector_name}` : `${latest.inspector_name} (Menunggu Approval)`
      }).eq('id', unitId);
    } else {
      await db.from('master_units').update({ status: 'kotor', last_checked_at: null, last_checked_by: null }).eq('id', unitId);
    }
  }
  await loadAllData();
}

function getIsoWeekString(dateObj) {
  const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function initExportPeriodInputs() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const dayEl = document.getElementById('export-filter-day');
  const weekEl = document.getElementById('export-filter-week');
  const startEl = document.getElementById('export-filter-start');
  const endEl = document.getElementById('export-filter-end');
  const monthEl = document.getElementById('export-filter-month');
  const yearEl = document.getElementById('export-filter-year');
  const unitEl = document.getElementById('export-filter-unit');

  if (dayEl && !dayEl.value) dayEl.value = todayStr;
  if (weekEl && !weekEl.value) weekEl.value = getIsoWeekString(now);
  if (startEl && !startEl.value) startEl.value = todayStr;
  if (endEl && !endEl.value) endEl.value = todayStr;
  if (monthEl && !monthEl.value) monthEl.value = `${yyyy}-${mm}`;

  if (yearEl) {
    const yearsSet = new Set([yyyy, yyyy - 1]);
    inspectionsData.forEach(r => {
      if (r.created_at) {
        const y = new Date(r.created_at).getFullYear();
        if (!isNaN(y)) yearsSet.add(y);
      }
    });
    const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
    const prevVal = yearEl.value || String(yyyy);
    yearEl.innerHTML = sortedYears.map(y => `<option value="${y}">Tahun ${y}</option>`).join('');
    yearEl.value = prevVal;
  }

  if (unitEl) {
    const prevUnit = unitEl.value || 'all';
    const unitOptions = ['<option value="all">Semua Kamar</option>'];
    unitsData.forEach(u => unitOptions.push(`<option value="${u.unit_name}">${u.unit_name}</option>`));
    unitEl.innerHTML = unitOptions.join('');
    unitEl.value = prevUnit;
  }
}

function handleExportPeriodTypeChange() {
  const type = document.getElementById('export-period-type')?.value || 'all';
  document.getElementById('wrap-filter-day')?.classList.toggle('hidden', type !== 'day');
  document.getElementById('wrap-filter-week')?.classList.toggle('hidden', type !== 'week');
  document.getElementById('wrap-filter-range')?.classList.toggle('hidden', type !== 'range');
  document.getElementById('wrap-filter-month')?.classList.toggle('hidden', type !== 'month');
  document.getElementById('wrap-filter-year')?.classList.toggle('hidden', type !== 'year');
  renderAnalytics();
}

function getLocalYmd(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getFilteredExportData() {
  const type = document.getElementById('export-period-type')?.value || 'all';
  const selectedUnit = document.getElementById('export-filter-unit')?.value || 'all';

  let rows = [...inspectionsData];
  let periodLabel = 'Semua Periode';
  let fileSuffix = new Date().toISOString().slice(0, 10);

  if (selectedUnit !== 'all') rows = rows.filter(r => r.unit_name === selectedUnit);

  if (type === 'day') {
    const targetDay = document.getElementById('export-filter-day')?.value || '';
    rows = rows.filter(r => r.created_at && getLocalYmd(r.created_at) === targetDay);
    periodLabel = `Tanggal ${targetDay}`;
    fileSuffix = `Harian_${targetDay}`;
  } else if (type === 'week') {
    const targetWeek = document.getElementById('export-filter-week')?.value || '';
    rows = rows.filter(r => r.created_at && getIsoWeekString(new Date(r.created_at)) === targetWeek);
    periodLabel = `Minggu ${targetWeek}`;
    fileSuffix = `Mingguan_${targetWeek}`;
  } else if (type === 'range') {
    const startDay = document.getElementById('export-filter-start')?.value || '';
    const endDay = document.getElementById('export-filter-end')?.value || '';
    rows = rows.filter(r => {
      if (!r.created_at) return false;
      const ymd = getLocalYmd(r.created_at);
      if (startDay && ymd < startDay) return false;
      if (endDay && ymd > endDay) return false;
      return true;
    });
    periodLabel = `${startDay} s/d ${endDay}`;
    fileSuffix = `Periode_${startDay}_sd_${endDay}`;
  } else if (type === 'month') {
    const targetMonth = document.getElementById('export-filter-month')?.value || '';
    rows = rows.filter(r => {
      if (!r.created_at) return false;
      const d = new Date(r.created_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === targetMonth;
    });
    periodLabel = `Bulan ${targetMonth}`;
    fileSuffix = `Bulanan_${targetMonth}`;
  } else if (type === 'year') {
    const targetYear = document.getElementById('export-filter-year')?.value || '';
    rows = rows.filter(r => r.created_at && String(new Date(r.created_at).getFullYear()) === targetYear);
    periodLabel = `Tahun ${targetYear}`;
    fileSuffix = `Tahunan_${targetYear}`;
  }

  if (selectedUnit !== 'all') {
    periodLabel += ` • ${selectedUnit}`;
    fileSuffix += `_${selectedUnit.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }
  return { rows, label: periodLabel, fileSuffix };
}

function computeAnalyticsSummary(filteredRows) {
  const totalRooms = unitsData.length;
  const occupiedRooms = unitsData.filter(u => isRoomBookedByNurse(u)).length;
  const vacantRooms = Math.max(0, totalRooms - occupiedRooms);
  const occupiedPct = totalRooms ? Math.round((occupiedRooms / totalRooms) * 100) : 0;
  const vacantPct = totalRooms ? Math.round((vacantRooms / totalRooms) * 100) : 0;

  // Skor kesiapan murni: hanya dari laporan checklist kamar & cek teknis (tidak tercampur log permintaan perawat)
  const pureInspections = filteredRows.filter(r => !isNurseRequestRecord(r) && !isRepairRecord(r));
  const pureAvgScore = pureInspections.length
    ? Math.round(pureInspections.reduce((acc, r) => acc + Number(r.readiness_score || 0), 0) / pureInspections.length)
    : 0;
  const avgDuration = pureInspections.length
    ? Math.round(pureInspections.reduce((acc, r) => acc + Number(r.duration_seconds || 0), 0) / pureInspections.length)
    : 0;

  // Hitung Kedisiplinan (%) tiap Petugas & Teknisi
  const staffMembers = usersData.filter(u => {
    const r = (u.role || '').toLowerCase();
    return r === 'petugas' || r === 'teknisi';
  });

  const disciplineRows = staffMembers.map(u => {
    const isTech = (u.role || '').toLowerCase() === 'teknisi';
    const userNameNorm = normalizeText(u.full_name);

    const matchedTasks = filteredRows.filter(r => {
      if (isTech) {
        if (!isTechCheckRecord(r) && !isRepairRecord(r)) return false;
      } else {
        if (isNurseRequestRecord(r) || isTechCheckRecord(r) || isRepairRecord(r)) return false;
      }
      const meta = parseNotesMetadata(r.notes);
      const execNorm = normalizeText(meta.executor);
      const inspNorm = normalizeText(r.inspector_name);
      return (execNorm && execNorm === userNameNorm) || (inspNorm && inspNorm === userNameNorm);
    });

    const totalTasks = matchedTasks.length;
    const completedOnStandard = matchedTasks.filter(r => {
      if (isTech) return r.final_status === 'siap';
      return !isRevisionRequested(r) && Number(r.readiness_score || 0) === 100;
    }).length;

    const avgTaskScore = totalTasks
      ? Math.round(matchedTasks.reduce((a, b) => a + Number(b.readiness_score || 0), 0) / totalTasks)
      : 0;
    const disciplinePct = totalTasks ? Math.round((completedOnStandard / totalTasks) * 100) : 0;

    return {
      fullName: u.full_name,
      role: isTech ? 'Teknisi' : 'Petugas Kebersihan',
      totalTasks,
      completedOnStandard,
      avgTaskScore,
      disciplinePct
    };
  });

  return {
    totalRooms,
    occupiedRooms,
    vacantRooms,
    occupiedPct,
    vacantPct,
    pureInspectionsCount: pureInspections.length,
    pureAvgScore,
    avgDuration,
    disciplineRows
  };
}

function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [880, 1174.66, 1318.51].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0.001, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.24, now + idx * 0.12 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.38);
    });
  } catch (e) {}
}

function updateNotificationPermissionUI() {
  const bar = document.getElementById('notif-permission-bar');
  const label = document.getElementById('notif-status-label');
  const btnSettings = document.getElementById('btn-enable-notif-settings');
  if (!('Notification' in window)) {
    if (bar) bar.classList.add('hidden');
    if (label) label.textContent = 'Browser tidak mendukung notifikasi sistem';
    if (btnSettings) btnSettings.classList.add('hidden');
    return;
  }
  if (Notification.permission === 'granted') {
    if (bar) bar.classList.add('hidden');
    if (label) label.textContent = 'Status Notifikasi HP: Aktif ✅';
    if (btnSettings) btnSettings.classList.add('hidden');
  } else if (Notification.permission === 'denied') {
    if (bar) bar.classList.add('hidden');
    if (label) label.textContent = 'Status Notifikasi HP: Diblokir di Pengaturan Browser';
    if (btnSettings) btnSettings.classList.add('hidden');
  } else {
    if (bar) bar.classList.remove('hidden');
    if (label) label.textContent = 'Status Notifikasi HP: Belum Diaktifkan';
    if (btnSettings) btnSettings.classList.remove('hidden');
  }
}

async function requestNativeNotificationPermission() {
  if (!('Notification' in window)) return alert('Perangkat atau browser ini tidak mendukung notifikasi sistem.');
  const perm = await Notification.requestPermission();
  updateNotificationPermissionUI();
  if (perm === 'granted') testNotificationAlert();
}

async function triggerNativePhoneNotification(title, body, reportId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const targetUrl = reportId ? getPublicReportUrl(reportId, true) : window.location.href;
  const options = { body, icon: './192x192.png', badge: './192x192.png', vibrate: [250, 100, 250], tag: 'cek-kamar-' + (reportId || Date.now()), renotify: true, data: { url: targetUrl } };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) { await reg.showNotification(title, options); return; }
    }
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); if (reportId) window.location.href = targetUrl; };
  } catch (e) {}
}

function showInAppBanner(report) {
  latestNotifReport = report;
  const banner = document.getElementById('live-toast-banner');
  const isNurseReq = isNurseRequestRecord(report);
  const isTechReq = isTechCheckRecord(report);
  const isRepair = isRepairRecord(report);
  const isApproved = isInspectionOfficiallyApproved(report);
  const isRev = isRevisionRequested(report);
  const meta = parseNotesMetadata(report.notes);
  const actorName = meta.executor || report.inspector_name;

  let statusLabel = `MENUNGGU APPROVAL (${getApprovalTargetLabel().toUpperCase()}) ⏳`;
  let badgeLabel = 'Laporan Kamar • Baru Saja';
  let bodyLabel = canCurrentUserApprove()
    ? `Oleh ${actorName} • Klik untuk cek form & approve`
    : `Oleh ${actorName} • Laporan info kesiapan kamar`;

  if (isTechReq) {
    statusLabel = report.final_status === 'siap' ? 'CEK TEKNIS SELESAI ✅' : 'TUGAS CEK TEKNIS 🔧';
    badgeLabel = `Teknisi (${report.inspector_name})`;
    bodyLabel = getSpokenTextForReport(report);
  } else if (isNurseReq) {
    const reqType = getNurseRequestTypeFromString((report.notes || '') + ' ' + (report.shift || ''));
    statusLabel = reqType.toastTitle;
    badgeLabel = `Permintaan Perawat (${actorName})`;
    bodyLabel = getSpokenTextForReport(report);
  } else if (isRepair) {
    statusLabel = report.final_status === 'siap' ? 'SUDAH DIPERBAIKI ✅' : 'PENGAJUAN PERBAIKAN 🔧';
    badgeLabel = 'Cek Perbaikan Fasilitas • Baru Saja';
    bodyLabel = `Pelaksana: ${actorName} • ${meta.feedbackDetail || 'Perbaikan Kamar'}`;
  } else if (isApproved) {
    statusLabel = 'SIAP PAKAI ✅';
    badgeLabel = 'Laporan Kesiapan Kamar • Baru Saja';
    bodyLabel = `Oleh ${actorName} • Skor ${report.readiness_score}%`;
  } else if (isRev) {
    statusLabel = 'PERLU PERBAIKAN ⚠️';
    badgeLabel = 'Komplain Revisi • Baru Saja';
    bodyLabel = `Komplain: ${meta.feedbackDetail || 'Segera perbaiki kamar ini'}`;
  }

  document.getElementById('toast-banner-badge').textContent = badgeLabel;
  document.getElementById('toast-banner-title').textContent = `${report.unit_name} • ${statusLabel}`;
  document.getElementById('toast-banner-body').textContent = bodyLabel;
  document.getElementById('toast-banner-time').textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  banner.classList.remove('hidden', 'banner-slide-in');
  void banner.offsetWidth;
  banner.classList.add('banner-slide-in');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(hideToastBanner, 9000);
}

function hideToastBanner() { document.getElementById('live-toast-banner')?.classList.add('hidden'); }

function openLatestNotifFromBanner() {
  hideToastBanner();
  if (latestNotifReport && isTechCheckRecord(latestNotifReport)) {
    if (!isPerawatRole()) switchTab('repair');
  } else if (latestNotifReport && isNurseRequestRecord(latestNotifReport)) {
    if (isPetugasRole() && latestNotifReport.unit_id) quickInspect(latestNotifReport.unit_id);
    else if (!isPerawatRole()) switchTab('dashboard');
  } else if (latestNotifReport && isRepairRecord(latestNotifReport)) {
    openRepairReportInForm(latestNotifReport.id);
  } else if (latestNotifReport && latestNotifReport.id && !isInspectionOfficiallyApproved(latestNotifReport) && canCurrentUserApprove()) {
    openReportInForm(latestNotifReport.id);
  } else if (isManagerRole() || isPerawatRole()) {
    openNotificationDrawer();
  } else if (latestNotifReport && latestNotifReport.id) {
    openReportFullView(latestNotifReport.id);
  } else {
    switchTab('analytics');
  }
}

function openReportFullView(reportId) {
  window.location.href = getPublicReportUrl(reportId, true);
}

function handleIncomingNewReport(report) {
  if (!report || !report.id) return;
  const isUpdate = lastKnownReportId === report.id;
  lastKnownReportId = report.id;
  localStorage.setItem('ck_last_seen_id', report.id);

  const isNurseReq = isNurseRequestRecord(report);
  const isTechReq = isTechCheckRecord(report);
  const isRepair = isRepairRecord(report);
  const isApproved = isInspectionOfficiallyApproved(report);
  const isRev = isRevisionRequested(report);

  if (!isUpdate || !isApproved) {
    unreadNotifCount++;
    const badge = document.getElementById('notif-unread-badge');
    const bell = document.getElementById('notif-bell-icon');
    if (badge) { badge.textContent = unreadNotifCount > 9 ? '9+' : String(unreadNotifCount); badge.classList.remove('hidden'); }
    if (bell) { bell.classList.remove('bell-animate'); void bell.offsetWidth; bell.classList.add('bell-animate'); }

    playNotificationChime();
    const spokenText = getSpokenTextForReport(report);
    speakIndonesianAlert(spokenText);

    if (navigator.vibrate) navigator.vibrate([250, 100, 250]);
    showInAppBanner(report);

    const meta = parseNotesMetadata(report.notes);
    const actorName = meta.executor || report.inspector_name;

    let notifTitle = canCurrentUserApprove()
      ? `Approval Dibutuhkan: ${report.unit_name}`
      : `Laporan Kesiapan Kamar: ${report.unit_name}`;
    let notifBody = canCurrentUserApprove()
      ? `Petugas ${actorName} selesai cek (${report.readiness_score}%). Mohon cek form & approve.`
      : `Petugas ${actorName} selesai menyiapkan kamar (${report.readiness_score}%).`;

    if (isTechReq) {
      notifTitle = `Tugas Cek Teknis: ${report.unit_name}`;
      notifBody = spokenText;
    } else if (isNurseReq) {
      const reqType = getNurseRequestTypeFromString((report.notes || '') + ' ' + (report.shift || ''));
      notifTitle = `${reqType.label}: ${report.unit_name}`;
      notifBody = spokenText;
    } else if (isRepair) {
      notifTitle = report.final_status === 'siap' ? `Sudah Diperbaiki: ${report.unit_name}` : `Pengajuan Perbaikan: ${report.unit_name}`;
      notifBody = `Pelaksana: ${actorName} • ${meta.feedbackStatus}`;
    } else if (isApproved) {
      notifTitle = `Kamar Siap Pakai: ${report.unit_name}`;
      notifBody = `Oleh ${actorName} (${report.readiness_score}%).`;
    } else if (isRev) {
      notifTitle = `Perlu Perbaikan: ${report.unit_name}`;
      notifBody = `Komplain: ${meta.feedbackDetail || 'Segera lakukan perbaikan kamar.'}`;
    }

    triggerNativePhoneNotification(notifTitle, notifBody, report.id);
  }
  loadAllData();
}

function testNotificationAlert() {
  const sample = inspectionsData[0] || {
    id: null,
    unit_name: 'Kamar 201 - SVIP',
    inspector_name: currentUser ? currentUser.full_name : 'Perawat',
    shift: 'Siapkan Kamar • 08:00 WIB',
    readiness_score: 0,
    final_status: 'kotor',
    notes: '[JENIS_LAPORAN: PERMINTAAN_PERAWAT]\n[REQ_TYPE: siapkan]'
  };
  playNotificationChime();
  speakIndonesianAlert('Tes notifikasi suara aktif. Tolong siapkan kamar nomor 201, Lantai 2.');
  if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
  showInAppBanner(sample);
  triggerNativePhoneNotification('Tes Notifikasi Suara Cek Kamar', 'Notifikasi suara bahasa Indonesia aktif!', sample.id);
}

function openNotificationDrawer() {
  unreadNotifCount = 0;
  document.getElementById('notif-unread-badge')?.classList.add('hidden');
  const listEl = document.getElementById('notif-drawer-list');
  if (!inspectionsData.length) {
    listEl.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Belum ada riwayat laporan masuk.</p>';
  } else {
    const resolveBtnLabel = requireApprovalMode ? 'Selesai Perbaikan & Minta Approve' : 'Selesai Perbaikan (Siap Pakai)';
    const userCanApprove = canCurrentUserApprove();
    listEl.innerHTML = inspectionsData.slice(0, 20).map(r => {
      const isNurseReq = isNurseRequestRecord(r);
      const isTechReq = isTechCheckRecord(r);
      const isRepair = isRepairRecord(r);
      const isApproved = isInspectionOfficiallyApproved(r);
      const isRev = isRevisionRequested(r);
      const meta = parseNotesMetadata(r.notes);
      const actorName = meta.executor || r.inspector_name;
      const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const reqType = isNurseReq ? getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')) : null;

      const cardStyle = isTechReq
        ? 'bg-sky-50/80 border-sky-200'
        : isNurseReq
          ? 'bg-orange-50/80 border-orange-200'
          : isRepair
            ? 'bg-amber-50/80 border-amber-200'
            : isApproved
              ? 'bg-slate-50 border-slate-200/80'
              : isRev
                ? 'bg-rose-50/80 border-rose-200'
                : 'bg-indigo-50/70 border-indigo-200';
      const badgeStyle = isTechReq
        ? 'bg-sky-100 text-sky-800'
        : isNurseReq
          ? reqType.badgeClass
          : isRepair
            ? (r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')
            : isApproved
              ? 'bg-emerald-100 text-emerald-700'
              : isRev
                ? 'bg-rose-100 text-rose-800'
                : 'bg-indigo-100 text-indigo-800';
      const badgeLabel = isTechReq
        ? (r.final_status === 'siap' ? 'TEKNIS SELESAI' : 'CEK TEKNISI')
        : isNurseReq
          ? reqType.shortTag
          : isRepair
            ? (r.final_status === 'siap' ? 'SUDAH DIPERBAIKI' : 'CEK PERBAIKAN')
            : isApproved ? 'SIAP PAKAI' : isRev ? 'PERLU PERBAIKAN' : `MENUNGGU APPROVAL (${getApprovalTargetLabel().toUpperCase()})`;

      return `
        <div class="p-3 rounded-2xl ${cardStyle} border transition space-y-2">
          <div onclick="${(r.id && !isPerawatRole()) ? `openReportFullView('${r.id}')` : ''}" class="cursor-pointer space-y-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-extrabold text-slate-900 truncate">${r.unit_name}</span>
              <span class="shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full ${badgeStyle}">${badgeLabel}</span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500">
              <span class="truncate">Oleh: <strong>${actorName}</strong></span>
              <span class="shrink-0 text-[10px]">${waktu}</span>
            </div>
            ${isRev && meta.feedbackDetail ? `<p class="text-[11px] font-bold text-rose-700">Komplain: ${meta.feedbackDetail}</p>` : ''}
            ${(isNurseReq || isTechReq) ? `<p class="text-[11px] font-semibold text-slate-700">${getSpokenTextForReport(r)}</p>` : ''}
          </div>
          ${(isPetugasRole() && isNurseReq && r.unit_id) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); quickInspect('${r.unit_id}');" class="w-full py-2.5 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Cek & Siapkan Kamar Ini
            </button>
          ` : ''}
          ${(userCanApprove && !isApproved && !isRepair && !isNurseReq && !isTechReq && r.id) ? `
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" onclick="closeActiveModal('modal-notifications'); approveReportById('${r.id}');" class="py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Approve Siap Pakai
              </button>
              <button type="button" onclick="closeActiveModal('modal-notifications'); requestRevisionByManagement('${r.unit_id || ''}', '${(r.unit_name || '').replace(/'/g, "\\'")}', '${r.id}');" class="py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> Perlu Diperbaiki
              </button>
            </div>
          ` : ''}
          ${(isTechReq && r.final_status !== 'siap' && (isTeknisiRole() || isManagerRole())) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); switchTab('repair');" class="w-full py-2.5 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="wrench" class="w-3.5 h-3.5"></i> Buka Tugas Cek Teknis
            </button>
          ` : ''}
          ${(isRepair && r.final_status !== 'siap' && r.id && !isPerawatRole()) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); openRepairReportInForm('${r.id}');" class="w-full py-2.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="wrench" class="w-3.5 h-3.5"></i> Kelola / Tandai Sudah Diperbaiki
            </button>
          ` : ''}
          ${(isPetugasRole() && isRev && !isRepair && !isNurseReq && !isTechReq && r.id) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); markIssueResolvedByOfficer('${r.id}');" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> ${resolveBtnLabel}
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }
  openModalWithHistory('modal-notifications');
  lucide.createIcons();
}

function startRealtimeReportListener() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db.channel('room-inspections-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_inspections' }, (payload) => { if (payload?.new) handleIncomingNewReport(payload.new); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'room_inspections' }, (payload) => {
      if (payload?.new && !isInspectionOfficiallyApproved(payload.new)) handleIncomingNewReport(payload.new);
      else loadAllData();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'room_inspections' }, () => { loadAllData(); })
    .subscribe();

  clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    if (!navigator.onLine) return;
    const { data } = await db.from('room_inspections').select('*').order('created_at', { ascending: false }).limit(1);
    if (data && data[0]) {
      if (!lastKnownReportId) { lastKnownReportId = data[0].id; localStorage.setItem('ck_last_seen_id', data[0].id); }
      else if (data[0].id !== lastKnownReportId) handleIncomingNewReport(data[0]);
    }
  }, 8000);
}

function getPublicReportUrl(reportId, withProtocol = true) {
  const cleanPath = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
  const hostAndPath = window.location.host + cleanPath;
  const prefix = withProtocol ? window.location.protocol + '//' : '';
  if (!reportId) return prefix + hostAndPath;
  return `${prefix}${hostAndPath}?l=${encodeURIComponent(String(reportId).slice(0, 8))}`;
}

async function loadPublicReport(codeParam) {
  const container = document.getElementById('public-report-container');
  try {
    let matched = null;
    if (codeParam.length >= 32) {
      const { data } = await db.from('room_inspections').select('*').eq('id', codeParam).single();
      matched = data;
    } else {
      const { data } = await db.from('room_inspections').select('*').order('created_at', { ascending: false }).limit(100);
      if (Array.isArray(data)) matched = data.find(item => String(item.id).toLowerCase().startsWith(codeParam.toLowerCase()));
    }
    if (!matched) throw new Error('Data laporan tidak ditemukan atau sudah dihapus.');
    currentPublicReport = matched;
    renderPublicReportView(matched);
  } catch (err) {
    container.innerHTML = `<div class="bg-white rounded-3xl p-6 text-center shadow-sm space-y-2 border border-rose-200"><p class="text-sm font-extrabold text-rose-600">Laporan Tidak Ditemukan</p><p class="text-xs text-slate-500">${err.message}</p></div>`;
  }
}

function renderPublicReportView(r) {
  const container = document.getElementById('public-report-container');
  const isNurseReq = isNurseRequestRecord(r);
  const isTechReq = isTechCheckRecord(r);
  const isRepair = isRepairRecord(r);
  const isApproved = isInspectionOfficiallyApproved(r);
  const isRev = isRevisionRequested(r);
  const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '-';
  const meta = parseNotesMetadata(r.notes);
  const cleanNotesText = meta.cleanNotes
    .replace(REPAIR_RECORD_TAG, '')
    .replace(CHECKOUT_RECORD_TAG, '')
    .replace(NURSE_REQ_TAG, '')
    .replace(TECH_CHECK_TAG, '')
    .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
    .trim();
  const reqType = isNurseReq ? getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')) : null;

  const checklistHtml = Array.isArray(r.checklist_data) && r.checklist_data.length > 0
    ? r.checklist_data.map(c => `<div class="flex items-center justify-between py-2 px-3 rounded-xl ${c.checked ? 'bg-emerald-50/70 text-slate-800' : 'bg-rose-50/70 text-rose-800'}"><span class="text-xs font-bold">${c.item}</span><span class="text-xs font-extrabold">${c.checked ? '✅ Sesuai' : '❌ Belum'}</span></div>`).join('')
    : '<p class="text-xs text-slate-400">Tidak ada rincian checklist.</p>';

  const badgeClass = isTechReq
    ? (r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-800')
    : isNurseReq
      ? reqType.badgeClass
      : isRepair
        ? (r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')
        : isApproved
          ? 'bg-emerald-100 text-emerald-700'
          : isRev
            ? 'bg-rose-100 text-rose-800'
            : 'bg-indigo-100 text-indigo-800';
  const badgeText = isTechReq
    ? (r.final_status === 'siap' ? 'CEK TEKNIS SELESAI ✅' : 'TUGAS CEK TEKNISI 🔧')
    : isNurseReq
      ? reqType.shortTag
      : isRepair
        ? (r.final_status === 'siap' ? 'SUDAH DIPERBAIKI ✅' : 'PENGAJUAN PERBAIKAN 🔧')
        : isApproved
          ? 'SIAP PAKAI ✅'
          : isRev
            ? 'PERLU PERBAIKAN ⚠️'
            : 'MENUNGGU APPROVAL ⏳';

  const photo1Label = isRepair ? 'Foto Rusak (Awal)' : 'Area Kamar';
  const photo2Label = isRepair ? 'Foto Sesudah Diperbaiki' : 'Kamar Mandi';

  container.innerHTML = `
    <div id="public-pdf-area" class="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4">
      <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <span class="text-[10px] font-extrabold uppercase tracking-wider text-teal-600">RS Khusus Bedah SS Medika</span>
          <h2 class="text-lg font-extrabold text-slate-900 mt-0.5">${r.unit_name}</h2>
          <p class="text-xs text-slate-500 mt-0.5">Waktu Laporan: <strong>${waktu}</strong></p>
        </div>
        <div class="text-right shrink-0">
          <span class="inline-block text-xs font-extrabold px-3 py-1 rounded-full ${badgeClass}">${badgeText}</span>
          ${(!isRepair && !isNurseReq) ? `<p class="text-lg font-extrabold text-teal-700 mt-1">Skor: ${r.readiness_score}%</p>` : ''}
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-xs">
        <div><span class="text-[10px] text-slate-400 font-bold block">${isNurseReq ? 'PERAWAT PELAPOR' : isRepair ? 'PETUGAS PENGAJU' : 'PETUGAS PEMERIKSA'}</span><span class="font-extrabold text-slate-800">${r.inspector_name}</span></div>
        <div><span class="text-[10px] text-slate-400 font-bold block">WAKTU / SHIFT</span><span class="font-extrabold text-slate-800">${r.shift}</span></div>
        ${meta.executor ? `<div class="col-span-2 pt-1 border-t border-slate-200/70"><span class="text-[10px] text-indigo-600 font-bold block">${isNurseReq ? 'PERAWAT BERTUGAS' : isTechReq ? 'TEKNISI PELAKSANA' : isRepair ? 'PETUGAS YANG DITUGASKAN' : 'PETUGAS PELAKSANA'}</span><span class="font-extrabold text-slate-800">${meta.executor}</span></div>` : ''}
      </div>
      ${meta.feedbackStatus ? `<div class="${isApproved || r.final_status === 'siap' ? 'bg-emerald-50/80 border-emerald-200' : isRev ? 'bg-rose-50/80 border-rose-200' : 'bg-amber-50/80 border-amber-200'} border rounded-2xl p-3 space-y-1"><span class="text-[10px] font-extrabold uppercase ${isApproved || r.final_status === 'siap' ? 'text-emerald-800' : isRev ? 'text-rose-800' : 'text-amber-800'} block">Status & Tanggapan</span><p class="text-xs font-extrabold text-slate-800">${meta.feedbackStatus}</p>${meta.feedbackDetail ? `<p class="text-xs text-rose-700 font-semibold">${isNurseReq ? 'Instruksi' : isRepair ? 'Kategori' : 'Keterangan'}: ${meta.feedbackDetail}</p>` : ''}</div>` : ''}
      ${(r.photo_room_url || r.photo_toilet_url) ? `<div class="space-y-2"><h3 class="text-xs font-extrabold text-slate-800">Dokumentasi Foto</h3><div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${r.photo_room_url ? `<div class="space-y-1"><span class="text-[10px] font-bold text-slate-500">${photo1Label}</span><img src="${r.photo_room_url}" onclick="zoomPhoto(this.src)" class="w-full h-48 object-cover rounded-2xl border border-slate-200 cursor-pointer shadow-sm" /></div>` : ''}${r.photo_toilet_url ? `<div class="space-y-1"><span class="text-[10px] font-bold text-slate-500">${photo2Label}</span><img src="${r.photo_toilet_url}" onclick="zoomPhoto(this.src)" class="w-full h-48 object-cover rounded-2xl border border-slate-200 cursor-pointer shadow-sm" /></div>` : ''}</div></div>` : ''}
      <div class="space-y-2"><h3 class="text-xs font-extrabold text-slate-800">Rincian</h3><div class="space-y-1.5">${checklistHtml}</div></div>
      ${cleanNotesText ? `<div class="bg-amber-50/70 border border-amber-200 rounded-2xl p-3"><span class="text-[10px] font-extrabold uppercase text-amber-800 block">Catatan</span><p class="text-xs text-slate-700 mt-0.5">${cleanNotesText}</p></div>` : ''}
    </div>
  `;
  lucide.createIcons();
}

function sharePublicReportWa() {
  if (!currentPublicReport) return;
  window.open(`https://wa.me/?text=${encodeURIComponent(buildWaMessage(currentPublicReport, true, true))}`, '_blank');
}

function zoomPhoto(src) {
  document.getElementById('zoom-photo-img').src = src;
  openModalWithHistory('modal-photo-zoom');
}

function downloadPublicReportPdf() {
  if (!currentPublicReport) return;
  const btn = document.getElementById('btn-public-pdf');
  btn.disabled = true; btn.textContent = '...';
  const el = document.getElementById('public-pdf-area');
  const safeName = (currentPublicReport.unit_name || 'Kamar').replace(/[^a-zA-Z0-9_-]/g, '_');
  html2pdf().set({ margin: 10, filename: `Laporan_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(el).save().then(() => {
    btn.disabled = false; btn.innerHTML = '<i data-lucide="download" class="w-3.5 h-3.5"></i> PDF'; lucide.createIcons();
  });
}

function exitPublicReportMode() {
  window.location.href = window.location.origin + window.location.pathname;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  ['btn-install-login', 'btn-install-modal'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  ['btn-install-login', 'btn-install-modal'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
});

async function triggerPwaInstall() {
  if (!deferredInstallPrompt) return alert('Ketuk menu titik tiga (⋮) di pojok kanan atas browser Chrome lalu pilih "Tambahkan ke Layar utama" atau "Install aplikasi".');
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') deferredInstallPrompt = null;
}

window.addEventListener('DOMContentLoaded', () => {
  ensurePerawatRoleOptionInAccountForm();
  renderMasterShifts();
  populateShiftDropdown();
  const params = new URLSearchParams(window.location.search);
  const reportCode = params.get('l') || params.get('laporan');
  if (reportCode) { loadPublicReport(reportCode); return; }
  updateNetworkStatus();
  window.addEventListener('online', () => { updateNetworkStatus(); syncOfflineQueue(); });
  window.addEventListener('offline', updateNetworkStatus);
  if (currentUser) enterApp();
  else document.documentElement.classList.remove('has-session');
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errBox = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');
  errBox.classList.add('hidden'); btn.disabled = true; btn.innerHTML = '<span>Memverifikasi...</span>';
  try {
    const { data, error } = await db.from('app_users').select('*').eq('username', username).eq('password', password).single();
    if (error || !data) {
      if ((username === 'admin' && password === 'azis123') || (username === 'petugas1' && password === 'petugas123') || (username === 'perawat1' && password === 'perawat123') || (username === 'teknisi1' && password === 'teknisi123')) {
        currentUser = {
          username,
          full_name: username === 'admin' ? 'Supervisor Manajemen' : username === 'perawat1' ? 'Perawat Nurse Station' : username === 'teknisi1' ? 'Teknisi Fasilitas' : 'Petugas Shift Pagi',
          role: username === 'admin' ? 'manajemen' : username === 'perawat1' ? 'perawat' : username === 'teknisi1' ? 'teknisi' : 'petugas'
        };
      } else throw new Error('Username atau password salah!');
    } else currentUser = data;
    localStorage.setItem('ck_user', JSON.stringify(currentUser));
    document.documentElement.classList.add('has-session');
    enterApp();
  } catch (err) {
    errBox.textContent = err.message || 'Gagal terhubung ke server';
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.innerHTML = 'Masuk Aplikasi';
  }
});

function populateOfficerDropdown() {
  const sel = document.getElementById('inspect-officer-select');
  const execSel = document.getElementById('inspect-executor-select');
  const execBadge = document.getElementById('executor-lock-badge');
  const fbSel = document.getElementById('inspect-feedback-status');
  const optApproved = document.getElementById('opt-feedback-approved');
  const list = [...usersData];

  let managerOnly = list.filter(u => {
    const role = (u.role || '').toLowerCase();
    const name = (u.full_name || '').toLowerCase();
    return role === 'manajemen' || name.includes('supervisor') || name.includes('manajemen');
  });

  if (currentUser && isManagerRole() && !managerOnly.some(u => u.full_name === currentUser.full_name)) {
    managerOnly.unshift({ full_name: currentUser.full_name, role: 'manajemen' });
  }
  if (managerOnly.length === 0) {
    managerOnly = [{ full_name: 'Supervisor Manajemen', role: 'manajemen' }];
  }

  if (sel) {
    const prevManager = sel.value;
    sel.innerHTML = managerOnly.map(u => `<option value="${u.full_name}">${u.full_name}</option>`).join('');
    if (prevManager && managerOnly.some(u => u.full_name === prevManager)) sel.value = prevManager;
    else if (isManagerRole() && currentUser?.full_name) sel.value = currentUser.full_name;
    else sel.value = managerOnly[0].full_name;
  }

  if (execSel) {
    if (isPetugasRole() && currentUser) {
      execSel.innerHTML = `<option value="${currentUser.full_name}">${currentUser.full_name}</option>`;
      execSel.value = currentUser.full_name;
      execSel.disabled = true;
      if (execBadge) execBadge.textContent = '🔒 Terkunci';
    } else {
      const prevExec = execSel.value;
      const petugasOnly = list.filter(u => (u.role || '').toLowerCase() === 'petugas');
      const finalPetugasList = petugasOnly.length > 0 ? petugasOnly : [{ full_name: 'Petugas Kebersihan', role: 'petugas' }];
      execSel.innerHTML = finalPetugasList.map(u => `<option value="${u.full_name}">${u.full_name}</option>`).join('');
      if (prevExec && finalPetugasList.some(u => u.full_name === prevExec)) execSel.value = prevExec;
      execSel.disabled = false;
      if (execBadge) execBadge.textContent = '';
    }
  }

  if (optApproved) {
    const lockApprovedOption = !canCurrentUserApprove() && requireApprovalMode;
    optApproved.disabled = lockApprovedOption;
    optApproved.hidden = lockApprovedOption;
  }
  if (fbSel && !activeReviewReportId) {
    if (canCurrentUserApprove() || !requireApprovalMode) {
      fbSel.value = 'Sesuai Standar (Approved)';
    } else {
      fbSel.value = 'Menunggu Approval Manajemen';
    }
  }

  const btnSubmit = document.getElementById('btn-submit-inspect');
  if (btnSubmit && !activeReviewReportId) {
    btnSubmit.textContent = (!canCurrentUserApprove() && requireApprovalMode) ? 'Ajukan Approval' : 'Simpan Laporan';
  }
}

function triggerPhotoPicker(type, source) {
  const inputId = source === 'camera' ? `input-camera-${type}` : `input-album-${type}`;
  const el = document.getElementById(inputId);
  if (el) {
    el.value = '';
    el.click();
  }
}

function updatePhotoBoxUI(type, dataUrl) {
  const wrap = document.getElementById('preview-wrap-' + type);
  const prev = document.getElementById('preview-' + type);
  const ph = document.getElementById('placeholder-' + type);
  const box = document.getElementById('box-upload-' + type);
  const btnClear = document.getElementById('btn-clear-' + type);

  if (dataUrl) {
    prev.src = dataUrl;
    prev.classList.remove('photo-pop');
    void prev.offsetWidth;
    prev.classList.add('photo-pop');
    wrap?.classList.remove('hidden');
    ph?.classList.add('hidden');
    btnClear?.classList.remove('hidden');
    if (box) {
      box.classList.remove('border-dashed', 'border-slate-300', 'from-white', 'to-slate-50');
      box.classList.add('border-solid', 'border-emerald-400', 'bg-emerald-50/30');
    }
  } else {
    wrap?.classList.add('hidden');
    ph?.classList.remove('hidden');
    btnClear?.classList.add('hidden');
    if (box) {
      box.classList.add('border-dashed', 'border-slate-300', 'from-white', 'to-slate-50');
      box.classList.remove('border-solid', 'border-emerald-400', 'bg-emerald-50/30');
    }
  }
}

function clearSinglePhoto(type) {
  watermarkedPhotos[type] = null;
  updatePhotoBoxUI(type, null);
}

function resetPhotoBoxes() {
  clearSinglePhoto('room');
  clearSinglePhoto('toilet');
}

function clearBottomFormReviewBar() {
  document.getElementById('bottom-review-actions')?.remove();
  const btnSubmit = document.getElementById('btn-submit-inspect');
  const btnWa = document.getElementById('btn-submit-wa');
  if (btnSubmit) {
    btnSubmit.classList.remove('hidden');
    btnSubmit.textContent = (!canCurrentUserApprove() && requireApprovalMode) ? 'Ajukan Approval' : 'Simpan Laporan';
  }
  if (btnWa) {
    btnWa.classList.remove('hidden');
    if (btnWa.parentElement) btnWa.parentElement.classList.remove('hidden');
  }
}

function clearPrefillFormState() {
  activeReviewReportId = null;
  document.getElementById('prefill-review-banner')?.classList.add('hidden');
  clearBottomFormReviewBar();
  document.querySelectorAll('.inspect-chk').forEach(c => { c.checked = false; });
  updateScore();
  resetPhotoBoxes();
  const notesEl = document.getElementById('inspect-notes');
  if (notesEl) notesEl.value = '';
  const detailEl = document.getElementById('inspect-feedback-detail');
  if (detailEl) detailEl.value = '';
}

function resetFormForFreshCheck() {
  clearPrefillFormState();
  populateOfficerDropdown();
  populateShiftDropdown();
}

function populateFormWithReport(latestRep) {
  if (!latestRep) {
    clearPrefillFormState();
    populateOfficerDropdown();
    populateShiftDropdown();
    return;
  }

  if (isPetugasRole()) {
    officerFormUnlocked = true;
    updateInspectFormVisibilityForRole();
  }

  const realChecklistItems = itemsData.filter(i => !isSystemMetaCategory(i.category));
  if (document.querySelectorAll('.inspect-chk').length === 0 && realChecklistItems.length > 0) {
    renderInspectForm();
  }

  activeReviewReportId = latestRep.id;
  const meta = parseNotesMetadata(latestRep.notes);
  const isRev = isRevisionRequested(latestRep);

  const unitSel = document.getElementById('inspect-unit');
  if (unitSel) {
    const matchedUnit = unitsData.find(u =>
      (latestRep.unit_id && String(u.id) === String(latestRep.unit_id)) ||
      normalizeText(u.unit_name) === normalizeText(latestRep.unit_name)
    );
    if (matchedUnit) unitSel.value = matchedUnit.id;
  }

  populateShiftDropdown();
  const shiftEl = document.getElementById('inspect-shift');
  if (shiftEl && latestRep.shift) {
    if (!Array.from(shiftEl.options).some(o => o.value === latestRep.shift)) {
      const opt = document.createElement('option');
      opt.value = latestRep.shift;
      opt.textContent = latestRep.shift;
      shiftEl.prepend(opt);
    }
    shiftEl.value = latestRep.shift;
  }

  const execSel = document.getElementById('inspect-executor-select');
  const executorName = meta.executor || latestRep.inspector_name;
  if (execSel && executorName) {
    if (isPetugasRole() && currentUser) {
      execSel.innerHTML = `<option value="${currentUser.full_name}">${currentUser.full_name}</option>`;
      execSel.value = currentUser.full_name;
      execSel.disabled = true;
    } else {
      if (!Array.from(execSel.options).some(o => o.value === executorName)) {
        const opt = document.createElement('option');
        opt.value = executorName;
        opt.textContent = executorName;
        execSel.prepend(opt);
      }
      execSel.value = executorName;
    }
  }

  const fbSel = document.getElementById('inspect-feedback-status');
  if (fbSel) {
    fbSel.value = (canCurrentUserApprove() || !requireApprovalMode) ? 'Sesuai Standar (Approved)' : 'Menunggu Approval Manajemen';
  }

  const detailEl = document.getElementById('inspect-feedback-detail');
  if (detailEl) detailEl.value = meta.feedbackDetail || '';

  const notesEl = document.getElementById('inspect-notes');
  if (notesEl) notesEl.value = meta.cleanNotes || '';

  const savedChecklist = Array.isArray(latestRep.checklist_data) ? latestRep.checklist_data : [];
  document.querySelectorAll('.inspect-chk').forEach(chk => {
    const labelText = chk.dataset.name || '';
    const match = savedChecklist.find(c =>
      (c.item || '').trim().toLowerCase() === labelText.trim().toLowerCase()
    );
    if (match) chk.checked = Boolean(match.checked);
    else chk.checked = savedChecklist.length > 0 && latestRep.readiness_score === 100;
  });
  updateScore();

  watermarkedPhotos = {
    room: latestRep.photo_room_url || null,
    toilet: latestRep.photo_toilet_url || null
  };
  updatePhotoBoxUI('room', watermarkedPhotos.room);
  updatePhotoBoxUI('toilet', watermarkedPhotos.toilet);

  const banner = document.getElementById('prefill-review-banner');
  const desc = document.getElementById('prefill-review-desc');
  const btnApprove = document.getElementById('btn-direct-approve-form');
  const btnSubmit = document.getElementById('btn-submit-inspect');
  const btnWa = document.getElementById('btn-submit-wa');

  clearBottomFormReviewBar();

  if (banner && desc) {
    if (canCurrentUserApprove()) {
      desc.innerHTML = `Petugas <strong>${executorName}</strong> telah mengisi form ini (Skor: <strong>${latestRep.readiness_score}%</strong>). Periksa checklist & foto, lalu pilih <strong>Approve</strong> atau <strong>Perlu Diperbaiki</strong> di bagian paling bawah form.`;
      banner.classList.remove('hidden');
      if (btnApprove) btnApprove.classList.add('hidden');
      if (btnSubmit) btnSubmit.classList.add('hidden');
      if (btnWa && btnWa.parentElement) btnWa.parentElement.classList.add('hidden');

      const formEl = document.getElementById('inspection-form');
      if (formEl) {
        const bottomBar = document.createElement('div');
        bottomBar.id = 'bottom-review-actions';
        bottomBar.className = 'pt-2 grid grid-cols-2 gap-2.5';
        bottomBar.innerHTML = `
          <button type="button" onclick="approveActiveFormReport()" class="py-3.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-extrabold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition">
            <i data-lucide="check-circle-2" class="w-4 h-4"></i> APPROVE (SIAP PAKAI)
          </button>
          <button type="button" onclick="requestRevisionFromActiveForm()" class="py-3.5 px-3 bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-extrabold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/25 transition">
            <i data-lucide="alert-triangle" class="w-4 h-4"></i> PERLU DIPERBAIKI
          </button>
        `;
        formEl.appendChild(bottomBar);
        lucide.createIcons();
      }
    } else if (isPetugasRole() && isRev) {
      desc.innerHTML = `Komplain revisi pada <strong>${latestRep.unit_name}</strong>: <span class="text-rose-700 font-bold">${meta.feedbackDetail || 'Periksa kembali kelengkapan kamar'}</span>. Silakan perbaiki lalu simpan ulang.`;
      banner.classList.remove('hidden');
      if (btnApprove) btnApprove.classList.add('hidden');
      if (btnSubmit) {
        btnSubmit.classList.remove('hidden');
        btnSubmit.textContent = requireApprovalMode ? 'Simpan Perbaikan & Minta Approve' : 'Simpan Perbaikan (Siap Pakai)';
      }
      if (btnWa && btnWa.parentElement) btnWa.parentElement.classList.remove('hidden');
    } else {
      desc.innerHTML = `Menampilkan hasil pengisian form terakhir oleh <strong>${executorName}</strong> (Skor: <strong>${latestRep.readiness_score}%</strong>).`;
      banner.classList.remove('hidden');
      if (btnApprove) btnApprove.classList.add('hidden');
      if (btnSubmit) btnSubmit.classList.remove('hidden');
      if (btnWa && btnWa.parentElement) btnWa.parentElement.classList.remove('hidden');
    }
  }
}

function handleInspectUnitChange() {
  const unitId = document.getElementById('inspect-unit')?.value;
  if (!unitId) return;
  const unitObj = unitsData.find(u => String(u.id) === String(unitId));
  const latestRep = getLatestInspectionForUnit(unitId, unitObj?.unit_name);
  if (latestRep && !isInspectionOfficiallyApproved(latestRep)) {
    populateFormWithReport(latestRep);
  } else {
    clearPrefillFormState();
    populateOfficerDropdown();
    populateShiftDropdown();
  }
}

function openReportInForm(reportId) {
  const rep = inspectionsData.find(r => String(r.id) === String(reportId));
  if (!rep) return;
  if (isRepairRecord(rep)) {
    openRepairReportInForm(reportId);
    return;
  }
  if (isPetugasRole()) officerFormUnlocked = true;
  switchTab('inspect');
  populateFormWithReport(rep);
}

function applyRolePermissions() {
  const role = (currentUser?.role || 'petugas').toLowerCase();
  const isManager = isManagerRole();
  const isPerawat = isPerawatRole();
  const isTeknisi = isTeknisiRole();
  const isPetugas = isPetugasRole();

  ensureRepairNavigationAndSection();

  const badge = document.getElementById('user-role-badge');
  if (badge) {
    badge.textContent = role.toUpperCase();
    badge.className = isManager
      ? 'text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 tracking-wider'
      : isPerawat
        ? 'text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 tracking-wider'
        : isTeknisi
          ? 'text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 tracking-wider'
          : 'text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 tracking-wider';
  }

  const navGrid = document.getElementById('bottom-nav-grid');
  if (navGrid) {
    const dashBtn = navGrid.querySelector('[data-tab="dashboard"]');
    const inspectBtn = navGrid.querySelector('[data-tab="inspect"]');
    const repairBtn = navGrid.querySelector('[data-tab="repair"]');
    const analyticsBtn = navGrid.querySelector('[data-tab="analytics"]');
    const masterBtn = navGrid.querySelector('[data-tab="master"]');

    if (isManager) {
      // Manajemen: Dasbor, Cek Kamar, Perbaikan, Analitik, Pengaturan (5 menu)
      dashBtn?.classList.remove('hidden');
      inspectBtn?.classList.remove('hidden');
      repairBtn?.classList.remove('hidden');
      analyticsBtn?.classList.remove('hidden');
      masterBtn?.classList.remove('hidden');
      navGrid.className = 'max-w-3xl mx-auto grid grid-cols-5 gap-1';
    } else if (isPerawat) {
      // Perawat: Dasbor saja
      dashBtn?.classList.remove('hidden');
      inspectBtn?.classList.add('hidden');
      repairBtn?.classList.add('hidden');
      analyticsBtn?.classList.add('hidden');
      masterBtn?.classList.add('hidden');
      navGrid.className = 'max-w-3xl mx-auto grid grid-cols-1 gap-1.5';
    } else if (isTeknisi) {
      // Teknisi: Perbaikan (Cek Teknis & Maintenance) + Analitik (2 menu)
      dashBtn?.classList.add('hidden');
      inspectBtn?.classList.add('hidden');
      repairBtn?.classList.remove('hidden');
      analyticsBtn?.classList.remove('hidden');
      masterBtn?.classList.add('hidden');
      navGrid.className = 'max-w-3xl mx-auto grid grid-cols-2 gap-1.5';
    } else {
      // Petugas Kebersihan: Menu Cek Kamar dihilangkan dari navigasi bawah!
      // Halaman utama Petugas langsung berada di tab-inspect (box Permintaan Perawat & Revisi),
      // sedangkan navigasi bawah menampilkan: Permintaan Kamar (ke inspect), Perbaikan, dan Analitik
      dashBtn?.classList.add('hidden');
      inspectBtn?.classList.add('hidden');
      repairBtn?.classList.remove('hidden');
      analyticsBtn?.classList.remove('hidden');
      masterBtn?.classList.add('hidden');
      navGrid.className = 'max-w-3xl mx-auto grid grid-cols-2 gap-1.5';
    }
  }

  document.getElementById('invite-box-about')?.classList.toggle('hidden', !isManager);
  document.getElementById('user-management-card')?.classList.toggle('hidden', !isManager);
  renderApprovalToggleCard();
}

function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('user-greeting').textContent = `Halo, ${currentUser.full_name}`;
  ensurePerawatRoleOptionInAccountForm();
  applyRolePermissions();
  renderOfficerRevisionBanner();
  updateNotificationPermissionUI();
  populateOfficerDropdown();
  populateShiftDropdown();
  loadAllData().then(() => { syncOfflineQueue(); });
  startRealtimeReportListener();
  startPeriodicTaskReminder();

  if (isManagerRole() || isPerawatRole()) switchTab('dashboard');
  else if (isTeknisiRole()) switchTab('repair');
  else switchTab('inspect');
}

function logout() {
  localStorage.removeItem('ck_user');
  document.documentElement.classList.remove('has-session');
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  clearInterval(pollingInterval);
  clearInterval(reminderRepeatInterval);
  location.reload();
}

function updateNetworkStatus() {
  const el = document.getElementById('network-status');
  if (!el) return;
  if (navigator.onLine) {
    el.className = 'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap';
    el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online';
  } else {
    el.className = 'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap';
    el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Offline';
  }
}

function switchTab(tab, fromBack = false) {
  if ((isPerawatRole()) && tab !== 'dashboard') tab = 'dashboard';
  if (isPetugasRole() && (tab === 'dashboard' || tab === 'master')) tab = 'inspect';
  if (isTeknisiRole() && (tab === 'dashboard' || tab === 'inspect' || tab === 'master')) tab = 'repair';
  if (!isManagerRole() && tab === 'master') tab = isPerawatRole() ? 'dashboard' : isTeknisiRole() ? 'repair' : 'inspect';

  activeTabName = tab;
  if (!fromBack) {
    try { window.history.pushState({ tab }, ''); } catch (e) {}
  }

  document.querySelectorAll('.page-section').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('page-animate');
  });
  const targetSection = document.getElementById('tab-' + tab);
  if (targetSection) {
    targetSection.classList.remove('hidden');
    void targetSection.offsetWidth;
    targetSection.classList.add('page-animate');
  }

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('nav-btn-active'));
  const navBtn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
  if (navBtn) navBtn.classList.add('nav-btn-active');

  if (tab === 'inspect') {
    populateOfficerDropdown();
    populateShiftDropdown();
    startTimer();
    renderOfficerRevisionBanner();
  } else if (tab === 'repair') {
    stopTimer();
    populateRepairFormDropdowns();
    renderRepairHistoryList();
  } else {
    stopTimer();
  }
  if (tab === 'analytics') renderAnalytics();
  if (tab === 'master' && isManagerRole()) {
    renderApprovalToggleCard();
    renderMasterShifts();
    loadUsers();
  }
  lucide.createIcons();
}

async function loadAllData() {
  if (!navigator.onLine) {
    unitsData = JSON.parse(localStorage.getItem('ck_units') || '[]');
    itemsData = JSON.parse(localStorage.getItem('ck_items') || '[]');
    inspectionsData = JSON.parse(localStorage.getItem('ck_inspections') || '[]');
    usersData = JSON.parse(localStorage.getItem('ck_users_cache') || '[]');
    syncApprovalConfigFromItems();
    rebuildShiftsFromItems();
    renderAllViews();
    return;
  }
  const [uRes, iRes, insRes, usrRes] = await Promise.all([
    db.from('master_units').select('*').order('unit_code'),
    db.from('master_items').select('*').order('created_at'),
    db.from('room_inspections').select('*').order('created_at', { ascending: false }).limit(200),
    db.from('app_users').select('*').order('created_at')
  ]);
  if (uRes.data) { unitsData = uRes.data; localStorage.setItem('ck_units', JSON.stringify(unitsData)); }
  if (iRes.data) {
    itemsData = iRes.data;
    await ensureDefaultShiftsInDb();
    localStorage.setItem('ck_items', JSON.stringify(itemsData));
  }
  if (insRes.data) {
    inspectionsData = insRes.data;
    localStorage.setItem('ck_inspections', JSON.stringify(inspectionsData));
    if (inspectionsData[0]?.id && !lastKnownReportId) {
      lastKnownReportId = inspectionsData[0].id;
      localStorage.setItem('ck_last_seen_id', lastKnownReportId);
    }
  }
  if (usrRes.data) { usersData = usrRes.data; localStorage.setItem('ck_users_cache', JSON.stringify(usersData)); }
  syncApprovalConfigFromItems();
  rebuildShiftsFromItems();
  renderAllViews();
}

function renderAllViews() {
  populateOfficerDropdown();
  populateShiftDropdown();
  initExportPeriodInputs();
  renderDashboard();
  renderInspectForm();
  renderOfficerRevisionBanner();
  populateRepairFormDropdowns();
  renderRepairHistoryList();
  renderMasterLists();
  renderAnalytics();
  lucide.createIcons();
}

function renderDashboard() {
  const grid = document.getElementById('dashboard-unit-grid');
  if (!grid) return;

  let siap = 0, kotor = 0, maint = 0;
  unitsData.forEach(u => {
    const eff = getEffectiveUnitStatus(u);
    if (eff === 'siap') siap++;
    else if (eff === 'maintenance') maint++;
    else kotor++;
  });

  document.getElementById('stat-siap').textContent = siap;
  document.getElementById('stat-kotor').textContent = kotor;
  document.getElementById('stat-maint').textContent = maint;

  const pendingApprovalUnits = unitsData.filter(u => getEffectiveUnitStatus(u) === 'pending_approval');
  const alertBox = document.getElementById('management-approval-alert');
  if (alertBox) {
    if (canCurrentUserApprove() && pendingApprovalUnits.length > 0) {
      document.getElementById('approval-alert-title').textContent = `${pendingApprovalUnits.length} Kamar Menunggu Approval`;
      alertBox.classList.remove('hidden');
    } else alertBox.classList.add('hidden');
  }

  if (unitsData.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-center py-8 text-xs text-slate-400">Belum ada unit kamar.</div>';
    return;
  }

  grid.innerHTML = unitsData.map(u => {
    const effStatus = getEffectiveUnitStatus(u);
    const latestRep = getLatestInspectionForUnit(u.id, u.unit_name);
    const meta = latestRep ? parseNotesMetadata(latestRep.notes) : { executor: '', feedbackStatus: '', feedbackDetail: '' };
    const unitExecutor = meta.executor || latestRep?.inspector_name || u.last_checked_by || '';
    const isBookedByNurse = isRoomBookedByNurse(u);

    let badge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-700">KOSONG / BELUM DICEK</span>';
    let borderClass = 'border-l-4 border-l-slate-400';

    if (effStatus === 'siap') {
      badge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-700">SIAP PAKAI</span>';
      borderClass = 'border-l-4 border-l-emerald-500';
    } else if (effStatus === 'pending_approval') {
      badge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-800">MENUNGGU APPROVAL (${getApprovalTargetLabel().toUpperCase()})</span>`;
      borderClass = 'border-l-4 border-l-indigo-500';
    } else if (effStatus === 'dibersihkan') {
      badge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-sky-100 text-sky-700">SEDANG DIBERSIHKAN</span>';
      borderClass = 'border-l-4 border-l-sky-500';
    } else if (effStatus === 'perlu_perbaikan') {
      badge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700">PERLU PERBAIKAN</span>';
      borderClass = 'border-l-4 border-l-rose-500';
    } else if (effStatus === 'maintenance') {
      badge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700">MAINTENANCE</span>';
      borderClass = 'border-l-4 border-l-rose-600';
    }

    if (isBookedByNurse) {
      badge += '<span class="ml-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">TERISI / DIPESAN</span>';
    }

    const lastTime = u.last_checked_at ? new Date(u.last_checked_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
    const safeUnitName = (u.unit_name || '').replace(/'/g, "\\'");
    const isNurseMarked = isNurseMarkedUnit(u.last_checked_by);
    const showExecutorRow = Boolean(unitExecutor) && !isNurseMarked;
    const isPerawat = isPerawatRole();
    const userCanApprove = canCurrentUserApprove();

    return `
      <div class="glass-card rounded-2xl p-4 shadow-sm ${borderClass} flex flex-col justify-between space-y-3">
        <div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="text-[11px] font-bold text-slate-400">${u.unit_code} • ${u.floor || 'Lantai 1'}</span>
              <h3 class="text-sm font-extrabold text-slate-900 mt-0.5">${u.unit_name}</h3>
            </div>
            <div class="flex flex-wrap justify-end gap-1">${badge}</div>
          </div>

          ${isNurseMarked ? `
            <p class="mt-2 text-[11px] font-extrabold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5">
              <i data-lucide="bell-ring" class="w-3.5 h-3.5 text-amber-600 shrink-0"></i>
              <span>${u.last_checked_by}</span>
            </p>
          ` : ''}

          ${showExecutorRow ? `
            <p class="mt-2 text-[11px] font-bold text-teal-800 bg-teal-50/80 border border-teal-200/70 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5">
              <i data-lucide="user-check" class="w-3.5 h-3.5 text-teal-600 shrink-0"></i>
              <span>Petugas: <strong>${unitExecutor}</strong></span>
            </p>
          ` : ''}

          ${effStatus === 'perlu_perbaikan' && meta.feedbackDetail ? `
            <p class="mt-1.5 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-2.5 py-1.5">
              Komplain: ${meta.feedbackDetail}
            </p>
          ` : ''}

          <div class="mt-2 flex items-center justify-between gap-2">
            <p class="text-[11px] text-slate-500">Update: ${lastTime}</p>
            ${isManagerRole() ? `
              <select onchange="quickChangeUnitStatus('${u.id}', this.value)" class="text-[10px] font-bold bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 text-slate-700">
                <option value="kosong" ${effStatus === 'kosong' ? 'selected' : ''}>Kosong / Belum Dicek</option>
                <option value="dibersihkan" ${effStatus === 'dibersihkan' ? 'selected' : ''}>Sedang Dibersihkan</option>
                <option value="pending_approval" ${effStatus === 'pending_approval' ? 'selected' : ''}>Menunggu Approval</option>
                <option value="perlu_perbaikan" ${effStatus === 'perlu_perbaikan' ? 'selected' : ''}>Perlu Perbaikan</option>
                <option value="siap" ${effStatus === 'siap' ? 'selected' : ''}>Siap Pakai (Approved)</option>
                <option value="maintenance" ${effStatus === 'maintenance' ? 'selected' : ''}>Maintenance</option>
              </select>
            ` : ''}
          </div>
        </div>

        ${(userCanApprove && effStatus === 'pending_approval') ? `
          <div class="space-y-1.5">
            <button type="button" onclick="quickInspect('${u.id}')" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="file-search" class="w-4 h-4"></i> Lihat Form Hasil Petugas
            </button>
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" onclick="approveUnitByManagement('${u.id}', '${safeUnitName}')" class="py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Approve
              </button>
              <button type="button" onclick="requestRevisionByManagement('${u.id}', '${safeUnitName}')" class="py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> Perlu Diperbaiki
              </button>
            </div>
          </div>
        ` : ''}

        ${isPerawat ? `
          <div class="pt-1 border-t border-slate-100 space-y-1.5">
            <div class="grid grid-cols-2 gap-1.5">
              ${isBookedByNurse ? `
                <button type="button" disabled title="Terkunci sampai Pasien Pulang ditekan" class="py-2 px-2 bg-slate-200 text-slate-500 border border-slate-300 font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 cursor-not-allowed">
                  <i data-lucide="lock" class="w-3.5 h-3.5"></i> Sudah Dipesan / Terisi
                </button>
              ` : `
                <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'siapkan')" class="py-2 px-2 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                  <i data-lucide="bed-double" class="w-3.5 h-3.5"></i> Siapkan Kamar
                </button>
              `}
              <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'extrabed')" class="py-2 px-2 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i> Tambah Extrabed
              </button>
              <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'bersihkan')" class="py-2 px-2 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Minta Dibersihkan
              </button>
              <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'pulang')" class="py-2 px-2 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Pasien Pulang
              </button>
            </div>
          </div>
        ` : `
          <div class="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
            ${isManagerRole() ? (
              isBookedByNurse ? `
                <button type="button" disabled title="Terkunci sampai Pasien Pulang ditekan" class="w-full py-2 px-2 bg-slate-200 text-slate-500 border border-slate-300 font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 cursor-not-allowed">
                  <i data-lucide="lock" class="w-3.5 h-3.5"></i> Sudah Dipesan / Terisi
                </button>
              ` : `
                <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'siapkan')" class="flex-1 py-2 px-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl text-[10.5px] flex items-center justify-center gap-1">
                  <i data-lucide="bed-double" class="w-3.5 h-3.5"></i> Siapkan
                </button>
              `
            ) : ''}
            ${isManagerRole() ? `
              <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'pulang')" class="flex-1 py-2 px-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-[10.5px] flex items-center justify-center gap-1">
                <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Pulang
              </button>
            ` : ''}
            <button onclick="quickInspect('${u.id}')" class="flex-1 py-2 px-2 bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold rounded-xl text-xs transition">
              ${(userCanApprove && effStatus === 'pending_approval') ? 'Review Form' : 'Cek Kamar'}
            </button>
            <button onclick="showQrModal('${u.unit_code}', '${safeUnitName}')" class="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold" title="QR Pintu">
              <i data-lucide="qr-code" class="w-4 h-4"></i>
            </button>
          </div>
        `}
      </div>
    `;
  }).join('');
}

function quickInspect(unitId) {
  if (isPetugasRole()) {
    officerFormUnlocked = true;
  }
  switchTab('inspect');
  const sel = document.getElementById('inspect-unit');
  if (sel) sel.value = unitId;
  handleInspectUnitChange();
}

function renderInspectForm() {
  const unitSel = document.getElementById('inspect-unit');
  const prevUnit = unitSel ? unitSel.value : '';
  if (unitSel) {
    unitSel.innerHTML = unitsData.map(u => `<option value="${u.id}">${u.unit_code} - ${u.unit_name}</option>`).join('');
    if (prevUnit && unitsData.some(u => String(u.id) === String(prevUnit))) unitSel.value = prevUnit;
  }

  const realChecklistItems = itemsData.filter(i => !isSystemMetaCategory(i.category));
  const container = document.getElementById('checklist-container');
  if (!container) return;

  if (realChecklistItems.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400">Belum ada item checklist.</p>';
    return;
  }

  container.innerHTML = realChecklistItems.map(item => `
    <label class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/80 cursor-pointer active:bg-teal-50/50 transition">
      <div class="pr-3">
        <p class="text-xs font-bold text-slate-800">${item.item_name}</p>
        <span class="text-[10px] font-semibold text-slate-500">${item.category} ${item.is_critical ? '• <span class="text-rose-600">Wajib</span>' : ''}</span>
      </div>
      <input type="checkbox" data-id="${item.id}" data-name="${item.item_name}" data-critical="${item.is_critical}" onchange="updateScore()" class="inspect-chk w-5 h-5 rounded-md accent-teal-600 cursor-pointer" />
    </label>
  `).join('');
  updateScore();
}

function updateScore() {
  const chks = Array.from(document.querySelectorAll('.inspect-chk'));
  const badge = document.getElementById('readiness-badge');
  if (!chks.length || !badge) return;
  const checked = chks.filter(c => c.checked).length;
  const pct = Math.round((checked / chks.length) * 100);
  badge.textContent = `Skor: ${pct}%`;
  badge.className = pct === 100 ? 'px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-700' : 'px-3 py-1 rounded-full text-xs font-extrabold bg-amber-100 text-amber-700';
}

function startTimer() {
  clearInterval(timerInterval);
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
    const s = String(secondsElapsed % 60).padStart(2, '0');
    const el = document.getElementById('timer-display');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); }

function handlePhoto(e, type) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 800 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, canvas.height - 32, canvas.width, 32);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      const actor = document.getElementById('inspect-executor-select')?.value || currentUser.full_name;
      ctx.fillText(`${new Date().toLocaleString('id-ID')} • ${actor}`, 10, canvas.height - 12);
      watermarkedPhotos[type] = canvas.toDataURL('image/jpeg', 0.75);
      updatePhotoBoxUI(type, watermarkedPhotos[type]);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function processInspectionSubmit(alsoSendWa = false) {
  const unitId = document.getElementById('inspect-unit').value;
  const unit = unitsData.find(u => u.id === unitId);
  if (!unit) return alert('Pilih unit kamar terlebih dahulu!');
  const chks = Array.from(document.querySelectorAll('.inspect-chk'));
  const checklistData = chks.map(c => ({ item: c.dataset.name, checked: c.checked }));
  const score = chks.length ? Math.round((chks.filter(c => c.checked).length / chks.length) * 100) : 100;

  const feedbackStatus = document.getElementById('inspect-feedback-status').value;
  const feedbackDetail = document.getElementById('inspect-feedback-detail').value.trim();

  let isOfficialApproved = false;
  let finalFeedbackStatus = feedbackStatus;
  let unitBadgeLabel = '';

  const userCanApprove = canCurrentUserApprove();

  if (feedbackStatus.includes('Perlu Perbaikan') || feedbackStatus.includes('Wajib Diperbaiki')) {
    isOfficialApproved = false;
    finalFeedbackStatus = feedbackStatus;
    unitBadgeLabel = `Perlu Perbaikan: ${feedbackDetail || 'Cek Ulang'}`;
  } else if (userCanApprove) {
    isOfficialApproved = (score === 100 && feedbackStatus.includes('Approved'));
    finalFeedbackStatus = isOfficialApproved ? `Sesuai Standar (Approved oleh ${currentUser.full_name})` : feedbackStatus;
    unitBadgeLabel = isOfficialApproved ? `Approved: ${currentUser.full_name}` : `${currentUser.full_name} (Menunggu Approval)`;
  } else if (!requireApprovalMode) {
    isOfficialApproved = (score === 100);
    const executorTmp = document.getElementById('inspect-executor-select')?.value || currentUser.full_name;
    finalFeedbackStatus = isOfficialApproved
      ? `Sesuai Standar (Otomatis Siap Pakai - ${executorTmp})`
      : 'Belum 100% Lengkap';
    unitBadgeLabel = isOfficialApproved ? `Siap Pakai (${executorTmp})` : `${executorTmp} (Belum Lengkap)`;
  } else {
    isOfficialApproved = false;
    const executorTmp = document.getElementById('inspect-executor-select')?.value || currentUser.full_name;
    const targetApprovalLabel = getApprovalTargetLabel();
    finalFeedbackStatus = `Menunggu Approval ${targetApprovalLabel} (Selesai oleh ${executorTmp})`;
    unitBadgeLabel = `${executorTmp} (Menunggu Approval)`;
  }

  const finalStatus = isOfficialApproved ? 'siap' : 'kotor';
  const selectedOfficer = document.getElementById('inspect-officer-select')?.value || currentUser.full_name;
  const selectedExecutor = isPetugasRole()
    ? currentUser.full_name
    : (document.getElementById('inspect-executor-select')?.value || currentUser.full_name);

  const composedNotes = composeNotesWithMetadata(
    selectedExecutor,
    finalFeedbackStatus,
    feedbackDetail,
    document.getElementById('inspect-notes').value.trim()
  );

  const payload = {
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: selectedOfficer,
    inspector_role: currentUser.role,
    shift: document.getElementById('inspect-shift').value,
    readiness_score: score,
    final_status: finalStatus,
    duration_seconds: secondsElapsed,
    checklist_data: checklistData,
    notes: composedNotes,
    photo_room_url: watermarkedPhotos.room,
    photo_toilet_url: watermarkedPhotos.toilet
  };

  const btnSave = document.getElementById('btn-submit-inspect');
  const btnWa = document.getElementById('btn-submit-wa');
  btnSave.disabled = true; btnWa.disabled = true;
  btnSave.textContent = 'Menyimpan...';

  let savedRecord = { ...payload, created_at: new Date().toISOString() };
  let savedSuccess = false;

  if (!navigator.onLine) {
    const q = JSON.parse(localStorage.getItem('ck_offline_queue') || '[]');
    q.push(payload);
    localStorage.setItem('ck_offline_queue', JSON.stringify(q));
    savedSuccess = true;
  } else if (activeReviewReportId) {
    const { data: updatedRows, error } = await db.from('room_inspections')
      .update({ ...payload, created_at: new Date().toISOString() })
      .eq('id', activeReviewReportId)
      .select();

    if (error) {
      alert('Gagal memperbarui laporan: ' + error.message);
    } else {
      if (updatedRows?.[0]) {
        savedRecord = updatedRows[0];
        lastKnownReportId = savedRecord.id;
        localStorage.setItem('ck_last_seen_id', savedRecord.id);
      }
      await db.from('master_units').update({
        status: finalStatus,
        last_checked_at: new Date().toISOString(),
        last_checked_by: unitBadgeLabel
      }).eq('id', unit.id);
      savedSuccess = true;
    }
  } else {
    const { data: insertedRows, error } = await db.from('room_inspections').insert([payload]).select();
    if (error) {
      alert('Gagal menyimpan ke server: ' + error.message);
    } else {
      if (insertedRows?.[0]) {
        savedRecord = insertedRows[0];
        lastKnownReportId = savedRecord.id;
        localStorage.setItem('ck_last_seen_id', savedRecord.id);
      }
      await db.from('master_units').update({
        status: finalStatus,
        last_checked_at: new Date().toISOString(),
        last_checked_by: unitBadgeLabel
      }).eq('id', unit.id);
      savedSuccess = true;
    }
  }

  btnSave.disabled = false; btnWa.disabled = false;
  btnSave.textContent = (!userCanApprove && requireApprovalMode) ? 'Ajukan Approval' : 'Simpan Laporan';

  if (savedSuccess) {
    if (isPetugasRole()) officerFormUnlocked = false;
    resetFormForFreshCheck();
    await loadAllData();
    if (alsoSendWa) openWaShareModal(savedRecord);
    else {
      if (!userCanApprove && requireApprovalMode) {
        alert(`Laporan terkirim ke ${getApprovalTargetLabel()}! Status kamar menunggu approval agar menjadi Siap Pakai.`);
      } else if (!userCanApprove && !requireApprovalMode && isOfficialApproved) {
        alert(`Laporan tersimpan! Kamar ${unit.unit_name} langsung berstatus SIAP PAKAI.`);
      }
      if (isManagerRole() || isPerawatRole()) switchTab('dashboard');
      else switchTab('inspect');
    }
  }
}

document.getElementById('inspection-form').addEventListener('submit', async (e) => { e.preventDefault(); await processInspectionSubmit(false); });
async function saveAndSendWhatsApp() { await processInspectionSubmit(true); }

function buildWaMessage(record, includeChecklist = true, includeLink = true) {
  const isNurseReq = isNurseRequestRecord(record);
  const isTechReq = isTechCheckRecord(record);
  const isRepair = isRepairRecord(record);
  const isApproved = isInspectionOfficiallyApproved(record);
  const waktu = record.created_at ? new Date(record.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const meta = parseNotesMetadata(record.notes);
  const cleanDetail = meta.cleanNotes
    .replace(REPAIR_RECORD_TAG, '')
    .replace(CHECKOUT_RECORD_TAG, '')
    .replace(NURSE_REQ_TAG, '')
    .replace(TECH_CHECK_TAG, '')
    .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
    .trim();

  if (isTechReq) {
    const statusText = record.final_status === 'siap' ? 'CEK TEKNIS SELESAI ✅' : 'TUGAS CEK TEKNIS 🔧';
    const lines = [
      '*TUGAS PENGECEKAN TEKNIS KAMAR*',
      '*RS Khusus Bedah SS Medika*',
      '--------------------------------',
      `🏥 *Unit Kamar:* ${record.unit_name}`,
      `🕒 *Waktu:* ${waktu}`,
      `📋 *Status:* ${statusText}`
    ];
    if (includeChecklist && Array.isArray(record.checklist_data) && record.checklist_data.length > 0) {
      lines.push('', '*Item Pengecekan Teknis:*');
      record.checklist_data.forEach(c => lines.push(`${c.checked ? '✅' : '⏳'} ${c.item}`));
    }
    if (includeLink && record.id) lines.push('', '📄 *Link Laporan Penuh:*', getPublicReportUrl(record.id, false));
    lines.push('--------------------------------', '_Dikirim otomatis dari Aplikasi Cek Kesiapan Kamar_');
    return lines.join('\n');
  }

  if (isNurseReq) {
    const reqType = getNurseRequestTypeFromString((record.notes || '') + ' ' + (record.shift || ''));
    const lines = [
      `*PERMINTAAN KAMAR (${reqType.shortTag})*`,
      '*RS Khusus Bedah SS Medika*',
      '--------------------------------',
      `🏥 *Unit Kamar:* ${record.unit_name}`,
      `🕒 *Waktu:* ${waktu}`,
      `👩‍⚕️ *Perawat Pelapor:* ${record.inspector_name}`,
      `📋 *Jenis Permintaan:* ${reqType.label}`
    ];
    if (cleanDetail) lines.push(`📝 *Pesan:* ${cleanDetail}`);
    if (includeLink && record.id) lines.push('', '📄 *Link Detail Permintaan:*', getPublicReportUrl(record.id, false));
    lines.push('--------------------------------', '_Dikirim otomatis dari Aplikasi Cek Kesiapan Kamar_');
    return lines.join('\n');
  }

  if (isRepair) {
    const statusText = record.final_status === 'siap' ? 'SUDAH DIPERBAIKI ✅' : 'PENGAJUAN PERBAIKAN 🔧';
    const hasAssignee = meta.executor && meta.executor !== 'Belum Ditugaskan';
    const lines = [
      '*LAPORAN CEK PERBAIKAN FASILITAS*',
      '*RS Khusus Bedah SS Medika*',
      '--------------------------------',
      `🏥 *Unit Kamar:* ${record.unit_name}`,
      `🕒 *Waktu:* ${waktu}`,
      `👤 *Petugas Pengaju:* ${record.inspector_name}`,
      `🔧 *Ditugaskan Kepada:* ${hasAssignee ? meta.executor : 'Menunggu Penugasan Manajemen'}`,
      `📋 *Status:* ${statusText}`
    ];
    if (meta.feedbackDetail) lines.push(`🏷️ *Kategori:* ${meta.feedbackDetail}`);
    if (cleanDetail) lines.push(`📝 *Detail Kerusakan:* ${cleanDetail}`);
    if (includeLink && record.id) lines.push('', '📄 *Link Laporan & Foto Sebelum/Sesudah:*', getPublicReportUrl(record.id, false));
    lines.push('--------------------------------', '_Dikirim otomatis dari Aplikasi Cek Kesiapan Kamar_');
    return lines.join('\n');
  }

  const statusText = isApproved ? 'SIAP PAKAI ✅' : 'MENUNGGU APPROVAL / PERLU PERBAIKAN ⏳';
  const lines = [
    '*LAPORAN CEK KESIAPAN KAMAR*',
    '*RS Khusus Bedah SS Medika*',
    '--------------------------------',
    `🏥 *Unit Kamar:* ${record.unit_name}`,
    `🕒 *Waktu & Shift:* ${waktu} (${record.shift})`,
    `👤 *Pemeriksa:* ${record.inspector_name}`
  ];
  if (meta.executor && meta.executor !== record.inspector_name) lines.push(`🧹 *Petugas Pelaksana:* ${meta.executor}`);
  lines.push(`📊 *Skor Kesiapan:* ${record.readiness_score}%`, `📋 *Status:* ${statusText}`);
  if (meta.feedbackStatus) lines.push(`🔍 *Tanggapan:* ${meta.feedbackStatus}`);
  if (meta.feedbackDetail) lines.push(`⚠️ *Bagian Perbaikan:* ${meta.feedbackDetail}`);
  if (includeChecklist && Array.isArray(record.checklist_data) && record.checklist_data.length > 0) {
    lines.push('', '*Rincian Checklist:*');
    record.checklist_data.forEach(c => lines.push(`${c.checked ? '✅' : '❌'} ${c.item}`));
  }
  if (cleanDetail) lines.push('', `📝 *Catatan:* ${cleanDetail}`);
  if (includeLink && record.id) lines.push('', '📄 *Link Laporan Penuh & Foto:*', getPublicReportUrl(record.id, false));
  lines.push('--------------------------------', '_Dikirim otomatis dari Aplikasi Cek Kesiapan Kamar_');
  return lines.join('\n');
}

function openWaShareModal(record) {
  activeWaPayload = record;
  document.getElementById('wa-target-phone').value = localStorage.getItem('ck_last_wa_phone') || '';
  document.getElementById('wa-include-checklist').checked = true;
  document.getElementById('wa-include-link').checked = Boolean(record.id);
  refreshWaPreview();
  openModalWithHistory('modal-wa-share');
  lucide.createIcons();
}

function refreshWaPreview() {
  if (!activeWaPayload) return;
  document.getElementById('wa-message-preview').value = buildWaMessage(
    activeWaPayload,
    document.getElementById('wa-include-checklist').checked,
    document.getElementById('wa-include-link').checked
  );
}

function previewFullReportFromModal() {
  if (activeWaPayload?.id) window.open(getPublicReportUrl(activeWaPayload.id, true), '_blank');
  else alert('Laporan ini tersimpan offline dan belum memiliki link online.');
}

function shareHistoryWaById(id) {
  const found = inspectionsData.find(item => String(item.id) === String(id));
  if (found) openWaShareModal(found);
}

function formatIndonesianPhone(raw) {
  let digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  else if (digits.startsWith('8')) digits = '62' + digits;
  return digits;
}

function executeWhatsAppSend(useDirectNumber) {
  const msg = document.getElementById('wa-message-preview').value.trim();
  if (!msg) return alert('Isi pesan masih kosong.');
  const encodedText = encodeURIComponent(msg);
  let waUrl = `https://wa.me/?text=${encodedText}`;
  if (useDirectNumber) {
    const formattedPhone = formatIndonesianPhone(document.getElementById('wa-target-phone').value);
    if (!formattedPhone) return alert('Masukkan nomor WhatsApp tujuan terlebih dahulu.');
    localStorage.setItem('ck_last_wa_phone', document.getElementById('wa-target-phone').value.trim());
    waUrl = `https://wa.me/${formattedPhone}?text=${encodedText}`;
  }
  closeActiveModal('modal-wa-share');
  window.open(waUrl, '_blank');
  if (activeTabName === 'inspect') switchTab((isManagerRole() || isPerawatRole()) ? 'dashboard' : 'inspect');
}

async function syncOfflineQueue() {
  if (!navigator.onLine) return;
  const q = JSON.parse(localStorage.getItem('ck_offline_queue') || '[]');
  if (!q.length) return;
  const { error } = await db.from('room_inspections').insert(q);
  if (!error) {
    localStorage.removeItem('ck_offline_queue');
    loadAllData();
  }
}

function openQrScanner() {
  openModalWithHistory('modal-qr-scanner');
  qrScannerInstance = new Html5Qrcode('qr-reader');
  qrScannerInstance.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (decodedText) => {
    closeQrScanner();
    const found = unitsData.find(u => u.unit_code.toLowerCase() === decodedText.trim().toLowerCase());
    if (found) quickInspect(found.id);
    else alert(`Kode QR "${decodedText}" tidak terdaftar.`);
  }).catch(() => {});
}

function closeQrScanner() {
  closeActiveModal('modal-qr-scanner');
  if (qrScannerInstance) qrScannerInstance.stop().catch(() => {});
}

function showQrModal(code, name) {
  activeQrMeta = { code, name };
  document.getElementById('qr-print-title').textContent = name;
  document.getElementById('qr-print-code').textContent = code;
  const box = document.getElementById('qr-code-box');
  box.innerHTML = '';
  new QRCode(box, { text: code, width: 180, height: 180 });
  openModalWithHistory('modal-qr-print');
  lucide.createIcons();
}

function downloadQrImage() {
  const box = document.getElementById('qr-code-box');
  const qrCanvas = box.querySelector('canvas');
  const qrImg = box.querySelector('img');
  const drawSticker = (sourceEl) => {
    const out = document.createElement('canvas');
    out.width = 420; out.height = 520;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 8; ctx.strokeRect(14, 14, out.width - 28, out.height - 28);
    ctx.fillStyle = '#0f766e'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('RS KHUSUS BEDAH SS MEDIKA', out.width / 2, 54);
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText(activeQrMeta.name || 'Unit Kamar', out.width / 2, 86);
    ctx.drawImage(sourceEl, (out.width - 280) / 2, 110, 280, 280);
    ctx.fillStyle = '#334155'; ctx.font = 'bold 22px monospace';
    ctx.fillText(activeQrMeta.code || '', out.width / 2, 430);
    ctx.fillStyle = '#64748b'; ctx.font = '13px sans-serif';
    ctx.fillText('Scan QR ini untuk Cek Kesiapan Kamar', out.width / 2, 464);
    const link = document.createElement('a');
    link.download = `QR_${(activeQrMeta.code || 'Kamar').replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    link.href = out.toDataURL('image/png');
    link.click();
  };
  if (qrCanvas) drawSticker(qrCanvas);
  else if (qrImg) {
    if (qrImg.complete) drawSticker(qrImg);
    else qrImg.onload = () => drawSticker(qrImg);
  }
}

function renderAnalytics() {
  initExportPeriodInputs();
  const { rows: filtered } = getFilteredExportData();
  const countBadge = document.getElementById('export-filter-count');
  if (countBadge) countBadge.textContent = `${filtered.length} Data`;

  const summary = computeAnalyticsSummary(filtered);

  document.getElementById('analytic-total').textContent = `${summary.pureInspectionsCount} Laporan`;
  document.getElementById('analytic-avg-score').textContent = `${summary.pureAvgScore}%`;
  document.getElementById('analytic-avg-time').textContent = `${summary.avgDuration} Detik`;

  const occEl = document.getElementById('analytic-occupied-pct');
  const vacEl = document.getElementById('analytic-vacant-pct');
  if (occEl) occEl.textContent = `${summary.occupiedRooms} Kamar (${summary.occupiedPct}%)`;
  if (vacEl) vacEl.textContent = `${summary.vacantRooms} Kamar (${summary.vacantPct}%)`;

  const discList = document.getElementById('discipline-list');
  if (discList) {
    if (summary.disciplineRows.length === 0) {
      discList.innerHTML = '<p class="text-xs text-slate-400">Belum ada akun Petugas atau Teknisi terdaftar.</p>';
    } else {
      discList.innerHTML = summary.disciplineRows.map(d => {
        const badgeColor = d.totalTasks === 0
          ? 'bg-slate-100 text-slate-500'
          : d.disciplinePct >= 80
            ? 'bg-emerald-100 text-emerald-700'
            : d.disciplinePct >= 50
              ? 'bg-amber-100 text-amber-800'
              : 'bg-rose-100 text-rose-700';
        return `
          <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <div class="min-w-0">
              <p class="text-xs font-extrabold text-slate-900 truncate">${d.fullName}</p>
              <p class="text-[10.5px] text-slate-500">${d.role} • ${d.completedOnStandard}/${d.totalTasks} tugas sesuai standar</p>
            </div>
            <span class="shrink-0 text-xs font-extrabold px-2.5 py-1 rounded-full ${badgeColor}">${d.disciplinePct}%</span>
          </div>
        `;
      }).join('');
    }
  }

  let siap = 0, kotor = 0, maint = 0;
  unitsData.forEach(u => {
    const eff = getEffectiveUnitStatus(u);
    if (eff === 'siap') siap++;
    else if (eff === 'maintenance') maint++;
    else kotor++;
  });

  const ctx = document.getElementById('chart-status');
  if (ctx) {
    if (statusChart) statusChart.destroy();
    statusChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Siap Pakai', 'Kosong / Proses', 'Maintenance'],
        datasets: [{ data: [siap, kotor, maint], backgroundColor: ['#10b981', '#f59e0b', '#e11d48'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10, weight: 'bold' } } } } }
    });
  }

  const canDelete = creatorDeleteUnlocked && isManagerRole();
  const userCanApprove = canCurrentUserApprove();
  const resolveBtnLabel = requireApprovalMode ? 'Selesai Perbaikan & Minta Approve' : 'Selesai Perbaikan (Siap Pakai)';

  document.getElementById('history-list').innerHTML = filtered.length
    ? filtered.map(r => {
      const waktuStr = r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '-';
      const safeName = (r.unit_name || '').replace(/'/g, "\\'");
      const meta = parseNotesMetadata(r.notes);
      const isNurseReq = isNurseRequestRecord(r);
      const isTechReq = isTechCheckRecord(r);
      const isRepair = isRepairRecord(r);
      const isApproved = isInspectionOfficiallyApproved(r);
      const isRev = isRevisionRequested(r);
      const cleanNotesText = meta.cleanNotes
        .replace(REPAIR_RECORD_TAG, '')
        .replace(CHECKOUT_RECORD_TAG, '')
        .replace(NURSE_REQ_TAG, '')
        .replace(TECH_CHECK_TAG, '')
        .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
        .trim();
      const reqType = isNurseReq ? getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')) : null;

      const statusBadge = isTechReq
        ? (r.final_status === 'siap'
            ? '<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">CEK TEKNIS SELESAI ✅</span>'
            : '<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">TUGAS CEK TEKNISI 🔧</span>')
        : isNurseReq
          ? `<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full ${reqType.badgeClass}">${reqType.shortTag}</span>`
          : isRepair
            ? (r.final_status === 'siap'
                ? '<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">SUDAH DIPERBAIKI ✅</span>'
                : '<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">CEK PERBAIKAN 🔧</span>')
            : isApproved
              ? '<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">SIAP PAKAI ✅</span>'
              : isRev
                ? '<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">PERLU PERBAIKAN ⚠️</span>'
                : `<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">MENUNGGU APPROVAL (${getApprovalTargetLabel().toUpperCase()}) ⏳</span>`;

      return `
        <div class="glass-card rounded-2xl p-4 shadow-sm space-y-2.5">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h4 class="text-xs font-extrabold text-slate-900">${r.unit_name}</h4>
              <p class="text-[11px] text-slate-500">
                ${isNurseReq ? 'Perawat Pelapor' : isRepair ? 'Petugas Pengaju' : 'Pemeriksa'}: <strong>${r.inspector_name}</strong>
                ${meta.executor && meta.executor !== r.inspector_name ? ` • ${isTechReq ? 'Teknisi' : isRepair ? 'Ditugaskan ke' : 'Pelaksana'}: <strong>${meta.executor}</strong>` : ''}
                • ${r.shift}
              </p>
              <p class="text-[10px] text-slate-400">${waktuStr}</p>
            </div>
            <div class="text-right shrink-0 flex flex-col items-end gap-1">
              ${(!isRepair && !isNurseReq) ? `<span class="text-xs font-extrabold px-2.5 py-1 rounded-full ${r.readiness_score === 100 ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}">${r.readiness_score}%</span>` : ''}
              ${statusBadge}
            </div>
          </div>

          ${meta.feedbackStatus ? `
            <div class="text-[11px] px-2.5 py-1.5 rounded-xl ${isApproved || r.final_status === 'siap' ? 'bg-emerald-50 border border-emerald-200 text-emerald-950' : isRev ? 'bg-rose-50 border border-rose-200 text-rose-950' : 'bg-amber-50 border border-amber-200 text-amber-950'}">
              <span class="font-bold">Status:</span> ${meta.feedbackStatus}
              ${meta.feedbackDetail ? `<br><span class="text-rose-700 font-bold">${isNurseReq ? 'Instruksi' : isRepair ? 'Kategori' : 'Bagian perbaikan'}: ${meta.feedbackDetail}</span>` : ''}
            </div>
          ` : ''}

          ${cleanNotesText ? `<p class="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl">${cleanNotesText}</p>` : ''}
          ${(r.photo_room_url || r.photo_toilet_url) ? `<div class="grid grid-cols-2 gap-2 pt-1">${r.photo_room_url ? `<img src="${r.photo_room_url}" onclick="zoomPhoto(this.src)" class="w-full h-24 object-cover rounded-xl border cursor-pointer" />` : ''}${r.photo_toilet_url ? `<img src="${r.photo_toilet_url}" onclick="zoomPhoto(this.src)" class="w-full h-24 object-cover rounded-xl border cursor-pointer" />` : ''}</div>` : ''}

          <div class="pt-1 flex items-center justify-end gap-1.5 flex-wrap">
            ${(userCanApprove && !isApproved && !isRepair && !isNurseReq && !isTechReq && r.id) ? `
              <button type="button" onclick="openReportInForm('${r.id}')" class="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[11px] font-bold rounded-xl flex items-center gap-1 transition">
                <i data-lucide="file-search" class="w-3 h-3"></i> Cek Form
              </button>
              <button type="button" onclick="approveReportById('${r.id}')" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 shadow-sm transition">
                <i data-lucide="check-circle-2" class="w-3 h-3"></i> Approve
              </button>
              <button type="button" onclick="requestRevisionByManagement('${r.unit_id || ''}', '${safeName}', '${r.id}')" class="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 shadow-sm transition">
                <i data-lucide="alert-triangle" class="w-3 h-3"></i> Perlu Diperbaiki
              </button>
            ` : ''}
            ${(isRepair && r.final_status !== 'siap' && r.id) ? `
              <button type="button" onclick="openRepairReportInForm('${r.id}')" class="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 shadow-sm transition">
                <i data-lucide="wrench" class="w-3 h-3"></i> Kelola Perbaikan
              </button>
            ` : ''}
            ${(isPetugasRole() && isRev && !isRepair && !isNurseReq && !isTechReq && r.id) ? `
              <button type="button" onclick="openReportInForm('${r.id}')" class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold rounded-xl flex items-center gap-1 transition">
                <i data-lucide="edit-3" class="w-3 h-3"></i> Perbaiki Form
              </button>
              <button type="button" onclick="markIssueResolvedByOfficer('${r.id}')" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 shadow-sm transition">
                <i data-lucide="check-circle-2" class="w-3 h-3"></i> ${resolveBtnLabel}
              </button>
            ` : ''}
            ${canDelete ? `<button type="button" onclick="deleteHistoryRecord('${r.id}', '${safeName}', '${r.unit_id || ''}')" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-[11px] font-bold rounded-xl flex items-center gap-1 transition"><i data-lucide="trash-2" class="w-3 h-3"></i> Hapus</button>` : ''}
            ${r.id ? `<button type="button" onclick="openReportFullView('${r.id}')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-xl flex items-center gap-1 transition"><i data-lucide="file-text" class="w-3 h-3"></i> Detail</button>` : ''}
            <button type="button" onclick="shareHistoryWaById('${r.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 shadow-sm transition"><i data-lucide="send" class="w-3 h-3"></i> Kirim WA</button>
          </div>
        </div>
      `;
    }).join('')
    : '<p class="text-xs text-slate-400 text-center py-6">Tidak ada riwayat inspeksi pada periode atau kamar yang dipilih.</p>';
  lucide.createIcons();
}

function exportCsv() {
  const { rows: filtered, label, fileSuffix } = getFilteredExportData();
  if (!filtered.length) return alert(`Tidak ada data laporan untuk ${label}.`);

  const summary = computeAnalyticsSummary(filtered);
  const sep = ';';
  const esc = (val) => `"${String(val ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;

  const lines = [
    'sep=;',
    `REKAP LAPORAN KESIAPAN KAMAR - RS KHUSUS BEDAH SS MEDIKA`,
    `Periode Filter${sep}${esc(label)}`,
    `Skor Kesiapan Murni${sep}${summary.pureAvgScore}% (dari ${summary.pureInspectionsCount} inspeksi kamar/teknis)`,
    `Kamar Terpakai (Dipesan)${sep}${summary.occupiedRooms} Kamar (${summary.occupiedPct}%)`,
    `Kamar Kosong / Siap${sep}${summary.vacantRooms} Kamar (${summary.vacantPct}%)`,
    '',
    'PERSENTASE KEDISIPLINAN PETUGAS & TEKNISI',
    ['Nama Lengkap', 'Role', 'Total Tugas', 'Sesuai Standar', 'Persentase Kedisiplinan'].map(esc).join(sep)
  ];

  summary.disciplineRows.forEach(d => {
    lines.push([d.fullName, d.role, d.totalTasks, d.completedOnStandard, `${d.disciplinePct}%`].map(esc).join(sep));
  });

  lines.push('');
  lines.push('RINCIAN LAPORAN');
  const headers = ['Waktu', 'Unit Kamar', 'Jenis Laporan', 'Pemeriksa / Pengaju', 'Petugas Pelaksana', 'Shift', 'Skor Murni (%)', 'Status', 'Tanggapan / Kategori', 'Catatan'];
  lines.push(headers.map(esc).join(sep));

  filtered.forEach(r => {
    const meta = parseNotesMetadata(r.notes);
    const isNurseReq = isNurseRequestRecord(r);
    const isTechReq = isTechCheckRecord(r);
    const isRepair = isRepairRecord(r);
    const isApproved = isInspectionOfficiallyApproved(r);
    const cleanNotesText = meta.cleanNotes
      .replace(REPAIR_RECORD_TAG, '')
      .replace(CHECKOUT_RECORD_TAG, '')
      .replace(NURSE_REQ_TAG, '')
      .replace(TECH_CHECK_TAG, '')
      .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
      .trim();

    const row = [
      r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '-',
      r.unit_name,
      isTechReq ? 'Cek Teknis' : isNurseReq ? 'Permintaan Perawat' : isRepair ? 'Cek Perbaikan' : 'Cek Kesiapan Kamar',
      r.inspector_name,
      meta.executor || r.inspector_name,
      r.shift,
      (isNurseReq || isRepair) ? '-' : r.readiness_score,
      (isApproved || r.final_status === 'siap') ? 'SIAP PAKAI / SELESAI' : 'BELUM SIAP / PROSES',
      meta.feedbackDetail ? `${meta.feedbackStatus} (${meta.feedbackDetail})` : (meta.feedbackStatus || '-'),
      cleanNotesText
    ];
    lines.push(row.map(esc).join(sep));
  });

  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Rekap_Kesiapan_Kamar_${fileSuffix}.csv`;
  a.click();
}

function exportPdf() {
  const { rows: filtered, label, fileSuffix } = getFilteredExportData();
  if (!filtered.length) return alert(`Tidak ada data laporan untuk ${label}.`);

  const includePhotos = Boolean(document.getElementById('export-pdf-include-photos')?.checked);
  const summary = computeAnalyticsSummary(filtered);

  const disciplineTableRows = summary.disciplineRows.length
    ? summary.disciplineRows.map(d => `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:700;">${d.fullName}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;">${d.role}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${d.completedOnStandard} / ${d.totalTasks}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;font-weight:800;color:#0f766e;">${d.disciplinePct}%</td>
        </tr>
      `).join('')
    : `<tr><td colspan="4" style="border:1px solid #cbd5e1;padding:8px;text-align:center;color:#64748b;">Belum ada data petugas/teknisi</td></tr>`;

  const rowsHtml = filtered.map((r, idx) => {
    const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const meta = parseNotesMetadata(r.notes);
    const isNurseReq = isNurseRequestRecord(r);
    const isTechReq = isTechCheckRecord(r);
    const isRepair = isRepairRecord(r);
    const isApproved = isInspectionOfficiallyApproved(r);
    const executorInfo = meta.executor && meta.executor !== r.inspector_name
      ? `<br><span style="color:#0f766e;">Pelaksana: ${meta.executor}</span>`
      : '';
    const feedbackInfo = meta.feedbackStatus
      ? `<br><span style="color:#b45309;font-size:9.5px;">${meta.feedbackStatus}${meta.feedbackDetail ? ` (${meta.feedbackDetail})` : ''}</span>`
      : '';
    const cleanNotesText = meta.cleanNotes
      .replace(REPAIR_RECORD_TAG, '')
      .replace(CHECKOUT_RECORD_TAG, '')
      .replace(NURSE_REQ_TAG, '')
      .replace(TECH_CHECK_TAG, '')
      .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
      .trim();

    const jenisLabel = isTechReq ? 'Cek Teknis' : isNurseReq ? 'Permintaan Perawat' : isRepair ? 'Cek Perbaikan' : 'Cek Kamar';
    const statusLabel = (isApproved || r.final_status === 'siap') ? 'SIAP / SELESAI' : 'PROSES / BELUM';
    const statusColor = (isApproved || r.final_status === 'siap') ? '#047857' : '#b45309';

    let photoCells = '';
    if (includePhotos) {
      const img1 = r.photo_room_url ? `<img src="${r.photo_room_url}" style="width:72px;height:54px;object-fit:cover;border-radius:4px;border:1px solid #cbd5e1;" />` : '<span style="color:#94a3b8;font-size:9px;">-</span>';
      const img2 = r.photo_toilet_url ? `<img src="${r.photo_toilet_url}" style="width:72px;height:54px;object-fit:cover;border-radius:4px;border:1px solid #cbd5e1;" />` : '<span style="color:#94a3b8;font-size:9px;">-</span>';
      photoCells = `<td style="border:1px solid #cbd5e1;padding:5px;text-align:center;">${img1}</td><td style="border:1px solid #cbd5e1;padding:5px;text-align:center;">${img2}</td>`;
    }
    return `<tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
      <td style="border:1px solid #cbd5e1;padding:6px 8px;">${waktu}</td>
      <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:700;">${r.unit_name}<br><span style="font-size:9px;color:#0284c7;">[${jenisLabel}]</span></td>
      <td style="border:1px solid #cbd5e1;padding:6px 8px;">${r.inspector_name}${executorInfo}</td>
      <td style="border:1px solid #cbd5e1;padding:6px 8px;">${r.shift}</td>
      <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;font-weight:700;">${(isNurseReq || isRepair) ? '-' : r.readiness_score + '%'}</td>
      <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:700;color:${statusColor};">${statusLabel}</td>
      ${photoCells}
      <td style="border:1px solid #cbd5e1;padding:6px 8px;">${cleanNotesText || '-'}${feedbackInfo}</td>
    </tr>`;
  }).join('');

  const el = document.createElement('div');
  el.style.padding = '16px'; el.style.fontFamily = 'Arial, sans-serif'; el.style.color = '#0f172a'; el.style.background = '#ffffff';
  el.innerHTML = `
    <div style="border-bottom:2px solid #0d9488;padding-bottom:10px;margin-bottom:12px;">
      <h2 style="margin:0;font-size:17px;color:#0f172a;">REKAP LAPORAN KESIAPAN KAMAR</h2>
      <p style="margin:3px 0 0;font-size:12px;color:#0f766e;font-weight:bold;">RS Khusus Bedah SS Medika</p>
      <p style="margin:4px 0 0;font-size:10.5px;color:#475569;">Periode: <strong>${label}</strong> • Dicetak: ${new Date().toLocaleString('id-ID')}</p>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:12px;font-size:11px;">
      <div style="flex:1;background:#f0fdfa;border:1px solid #99f6e4;padding:8px 10px;border-radius:8px;">
        <span style="color:#0f766e;display:block;font-size:9.5px;font-weight:bold;">SKOR KESIAPAN MURNI</span>
        <strong style="font-size:14px;color:#0f172a;">${summary.pureAvgScore}%</strong> <span style="color:#64748b;font-size:9.5px;">(${summary.pureInspectionsCount} inspeksi)</span>
      </div>
      <div style="flex:1;background:#fffbeb;border:1px solid #fde68a;padding:8px 10px;border-radius:8px;">
        <span style="color:#b45309;display:block;font-size:9.5px;font-weight:bold;">KAMAR TERPAKAI (DIPESAN)</span>
        <strong style="font-size:14px;color:#92400e;">${summary.occupiedRooms} Kamar (${summary.occupiedPct}%)</strong>
      </div>
      <div style="flex:1;background:#ecfdf5;border:1px solid #a7f3d0;padding:8px 10px;border-radius:8px;">
        <span style="color:#047857;display:block;font-size:9.5px;font-weight:bold;">KAMAR KOSONG / SIAP</span>
        <strong style="font-size:14px;color:#065f46;">${summary.vacantRooms} Kamar (${summary.vacantPct}%)</strong>
      </div>
    </div>

    <div style="margin-bottom:14px;">
      <h4 style="margin:0 0 6px;font-size:11.5px;color:#0f172a;">Persentase Kedisiplinan Petugas & Teknisi</h4>
      <table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead>
          <tr style="background:#f1f5f9;color:#334155;">
            <th style="border:1px solid #cbd5e1;padding:6px 8px;text-align:left;">Nama Lengkap</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;text-align:left;">Role</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">Tugas Sesuai Standar</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">Kedisiplinan (%)</th>
          </tr>
        </thead>
        <tbody>${disciplineTableRows}</tbody>
      </table>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
      <thead><tr style="background:#0d9488;color:#ffffff;">
        <th style="border:1px solid #0f766e;padding:7px 8px;text-align:left;">Waktu</th>
        <th style="border:1px solid #0f766e;padding:7px 8px;text-align:left;">Unit Kamar</th>
        <th style="border:1px solid #0f766e;padding:7px 8px;text-align:left;">Pemeriksa & Pelaksana</th>
        <th style="border:1px solid #0f766e;padding:7px 8px;text-align:left;">Shift</th>
        <th style="border:1px solid #0f766e;padding:7px 8px;text-align:center;">Skor</th>
        <th style="border:1px solid #0f766e;padding:7px 8px;text-align:left;">Status</th>
        ${includePhotos ? '<th style="border:1px solid #0f766e;padding:7px 8px;text-align:center;">Foto 1</th><th style="border:1px solid #0f766e;padding:7px 8px;text-align:center;">Foto 2</th>' : ''}
        <th style="border:1px solid #0f766e;padding:7px 8px;text-align:left;">Catatan & Tanggapan</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:16px;text-align:right;font-size:10px;color:#64748b;">Aplikasi Cek Kesiapan Kamar • RS Khusus Bedah SS Medika</div>
  `;
  html2pdf().set({
    margin: 8,
    filename: `Rekap_Kesiapan_Kamar_${fileSuffix}.pdf`,
    image: { type: 'jpeg', quality: 0.96 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  }).from(el).save();
}

function renderMasterLists() {
  const unitList = document.getElementById('master-unit-list');
  if (unitList) {
    unitList.innerHTML = unitsData.map(u => `
      <div class="py-3 flex items-center justify-between gap-2">
        <div><p class="text-xs font-extrabold text-slate-900">${u.unit_code} — ${u.unit_name}</p><p class="text-[11px] text-slate-400">${u.floor || '-'}</p></div>
        <div class="flex gap-1.5">
          <button onclick="editUnit('${u.id}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold">Edit</button>
          <button onclick="deleteUnit('${u.id}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold">Hapus</button>
        </div>
      </div>
    `).join('');
  }

  const realItems = itemsData.filter(i => !isSystemMetaCategory(i.category));
  const itemList = document.getElementById('master-item-list');
  if (itemList) {
    itemList.innerHTML = realItems.map(i => `
      <div class="py-3 flex items-center justify-between gap-2">
        <div><p class="text-xs font-extrabold text-slate-900">${i.item_name}</p><p class="text-[11px] text-slate-400">${i.category} ${i.is_critical ? '• Wajib' : ''}</p></div>
        <div class="flex gap-1.5">
          <button onclick="editItem('${i.id}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold">Edit</button>
          <button onclick="deleteItem('${i.id}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold">Hapus</button>
        </div>
      </div>
    `).join('');
  }
}

document.getElementById('form-add-unit').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isManagerRole()) return;
  const id = document.getElementById('edit-unit-id').value;
  const payload = { unit_code: document.getElementById('unit-code').value.trim(), unit_name: document.getElementById('unit-name').value.trim(), floor: document.getElementById('unit-floor').value.trim() };
  if (id) await db.from('master_units').update(payload).eq('id', id);
  else await db.from('master_units').insert([payload]);
  e.target.reset(); document.getElementById('edit-unit-id').value = ''; document.getElementById('btn-save-unit').textContent = '+ Simpan Unit Kamar'; loadAllData();
});

function editUnit(id) {
  const u = unitsData.find(x => x.id === id); if (!u) return;
  document.getElementById('edit-unit-id').value = u.id; document.getElementById('unit-code').value = u.unit_code; document.getElementById('unit-name').value = u.unit_name; document.getElementById('unit-floor').value = u.floor || ''; document.getElementById('btn-save-unit').textContent = 'Perbarui Unit Kamar';
}

async function deleteUnit(id) {
  if (!isManagerRole()) return;
  if (confirm('Hapus unit kamar ini?')) { await db.from('master_units').delete().eq('id', id); loadAllData(); }
}

document.getElementById('form-add-item').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isManagerRole()) return;
  const id = document.getElementById('edit-item-id').value;
  const payload = { item_name: document.getElementById('item-name').value.trim(), category: document.getElementById('item-category').value, is_critical: document.getElementById('item-critical').checked };
  if (id) await db.from('master_items').update(payload).eq('id', id);
  else await db.from('master_items').insert([payload]);
  e.target.reset(); document.getElementById('edit-item-id').value = ''; document.getElementById('btn-save-item').textContent = '+ Simpan Item Checklist'; loadAllData();
});

function editItem(id) {
  const i = itemsData.find(x => x.id === id); if (!i) return;
  document.getElementById('edit-item-id').value = i.id; document.getElementById('item-name').value = i.item_name; document.getElementById('item-category').value = i.category; document.getElementById('item-critical').checked = i.is_critical; document.getElementById('btn-save-item').textContent = 'Perbarui Item';
}

async function deleteItem(id) {
  if (!isManagerRole()) return;
  if (confirm('Hapus item checklist ini?')) { await db.from('master_items').delete().eq('id', id); loadAllData(); }
}

async function loadUsers() {
  if (!isManagerRole()) return;
  ensurePerawatRoleOptionInAccountForm();
  const { data } = await db.from('app_users').select('*').order('created_at');
  const list = document.getElementById('master-user-list');
  if (!data || !list) return;
  usersData = data;
  localStorage.setItem('ck_users_cache', JSON.stringify(usersData));
  populateOfficerDropdown();
  list.innerHTML = data.map(u => `
    <div class="py-2.5 flex items-center justify-between gap-2 text-xs">
      <div><p class="font-extrabold text-slate-900">${u.full_name} <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 uppercase">${u.role}</span></p><p class="text-[11px] text-slate-400">User: ${u.username} • Pass: ${u.password}</p></div>
      <div class="flex gap-1.5">
        <button type="button" onclick="editUser('${u.id}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold">Edit</button>
        <button type="button" onclick="deleteUser('${u.id}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold">Hapus</button>
      </div>
    </div>
  `).join('');
}

function editUser(id) {
  if (!isManagerRole()) return;
  ensurePerawatRoleOptionInAccountForm();
  const u = usersData.find(x => String(x.id) === String(id));
  if (!u) return;
  document.getElementById('edit-user-id').value = u.id;
  document.getElementById('new-user-fullname').value = u.full_name;
  document.getElementById('new-user-username').value = u.username;
  document.getElementById('new-user-password').value = u.password;
  document.getElementById('new-user-role').value = (u.role || 'petugas').toLowerCase();
  document.getElementById('btn-save-user').textContent = 'Update';
}

document.getElementById('form-add-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isManagerRole()) return;
  const editId = document.getElementById('edit-user-id').value;
  const payload = {
    full_name: document.getElementById('new-user-fullname').value.trim(),
    username: document.getElementById('new-user-username').value.trim(),
    password: document.getElementById('new-user-password').value.trim(),
    role: document.getElementById('new-user-role').value
  };
  let errResult = null;
  if (editId) {
    const { error } = await db.from('app_users').update(payload).eq('id', editId);
    errResult = error;
  } else {
    const { error } = await db.from('app_users').insert([payload]);
    errResult = error;
  }
  if (errResult) return alert('Gagal menyimpan akun: ' + errResult.message);
  e.target.reset();
  document.getElementById('edit-user-id').value = '';
  document.getElementById('btn-save-user').textContent = '+ Akun';
  loadUsers();
});

async function deleteUser(id) {
  if (!isManagerRole()) return;
  if (confirm('Hapus akun ini?')) { await db.from('app_users').delete().eq('id', id); loadUsers(); }
}
