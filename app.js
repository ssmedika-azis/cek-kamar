const APP_VERSION = '6.4';
const SUPABASE_URL = 'https://ymxpxrrjxnujygabrhsg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlteHB4cnJqeG51anlnYWJyaHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MDk0MjAsImV4cCI6MjExMDQ4NTQyMH0.tFMCbg1_R-I08KEIs-h6wwxXhYLP2Z0oYgnDGC7T2YU';
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
let requireApprovalMode = localStorage.getItem('ck_require_approval') !== 'false';

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

let realtimeChannel = null;
let pollingInterval = null;
let lastKnownReportId = localStorage.getItem('ck_last_seen_id') || null;
let unreadNotifCount = 0;
let latestNotifReport = null;
let toastTimeout = null;

if (window.lucide) lucide.createIcons();

// ==================== MESIN SUARA NOTIFIKASI BAHASA INDONESIA ====================

function extractSpokenRoomLabel(unitName) {
  const raw = String(unitName || '').trim();
  const numMatch = raw.match(/(?:kamar|kmr|ruang)?\s*(\d+[a-zA-Z]?)/i);
  if (numMatch && numMatch[1]) {
    return `nomor ${numMatch[1]}`;
  }
  return raw.replace(/^kamar\s*/i, '');
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
  const roomLabel = extractSpokenRoomLabel(report.unit_name);
  const notesStr = String(report.notes || '');
  const shiftStr = String(report.shift || '');

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
  return `Laporan cek kesiapan kamar ${roomLabel} menunggu approval manajemen.`;
}

// =================================================================================

function isSystemMetaCategory(category) {
  return category === SHIFT_CATEGORY_KEY || category === APPROVAL_CONFIG_KEY;
}

function isRepairRecord(rep) {
  if (!rep) return false;
  return String(rep.notes || '').includes(REPAIR_RECORD_TAG) || String(rep.shift || '').startsWith('Perbaikan');
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
  return inspectionsData.filter(r => !isRepairRecord(r) && !isNurseRequestRecord(r));
}

function getRepairReports() {
  return inspectionsData.filter(r => isRepairRecord(r));
}

function syncApprovalConfigFromItems() {
  const cfgRow = itemsData.find(i => i.category === APPROVAL_CONFIG_KEY);
  if (cfgRow) {
    requireApprovalMode = String(cfgRow.item_name).toUpperCase() !== 'OFF';
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
    <div class="glass-card rounded-3xl p-4 sm:p-5 shadow-sm border ${requireApprovalMode ? 'border-indigo-200 bg-indigo-50/40' : 'border-emerald-200 bg-emerald-50/40'} mb-4">
      <div class="flex items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="text-xs sm:text-sm font-extrabold text-slate-900">Permintaan Approval Manajemen</span>
            <span class="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full ${requireApprovalMode ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}">
              ${requireApprovalMode ? 'ON (AKTIF)' : 'OFF (NONAKTIF)'}
            </span>
          </div>
          <p class="text-[11px] text-slate-600 leading-relaxed">
            ${requireApprovalMode
              ? 'Laporan petugas harus diperiksa & di-Approve Manajemen terlebih dahulu sebelum kamar berstatus <strong>SIAP PAKAI</strong>.'
              : 'Mode langsung aktif: Laporan petugas dengan skor 100% langsung otomatis berstatus <strong>SIAP PAKAI</strong> tanpa menunggu Approve.'}
          </p>
        </div>
        <button type="button" id="btn-toggle-approval-mode" onclick="toggleApprovalMode()" aria-label="Toggle Permintaan Approval"
          class="relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${requireApprovalMode ? 'bg-indigo-600' : 'bg-slate-300'}">
          <span class="pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${requireApprovalMode ? 'translate-x-6' : 'translate-x-0'}"></span>
        </button>
      </div>
    </div>
  `;
}

async function toggleApprovalMode() {
  if (!isManagerRole()) return;
  const btn = document.getElementById('btn-toggle-approval-mode');
  if (btn) btn.disabled = true;

  const nextState = !requireApprovalMode;
  requireApprovalMode = nextState;
  localStorage.setItem('ck_require_approval', nextState ? 'true' : 'false');
  renderApprovalToggleCard();
  populateOfficerDropdown();
  renderDashboard();

  if (navigator.onLine) {
    try {
      const valueStr = nextState ? 'ON' : 'OFF';
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

  if (btn) btn.disabled = false;
  playNotificationChime();
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

function isPetugasRole() {
  return currentUser && !isManagerRole() && !isPerawatRole();
}

function ensurePerawatRoleOptionInAccountForm() {
  const roleSel = document.getElementById('new-user-role');
  if (!roleSel) return;
  if (!Array.from(roleSel.options).some(o => o.value === 'perawat')) {
    const opt = document.createElement('option');
    opt.value = 'perawat';
    opt.textContent = 'Perawat (Permintaan Kamar & Pasien Pulang)';
    roleSel.appendChild(opt);
  }
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
  const defaultTab = (isManagerRole() || isPerawatRole()) ? 'dashboard' : 'inspect';
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
  if (!isManagerRole()) {
    return alert('Hanya akun Manajemen / Supervisor yang dapat mengirim komplain / permintaan perbaikan.');
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

  const supervisorName = currentUser.full_name || 'Supervisor Manajemen';

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
  if (!isManagerRole()) {
    return alert('Hanya akun Manajemen / Supervisor yang dapat menyetujui (Approve) form laporan ini.');
  }
  const rep = inspectionsData.find(r => String(r.id) === String(reportId));
  if (!rep) return alert('Data laporan form tidak ditemukan.');

  if (!confirm(`Approve form laporan "${rep.unit_name}" (Skor ${rep.readiness_score}%) menjadi SIAP PAKAI sekarang?`)) return;

  const approverName = currentUser.full_name || 'Supervisor Manajemen';
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
  if (!isManagerRole()) {
    return alert('Hanya akun Manajemen / Supervisor yang dapat menyetujui (Approve) kamar menjadi Siap Pakai.');
  }
  const latestRep = getLatestInspectionForUnit(unitId, unitName);
  if (latestRep && !isInspectionOfficiallyApproved(latestRep)) {
    return approveReportById(latestRep.id);
  }

  if (!confirm(`Approve "${unitName}" sebagai SIAP PAKAI sekarang?`)) return;
  const approverName = currentUser.full_name || 'Supervisor Manajemen';
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

// ==================== AKSI CEPAT PERAWAT (4 TOMBOL + SUARA) ====================

async function sendNurseRoomAction(unitId, unitName, actionKey) {
  if (!isManagerRole() && !isPerawatRole()) return;
  const cfg = NURSE_REQUEST_TYPES[actionKey] || NURSE_REQUEST_TYPES.pulang;
  const roomLabel = extractSpokenRoomLabel(unitName);

  const ok = confirm(`Kirim permintaan "${cfg.label}" untuk ${unitName} ke Petugas sekarang?`);
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

  // Untuk tambahan extrabed atau minta dibersihkan saat pasien masih dirawat, pertahankan status siap jika sebelumnya siap, selain itu kotor
  const currentUnit = unitsData.find(u => String(u.id) === String(unitId));
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
  } catch (e) {}

  playNotificationChime();
  speakIndonesianAlert(`Permintaan ${cfg.label} kamar ${roomLabel} terkirim.`);
  await loadAllData();
  alert(`Terkirim ke Petugas! Permintaan "${cfg.label}" untuk ${unitName} sudah masuk ke layar & suara notifikasi petugas.`);
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

  const autoApprove = isManagerRole() || !requireApprovalMode;
  const confirmMsg = autoApprove
    ? `Konfirmasi perbaikan pada "${report.unit_name}" sudah selesai? Status kamar akan langsung menjadi SIAP PAKAI.`
    : `Konfirmasi perbaikan pada "${report.unit_name}" sudah selesai?\n\nNotifikasi akan dikirim ke bagian Manajemen agar segera di-approve menjadi Siap Pakai.`;

  if (!confirm(confirmMsg)) return;

  const meta = parseNotesMetadata(report.notes);
  const actorName = currentUser ? currentUser.full_name : 'Petugas';

  if (isManagerRole()) {
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
    document.getElementById('prefill-review-banner')?.classList.add('hidden');
    playNotificationChime();
    await loadAllData();
    alert(`Berhasil! Perbaikan pada ${report.unit_name} selesai dan kamar langsung berstatus SIAP PAKAI.`);
  } else {
    const pendingNote = composeNotesWithMetadata(
      actorName,
      `Menunggu Approval Manajemen (Selesai Perbaikan oleh ${actorName})`,
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
    document.getElementById('prefill-review-banner')?.classList.add('hidden');
    playNotificationChime();
    await loadAllData();
    alert(`Terkirim ke Manajemen! Perbaikan pada ${report.unit_name} sudah dilaporkan selesai dan menunggu approval Manajemen.`);
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

function renderOfficerRevisionBanner() {
  const inspectSection = document.getElementById('tab-inspect');
  if (!inspectSection) return;

  let container = document.getElementById('officer-revision-alert-box');
  if (!container) {
    container = document.createElement('div');
    container.id = 'officer-revision-alert-box';
    inspectSection.insertBefore(container, inspectSection.firstChild);
  }

  if (!isPetugasRole()) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  const revisionReports = getRoomChecklistReports().filter(r => isRevisionRequested(r));
  const nurseTaskUnits = unitsData.filter(u => isNurseMarkedUnit(u.last_checked_by));

  if (revisionReports.length === 0 && nurseTaskUnits.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
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
                  <p class="text-xs font-extrabold text-slate-900">${u.unit_code} - ${u.unit_name}</p>
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
        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-200 text-rose-900">Komplain Manajemen</span>
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

// ==================== MODUL NAVIGASI & FORM CEK PERBAIKAN FASILITAS ====================

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
      : [{ full_name: currentUser?.full_name || 'Petugas / Teknisi', role: 'petugas' }];

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

  const repairs = getRepairReports();
  const activeCount = repairs.filter(r => r.final_status !== 'siap').length;
  if (countEl) countEl.textContent = `${repairs.length} Laporan`;
  if (navBadge) navBadge.classList.toggle('hidden', activeCount === 0);

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
    '*UNDANGAN OPERASIONAL PETUGAS & PERAWAT*',
    '*Aplikasi Cek Kesiapan Kamar*',
    '*RS Khusus Bedah SS Medika*',
    '--------------------------------',
    'Halo Rekan-Rekan Tim,',
    '',
    'Silakan akses aplikasi di bawah ini untuk melakukan permintaan kamar (Perawat), pengecekan kesiapan kamar, pengajuan perbaikan, dan dokumentasi foto:',
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
  if (isPetugasRole() && requireApprovalMode && st.includes('Approved')) {
    document.getElementById('inspect-feedback-status').value = 'Menunggu Approval Manajemen';
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

function initExportPeriodInputs() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const dayEl = document.getElementById('export-filter-day');
  const startEl = document.getElementById('export-filter-start');
  const endEl = document.getElementById('export-filter-end');
  const monthEl = document.getElementById('export-filter-month');
  const yearEl = document.getElementById('export-filter-year');
  const unitEl = document.getElementById('export-filter-unit');

  if (dayEl && !dayEl.value) dayEl.value = todayStr;
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
  const isRepair = isRepairRecord(report);
  const isApproved = isInspectionOfficiallyApproved(report);
  const isRev = isRevisionRequested(report);
  const meta = parseNotesMetadata(report.notes);
  const actorName = meta.executor || report.inspector_name;

  let statusLabel = 'MENUNGGU APPROVAL ⏳';
  let badgeLabel = 'Butuh Approval Manajemen • Baru Saja';
  let bodyLabel = `Oleh ${actorName} • Klik untuk cek form & approve`;

  if (isNurseReq) {
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
    badgeLabel = 'Komplain Manajemen • Baru Saja';
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
  if (latestNotifReport && isNurseRequestRecord(latestNotifReport)) {
    if (isPetugasRole() && latestNotifReport.unit_id) quickInspect(latestNotifReport.unit_id);
    else if (!isPerawatRole()) switchTab('dashboard');
  } else if (latestNotifReport && isRepairRecord(latestNotifReport)) {
    openRepairReportInForm(latestNotifReport.id);
  } else if (latestNotifReport && latestNotifReport.id && !isInspectionOfficiallyApproved(latestNotifReport)) {
    openReportInForm(latestNotifReport.id);
  } else if (isManagerRole()) {
    openNotificationDrawer();
  } else if (latestNotifReport && latestNotifReport.id) {
    openReportFullView(latestNotifReport.id);
  } else if (!isPerawatRole()) {
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

    let notifTitle = `Approval Dibutuhkan: ${report.unit_name}`;
    let notifBody = `Petugas ${actorName} selesai cek (${report.readiness_score}%). Mohon cek form & approve.`;

    if (isNurseReq) {
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
      notifBody = `Komplain Manajemen: ${meta.feedbackDetail || 'Segera lakukan perbaikan kamar.'}`;
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
  speakIndonesianAlert('Tes notifikasi suara aktif. Tolong siapkan kamar nomor 201.');
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
    listEl.innerHTML = inspectionsData.slice(0, 20).map(r => {
      const isNurseReq = isNurseRequestRecord(r);
      const isRepair = isRepairRecord(r);
      const isApproved = isInspectionOfficiallyApproved(r);
      const isRev = isRevisionRequested(r);
      const meta = parseNotesMetadata(r.notes);
      const actorName = meta.executor || r.inspector_name;
      const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const reqType = isNurseReq ? getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')) : null;

      const cardStyle = isNurseReq
        ? 'bg-orange-50/80 border-orange-200'
        : isRepair
          ? 'bg-amber-50/80 border-amber-200'
          : isApproved
            ? 'bg-slate-50 border-slate-200/80'
            : isRev
              ? 'bg-rose-50/80 border-rose-200'
              : 'bg-indigo-50/70 border-indigo-200';
      const badgeStyle = isNurseReq
        ? reqType.badgeClass
        : isRepair
          ? (r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')
          : isApproved
            ? 'bg-emerald-100 text-emerald-700'
            : isRev
              ? 'bg-rose-100 text-rose-800'
              : 'bg-indigo-100 text-indigo-800';
      const badgeLabel = isNurseReq
        ? reqType.shortTag
        : isRepair
          ? (r.final_status === 'siap' ? 'SUDAH DIPERBAIKI' : 'CEK PERBAIKAN')
          : isApproved ? 'SIAP PAKAI' : isRev ? 'PERLU PERBAIKAN' : 'MENUNGGU APPROVAL';

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
            ${isNurseReq ? `<p class="text-[11px] font-semibold text-orange-900">${getSpokenTextForReport(r)}</p>` : ''}
          </div>
          ${(isPetugasRole() && isNurseReq && r.unit_id) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); quickInspect('${r.unit_id}');" class="w-full py-2.5 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Cek & Siapkan Kamar Ini
            </button>
          ` : ''}
          ${(isManagerRole() && !isApproved && !isRepair && !isNurseReq && r.id) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); openReportInForm('${r.id}');" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Cek & Approve Form
            </button>
          ` : ''}
          ${(isRepair && r.final_status !== 'siap' && r.id && !isPerawatRole()) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); openRepairReportInForm('${r.id}');" class="w-full py-2.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="wrench" class="w-3.5 h-3.5"></i> Kelola / Tandai Sudah Diperbaiki
            </button>
          ` : ''}
          ${(isPetugasRole() && isRev && !isRepair && !isNurseReq && r.id) ? `
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
  const isRepair = isRepairRecord(r);
  const isApproved = isInspectionOfficiallyApproved(r);
  const isRev = isRevisionRequested(r);
  const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '-';
  const meta = parseNotesMetadata(r.notes);
  const cleanNotesText = meta.cleanNotes
    .replace(REPAIR_RECORD_TAG, '')
    .replace(CHECKOUT_RECORD_TAG, '')
    .replace(NURSE_REQ_TAG, '')
    .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
    .trim();
  const reqType = isNurseReq ? getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')) : null;

  const checklistHtml = Array.isArray(r.checklist_data) && r.checklist_data.length > 0
    ? r.checklist_data.map(c => `<div class="flex items-center justify-between py-2 px-3 rounded-xl ${c.checked ? 'bg-emerald-50/70 text-slate-800' : 'bg-rose-50/70 text-rose-800'}"><span class="text-xs font-bold">${c.item}</span><span class="text-xs font-extrabold">${c.checked ? '✅ Sesuai' : '❌ Belum'}</span></div>`).join('')
    : '<p class="text-xs text-slate-400">Tidak ada rincian checklist.</p>';

  const badgeClass = isNurseReq
    ? reqType.badgeClass
    : isRepair
      ? (r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')
      : isApproved
        ? 'bg-emerald-100 text-emerald-700'
        : isRev
          ? 'bg-rose-100 text-rose-800'
          : 'bg-indigo-100 text-indigo-800';
  const badgeText = isNurseReq
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
        ${meta.executor ? `<div class="col-span-2 pt-1 border-t border-slate-200/70"><span class="text-[10px] text-indigo-600 font-bold block">${isNurseReq ? 'PERAWAT BERTUGAS' : isRepair ? 'PETUGAS YANG DITUGASKAN' : 'PETUGAS PELAKSANA'}</span><span class="font-extrabold text-slate-800">${meta.executor}</span></div>` : ''}
      </div>
      ${meta.feedbackStatus ? `<div class="${isApproved || r.final_status === 'siap' ? 'bg-emerald-50/80 border-emerald-200' : isRev ? 'bg-rose-50/80 border-rose-200' : 'bg-amber-50/80 border-amber-200'} border rounded-2xl p-3 space-y-1"><span class="text-[10px] font-extrabold uppercase ${isApproved || r.final_status === 'siap' ? 'text-emerald-800' : isRev ? 'text-rose-800' : 'text-amber-800'} block">Status & Tanggapan</span><p class="text-xs font-extrabold text-slate-800">${meta.feedbackStatus}</p>${meta.feedbackDetail ? `<p class="text-xs text-rose-700 font-semibold">${isNurseReq ? 'Instruksi' : isRepair ? 'Kategori' : 'Bagian Ditandai Perbaikan'}: ${meta.feedbackDetail}</p>` : ''}</div>` : ''}
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
      if ((username === 'admin' && password === 'azis123') || (username === 'petugas1' && password === 'petugas123') || (username === 'perawat1' && password === 'perawat123')) {
        currentUser = {
          username,
          full_name: username === 'admin' ? 'Supervisor Manajemen' : username === 'perawat1' ? 'Perawat Nurse Station' : 'Petugas Shift Pagi',
          role: username === 'admin' ? 'manajemen' : username === 'perawat1' ? 'perawat' : 'petugas'
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
    const lockApprovedOption = isPetugasRole() && requireApprovalMode;
    optApproved.disabled = lockApprovedOption;
    optApproved.hidden = lockApprovedOption;
  }
  if (fbSel && !activeReviewReportId) {
    if (isManagerRole() || !requireApprovalMode) {
      fbSel.value = 'Sesuai Standar (Approved)';
    } else {
      fbSel.value = 'Menunggu Approval Manajemen';
    }
  }

  const btnSubmit = document.getElementById('btn-submit-inspect');
  if (btnSubmit && !activeReviewReportId) {
    btnSubmit.textContent = (isPetugasRole() && requireApprovalMode) ? 'Ajukan Approval' : 'Simpan Laporan';
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
    btnSubmit.textContent = (isPetugasRole() && requireApprovalMode) ? 'Ajukan Approval' : 'Simpan Laporan';
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
    fbSel.value = (isManagerRole() || !requireApprovalMode) ? 'Sesuai Standar (Approved)' : 'Menunggu Approval Manajemen';
  }

  const detailEl = document.getElementById('inspect-feedback-detail');
  if (detailEl) detailEl.value = meta.feedbackDetail || '';

  const notesEl = document.getElementById('inspect-notes');
  if (notesEl) notesEl.value = meta.cleanNotes || '';

  const savedChecklist = Array.isArray(latestRep.checklist_data) ? latestRep.checklist_data : [];
  document.querySelectorAll('.inspect-chk').forEach(chk => {
    const chkNorm = normalizeText(chk.dataset.name);
    const foundItem = savedChecklist.find(c =>
      c.item === chk.dataset.name || normalizeText(c.item) === chkNorm
    );
    chk.checked = foundItem ? Boolean(foundItem.checked) : false;
  });
  updateScore();

  watermarkedPhotos = {
    room: latestRep.photo_room_url || null,
    toilet: latestRep.photo_toilet_url || null
  };
  updatePhotoBoxUI('room', watermarkedPhotos.room);
  updatePhotoBoxUI('toilet', watermarkedPhotos.toilet);

  const reviewBanner = document.getElementById('prefill-review-banner');
  const reviewDesc = document.getElementById('prefill-review-desc');
  const btnDirectApprove = document.getElementById('btn-direct-approve-form');

  if (btnDirectApprove) {
    btnDirectApprove.classList.add('hidden');
  }

  if (reviewBanner && reviewDesc) {
    const waktu = latestRep.created_at ? new Date(latestRep.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const extraComplaintHtml = isRev && meta.feedbackDetail
      ? `<span class="block mt-1 px-2 py-1 rounded-lg bg-rose-100 text-rose-800 font-extrabold">⚠️ Komplain Manajemen: ${meta.feedbackDetail}</span>`
      : '';
    reviewDesc.innerHTML = `Diajukan oleh <strong>${executorName}</strong>${waktu ? ' (' + waktu + ')' : ''} • Skor <strong>${latestRep.readiness_score}%</strong>. Silakan periksa hasil checklist & foto di bawah sebelum mengambil keputusan.${extraComplaintHtml} <button type="button" onclick="resetFormForFreshCheck()" class="underline font-extrabold text-indigo-950 ml-1">Kosongkan Form</button>`;
    reviewBanner.classList.remove('hidden');
  }

  const btnSubmit = document.getElementById('btn-submit-inspect');
  const btnWa = document.getElementById('btn-submit-wa');

  if (isManagerRole() && btnSubmit) {
    const actionRow = btnSubmit.parentElement;
    if (actionRow) actionRow.classList.add('hidden');

    document.getElementById('bottom-review-actions')?.remove();
    const bottomBox = document.createElement('div');
    bottomBox.id = 'bottom-review-actions';
    bottomBox.className = 'pt-2 space-y-2.5';
    bottomBox.innerHTML = `
      <button type="button" onclick="approveActiveFormReport()" class="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition">
        <i data-lucide="check-circle-2" class="w-4 h-4"></i> APPROVE LAPORAN INI (JADIKAN SIAP PAKAI)
      </button>
      <div class="grid grid-cols-2 gap-2.5">
        <button type="button" onclick="requestRevisionFromActiveForm()" class="py-3 px-3 bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition">
          <i data-lucide="alert-triangle" class="w-4 h-4"></i> Perlu Diperbaiki
        </button>
        <button type="button" onclick="saveAndSendWhatsApp()" class="py-3 px-3 bg-teal-600 hover:bg-teal-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition">
          <i data-lucide="send" class="w-4 h-4"></i> Simpan & WA
        </button>
      </div>
    `;
    actionRow?.parentElement?.appendChild(bottomBox);
  } else {
    clearBottomFormReviewBar();
    if (btnSubmit) {
      if (isRev) {
        btnSubmit.textContent = requireApprovalMode ? 'Kirim Selesai Perbaikan' : 'Simpan Selesai Perbaikan';
      } else {
        btnSubmit.textContent = requireApprovalMode ? 'Ajukan Approval' : 'Simpan Laporan';
      }
    }
    if (btnWa) btnWa.classList.remove('hidden');
  }

  lucide.createIcons();
}

function loadExistingInspectionToForm(unitId) {
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  if (!unit) { clearPrefillFormState(); return; }

  const eff = getEffectiveUnitStatus(unit);
  const latestRep = getLatestInspectionForUnit(unit.id, unit.unit_name);

  if ((eff === 'pending_approval' || eff === 'dibersihkan' || eff === 'perlu_perbaikan') && latestRep && !isInspectionOfficiallyApproved(latestRep)) {
    const meta = parseNotesMetadata(latestRep.notes);
    const ownerName = meta.executor || latestRep.inspector_name;
    if (isManagerRole() || eff === 'perlu_perbaikan' || (currentUser && ownerName === currentUser.full_name)) {
      populateFormWithReport(latestRep);
      return;
    }
  }

  clearPrefillFormState();
  populateOfficerDropdown();
  populateShiftDropdown();
}

function openReportInForm(reportId) {
  const rep = inspectionsData.find(r => String(r.id) === String(reportId));
  if (!rep) return;
  if (isNurseRequestRecord(rep)) {
    if (isPetugasRole() && rep.unit_id) quickInspect(rep.unit_id);
    else if (!isPerawatRole()) switchTab('dashboard');
    return;
  }
  if (isRepairRecord(rep)) {
    openRepairReportInForm(reportId);
    return;
  }
  switchTab('inspect', false, true);
  populateOfficerDropdown();
  populateShiftDropdown();
  populateFormWithReport(rep);
}

function handleInspectUnitChange() {
  const unitId = document.getElementById('inspect-unit')?.value;
  if (unitId) loadExistingInspectionToForm(unitId);
}

function configureNavigationByRole() {
  ensureRepairNavigationAndSection();
  const navGrid = document.getElementById('bottom-nav-grid');
  const bottomNavContainer = navGrid ? navGrid.closest('nav') || navGrid.parentElement : null;
  const btnDash = document.getElementById('nav-item-dashboard');
  const btnInspect = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.tab === 'inspect');
  const btnRepair = document.getElementById('nav-item-repair');
  const btnAnalytics = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.tab === 'analytics');
  const btnMaster = document.getElementById('nav-item-master');
  const inviteBox = document.getElementById('invite-box-about');

  if (isPerawatRole()) {
    // Sembunyikan seluruh navigasi bawah pada akun Perawat agar layar bersih & fokus
    if (bottomNavContainer) bottomNavContainer.classList.add('hidden');
    if (navGrid) navGrid.classList.add('hidden');
    inviteBox?.classList.add('hidden');
  } else if (isPetugasRole()) {
    if (bottomNavContainer) bottomNavContainer.classList.remove('hidden');
    if (navGrid) navGrid.classList.remove('hidden');
    btnDash?.classList.add('hidden');
    btnInspect?.classList.remove('hidden');
    btnRepair?.classList.remove('hidden');
    btnAnalytics?.classList.remove('hidden');
    btnMaster?.classList.add('hidden');
    if (navGrid) {
      navGrid.classList.remove('grid-cols-2', 'grid-cols-4', 'grid-cols-5');
      navGrid.classList.add('grid-cols-3');
    }
    inviteBox?.classList.add('hidden');
  } else {
    if (bottomNavContainer) bottomNavContainer.classList.remove('hidden');
    if (navGrid) navGrid.classList.remove('hidden');
    btnDash?.classList.remove('hidden');
    btnInspect?.classList.remove('hidden');
    btnRepair?.classList.remove('hidden');
    btnAnalytics?.classList.remove('hidden');
    btnMaster?.classList.remove('hidden');
    if (navGrid) {
      navGrid.classList.remove('grid-cols-2', 'grid-cols-3', 'grid-cols-4');
      navGrid.classList.add('grid-cols-5');
    }
    inviteBox?.classList.remove('hidden');
  }
}

async function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('user-greeting').textContent = 'Halo, ' + currentUser.full_name;
  ensurePerawatRoleOptionInAccountForm();
  configureNavigationByRole();
  renderApprovalToggleCard();
  populateOfficerDropdown();
  populateShiftDropdown();
  populateRepairFormDropdowns();
  renderMasterShifts();
  updateNotificationPermissionUI();

  const badge = document.getElementById('user-role-badge');
  badge.textContent = currentUser.role.toUpperCase();
  badge.className = isManagerRole()
    ? 'shrink-0 text-[7.5px] font-extrabold uppercase px-1 py-0.5 rounded bg-indigo-100 text-indigo-700 tracking-wide'
    : isPerawatRole()
      ? 'shrink-0 text-[7.5px] font-extrabold uppercase px-1 py-0.5 rounded bg-orange-100 text-orange-700 tracking-wide'
      : 'shrink-0 text-[7.5px] font-extrabold uppercase px-1 py-0.5 rounded bg-teal-100 text-teal-700 tracking-wide';

  const userCard = document.getElementById('user-management-card');
  if (userCard) userCard.style.display = isManagerRole() ? 'block' : 'none';

  const savedTab = localStorage.getItem('ck_last_tab');
  const validTabs = isManagerRole()
    ? ['dashboard', 'inspect', 'repair', 'analytics', 'master']
    : isPerawatRole()
      ? ['dashboard']
      : ['inspect', 'repair', 'analytics'];
  const startTab = validTabs.includes(savedTab) ? savedTab : ((isManagerRole() || isPerawatRole()) ? 'dashboard' : 'inspect');
  try { window.history.replaceState({ tab: startTab }, ''); } catch (e) {}
  switchTab(startTab, true);

  await loadAllData();
  if (inspectionsData[0] && !lastKnownReportId) {
    lastKnownReportId = inspectionsData[0].id;
    localStorage.setItem('ck_last_seen_id', lastKnownReportId);
  }
  startRealtimeReportListener();
}

function logout() {
  localStorage.removeItem('ck_user');
  localStorage.removeItem('ck_last_tab');
  document.documentElement.classList.remove('has-session');
  location.reload();
}

function updateNetworkStatus() {
  const el = document.getElementById('network-status');
  if (navigator.onLine) {
    el.className = 'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap';
    el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online';
  } else {
    el.className = 'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap';
    el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Offline';
  }
}

async function switchTab(tabName, fromPopState = false, skipAutoPrefill = false) {
  if (isPetugasRole() && (tabName === 'dashboard' || tabName === 'master')) {
    tabName = 'inspect';
  }
  if (isPerawatRole()) {
    tabName = 'dashboard';
  }
  ensureRepairNavigationAndSection();
  activeTabName = tabName;
  localStorage.setItem('ck_last_tab', tabName);

  document.querySelectorAll('.page-section').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('page-animate');
  });
  const targetSection = document.getElementById('tab-' + tabName);
  if (targetSection) {
    targetSection.classList.remove('hidden');
    void targetSection.offsetWidth;
    targetSection.classList.add('page-animate');
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('nav-btn-active', isActive);
    btn.classList.toggle('text-slate-500', !isActive);
  });

  const defaultTab = (isManagerRole() || isPerawatRole()) ? 'dashboard' : 'inspect';
  if (!fromPopState && tabName !== defaultTab) {
    try { window.history.pushState({ tab: tabName }, ''); } catch (e) {}
  }
  if (tabName === 'inspect') {
    populateOfficerDropdown();
    populateShiftDropdown();
    renderOfficerRevisionBanner();
    startTimer();
    if (!skipAutoPrefill) {
      if (activeReviewReportId) {
        const rep = inspectionsData.find(r => String(r.id) === String(activeReviewReportId));
        if (rep) populateFormWithReport(rep);
      } else {
        const curUnitId = document.getElementById('inspect-unit')?.value;
        if (curUnitId) loadExistingInspectionToForm(curUnitId);
      }
    }
  }
  if (tabName === 'repair') {
    populateRepairFormDropdowns();
    renderRepairHistoryList();
    if (navigator.onLine) await loadAllData();
  }
  if (tabName === 'master') {
    ensurePerawatRoleOptionInAccountForm();
    renderApprovalToggleCard();
    renderMasterShifts();
  }
  if (tabName === 'analytics') renderAnalytics();
}

async function loadAllData() {
  const [uRes, iRes, insRes, usrRes] = await Promise.all([
    db.from('master_units').select('*').order('unit_code', { ascending: true }),
    db.from('master_items').select('*').order('created_at', { ascending: true }),
    db.from('room_inspections').select('*').order('created_at', { ascending: false }).limit(200),
    db.from('app_users').select('*').order('created_at', { ascending: true })
  ]);
  unitsData = uRes.data || [];
  itemsData = iRes.data || [];
  inspectionsData = insRes.data || [];
  usersData = usrRes.data || [];

  syncApprovalConfigFromItems();
  await ensureDefaultShiftsInDb();
  rebuildShiftsFromItems();
  populateOfficerDropdown();
  populateRepairFormDropdowns();
  initExportPeriodInputs();
  renderDashboard();
  renderInspectForm();
  renderOfficerRevisionBanner();
  renderRepairHistoryList();
  renderUsers();
  renderMasterUnits();
  renderMasterItems();
  renderAnalytics();

  if (activeTabName === 'inspect') {
    if (activeReviewReportId) {
      const rep = inspectionsData.find(r => String(r.id) === String(activeReviewReportId));
      if (rep) populateFormWithReport(rep);
    } else {
      const curUnitId = document.getElementById('inspect-unit')?.value;
      if (curUnitId) loadExistingInspectionToForm(curUnitId);
    }
  }
}

function applyNurseDashboardVisibility() {
  const dashSection = document.getElementById('tab-dashboard');
  if (!dashSection) return;

  // Sembunyikan 3 kartu statistik atas (Siap Pakai, Kosong/Proses, Maintenance) & tombol Scan QR untuk akun Perawat
  const statSiapEl = document.getElementById('stat-siap');
  const statsRow = statSiapEl ? statSiapEl.closest('.grid') : null;
  if (statsRow) statsRow.classList.toggle('hidden', isPerawatRole());

  dashSection.querySelectorAll('button').forEach(btn => {
    if ((btn.textContent || '').includes('Scan QR')) {
      btn.classList.toggle('hidden', isPerawatRole());
    }
  });

  let banner = document.getElementById('nurse-station-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'nurse-station-banner';
    dashSection.insertBefore(banner, dashSection.firstChild);
  }
  if (!isPerawatRole()) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-white p-3.5 shadow-sm mb-3 flex items-center justify-between gap-3">
      <div class="space-y-0.5">
        <span class="text-[9.5px] font-extrabold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">Nurse Station</span>
        <h3 class="text-xs sm:text-sm font-extrabold">Permintaan Layanan Kamar (1 Ketuk)</h3>
        <p class="text-[11px] text-orange-50">Pilih kamar di bawah lalu ketuk tombol sesuai kebutuhan (suara notifikasi otomatis berbunyi di HP Petugas).</p>
      </div>
      <i data-lucide="volume-2" class="w-7 h-7 shrink-0 opacity-90"></i>
    </div>
  `;
  lucide.createIcons();
}

function renderDashboard() {
  applyNurseDashboardVisibility();
  const siap = unitsData.filter(u => getEffectiveUnitStatus(u) === 'siap').length;
  const kosongOrProses = unitsData.filter(u => ['kosong', 'dibersihkan', 'pending_approval', 'perlu_perbaikan'].includes(getEffectiveUnitStatus(u))).length;
  const maint = unitsData.filter(u => getEffectiveUnitStatus(u) === 'maintenance').length;
  const pendingUnitsCount = unitsData.filter(u => getEffectiveUnitStatus(u) === 'pending_approval').length;

  document.getElementById('stat-siap').textContent = siap;
  document.getElementById('stat-kotor').textContent = kosongOrProses;
  document.getElementById('stat-maint').textContent = maint;

  const mgmtBanner = document.getElementById('management-approval-alert');
  if (mgmtBanner) {
    if (isManagerRole() && pendingUnitsCount > 0) {
      document.getElementById('approval-alert-title').textContent = `${pendingUnitsCount} Kamar Menunggu Approval`;
      mgmtBanner.classList.remove('hidden');
    } else {
      mgmtBanner.classList.add('hidden');
    }
  }

  const grid = document.getElementById('dashboard-unit-grid');
  if (unitsData.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-center py-8 text-xs text-slate-400">Belum ada unit kamar. Tambahkan di menu Pengaturan.</div>';
    return;
  }
  grid.innerHTML = unitsData.map(u => {
    const eff = getEffectiveUnitStatus(u);
    const latestRep = getLatestInspectionForUnit(u.id, u.unit_name);
    const isWaitingApproval = (eff === 'pending_approval' || eff === 'dibersihkan');
    const isNeedsRevision = (eff === 'perlu_perbaikan');
    const isNurseMarked = isNurseMarkedUnit(u.last_checked_by);
    const safeUnitName = (u.unit_name || '').replace(/'/g, "\\'");

    const statusMap = {
      siap: { label: 'SIAP PAKAI', bg: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-200' },
      pending_approval: { label: 'MENUNGGU APPROVAL', bg: 'bg-indigo-100 text-indigo-800', border: 'border-indigo-300' },
      perlu_perbaikan: { label: 'PERLU PERBAIKAN', bg: 'bg-rose-100 text-rose-800', border: 'border-rose-300' },
      dibersihkan: { label: 'SEDANG DIBERSIHKAN', bg: 'bg-amber-100 text-amber-700', border: 'border-amber-200' },
      kosong: { label: isNurseMarked ? 'PERMINTAAN PERAWAT' : 'KOSONG', bg: isNurseMarked ? 'bg-orange-100 text-orange-800' : 'bg-slate-200 text-slate-700', border: isNurseMarked ? 'border-orange-300' : 'border-slate-300' },
      maintenance: { label: 'MAINTENANCE', bg: 'bg-rose-100 text-rose-700', border: 'border-rose-200' }
    };
    const st = statusMap[eff] || statusMap.kosong;

    const actorMeta = latestRep ? parseNotesMetadata(latestRep.notes) : null;
    const checkedInfo = eff === 'maintenance'
      ? (u.last_checked_by || 'Dalam Perbaikan / Maintenance')
      : isNeedsRevision
        ? `⚠️ Komplain: ${actorMeta?.feedbackDetail || 'Menunggu perbaikan petugas'}`
        : isWaitingApproval
          ? `Diajukan: ${actorMeta?.executor || latestRep?.inspector_name || 'Petugas'} (${latestRep?.readiness_score ?? 0}%)`
          : isNurseMarked
            ? (u.last_checked_by || 'Permintaan Perawat')
            : (eff === 'siap' ? (u.last_checked_by || 'Siap Pakai') : 'Belum dicek (Kosong)');

    // Tampilan khusus Perawat: 4 tombol aksi cepat langsung di kartu kamar
    if (isPerawatRole()) {
      return `
        <div class="glass-card rounded-2xl p-4 shadow-sm border ${st.border} flex flex-col justify-between space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <span class="text-[10px] font-mono font-bold text-slate-400">${u.unit_code} • ${u.floor || ''}</span>
              <h3 class="text-sm font-extrabold text-slate-900 truncate">${u.unit_name}</h3>
            </div>
            <span class="shrink-0 text-[9px] font-extrabold px-2.5 py-1 rounded-full ${st.bg}">${st.label}</span>
          </div>
          <p class="text-[11px] ${isNurseMarked ? 'text-orange-700 font-bold' : 'text-slate-500'} truncate">${checkedInfo}</p>
          <div class="grid grid-cols-2 gap-1.5 pt-1">
            <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'siapkan')" class="py-2.5 px-2 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
              <span>🛏️</span> Siapkan Kamar
            </button>
            <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'extrabed')" class="py-2.5 px-2 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
              <span>➕</span> Tambah Extrabed
            </button>
            <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'bersihkan')" class="py-2.5 px-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
              <span>🧹</span> Minta Dibersihkan
            </button>
            <button type="button" onclick="sendNurseRoomAction('${u.id}', '${safeUnitName}', 'pulang')" class="py-2.5 px-2 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
              <span>🚪</span> Pasien Pulang
            </button>
          </div>
        </div>
      `;
    }

    const dropdownOptions = `
      <option value="siap" ${eff === 'siap' ? 'selected' : ''}>SIAP PAKAI</option>
      <option value="pending_approval" ${eff === 'pending_approval' ? 'selected' : ''}>MENUNGGU APPROVAL</option>
      <option value="perlu_perbaikan" ${eff === 'perlu_perbaikan' ? 'selected' : ''}>PERLU PERBAIKAN</option>
      <option value="dibersihkan" ${eff === 'dibersihkan' ? 'selected' : ''}>SEDANG DIBERSIHKAN</option>
      <option value="kosong" ${eff === 'kosong' ? 'selected' : ''}>KOSONG</option>
      <option value="maintenance" ${eff === 'maintenance' ? 'selected' : ''}>MAINTENANCE</option>
    `;

    const openAction = (latestRep && !isInspectionOfficiallyApproved(latestRep))
      ? `openReportInForm('${latestRep.id}')`
      : `quickInspect('${u.id}')`;

    const showApprovalButtons = isManagerRole() && isWaitingApproval;

    return `
      <div class="glass-card rounded-2xl p-4 shadow-sm border ${st.border} flex flex-col justify-between space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <span class="text-[10px] font-mono font-bold text-slate-400">${u.unit_code} • ${u.floor || ''}</span>
            <h3 class="text-sm font-extrabold text-slate-900 truncate">${u.unit_name}</h3>
          </div>
          <select onchange="quickChangeUnitStatus('${u.id}', this.value)" ${!isManagerRole() ? 'disabled' : ''} class="shrink-0 text-[9px] font-extrabold px-2 py-1 rounded-full ${st.bg} outline-none cursor-pointer">
            ${dropdownOptions}
          </select>
        </div>
        ${showApprovalButtons ? `
          <div class="space-y-1.5">
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" onclick="${openAction}" class="py-2 px-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Cek Form
              </button>
              <button type="button" onclick="approveUnitByManagement('${u.id}', '${safeUnitName}')" class="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Approve
              </button>
            </div>
            <button type="button" onclick="requestRevisionByManagement('${u.id}', '${safeUnitName}', '${latestRep ? latestRep.id : ''}')" class="w-full py-1.5 px-2 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 border border-rose-200 font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 transition">
              <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> Perlu Diperbaiki (Komplain)
            </button>
          </div>
        ` : ''}
        <div class="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100">
          <span class="text-[10px] ${isNeedsRevision ? 'text-rose-700 font-bold' : isNurseMarked ? 'text-orange-700 font-bold' : 'text-slate-500 font-medium'} truncate">${checkedInfo}</span>
          <div class="flex items-center gap-1.5 shrink-0">
            ${(eff === 'siap' && isManagerRole()) ? `<button type="button" onclick="confirmPatientCheckout('${u.id}', '${safeUnitName}')" title="Konfirmasi Pasien Pulang / Kosongkan" class="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-lg text-[10px] font-bold">Pasien Pulang</button>` : ''}
            <button type="button" onclick="quickInspect('${u.id}')" class="px-3 py-1 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-lg text-[11px] font-bold">Cek Sekarang</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

function quickInspect(unitId) {
  if (isPerawatRole()) return;
  switchTab('inspect', false, true);
  const unitSel = document.getElementById('inspect-unit');
  if (unitSel) unitSel.value = unitId;
  loadExistingInspectionToForm(unitId);
}

function startTimer() {
  clearInterval(timerInterval);
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    document.getElementById('timer-display').textContent = `${String(Math.floor(secondsElapsed / 60)).padStart(2, '0')}:${String(secondsElapsed % 60).padStart(2, '0')}`;
  }, 1000);
}

function renderInspectForm() {
  const prevSelectedUnit = document.getElementById('inspect-unit')?.value;
  document.getElementById('inspect-unit').innerHTML = unitsData.map(u => `<option value="${u.id}">${u.unit_code} - ${u.unit_name}</option>`).join('');
  if (prevSelectedUnit && unitsData.some(u => String(u.id) === String(prevSelectedUnit))) {
    document.getElementById('inspect-unit').value = prevSelectedUnit;
  }
  const box = document.getElementById('checklist-container');
  const realChecklistItems = itemsData.filter(item => !isSystemMetaCategory(item.category));
  if (realChecklistItems.length === 0) { box.innerHTML = '<p class="text-xs text-slate-400">Belum ada item kelengkapan. Tambahkan di Pengaturan.</p>'; return; }
  box.innerHTML = realChecklistItems.map(item => `
    <label class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer active:scale-[0.99] transition">
      <div>
        <span class="text-xs font-bold text-slate-800">${item.item_name}</span>
        <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">${item.category}</span>
        ${item.is_critical ? '<span class="ml-1 text-[10px] font-bold text-rose-600">*Wajib</span>' : ''}
      </div>
      <input type="checkbox" class="inspect-chk w-5 h-5 rounded text-teal-600" data-id="${item.id}" data-name="${item.item_name}" data-critical="${item.is_critical}" onchange="updateScore()" />
    </label>
  `).join('');
  updateScore();
}

function updateScore() {
  const chks = document.querySelectorAll('.inspect-chk');
  if (chks.length === 0) return;
  document.getElementById('readiness-badge').textContent = `Skor: ${Math.round((Array.from(chks).filter(c => c.checked).length / chks.length) * 100)}%`;
}

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
      const officerName = isPetugasRole() ? currentUser.full_name : (document.getElementById('inspect-executor-select')?.value || currentUser.full_name);
      ctx.fillText(`${new Date().toLocaleString('id-ID')} • ${officerName}`, 10, canvas.height - 12);
      watermarkedPhotos[type] = canvas.toDataURL('image/jpeg', 0.75);
      updatePhotoBoxUI(type, watermarkedPhotos[type]);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function buildWaMessage(data, includeChecklist, includeFullLink) {
  const waktu = data.created_at ? new Date(data.created_at).toLocaleString('id-ID') : new Date().toLocaleString('id-ID');
  const isNurseReq = isNurseRequestRecord(data);
  const isRepair = isRepairRecord(data);
  const isApproved = isInspectionOfficiallyApproved(data);
  const isRev = isRevisionRequested(data);
  const reqType = isNurseReq ? getNurseRequestTypeFromString((data.notes || '') + ' ' + (data.shift || '')) : null;

  const statusText = isNurseReq
    ? `${reqType.shortTag} 🛏️`
    : isRepair
      ? (data.final_status === 'siap' ? 'SUDAH DIPERBAIKI ✅' : 'PENGAJUAN PERBAIKAN FASILITAS 🔧')
      : isApproved
        ? 'SIAP PAKAI ✅'
        : isRev
          ? 'PERLU PERBAIKAN ⚠️'
          : 'MENUNGGU APPROVAL MANAJEMEN ⏳';
  const meta = parseNotesMetadata(data.notes);
  const cleanNotesText = meta.cleanNotes
    .replace(REPAIR_RECORD_TAG, '')
    .replace(CHECKOUT_RECORD_TAG, '')
    .replace(NURSE_REQ_TAG, '')
    .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
    .trim();
  const titleText = isNurseReq
    ? `*PERMINTAAN LAYANAN KAMAR (${reqType.shortTag})*`
    : isRepair
      ? '*LAPORAN CEK PERBAIKAN FASILITAS*'
      : '*LAPORAN CEK KESIAPAN KAMAR*';

  const lines = [titleText, '*RS Khusus Bedah SS Medika*', '--------------------------------', `• *Kamar:* ${data.unit_name}`, `• *Waktu / Shift:* ${data.shift}`, `• *${isNurseReq ? 'Perawat Pelapor' : isRepair ? 'Pengaju' : 'Pemeriksa'}:* ${data.inspector_name}`];
  if (meta.executor && !isNurseReq) lines.push(`• *${isRepair ? 'Petugas Ditugaskan' : 'Pelaksana'}:* ${meta.executor}`);
  if (!isRepair && !isNurseReq) lines.push(`• *Skor Kesiapan:* ${data.readiness_score}%`);
  lines.push(`• *Status:* ${statusText}`, `• *Waktu:* ${waktu}`);
  if (meta.feedbackStatus) {
    lines.push('--------------------------------', `• *Tanggapan / Status:* ${meta.feedbackStatus}`);
    if (meta.feedbackDetail) lines.push(`• *${isNurseReq ? 'Instruksi' : isRepair ? 'Kategori' : 'Bagian Perbaikan'}:* ${meta.feedbackDetail}`);
  }
  if (includeChecklist && Array.isArray(data.checklist_data) && data.checklist_data.length > 0 && !isNurseReq) {
    lines.push('--------------------------------', '*Rincian:*');
    data.checklist_data.forEach(c => lines.push(`${c.checked ? '✅' : '❌'} ${c.item}`));
  }
  if (cleanNotesText) lines.push('--------------------------------', `• *Catatan:* ${cleanNotesText}`);
  if (includeFullLink && data.id) lines.push('', '╭──────────────────────────╮', '│  📄 *BUKA LAPORAN PENUH*   │', `│  ${getPublicReportUrl(data.id, false)}`, '╰──────────────────────────╯');
  return lines.join('\n');
}

function openWaShareModal(data) {
  activeWaPayload = data;
  document.getElementById('wa-target-phone').value = localStorage.getItem('ck_last_wa_phone') || '';
  document.getElementById('wa-include-checklist').checked = true;
  const linkChk = document.getElementById('wa-include-link');
  linkChk.checked = Boolean(data.id); linkChk.disabled = !data.id;
  refreshWaPreview();
  openModalWithHistory('modal-wa-share');
  lucide.createIcons();
}

function refreshWaPreview() {
  if (!activeWaPayload) return;
  document.getElementById('wa-message-preview').value = buildWaMessage(activeWaPayload, document.getElementById('wa-include-checklist').checked, document.getElementById('wa-include-link').checked);
}

function previewFullReportFromModal() {
  if (!activeWaPayload) return;
  if (activeWaPayload.id) openReportFullView(activeWaPayload.id);
  else alert('Laporan ini tersimpan saat offline.');
}

function normalizePhone(raw) {
  let digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
}

function executeWhatsAppSend(usePhone) {
  const text = document.getElementById('wa-message-preview').value;
  const rawPhone = document.getElementById('wa-target-phone').value.trim();
  let waUrl = '';
  if (usePhone) {
    const phone = normalizePhone(rawPhone);
    if (!phone) return alert('Masukkan nomor WhatsApp tujuan terlebih dahulu, atau ketuk "Pilih Grup / Kontak".');
    localStorage.setItem('ck_last_wa_phone', rawPhone);
    waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  } else {
    waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  }
  closeActiveModal('modal-wa-share');
  window.open(waUrl, '_blank');
}

function shareHistoryWaById(reportId) {
  const item = inspectionsData.find(r => String(r.id) === String(reportId));
  if (item) openWaShareModal(item);
}

async function processInspectionSubmit(alsoSendWa = false) {
  if (isPerawatRole()) return;
  const unitId = document.getElementById('inspect-unit').value;
  const unit = unitsData.find(u => u.id === unitId);
  if (!unit) return alert('Pilih unit kamar terlebih dahulu');

  const selectedShift = document.getElementById('inspect-shift').value;
  const officerName = document.getElementById('inspect-officer-select')?.value || 'Supervisor Manajemen';
  const executorVal = isPetugasRole()
    ? currentUser.full_name
    : (document.getElementById('inspect-executor-select')?.value || currentUser.full_name);

  let feedbackStatus = document.getElementById('inspect-feedback-status')?.value || '';
  const feedbackDetail = document.getElementById('inspect-feedback-detail')?.value.trim() || '';
  const rawExtraNotes = document.getElementById('inspect-notes').value.trim();

  const chks = Array.from(document.querySelectorAll('.inspect-chk'));
  const checkedCount = chks.filter(c => c.checked).length;
  const score = chks.length ? Math.round((checkedCount / chks.length) * 100) : 100;
  const missingCritical = chks.some(c => c.dataset.critical === 'true' && !c.checked);

  const isManagerSendingRevision = isManagerRole() && (
    feedbackStatus.includes('Perlu Perbaikan') ||
    feedbackStatus.includes('Wajib Diperbaiki')
  );

  let isApproved = false;
  let finalFeedbackDetail = feedbackDetail;

  if (isManagerSendingRevision) {
    isApproved = false;
    feedbackStatus = `Perlu Perbaikan (Komplain oleh ${currentUser.full_name || officerName})`;
    if (!finalFeedbackDetail) {
      finalFeedbackDetail = rawExtraNotes || 'Periksa kembali kelengkapan & kebersihan kamar';
    }
  } else if (isManagerRole() && feedbackStatus.includes('Approved') && score === 100 && !missingCritical) {
    isApproved = true;
    finalFeedbackDetail = '';
    feedbackStatus = `Sesuai Standar (Approved oleh ${currentUser.full_name || officerName})`;
  } else if (!requireApprovalMode && score === 100 && !missingCritical) {
    isApproved = true;
    finalFeedbackDetail = '';
    feedbackStatus = `Sesuai Standar (Otomatis Siap Pakai oleh ${executorVal})`;
  } else {
    isApproved = false;
    if (isPetugasRole()) {
      finalFeedbackDetail = '';
      if (requireApprovalMode) {
        feedbackStatus = activeReviewReportId
          ? `Menunggu Approval Manajemen (Selesai Perbaikan oleh ${executorVal})`
          : 'Menunggu Approval Manajemen';
      } else {
        feedbackStatus = `Belum Lengkap (Skor ${score}%)`;
      }
    } else if (feedbackStatus.includes('Approved') || feedbackStatus.includes('Sesuai Standar')) {
      feedbackStatus = requireApprovalMode ? 'Menunggu Approval Manajemen' : `Belum Lengkap (Skor ${score}%)`;
    }
  }

  const finalStatus = isApproved ? 'siap' : 'kotor';
  const unitCheckedByLabel = isApproved
    ? (isManagerRole() ? `Approved: ${currentUser.full_name || officerName}` : `Siap Pakai (${executorVal})`)
    : isManagerSendingRevision
      ? `Perlu Perbaikan: ${finalFeedbackDetail}`
      : (requireApprovalMode ? `${executorVal} (Menunggu Approval)` : `${executorVal} (Belum Lengkap)`);

  const payload = {
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: isApproved ? (isManagerRole() ? (currentUser.full_name || officerName) : executorVal) : officerName,
    inspector_role: currentUser.role,
    shift: selectedShift,
    readiness_score: score,
    final_status: finalStatus,
    duration_seconds: secondsElapsed,
    checklist_data: chks.map(c => ({ item: c.dataset.name, checked: c.checked })),
    notes: composeNotesWithMetadata(executorVal, feedbackStatus, finalFeedbackDetail, rawExtraNotes),
    photo_room_url: watermarkedPhotos.room,
    photo_toilet_url: watermarkedPhotos.toilet
  };

  const btn = document.getElementById('btn-submit-inspect');
  const btnWa = document.getElementById('btn-submit-wa');
  btn.disabled = true; btnWa.disabled = true; btn.textContent = 'Menyimpan...';

  let savedOk = false;
  let savedRecord = { ...payload, created_at: new Date().toISOString() };

  if (!navigator.onLine) {
    const q = JSON.parse(localStorage.getItem('ck_offline_queue') || '[]');
    q.push(payload);
    localStorage.setItem('ck_offline_queue', JSON.stringify(q));
    savedOk = true;
  } else {
    if (activeReviewReportId) {
      const { data: updatedRows, error } = await db.from('room_inspections')
        .update({ ...payload, created_at: new Date().toISOString() })
        .eq('id', activeReviewReportId)
        .select();
      if (error) alert('Gagal memperbarui laporan: ' + error.message);
      else {
        if (updatedRows?.[0]) savedRecord = updatedRows[0];
        await db.from('master_units').update({ status: finalStatus, last_checked_at: new Date().toISOString(), last_checked_by: unitCheckedByLabel }).eq('id', unit.id);
        savedOk = true;
      }
    } else {
      const { data: insertedRows, error } = await db.from('room_inspections').insert([payload]).select();
      if (error) alert('Gagal menyimpan laporan: ' + error.message);
      else {
        if (insertedRows?.[0]) {
          savedRecord = insertedRows[0];
          lastKnownReportId = savedRecord.id;
          localStorage.setItem('ck_last_seen_id', savedRecord.id);
        }
        await db.from('master_units').update({ status: finalStatus, last_checked_at: new Date().toISOString(), last_checked_by: unitCheckedByLabel }).eq('id', unit.id);
        savedOk = true;
      }
    }
  }

  btn.disabled = false; btnWa.disabled = false;

  if (savedOk) {
    clearBottomFormReviewBar();
    activeReviewReportId = null;
    document.getElementById('prefill-review-banner')?.classList.add('hidden');
    document.getElementById('inspection-form').reset();
    populateOfficerDropdown();
    populateShiftDropdown();
    document.getElementById('inspect-shift').value = selectedShift;
    resetPhotoBoxes();
    playNotificationChime();
    await loadAllData();
    switchTab(isManagerRole() ? 'dashboard' : 'analytics');
    if (alsoSendWa) openWaShareModal(savedRecord);
    else if (isManagerSendingRevision) alert('Komplain perbaikan terkirim ke Petugas! Status kamar kini ditandai PERLU PERBAIKAN.');
    else if (!isApproved && requireApprovalMode) alert('Laporan tersimpan! Notifikasi telah dikirim ke bagian Manajemen agar segera di-approve menjadi SIAP PAKAI.');
    else if (!isApproved) alert(`Laporan tersimpan dengan skor ${score}%. Lengkapi seluruh checklist wajib agar kamar berstatus SIAP PAKAI.`);
    else alert('Berhasil! Laporan kesiapan kamar tersimpan dan kamar berstatus SIAP PAKAI.');
  }
}

document.getElementById('inspection-form').addEventListener('submit', async (e) => { e.preventDefault(); await processInspectionSubmit(false); });
async function saveAndSendWhatsApp() { await processInspectionSubmit(true); }

async function syncOfflineQueue() {
  const q = JSON.parse(localStorage.getItem('ck_offline_queue') || '[]');
  if (q.length === 0) return;
  for (const item of q) await db.from('room_inspections').insert([item]);
  localStorage.removeItem('ck_offline_queue');
  loadAllData();
}

function openQrScanner() {
  openModalWithHistory('modal-qr-scanner');
  if (qrScannerInstance) {
    qrScannerInstance.stop().catch(() => {}).finally(() => {
      qrScannerInstance = null;
      startQrCamera();
    });
  } else {
    startQrCamera();
  }
}

function startQrCamera() {
  qrScannerInstance = new Html5Qrcode("qr-reader");
  qrScannerInstance.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (decodedText) => {
    closeQrScanner();
    const found = unitsData.find(u => u.unit_code === decodedText || u.id === decodedText);
    if (found) {
      if (isPerawatRole()) confirmPatientCheckout(found.id, found.unit_name);
      else quickInspect(found.id);
    } else alert('Kode QR tidak dikenali: ' + decodedText);
  }).catch(err => alert('Kamera tidak dapat diakses: ' + err));
}

function closeQrScanner() {
  closeActiveModal('modal-qr-scanner');
  if (qrScannerInstance) qrScannerInstance.stop().catch(() => {});
}

function showQrPrint(code, name) {
  activeQrMeta = { code, name };
  document.getElementById('qr-print-title').textContent = name;
  document.getElementById('qr-print-code').textContent = code;
  const box = document.getElementById('qr-code-box');
  box.innerHTML = '';
  new QRCode(box, { text: code, width: 200, height: 200 });
  openModalWithHistory('modal-qr-print');
}

function downloadQrImage() {
  const box = document.getElementById('qr-code-box');
  const source = box.querySelector('canvas') || box.querySelector('img');
  if (!source) return alert('Gambar QR belum siap.');
  const out = document.createElement('canvas');
  out.width = 320; out.height = 390;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, out.width - 20, out.height - 20);
  ctx.fillStyle = '#0d9488'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('RS KHUSUS BEDAH SS MEDIKA', out.width / 2, 42);
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 17px sans-serif'; ctx.fillText(activeQrMeta.name, out.width / 2, 68);
  ctx.drawImage(source, 60, 88, 200, 200);
  ctx.fillStyle = '#334155'; ctx.font = 'bold 16px monospace'; ctx.fillText(activeQrMeta.code, out.width / 2, 322);
  ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif'; ctx.fillText('Scan untuk Cek Kesiapan Kamar', out.width / 2, 348);
  const link = document.createElement('a');
  link.download = `QR_${activeQrMeta.code.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  link.href = out.toDataURL('image/png');
  link.click();
}

function renderUsers() {
  ensurePerawatRoleOptionInAccountForm();
  const list = document.getElementById('master-user-list');
  if (!list) return;
  list.innerHTML = usersData.map(u => {
    const rLower = (u.role || '').toLowerCase();
    const roleBadge = rLower === 'manajemen'
      ? 'bg-indigo-100 text-indigo-700'
      : rLower === 'perawat'
        ? 'bg-orange-100 text-orange-700'
        : 'bg-teal-100 text-teal-700';
    return `
      <div class="py-3 flex items-center justify-between gap-2">
        <div>
          <div class="flex items-center gap-2">
            <p class="text-xs font-extrabold text-slate-900">${u.full_name}</p>
            <span class="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${roleBadge}">${u.role}</span>
          </div>
          <p class="text-[11px] text-slate-500 font-mono mt-0.5">User: ${u.username} • Pass: ${u.password}</p>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" onclick="editUser('${u.id}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-[11px] font-bold">Edit</button>
          ${u.username !== 'admin' ? `<button type="button" onclick="deleteUser('${u.id}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-[11px] font-bold">Hapus</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function editUser(id) {
  if (!isManagerRole()) return;
  ensurePerawatRoleOptionInAccountForm();
  const u = usersData.find(item => item.id === id);
  if (!u) return;
  document.getElementById('edit-user-id').value = u.id;
  document.getElementById('new-user-fullname').value = u.full_name;
  document.getElementById('new-user-username').value = u.username;
  document.getElementById('new-user-password').value = u.password;
  document.getElementById('new-user-role').value = u.role;
  document.getElementById('btn-save-user').textContent = 'Simpan';
}

async function deleteUser(id) {
  if (!isManagerRole()) return;
  if (!confirm('Hapus akun ini?')) return;
  const { error } = await db.from('app_users').delete().eq('id', id);
  if (error) return alert('Gagal menghapus akun: ' + error.message);
  await loadAllData();
}

document.getElementById('form-add-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isManagerRole()) return;
  const id = document.getElementById('edit-user-id').value;
  const payload = { full_name: document.getElementById('new-user-fullname').value.trim(), username: document.getElementById('new-user-username').value.trim(), password: document.getElementById('new-user-password').value.trim(), role: document.getElementById('new-user-role').value };
  const { error } = id ? await db.from('app_users').update(payload).eq('id', id) : await db.from('app_users').insert([payload]);
  if (error) return alert('Gagal menyimpan akun: ' + error.message);
  if (currentUser && currentUser.id === id) {
    currentUser = { ...currentUser, ...payload };
    localStorage.setItem('ck_user', JSON.stringify(currentUser));
    document.getElementById('user-greeting').textContent = 'Halo, ' + currentUser.full_name;
  }
  e.target.reset(); document.getElementById('edit-user-id').value = ''; document.getElementById('btn-save-user').textContent = '+ Akun';
  await loadAllData();
});

function renderMasterUnits() {
  document.getElementById('master-unit-list').innerHTML = unitsData.map(u => {
    const safeCode = String(u.unit_code || '').replace(/'/g, "\\'");
    const safeName = String(u.unit_name || '').replace(/'/g, "\\'");
    return `
    <div class="py-3 flex items-center justify-between gap-2">
      <div>
        <p class="text-xs font-extrabold text-slate-900">${u.unit_code} — ${u.unit_name}</p>
        <p class="text-[11px] text-slate-500">${u.floor || ''} • Status: <strong class="uppercase">${getEffectiveUnitStatus(u)}</strong></p>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="showQrPrint('${safeCode}', '${safeName}')" class="px-2.5 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-[11px] font-bold">QR</button>
        <button type="button" onclick="editUnit('${u.id}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold">Edit</button>
        <button type="button" onclick="deleteUnit('${u.id}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold">Hapus</button>
      </div>
    </div>
  `;
  }).join('');
}

document.getElementById('form-add-unit').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isManagerRole()) return;
  const id = document.getElementById('edit-unit-id').value;
  const payload = { unit_code: document.getElementById('unit-code').value.trim(), unit_name: document.getElementById('unit-name').value.trim(), floor: document.getElementById('unit-floor').value.trim(), status: 'kotor' };
  if (id) { delete payload.status; await db.from('master_units').update(payload).eq('id', id); }
  else await db.from('master_units').insert([payload]);
  e.target.reset(); document.getElementById('edit-unit-id').value = ''; document.getElementById('btn-save-unit').textContent = '+ Simpan Unit';
  loadAllData();
});

function editUnit(id) {
  if (!isManagerRole()) return;
  const u = unitsData.find(x => x.id === id);
  if (!u) return;
  document.getElementById('edit-unit-id').value = u.id;
  document.getElementById('unit-code').value = u.unit_code;
  document.getElementById('unit-name').value = u.unit_name;
  document.getElementById('unit-floor').value = u.floor;
  document.getElementById('btn-save-unit').textContent = 'Perbarui';
}

async function deleteUnit(id) { if (isManagerRole() && confirm('Hapus unit kamar ini?')) { await db.from('master_units').delete().eq('id', id); loadAllData(); } }

function renderMasterItems() {
  const realChecklistItems = itemsData.filter(i => !isSystemMetaCategory(i.category));
  document.getElementById('master-item-list').innerHTML = realChecklistItems.map(i => `
    <div class="py-3 flex items-center justify-between gap-2">
      <div>
        <p class="text-xs font-extrabold text-slate-900">${i.item_name} ${i.is_critical ? '<span class="text-rose-600">*Wajib</span>' : ''}</p>
        <p class="text-[11px] text-slate-500">Kategori: ${i.category}</p>
      </div>
      <div class="flex items-center gap-1.5">
        <button onclick="editItem('${i.id}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold">Edit</button>
        <button onclick="deleteItem('${i.id}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold">Hapus</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('form-add-item').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isManagerRole()) return;
  const id = document.getElementById('edit-item-id').value;
  const payload = { item_name: document.getElementById('item-name').value.trim(), category: document.getElementById('item-category').value, is_critical: document.getElementById('item-critical').checked };
  if (id) await db.from('master_items').update(payload).eq('id', id);
  else await db.from('master_items').insert([payload]);
  e.target.reset(); document.getElementById('edit-item-id').value = ''; document.getElementById('btn-save-item').textContent = '+ Item';
  loadAllData();
});

function editItem(id) {
  if (!isManagerRole()) return;
  const i = itemsData.find(x => x.id === id);
  if (!i) return;
  document.getElementById('edit-item-id').value = i.id;
  document.getElementById('item-name').value = i.item_name;
  document.getElementById('item-category').value = i.category;
  document.getElementById('item-critical').checked = i.is_critical;
  document.getElementById('btn-save-item').textContent = 'Perbarui';
}

async function deleteItem(id) { if (isManagerRole() && confirm('Hapus item kelengkapan ini?')) { await db.from('master_items').delete().eq('id', id); loadAllData(); } }

function renderAnalytics() {
  const siap = unitsData.filter(u => getEffectiveUnitStatus(u) === 'siap').length;
  const kotor = unitsData.filter(u => ['kosong', 'dibersihkan', 'pending_approval', 'perlu_perbaikan'].includes(getEffectiveUnitStatus(u))).length;
  const maint = unitsData.filter(u => getEffectiveUnitStatus(u) === 'maintenance').length;
  const ctx = document.getElementById('chart-status');
  if (statusChart) statusChart.destroy();
  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Siap Pakai', 'Kosong / Proses', 'Maintenance'],
      datasets: [{ data: [siap, kotor, maint], backgroundColor: ['#10b981', '#f59e0b', '#e11d48'], borderWidth: 2, borderColor: '#ffffff' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, padding: 10, font: { size: 10.5, weight: 'bold' } }
        }
      }
    }
  });

  const { rows: filteredRows } = getFilteredExportData();
  const countBadge = document.getElementById('export-filter-count');
  if (countBadge) countBadge.textContent = `${filteredRows.length} Data Terpilih`;

  const total = filteredRows.length;
  document.getElementById('analytic-total').textContent = `${total} Laporan`;
  document.getElementById('analytic-avg-score').textContent = `${total ? Math.round(filteredRows.reduce((a, b) => a + b.readiness_score, 0) / total) : 0}%`;
  document.getElementById('analytic-avg-time').textContent = `${total ? Math.round(filteredRows.reduce((a, b) => a + (b.duration_seconds || 0), 0) / total) : 0} Detik`;

  const historyBox = document.getElementById('history-list');
  if (filteredRows.length === 0) {
    historyBox.innerHTML = '<div class="text-center py-6 text-xs text-slate-400 bg-slate-50 rounded-2xl border border-slate-100">Tidak ada riwayat inspeksi pada filter periode/kamar ini.</div>';
    return;
  }

  const resolveBtnLabel = requireApprovalMode ? 'Selesai Perbaikan & Minta Approve Manajemen' : 'Selesai Perbaikan (Siap Pakai)';

  historyBox.innerHTML = filteredRows.map((r) => {
    const waktuStr = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const meta = parseNotesMetadata(r.notes);
    const isNurseReq = isNurseRequestRecord(r);
    const isRepair = isRepairRecord(r);
    const isApproved = isInspectionOfficiallyApproved(r);
    const needsFix = isRevisionRequested(r);
    const isPendingApproval = !isApproved && !needsFix && !isRepair && !isNurseReq;
    const ownerName = meta.executor || r.inspector_name;
    const canResolveFix = !isRepair && !isNurseReq && needsFix && r.id && (isManagerRole() || isPetugasRole() || (currentUser && ownerName === currentUser.full_name));
    const safeUnitName = (r.unit_name || '').replace(/'/g, "\\'");
    const cleanNotesText = meta.cleanNotes
      .replace(REPAIR_RECORD_TAG, '')
      .replace(CHECKOUT_RECORD_TAG, '')
      .replace(NURSE_REQ_TAG, '')
      .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
      .trim();
    const reqType = isNurseReq ? getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')) : null;

    const pillClass = isNurseReq
      ? reqType.badgeClass
      : isRepair
        ? (r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')
        : isApproved
          ? 'bg-emerald-100 text-emerald-700'
          : isPendingApproval
            ? 'bg-indigo-100 text-indigo-800'
            : 'bg-rose-100 text-rose-800';
    const pillText = isNurseReq
      ? reqType.shortTag
      : isRepair
        ? (r.final_status === 'siap' ? 'SUDAH DIPERBAIKI' : 'CEK PERBAIKAN')
        : isApproved
          ? `SIAP PAKAI (${r.readiness_score}%)`
          : isPendingApproval
            ? `MENUNGGU APPROVAL (${r.readiness_score}%)`
            : `PERLU PERBAIKAN (${r.readiness_score}%)`;

    return `
      <div class="glass-card rounded-2xl p-4 shadow-sm space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h4 class="text-xs font-extrabold text-slate-900">${r.unit_name}</h4>
            <p class="text-[11px] text-slate-500">${isNurseReq ? 'Perawat' : isRepair ? 'Pengaju' : 'Pemeriksa'}: <strong>${r.inspector_name}</strong> • ${r.shift}</p>
            ${(meta.executor && !isNurseReq) ? `<p class="text-[11px] text-indigo-700 font-semibold">${isRepair ? 'Ditugaskan ke' : 'Pelaksana'}: <strong>${meta.executor}</strong></p>` : ''}
            <p class="text-[10px] text-slate-400 mt-0.5">${waktuStr}</p>
          </div>
          <span class="shrink-0 text-[9.5px] font-extrabold px-2.5 py-1 rounded-full ${pillClass}">${pillText}</span>
        </div>
        <div class="text-[11px] px-2.5 py-2 rounded-xl border ${isNurseReq ? 'bg-orange-50/70 border-orange-200 text-orange-900' : isRepair ? 'bg-amber-50/70 border-amber-200 text-amber-900' : isApproved ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' : isPendingApproval ? 'bg-indigo-50/80 border-indigo-200 text-indigo-900' : 'bg-rose-50/80 border-rose-200 text-rose-900'} space-y-1.5">
          <div>
            <p class="font-extrabold">Status: ${meta.feedbackStatus || (isApproved ? 'Sesuai Standar (Approved)' : 'Menunggu Approval Manajemen')}</p>
            ${meta.feedbackDetail ? `<p class="text-[10.5px] mt-0.5">${isNurseReq ? 'Instruksi' : isRepair ? 'Kategori' : 'Bagian Perbaikan'}: <strong>${meta.feedbackDetail}</strong></p>` : ''}
          </div>
          ${canResolveFix ? `
            <button type="button" onclick="markIssueResolvedByOfficer('${r.id}')" class="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> ${isManagerRole() ? 'Masalah Selesai & Approve Siap Pakai' : resolveBtnLabel}
            </button>
          ` : ''}
          ${(isManagerRole() && !isApproved && !isRepair && !isNurseReq && r.id) ? `
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" onclick="openReportInForm('${r.id}')" class="py-2 px-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Cek & Approve
              </button>
              <button type="button" onclick="requestRevisionByManagement('${r.unit_id || ''}', '${safeUnitName}', '${r.id}')" class="py-2 px-2 bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> Perlu Diperbaiki
              </button>
            </div>
          ` : ''}
          ${(isRepair && r.final_status !== 'siap' && r.id && !isPerawatRole()) ? `
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" onclick="openRepairReportInForm('${r.id}')" class="py-2 px-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="wrench" class="w-3.5 h-3.5"></i> Kelola Perbaikan
              </button>
              <button type="button" onclick="markRepairCompletedById('${r.id}')" class="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Sudah Diperbaiki
              </button>
            </div>
          ` : ''}
        </div>
        ${cleanNotesText ? `<p class="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">Catatan: ${cleanNotesText}</p>` : ''}
        <div class="grid grid-cols-2 gap-2">
          ${r.photo_room_url ? `<img src="${r.photo_room_url}" onclick="zoomPhoto(this.src)" class="w-full h-28 object-cover rounded-xl border cursor-pointer" />` : ''}
          ${r.photo_toilet_url ? `<img src="${r.photo_toilet_url}" onclick="zoomPhoto(this.src)" class="w-full h-28 object-cover rounded-xl border cursor-pointer" />` : ''}
        </div>
        <div class="pt-1 flex items-center justify-end gap-2 flex-wrap">
          ${(creatorDeleteUnlocked && isManagerRole() && r.id) ? `<button type="button" onclick="deleteHistoryRecord('${r.id}', '${safeUnitName}', '${r.unit_id || ''}')" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-[11px] font-bold rounded-xl flex items-center gap-1 transition"><i data-lucide="trash-2" class="w-3 h-3"></i> Hapus</button>` : ''}
          ${r.id ? `<button type="button" onclick="openReportFullView('${r.id}')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-xl flex items-center gap-1 transition"><i data-lucide="maximize-2" class="w-3 h-3"></i> Mode Penuh</button>` : ''}
          <button type="button" onclick="shareHistoryWaById('${r.id}')" class="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-[11px] font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition">
            <i data-lucide="send" class="w-3.5 h-3.5"></i> Kirim ke WhatsApp
          </button>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

function exportCsv() {
  const { rows: filteredRows, label, fileSuffix } = getFilteredExportData();
  if (filteredRows.length === 0) return alert(`Tidak ada data laporan pada filter (${label}).`);
  const headers = ['No,Waktu,Unit Kamar,Pemeriksa,Pelaksana,Shift,Skor (%),Status,Tanggapan Pemeriksa,Bagian Perbaikan,Durasi (Detik),Rincian Checklist,Catatan'];
  const rows = filteredRows.map((r, idx) => {
    const meta = parseNotesMetadata(r.notes);
    const cleanNotesText = meta.cleanNotes
      .replace(REPAIR_RECORD_TAG, '')
      .replace(CHECKOUT_RECORD_TAG, '')
      .replace(NURSE_REQ_TAG, '')
      .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
      .trim();
    const checklistStr = Array.isArray(r.checklist_data) ? r.checklist_data.map(c => `${c.item}: ${c.checked ? 'OK' : 'BELUM'}`).join(' | ') : '';
    return `${idx + 1},"${new Date(r.created_at).toLocaleString('id-ID')}","${r.unit_name}","${r.inspector_name}","${meta.executor || r.inspector_name}","${r.shift}",${r.readiness_score},"${r.final_status.toUpperCase()}","${(meta.feedbackStatus || '-').replace(/"/g, '""')}","${(meta.feedbackDetail || '-').replace(/"/g, '""')}",${r.duration_seconds || 0},"${checklistStr.replace(/"/g, '""')}","${cleanNotesText.replace(/"/g, '""')}"`;
  });
  const blob = new Blob(['\uFEFF' + headers.concat(rows).join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Rekap_Kesiapan_Kamar_${fileSuffix}.csv`;
  a.click();
}

function exportPdf() {
  const { rows: filteredRows, label, fileSuffix } = getFilteredExportData();
  if (filteredRows.length === 0) return alert(`Tidak ada data laporan pada filter (${label}).`);
  const includePhotos = document.getElementById('export-pdf-include-photos')?.checked || false;
  const total = filteredRows.length;
  const avgScore = Math.round(filteredRows.reduce((a, b) => a + b.readiness_score, 0) / total);
  const printWin = window.open('', '_blank');
  if (!printWin) return alert('Izinkan pop-up browser untuk mengekspor PDF.');

  const rowsHtml = filteredRows.map((r, i) => {
    const meta = parseNotesMetadata(r.notes);
    const cleanNotesText = meta.cleanNotes
      .replace(REPAIR_RECORD_TAG, '')
      .replace(CHECKOUT_RECORD_TAG, '')
      .replace(NURSE_REQ_TAG, '')
      .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
      .trim();
    const feedbackFull = [meta.feedbackStatus, meta.feedbackDetail ? `Keterangan: ${meta.feedbackDetail}` : ''].filter(Boolean).join(' • ') || '-';
    return `<tr><td>${i + 1}</td><td>${new Date(r.created_at).toLocaleString('id-ID')}</td><td>${r.unit_name}</td><td>${r.inspector_name}</td><td>${meta.executor || r.inspector_name}</td><td>${r.shift}</td><td>${r.readiness_score}%</td><td>${r.final_status.toUpperCase()}</td><td>${feedbackFull}</td><td>${cleanNotesText || '-'}</td>${includePhotos ? `<td><div style="display:flex;gap:4px;">${r.photo_room_url ? `<img src="${r.photo_room_url}" style="width:55px;height:42px;object-fit:cover;border-radius:4px;" />` : ''}${r.photo_toilet_url ? `<img src="${r.photo_toilet_url}" style="width:55px;height:42px;object-fit:cover;border-radius:4px;" />` : ''}</div></td>` : ''}</tr>`;
  }).join('');

  printWin.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8" /><title>Rekap Kesiapan Kamar</title><script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script><style>body{font-family:Arial,sans-serif;padding:20px;color:#1e293b;background:#f8fafc;margin:0}.toolbar{display:flex;gap:10px;margin-bottom:16px;background:#fff;padding:12px 16px;border-radius:12px;border:1px solid #e2e8f0}.btn{padding:10px 16px;border:none;border-radius:10px;font-weight:bold;font-size:13px;cursor:pointer}.btn-download{background:#0d9488;color:#fff}.btn-print{background:#334155;color:#fff}.report-box{background:#fff;padding:24px;border-radius:12px;border:1px solid #e2e8f0}h2{margin:0 0 4px;color:#0d9488;font-size:18px}p{margin:0 0 14px;font-size:12px;color:#64748b}.summary{display:flex;gap:16px;margin-bottom:14px;font-size:12px;background:#f1f5f9;padding:10px 14px;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:middle}th{background-color:#f1f5f9;font-weight:bold}@media print{.no-print{display:none!important}body{background:#fff;padding:0}.report-box{border:none;padding:0}}</style></head><body><div class="toolbar no-print"><button type="button" id="btn-dl-pdf" class="btn btn-download" onclick="downloadDirectPdf()">⬇ Download PDF</button><button type="button" id="btn-print" class="btn btn-print" onclick="window.print()">🖨 Cetak / Print</button></div><div id="pdf-content" class="report-box"><h2>REKAPITULASI LAPORAN KESIAPAN KAMAR</h2><p>RS Khusus Bedah SS Medika • Filter: <strong>${label}</strong> • Dicetak: ${new Date().toLocaleString('id-ID')}</p><div class="summary"><span><strong>Total Laporan:</strong> ${total}</span><span><strong>Rata-Rata Skor Kesiapan:</strong> ${avgScore}%</span></div><table><thead><tr><th>No</th><th>Waktu</th><th>Unit Kamar</th><th>Pemeriksa</th><th>Pelaksana</th><th>Shift</th><th>Skor</th><th>Status</th><th>Tanggapan Pemeriksa</th><th>Catatan</th>${includePhotos ? '<th>Foto</th>' : ''}</tr></thead><tbody>${rowsHtml}</tbody></table></div><script>function downloadDirectPdf(){const btn=document.getElementById('btn-dl-pdf');btn.textContent='Memproses PDF...';btn.disabled=true;html2pdf().set({margin:10,filename:'Rekap_Kesiapan_Kamar_${fileSuffix}.pdf',image:{type:'jpeg',quality:0.95},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'landscape'}}).from(document.getElementById('pdf-content')).save().then(()=>{btn.textContent='⬇ Download PDF';btn.disabled=false;});}<\/script></body></html>`);
  printWin.document.close();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=6.4').catch(() => {});
  });
}
