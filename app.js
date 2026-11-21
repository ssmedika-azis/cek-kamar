const APP_VERSION = '6.8';
const SUPABASE_URL = 'https://ymxpxrrjxnujygabrhsg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlteHB4cnJqeG51anlnYWJyaHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MDk0MjAsImV4cCI6MjExMDQ4NTQyMH0.tFMCbg1_R-I08KEIs-h6wwxXhYLP2Z0oYgnDGC7T2YU';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==================== KEAMANAN APLIKASI & SANITASI XSS ====================
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 jam batas sesi aktif
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 60 * 1000;

function checkLoginRateLimit() {
  const lockUntil = Number(localStorage.getItem('ck_login_lock_until') || 0);
  if (Date.now() < lockUntil) {
    const sec = Math.ceil((lockUntil - Date.now()) / 1000);
    throw new Error(`Terlalu banyak percobaan gagal. Silakan tunggu ${sec} detik demi keamanan.`);
  }
}

function recordLoginFailure() {
  const fails = Number(localStorage.getItem('ck_login_fails') || 0) + 1;
  localStorage.setItem('ck_login_fails', String(fails));
  if (fails >= MAX_LOGIN_ATTEMPTS) {
    localStorage.setItem('ck_login_lock_until', String(Date.now() + LOGIN_LOCK_MS));
    localStorage.setItem('ck_login_fails', '0');
  }
}

function clearLoginFailures() {
  localStorage.removeItem('ck_login_fails');
  localStorage.removeItem('ck_login_lock_until');
}

function isSessionExpired() {
  const loginTs = Number(localStorage.getItem('ck_session_ts') || 0);
  if (!loginTs) return false;
  return (Date.now() - loginTs) > SESSION_TIMEOUT_MS;
}

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
    speak: (roomLabel, extra) => extra
      ? `Perhatian petugas, tolong siapkan kamar ${roomLabel}. Tambahan dari perawat: ${extra}.`
      : `Perhatian petugas, tolong siapkan kamar ${roomLabel} untuk pasien baru.`
  },
  teknisi: {
    key: 'teknisi',
    label: 'Panggil Teknisi Perbaikan',
    shortTag: 'PANGGIL TEKNISI',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
    toastTitle: 'PANGGIL TEKNISI 🔧',
    speak: (roomLabel, extra) => extra
      ? `Perhatian teknisi, ada panggilan perbaikan di kamar ${roomLabel}. Keluhan: ${extra}.`
      : `Perhatian teknisi, segera cek perbaikan fasilitas di kamar ${roomLabel}.`
  },
  bersihkan: {
    key: 'bersihkan',
    label: 'Ruangan Minta Dibersihkan',
    shortTag: 'MINTA DIBERSIHKAN',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
    toastTitle: 'MINTA DIBERSIHKAN 🧹',
    speak: (roomLabel, extra) => extra
      ? `Perhatian petugas, ruangan kamar ${roomLabel} minta dibersihkan. Bagian yang perlu dibersihkan: ${extra}.`
      : `Perhatian petugas, ruangan kamar ${roomLabel} minta dibersihkan.`
  },
  pulang: {
    key: 'pulang',
    label: 'Pasien Pulang',
    shortTag: 'PASIEN PULANG',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
    toastTitle: 'PASIEN PULANG 🚪',
    speak: (roomLabel) => `Perhatian petugas, pasien kamar ${roomLabel} sudah pulang, tolong segera dibersihkan.`
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
if (currentUser && isSessionExpired()) {
  localStorage.removeItem('ck_user');
  localStorage.removeItem('ck_session_ts');
  currentUser = null;
}

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
let officerTaskOpen = false;

let realtimeChannel = null;
let pollingInterval = null;
let lastKnownReportId = localStorage.getItem('ck_last_seen_id') || null;
let unreadNotifCount = 0;
let latestNotifReport = null;
let toastTimeout = null;

if (window.lucide) lucide.createIcons();

// ==================== MESIN SUARA LANTANG & JELAS BAHASA INDONESIA ====================

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
    utter.rate = 0.90; // Sedikit lebih lambat agar pelafalan sangat jelas
    utter.pitch = 1.08; // Nada tegas & jernih
    utter.volume = 1.0; // Volume maksimal

    const voices = window.speechSynthesis.getVoices();
    const idVoice = voices.find(v => (v.lang || '').toLowerCase().includes('id'));
    if (idVoice) utter.voice = idVoice;

    setTimeout(() => {
      try { window.speechSynthesis.speak(utter); } catch (e) {}
    }, 280);
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
  const meta = parseNotesMetadata(notesStr);
  const cleanExtra = meta.cleanNotes
    .replace(REPAIR_RECORD_TAG, '')
    .replace(CHECKOUT_RECORD_TAG, '')
    .replace(NURSE_REQ_TAG, '')
    .replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '')
    .trim();

  if (notesStr.includes('[REQ_TYPE: siapkan]') || shiftStr.startsWith('Siapkan Kamar')) {
    return NURSE_REQUEST_TYPES.siapkan.speak(roomLabel, cleanExtra);
  }
  if (notesStr.includes('[REQ_TYPE: teknisi]') || shiftStr.startsWith('Panggil Teknisi')) {
    return NURSE_REQUEST_TYPES.teknisi.speak(roomLabel, cleanExtra || meta.feedbackDetail);
  }
  if (notesStr.includes('[REQ_TYPE: bersihkan]') || shiftStr.startsWith('Minta Dibersihkan')) {
    return NURSE_REQUEST_TYPES.bersihkan.speak(roomLabel, cleanExtra || meta.feedbackDetail);
  }
  if (notesStr.includes('[REQ_TYPE: pulang]') || notesStr.includes(CHECKOUT_RECORD_TAG) || shiftStr.startsWith('Pasien Pulang')) {
    return NURSE_REQUEST_TYPES.pulang.speak(roomLabel);
  }
  if (isRepairRecord(report)) {
    return report.final_status === 'siap'
      ? `Perhatian, perbaikan fasilitas kamar ${roomLabel} sudah selesai dikerjakan teknisi.`
      : `Perhatian teknisi, ada pengajuan perbaikan fasilitas di kamar ${roomLabel}. ${meta.feedbackDetail || ''}`;
  }
  if (isInspectionOfficiallyApproved(report)) {
    return `Kamar ${roomLabel} sudah di-approve perawat dan siap pakai.`;
  }
  if (isRevisionRequested(report)) {
    return `Perhatian petugas, kamar ${roomLabel} diminta perbaikan ulang oleh perawat.`;
  }
  return `Perhatian perawat, kamar ${roomLabel} sudah selesai disiapkan petugas dan menunggu approve Anda.`;
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
    s.startsWith('Panggil Teknisi') || s.startsWith('Minta Dibersihkan');
}

function isCheckoutRecord(rep) {
  return isNurseRequestRecord(rep);
}

function getNurseRequestTypeFromString(str) {
  const s = String(str || '');
  if (s.includes('[REQ_TYPE: siapkan]') || s.startsWith('Siapkan Kamar')) return NURSE_REQUEST_TYPES.siapkan;
  if (s.includes('[REQ_TYPE: teknisi]') || s.startsWith('Panggil Teknisi')) return NURSE_REQUEST_TYPES.teknisi;
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
            <span class="text-xs sm:text-sm font-extrabold text-slate-900">Permintaan Approval Perawat</span>
            <span class="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full ${requireApprovalMode ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}">
              ${requireApprovalMode ? 'ON (AKTIF)' : 'OFF (NONAKTIF)'}
            </span>
          </div>
          <p class="text-[11px] text-slate-600 leading-relaxed">
            ${requireApprovalMode
              ? 'Laporan petugas harus ditinjau & di-Approve oleh <strong>Perawat</strong> terlebih dahulu sebelum kamar berstatus <strong>SIAP PAKAI</strong>.'
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
    return `<option value="${escapeHtml(s.name)}">${escapeHtml(label)}</option>`;
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
        <p class="text-xs font-extrabold text-slate-900">${escapeHtml(s.name)}</p>
        <p class="text-[11px] text-slate-500">${escapeHtml(s.hours || 'Jam kerja fleksibel')}</p>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="editShift('${escapeHtml(s.id)}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-[11px] font-bold">Edit</button>
        <button type="button" onclick="deleteShift('${escapeHtml(s.id)}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-[11px] font-bold">Hapus</button>
      </div>
    </div>
  `).join('');
}

function editShift(id) {
  if (!requireManagerAction('mengubah shift kerja')) return;
  const s = shiftsData.find(item => String(item.id) === String(id));
  if (!s) return;
  document.getElementById('edit-shift-id').value = s.id;
  document.getElementById('shift-name').value = s.name;
  document.getElementById('shift-hours').value = s.hours || '';
  document.getElementById('btn-save-shift').textContent = 'Perbarui Shift';
  document.getElementById('shift-name').focus();
}

async function deleteShift(id) {
  if (!requireManagerAction('menghapus shift kerja')) return;
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
  if (!requireManagerAction('menyimpan shift kerja')) return;
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

function isReviewerRole() {
  return isPerawatRole() || isManagerRole();
}

const ACCOUNT_ROLE_OPTIONS = [
  { value: 'petugas', label: 'Role: Petugas Kebersihan' },
  { value: 'teknisi', label: 'Role: Teknisi Perbaikan' },
  { value: 'perawat', label: 'Role: Perawat (Permintaan Kamar & Approve)' },
  { value: 'manajemen', label: 'Role: Manajemen' }
];

function roleLabel(role) {
  const r = (role || '').toLowerCase();
  if (r === 'manajemen') return 'Manajemen';
  if (r === 'perawat') return 'Perawat';
  if (r === 'teknisi') return 'Teknisi';
  if (r === 'petugas') return 'Petugas Kebersihan';
  return role || '-';
}

function requireManagerAction(actionLabel) {
  if (isManagerRole()) return true;
  alert('Hanya akun Manajemen yang dapat ' + (actionLabel || 'menyimpan data ini') + '. Silakan masuk dengan akun Manajemen.');
  return false;
}

function ensureAccountRoleOptions() {
  const roleSel = document.getElementById('new-user-role');
  if (!roleSel) return;
  ACCOUNT_ROLE_OPTIONS.forEach(({ value, label }) => {
    if (!Array.from(roleSel.options).some(o => o.value === value)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      roleSel.appendChild(opt);
    }
  });
}

function ensurePerawatRoleOptionInAccountForm() {
  ensureAccountRoleOptions();
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
  const openModals = ['modal-photo-zoom', 'modal-qr-scanner', 'modal-qr-print', 'modal-wa-share', 'modal-notifications', 'modal-about', 'modal-nurse-action', 'modal-export-preview'];
  for (const id of openModals) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) {
      if (id === 'modal-qr-scanner') closeQrScanner();
      else el.classList.add('hidden');
      return;
    }
  }
  const defaultTab = (isManagerRole() || isPerawatRole()) ? 'dashboard' : (isTeknisiRole() ? 'repair' : 'inspect');
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
  return s.startsWith('Pasien Pulang:') || s.startsWith('Siapkan Kamar:') || s.startsWith('Panggil Teknisi:') || s.startsWith('Minta Dibersihkan:');
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
    const rep = getLatestInspectionForUnit(pendingUnit.id, pendingUnit.unit_name);
    if (rep && !isInspectionOfficiallyApproved(rep)) {
      openReportInForm(rep.id);
      return;
    }
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

// ==================== APPROVAL & TINJAUAN OLEH PERAWAT / MANAJEMEN ====================

async function requestRevisionByManagement(unitId, unitName, reportId = null) {
  if (!isReviewerRole()) {
    return alert('Hanya akun Perawat atau Manajemen yang dapat mengirim permintaan perbaikan ulang.');
  }

  let targetRep = reportId
    ? inspectionsData.find(r => String(r.id) === String(reportId))
    : getLatestInspectionForUnit(unitId, unitName);

  const existingDetail = targetRep ? parseNotesMetadata(targetRep.notes).feedbackDetail : '';
  const formDetail = document.getElementById('inspect-feedback-detail')?.value.trim() || '';
  const defaultComplaint = formDetail || existingDetail || '';

  const reviewerLabel = isPerawatRole() ? 'Perawat' : 'Manajemen';
  const complaintInput = prompt(
    `Catatan Perbaikan untuk "${unitName}" (dari ${reviewerLabel}):\n(Contoh: Lantai kamar mandi masih basah / Sprei belum terpasang rapi)`,
    defaultComplaint
  );
  if (complaintInput === null) return;
  const cleanComplaint = complaintInput.trim();
  if (!cleanComplaint) {
    return alert('Mohon isi keterangan bagian mana yang perlu diperbaiki agar petugas mengetahui detailnya.');
  }

  const supervisorName = `${currentUser.full_name || reviewerLabel} (${reviewerLabel})`;

  if (targetRep) {
    const meta = parseNotesMetadata(targetRep.notes);
    const executorName = meta.executor || targetRep.inspector_name || 'Petugas';
    const updatedNotes = composeNotesWithMetadata(
      executorName,
      `Perlu Perbaikan (Ditinjau oleh ${supervisorName})`,
      cleanComplaint,
      meta.cleanNotes
    );

    const { error } = await db.from('room_inspections').update({
      final_status: 'kotor',
      notes: updatedNotes,
      created_at: new Date().toISOString()
    }).eq('id', targetRep.id);

    if (error) return alert('Gagal mengirim permintaan perbaikan: ' + error.message);

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
  alert(`Terkirim ke Petugas! Status ${unitName} kini ditandai PERLU PERBAIKAN.`);
}

async function requestRevisionFromActiveForm() {
  const unitId = document.getElementById('inspect-unit')?.value;
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  const unitName = unit ? unit.unit_name : 'Kamar';
  await requestRevisionByManagement(unitId, unitName, activeReviewReportId);
  switchTab('dashboard');
}

async function approveReportById(reportId) {
  if (!isReviewerRole()) {
    return alert('Hanya akun Perawat atau Manajemen yang dapat menyetujui (Approve) form laporan ini.');
  }
  const rep = inspectionsData.find(r => String(r.id) === String(reportId));
  if (!rep) return alert('Data laporan form tidak ditemukan.');

  if (!confirm(`Approve form laporan "${rep.unit_name}" (Skor ${rep.readiness_score}%) menjadi SIAP PAKAI sekarang?`)) return;

  const reviewerRoleText = isPerawatRole() ? 'Perawat' : 'Manajemen';
  const approverName = `${currentUser.full_name || reviewerRoleText} (${reviewerRoleText})`;
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
  if (!isReviewerRole()) {
    return alert('Hanya akun Perawat atau Manajemen yang dapat menyetujui (Approve) kamar menjadi Siap Pakai.');
  }
  const latestRep = getLatestInspectionForUnit(unitId, unitName);
  if (latestRep && !isInspectionOfficiallyApproved(latestRep)) {
    return approveReportById(latestRep.id);
  }

  if (!confirm(`Approve "${unitName}" sebagai SIAP PAKAI sekarang?`)) return;
  const reviewerRoleText = isPerawatRole() ? 'Perawat' : 'Manajemen';
  const approverName = `${currentUser.full_name || reviewerRoleText} (${reviewerRoleText})`;
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

// ==================== AKSI CEPAT PERAWAT (SIAPKAN KAMAR + DESKRIPSI, PANGGIL TEKNISI, BERSIHKAN, PULANG) ====================

function isCancelledNurseRecord(rep) {
  if (!rep) return false;
  const notes = String(rep.notes || '');
  const shift = String(rep.shift || '');
  return notes.includes('[REQ_CANCELLED') || shift.toLowerCase().includes('dibatalkan');
}

function latestPulangRecordForUnit(unitId) {
  return inspectionsData
    .filter(r => r && String(r.unit_id) === String(unitId) && getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')).key === 'pulang')
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

function latestSiapkanRecordForUnit(unitId) {
  return inspectionsData
    .filter(r => r && String(r.unit_id) === String(unitId) && !isCancelledNurseRecord(r) && getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')).key === 'siapkan')
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

function isSiapkanLockedForUnit(unitId) {
  const siapkanRec = latestSiapkanRecordForUnit(unitId);
  if (!siapkanRec) return false;
  const pulangRec = latestPulangRecordForUnit(unitId);
  if (pulangRec && new Date(pulangRec.created_at || 0) > new Date(siapkanRec.created_at || 0)) return false;
  // Tetap terkunci selama pasien belum pulang dan belum ada pembatalan persiapan kamar
  return true;
}

function openNurseActionModal(unitId, unitName, actionKey) {
  if (!isManagerRole() && !isPerawatRole()) return;

  if (actionKey === 'siapkan' && isSiapkanLockedForUnit(unitId)) {
    return alert('Tombol "Siapkan Kamar" untuk kamar ini sudah diklik dan terkunci. Tombol akan aktif kembali setelah Pasien Pulang atau Pembatalan Persiapan Kamar.');
  }

  document.getElementById('nurse-modal-unit-id').value = unitId;
  document.getElementById('nurse-modal-unit-name').value = unitName;
  document.getElementById('nurse-modal-action-type').value = actionKey;
  document.getElementById('nurse-modal-subtitle').textContent = unitName;
  document.getElementById('nurse-modal-desc').value = '';

  const techWrap = document.getElementById('nurse-tech-category-wrap');
  const titleEl = document.getElementById('nurse-modal-title');
  const descLabel = document.getElementById('nurse-modal-desc-label');
  const descInput = document.getElementById('nurse-modal-desc');
  const hintEl = document.getElementById('nurse-modal-hint');
  const iconWrap = document.getElementById('nurse-modal-icon-wrap');
  const btnSubmit = document.getElementById('btn-submit-nurse-modal');

  if (actionKey === 'teknisi') {
    techWrap?.classList.remove('hidden');
    titleEl.textContent = 'Panggil Teknisi Perbaikan';
    descLabel.textContent = 'Deskripsi Bagian yang Perlu Diperbaiki *';
    descInput.placeholder = 'Contoh: Keran wastafel bocor, lampu kamar mandi mati, atau AC kurang dingin...';
    hintEl.textContent = 'Tugas otomatis masuk ke akun Teknisi & memicu notifikasi suara/getar di HP Teknisi.';
    iconWrap.className = 'w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center';
    iconWrap.innerHTML = '<i data-lucide="wrench" class="w-5 h-5"></i>';
    btnSubmit.className = 'py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm';
    btnSubmit.innerHTML = '<i data-lucide="wrench" class="w-3.5 h-3.5"></i> Panggil Teknisi';
  } else if (actionKey === 'bersihkan') {
    techWrap?.classList.add('hidden');
    titleEl.textContent = 'Minta Dibersihkan + Deskripsi';
    descLabel.textContent = 'Deskripsi Bagian yang Perlu Dibersihkan *';
    descInput.placeholder = 'Contoh: Lantai kamar mandi licin, ganti sprei & sarung bantal, bersihkan meja pasien...';
    hintEl.textContent = 'Tuliskan detail bagian kamar yang perlu dibersihkan agar petugas langsung mengerjakannya.';
    iconWrap.className = 'w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center';
    iconWrap.innerHTML = '<i data-lucide="sparkles" class="w-5 h-5"></i>';
    btnSubmit.className = 'py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm';
    btnSubmit.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> Kirim Permintaan Bersihkan';
  } else {
    techWrap?.classList.add('hidden');
    titleEl.textContent = 'Siapkan Kamar + Tambahan';
    descLabel.textContent = 'Deskripsi / Permintaan Tambahan (Opsional)';
    descInput.placeholder = 'Contoh: Tolong tambahkan 1 extrabed, selimut ekstra, atau pasien masuk pukul 14.00 WIB...';
    hintEl.textContent = 'Setelah dikirim, tombol Siapkan Kamar akan terkunci sampai Pasien Pulang atau dibatalkan.';
    iconWrap.className = 'w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center';
    iconWrap.innerHTML = '<i data-lucide="bed-double" class="w-5 h-5"></i>';
    btnSubmit.className = 'py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm';
    btnSubmit.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> Kirim ke Petugas';
  }

  openModalWithHistory('modal-nurse-action');
  lucide.createIcons();
  setTimeout(() => descInput?.focus(), 150);
}

async function submitNurseModalAction() {
  const unitId = document.getElementById('nurse-modal-unit-id').value;
  const unitName = document.getElementById('nurse-modal-unit-name').value;
  const actionKey = document.getElementById('nurse-modal-action-type').value;
  const descVal = document.getElementById('nurse-modal-desc').value.trim();
  const techCat = document.getElementById('nurse-tech-category')?.value || 'Lainnya';

  if (actionKey === 'teknisi' && !descVal) {
    alert('Mohon isi deskripsi kerusakan yang perlu diperbaiki agar teknisi membawa peralatan yang tepat.');
    document.getElementById('nurse-modal-desc')?.focus();
    return;
  }

  if (actionKey === 'bersihkan' && !descVal) {
    alert('Mohon isi deskripsi bagian kamar yang perlu dibersihkan terlebih dahulu.');
    document.getElementById('nurse-modal-desc')?.focus();
    return;
  }

  closeActiveModal('modal-nurse-action');
  await sendNurseRoomAction(unitId, unitName, actionKey, descVal, techCat, true);
}

async function sendNurseRoomAction(unitId, unitName, actionKey, extraDesc = '', techCategory = '', skipConfirm = false) {
  if (!isManagerRole() && !isPerawatRole()) return;
  const cfg = NURSE_REQUEST_TYPES[actionKey] || NURSE_REQUEST_TYPES.pulang;
  const roomLabel = extractSpokenRoomLabel(unitName);

  if (cfg.key === 'siapkan' && isSiapkanLockedForUnit(unitId)) {
    return alert('Tombol "Siapkan Kamar" untuk kamar ini masih terkunci. Tunggu petugas menindaklanjuti, atau tekan "Pasien Pulang" terlebih dahulu.');
  }

  if (!skipConfirm) {
    const ok = confirm(`Kirim permintaan "${cfg.label}" untuk ${unitName} sekarang?`);
    if (!ok) return;
  }

  const nurseName = currentUser?.full_name || 'Perawat';
  const jamReq = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  // JIKA PERAWAT MEMANGGIL TEKNISI: OTOMATIS BUAT TUGAS TEKNISI + NOTIFIKASI MASUK KE AKUN TEKNISI
  if (cfg.key === 'teknisi') {
    const detailDamage = extraDesc || 'Perlu pengecekan & perbaikan fasilitas kamar.';
    const composedRepairNotes = composeNotesWithMetadata(
      'Tim Teknisi',
      `Panggilan Teknisi oleh ${nurseName} (Menunggu Perbaikan)`,
      techCategory || 'Fasilitas Kamar',
      `${REPAIR_RECORD_TAG}\n${detailDamage}`
    );

    const repairPayload = {
      unit_id: unitId,
      unit_name: unitName,
      inspector_name: nurseName,
      inspector_role: currentUser?.role || 'perawat',
      shift: `Perbaikan • Panggilan Perawat (${jamReq} WIB)`,
      readiness_score: 0,
      final_status: 'kotor',
      duration_seconds: 0,
      checklist_data: [
        { item: techCategory || 'Fasilitas Kamar', checked: false },
        { item: 'Foto Kondisi Rusak (Awal)', checked: false },
        { item: 'Foto Sesudah Diperbaiki', checked: false }
      ],
      notes: composedRepairNotes,
      photo_room_url: null,
      photo_toilet_url: null
    };

    const { data: insertedRepair, error: repErr } = await db.from('room_inspections').insert([repairPayload]).select();
    if (repErr) return alert('Gagal memanggil teknisi: ' + repErr.message);

    if (insertedRepair?.[0]) {
      lastKnownReportId = insertedRepair[0].id;
      localStorage.setItem('ck_last_seen_id', insertedRepair[0].id);
    }

    await db.from('master_units').update({
      status: 'maintenance',
      last_checked_by: `Panggil Teknisi: ${techCategory} (${nurseName})`,
      last_checked_at: new Date().toISOString()
    }).eq('id', unitId);

    playNotificationChime(true);
    speakIndonesianAlert(`Panggilan teknisi untuk kamar ${roomLabel}, kategori ${techCategory}, telah dikirim.`);
    await loadAllData();
    alert(`Terkirim ke Akun Teknisi! Tugas perbaikan "${techCategory}" untuk ${unitName} sudah masuk ke layar & suara notifikasi Teknisi.`);
    return;
  }

  const prefixMap = {
    siapkan: 'Siapkan Kamar',
    bersihkan: 'Minta Dibersihkan',
    pulang: 'Pasien Pulang'
  };
  const prefixTitle = prefixMap[cfg.key] || 'Pasien Pulang';
  const unitStamp = extraDesc
    ? `${prefixTitle}: ${nurseName} (${jamReq}) • Tambahan: ${extraDesc}`
    : `${prefixTitle}: ${nurseName} (${jamReq})`;

  const { error } = await db.from('master_units').update({
    status: 'kotor',
    last_checked_by: unitStamp,
    last_checked_at: new Date().toISOString()
  }).eq('id', unitId);

  if (error) return alert('Gagal mengirim permintaan kamar: ' + error.message);

  try {
    const spokenMessage = cfg.speak(roomLabel, extraDesc);
    const reqPayload = {
      unit_id: unitId,
      unit_name: unitName,
      inspector_name: nurseName,
      inspector_role: currentUser?.role || 'perawat',
      shift: `${prefixTitle} • ${jamReq} WIB`,
      readiness_score: 0,
      final_status: 'kotor',
      duration_seconds: 0,
      checklist_data: [
        { item: cfg.label, checked: true },
        ...(extraDesc ? [{ item: `Tambahan: ${extraDesc}`, checked: true }] : [])
      ],
      notes: composeNotesWithMetadata(
        nurseName,
        `${cfg.label} (Dilaporkan oleh ${nurseName})`,
        extraDesc || spokenMessage,
        `${NURSE_REQ_TAG}\n[REQ_TYPE: ${cfg.key}]\n${extraDesc || spokenMessage}`
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

  playNotificationChime(true);
  speakIndonesianAlert(`Permintaan ${cfg.label} kamar ${roomLabel} terkirim ke petugas.`);
  await loadAllData();
  alert(`Terkirim ke Petugas! Permintaan "${cfg.label}" untuk ${unitName}${extraDesc ? ` (Tambahan: ${extraDesc})` : ''} sudah masuk ke layar & suara notifikasi petugas.`);
}

async function confirmPatientCheckout(unitId, unitName) {
  return sendNurseRoomAction(unitId, unitName, 'pulang');
}

async function cancelAdmissionRequest(unitId, unitName) {
  if (!isPerawatRole() && !isManagerRole()) return;
  const siapkanRec = latestSiapkanRecordForUnit(unitId);
  if (!siapkanRec) {
    return alert('Tidak ada permintaan "Siapkan Kamar / Pasien Masuk" yang aktif untuk ' + unitName + '.');
  }
  const pulangRec = latestPulangRecordForUnit(unitId);
  if (pulangRec && new Date(pulangRec.created_at || 0) > new Date(siapkanRec.created_at || 0)) {
    return alert('Permintaan pasien masuk untuk ' + unitName + ' sudah ditutup dengan laporan Pasien Pulang.');
  }
  const ok = confirm(`Batalkan permintaan "Siapkan Kamar (Pasien Masuk)" untuk ${unitName}?\n\nPetugas tidak akan lagi menerima pengingat/notifikasi kamar ini, dan tombol Siapkan Kamar dibuka kembali.`);
  if (!ok) return;

  const canceler = currentUser?.full_name || 'Perawat';
  const jamReq = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const roomLabel = extractSpokenRoomLabel(unitName);

  const cancelledNotes = `${siapkanRec.notes || ''}\n[Dibatalkan oleh: ${canceler} • ${jamReq} WIB]\n[REQ_CANCELLED: pasien_masuk]`;
  const { error: updErr } = await db.from('room_inspections').update({
    notes: cancelledNotes,
    shift: `Dibatalkan Pasien Masuk • ${jamReq} WIB`,
    final_status: 'kotor'
  }).eq('id', siapkanRec.id);
  if (updErr) return alert('Gagal membatalkan permintaan: ' + updErr.message);

  await db.from('master_units').update({
    status: 'kosong',
    last_checked_by: '',
    last_checked_at: new Date().toISOString()
  }).eq('id', unitId);

  closeNurseNotificationForUnit(unitId);
  playNotificationChime(false);
  speakIndonesianAlert(`Permintaan pasien masuk kamar ${roomLabel} dibatalkan.`);
  if (navigator.vibrate) navigator.vibrate([180, 80, 180]);

  await loadAllData();
  restartNurseReminderIfNeeded();
  alert(`Permintaan Pasien Masuk untuk ${unitName} dibatalkan.\nPengingat & notifikasi ke Petugas dihentikan, tombol "Siapkan Kamar" dibuka kembali.`);
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
  if (newMode === 'pending_approval') checkedBy = 'Menunggu Approval Perawat';
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

  const autoApprove = isReviewerRole() || !requireApprovalMode;
  const confirmMsg = autoApprove
    ? `Konfirmasi perbaikan pada "${report.unit_name}" sudah selesai? Status kamar akan langsung menjadi SIAP PAKAI.`
    : `Konfirmasi perbaikan pada "${report.unit_name}" sudah selesai?\n\nNotifikasi akan dikirim ke bagian Perawat agar segera ditinjau & di-approve menjadi Siap Pakai.`;

  if (!confirm(confirmMsg)) return;

  const meta = parseNotesMetadata(report.notes);
  const actorName = currentUser ? currentUser.full_name : 'Petugas';

  if (isReviewerRole()) {
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
    restartNurseReminderIfNeeded();
    alert(`Berhasil! Perbaikan pada ${report.unit_name} selesai dan kamar langsung berstatus SIAP PAKAI.`);
  } else {
    const pendingNote = composeNotesWithMetadata(
      actorName,
      `Menunggu Approval Perawat (Selesai Perbaikan oleh ${actorName})`,
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
        last_checked_by: `${actorName} (Menunggu Approval Perawat)`,
        last_checked_at: new Date().toISOString()
      }).eq('id', targetUnitId);
    }

    clearBottomFormReviewBar();
    activeReviewReportId = null;
    document.getElementById('prefill-review-banner')?.classList.add('hidden');
    playNotificationChime();
    await loadAllData();
    restartNurseReminderIfNeeded();
    alert(`Terkirim ke Perawat! Perbaikan pada ${report.unit_name} sudah dilaporkan selesai dan menunggu approval Perawat.`);
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
  restartNurseReminderIfNeeded();
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
    syncOfficerInspectLanding(false);
    return;
  }

  const revisionReports = getRoomChecklistReports().filter(r => isRevisionRequested(r));
  const nurseTaskUnits = unitsData.filter(u => isNurseMarkedUnit(u.last_checked_by) && !String(u.last_checked_by || '').startsWith('Panggil Teknisi:'));

  if (revisionReports.length === 0 && nurseTaskUnits.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  const resolveBtnLabel = requireApprovalMode ? 'Selesai Perbaikan & Minta Approve Perawat' : 'Selesai Perbaikan (Siap Pakai)';

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
          const safeName = escapeHtml(u.unit_name || '');
          const isCleanOnly = String(u.last_checked_by || '').startsWith('Minta Dibersihkan:');
          return `
            <div class="bg-white rounded-xl p-3 border border-amber-200 space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-xs font-extrabold text-slate-900">${escapeHtml(u.unit_code)} - ${safeName}</p>
                  <p class="text-[11px] font-bold text-amber-800">${escapeHtml(u.last_checked_by || '')}</p>
                </div>
              </div>
              <div class="flex items-center gap-1.5 justify-end">
                ${isCleanOnly ? `
                  <button type="button" onclick="acknowledgeNurseTask('${escapeHtml(u.id)}', '${safeName}')" class="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-lg text-[10.5px] flex items-center gap-1 shadow-sm transition">
                    <i data-lucide="check" class="w-3.5 h-3.5"></i> Sudah Dikerjakan
                  </button>
                ` : ''}
                <button type="button" onclick="quickInspect('${escapeHtml(u.id)}')" class="nurse-btn pulse-teal py-1.5 px-3 bg-gradient-to-br from-teal-500 to-cyan-600 text-white font-extrabold rounded-lg text-[10.5px] flex items-center gap-1 shadow-md shadow-teal-600/30 transition">
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
          <h3 class="text-xs font-extrabold text-rose-900 uppercase tracking-wide">Perlu Perbaikan Ulang (${revisionReports.length} Kamar)</h3>
        </div>
        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-200 text-rose-900">Tinjauan Perawat</span>
      </div>
      <div class="space-y-2">
        ${revisionReports.map(rep => {
          const meta = parseNotesMetadata(rep.notes);
          const waktu = rep.created_at ? new Date(rep.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div class="bg-white rounded-xl p-3 border border-rose-200 space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-xs font-extrabold text-slate-900">${escapeHtml(rep.unit_name)}</p>
                  <p class="text-[11px] font-bold text-rose-700 mt-0.5">Catatan: ${escapeHtml(meta.feedbackDetail || 'Periksa kembali kelengkapan & kebersihan kamar')}</p>
                </div>
                <span class="text-[10px] text-slate-400 shrink-0">${waktu}</span>
              </div>
              <div class="grid grid-cols-2 gap-1.5 pt-1">
                <button type="button" onclick="openReportInForm('${escapeHtml(rep.id)}')" class="py-2 px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-extrabold rounded-lg text-[10.5px] flex items-center justify-center gap-1 transition">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Buka & Perbaiki Form
                </button>
                <button type="button" onclick="markIssueResolvedByOfficer('${escapeHtml(rep.id)}')" class="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-lg text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
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
  syncOfficerInspectLanding(false);
}

// ==================== MODUL NAVIGASI & FORM CEK PERBAIKAN FASILITAS (TEKNISI) ====================

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
      <div id="teknisi-alert-banner" class="hidden rounded-2xl bg-purple-600 text-white p-3.5 shadow-lg flex items-center justify-between gap-3">
        <div class="space-y-0.5">
          <span class="text-[9.5px] font-extrabold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">Tugas Teknisi Masuk</span>
          <h3 id="teknisi-alert-title" class="text-xs sm:text-sm font-extrabold">Ada Panggilan Perbaikan Kamar</h3>
          <p class="text-[11px] text-purple-100">Segera kerjakan perbaikan di bawah ini lalu upload foto sesudah & klik Sudah Diperbaiki.</p>
        </div>
        <i data-lucide="wrench" class="w-7 h-7 shrink-0 opacity-90"></i>
      </div>

      <div class="glass-card rounded-3xl p-4 sm:p-5 shadow-sm border border-amber-200/80 space-y-4">
        <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-amber-500"></span>
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">Form Perbaikan & Maintenance Teknisi</span>
            </div>
            <h2 class="text-base font-extrabold text-slate-900 mt-0.5">Form Cek Perbaikan Fasilitas</h2>
            <p class="text-[11px] text-slate-500">Panggilan dari perawat, penugasan teknisi, & dokumentasi selesai</p>
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
                <option value="Gas Medis & Nurse Call">Gas Medis & Nurse Call</option>
                <option value="Lainnya">Lainnya</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-extrabold text-slate-700 mb-1">4. Pelapor / Pengaju</label>
              <input type="text" id="repair-reporter-input" readonly class="w-full px-3 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 outline-none" />
            </div>
          </div>

          <div id="repair-assignment-box" class="rounded-2xl bg-indigo-50/80 border border-indigo-200 p-3 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-extrabold text-indigo-950 flex items-center gap-1.5">
                <i data-lucide="user-check" class="w-3.5 h-3.5 text-indigo-600"></i>
                5. Teknisi yang Ditugaskan Memperbaiki
              </label>
              <span id="repair-assignee-lock-badge" class="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">Tim Teknisi</span>
            </div>
            <select id="repair-assignee-select" class="w-full px-3 py-2.5 rounded-xl bg-white border border-indigo-200 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"></select>
            <p id="repair-assignee-hint" class="text-[10.5px] text-indigo-700">Teknisi otomatis menerima panggilan perbaikan dari perawat & manajemen.</p>
          </div>

          <div>
            <label class="block text-[11px] font-extrabold text-slate-700 mb-1">6. Detail Kerusakan / Tindakan Perbaikan</label>
            <textarea id="repair-notes" rows="2" required placeholder="Contoh: Keran wastafel bocor / lampu kamar mandi mati, sudah diganti seal karet..." class="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 outline-none focus:border-amber-500"></textarea>
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
              <i data-lucide="user-check" class="w-4 h-4"></i> Simpan & Tugaskan Teknisi Perbaikan
            </button>

            <button type="button" id="btn-mark-repair-done" onclick="markActiveRepairAsDone()" class="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition">
              <i data-lucide="check-circle-2" class="w-4 h-4"></i> Sudah Diperbaiki (Selesai)
            </button>
          </div>
        </form>
      </div>

      <div class="space-y-2.5">
        <div class="flex items-center justify-between px-1">
          <h3 class="text-xs font-extrabold text-slate-800 uppercase tracking-wide">Daftar Pengajuan & Tugas Teknisi</h3>
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
    unitSel.innerHTML = unitsData.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</option>`).join('');
    if (prevUnit && unitsData.some(u => String(u.id) === String(prevUnit))) unitSel.value = prevUnit;
  }

  const shiftSel = document.getElementById('repair-shift');
  if (shiftSel) {
    const prevShift = shiftSel.value;
    shiftSel.innerHTML = shiftsData.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.hours ? `${s.name} (${s.hours})` : s.name)}</option>`).join('');
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
      ? usersData.filter(u => ['teknisi', 'petugas', 'manajemen'].includes((u.role || '').toLowerCase()))
      : [{ full_name: currentUser?.full_name || 'Teknisi', role: 'teknisi' }];

    const optionsHtml = ['<option value="Tim Teknisi">Tim Teknisi (Semua Teknisi Aktif)</option>']
      .concat(allStaff.map(u => `<option value="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)} (${escapeHtml(roleLabel(u.role))})</option>`))
      .join('');
    assigneeSel.innerHTML = optionsHtml;

    if (prevAssignee) assigneeSel.value = prevAssignee;

    if (isTeknisiRole() && currentUser) {
      assigneeSel.innerHTML = `<option value="${escapeHtml(currentUser.full_name)}">${escapeHtml(currentUser.full_name)} (Teknisi Login)</option>`;
      assigneeSel.value = currentUser.full_name;
      assigneeSel.disabled = true;
      assigneeSel.classList.add('bg-slate-100', 'text-slate-700', 'cursor-not-allowed');
      if (assigneeBadge) {
        assigneeBadge.textContent = '🔒 Terkunci Sesuai Akun';
        assigneeBadge.className = 'text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-slate-700 text-white';
      }
      if (assigneeHint) assigneeHint.textContent = 'Otomatis terisi dan terkunci sesuai akun teknisi yang sedang login agar tidak bisa memakai nama teknisi lain.';
      if (btnAssign) btnAssign.classList.add('hidden');
    } else if (isManagerRole()) {
      assigneeSel.disabled = false;
      assigneeSel.classList.remove('bg-slate-100', 'text-slate-700', 'cursor-not-allowed');
      if (assigneeBadge) {
        assigneeBadge.textContent = 'Pilih Teknisi';
        assigneeBadge.className = 'text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-600 text-white';
      }
      if (assigneeHint) assigneeHint.textContent = 'Pilih nama teknisi pelaksana yang menangani perbaikan fasilitas ini.';
      if (btnAssign) btnAssign.classList.remove('hidden');
    } else {
      assigneeSel.disabled = true;
      assigneeSel.classList.add('bg-slate-100', 'text-slate-700');
      if (assigneeBadge) {
        assigneeBadge.textContent = '🔒 Tim Teknisi';
        assigneeBadge.className = 'text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700';
      }
      if (assigneeHint) assigneeHint.textContent = 'Tugas akan otomatis masuk ke notifikasi akun Teknisi.';
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
  if (assigneeSel) assigneeSel.value = isTeknisiRole() && currentUser ? currentUser.full_name : 'Tim Teknisi';
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
    const assignedName = isTeknisiRole() && currentUser ? currentUser.full_name : (meta.executor || 'Tim Teknisi');
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
    desc.innerHTML = `Tugas perbaikan <strong>${escapeHtml(rep.unit_name)}</strong> (Pelapor: ${escapeHtml(rep.inspector_name)}). Upload foto sesudah lalu klik <strong>Sudah Diperbaiki</strong>.`;
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
      const actor = currentUser ? currentUser.full_name : 'Teknisi';
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
  const selectedAssignee = (isTeknisiRole() && currentUser)
    ? currentUser.full_name
    : (document.getElementById('repair-assignee-select')?.value || 'Tim Teknisi');
  const detailText = document.getElementById('repair-notes')?.value.trim();

  if (!detailText) return alert('Mohon isi detail kerusakan yang diajukan.');

  const executorStr = selectedAssignee || 'Tim Teknisi';
  const statusStr = `Ditugaskan ke ${executorStr} (Menunggu Perbaikan)`;

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
        last_checked_by: `Perbaikan (${executorStr})`,
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
        last_checked_by: `Perbaikan (${executorStr})`,
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
    else alert(`Pengajuan perbaikan tersimpan & notifikasi dikirim ke ${executorStr}!`);
  }
}

async function saveRepairRequestAndWa() {
  await processRepairRequestSubmit(true);
}

async function assignRepairWorkerFromForm() {
  if (!isManagerRole() && !isTeknisiRole()) return alert('Hanya Manajemen atau Teknisi yang dapat mengambil/menunjuk pelaksana perbaikan.');
  const chosenWorker = document.getElementById('repair-assignee-select')?.value || '';
  if (!chosenWorker) return alert('Silakan pilih terlebih dahulu nama teknisi yang harus memperbaiki.');

  if (!activeRepairReportId) {
    return processRepairRequestSubmit(false);
  }

  const rep = getRepairReports().find(r => String(r.id) === String(activeRepairReportId));
  if (!rep) return;

  const unitId = document.getElementById('repair-unit')?.value || rep.unit_id;
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  const categoryVal = document.getElementById('repair-category')?.value || 'Lainnya';
  const detailText = document.getElementById('repair-notes')?.value.trim() || parseNotesMetadata(rep.notes).cleanNotes.replace(REPAIR_RECORD_TAG, '').trim();
  const managerName = currentUser.full_name || 'Teknisi';

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

  if (error) return alert('Gagal menugaskan teknisi: ' + error.message);

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
  alert(`Berhasil! Tugas perbaikan telah ditetapkan kepada ${chosenWorker}.`);
}

async function quickAssignRepairWorker(reportId, workerName) {
  if ((!isManagerRole() && !isTeknisiRole()) || !workerName) return;
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

  if (error) return alert('Gagal menugaskan teknisi: ' + error.message);

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

  if (!confirm(`Konfirmasi bahwa "${rep.unit_name}" SUDAH DIPERBAIKI oleh Teknisi?\n\nStatus kamar akan otomatis keluar dari Maintenance dan siap disiapkan/dibersihkan petugas.`)) return;

  const meta = parseNotesMetadata(rep.notes);
  const finisherName = currentUser ? currentUser.full_name : (meta.executor || 'Teknisi');
  const rawDetail = overrideNotes !== null
    ? overrideNotes
    : meta.cleanNotes.replace(REPAIR_RECORD_TAG, '').trim();

  const updatedNotes = composeNotesWithMetadata(
    finisherName,
    `Sudah Diperbaiki (Selesai oleh Teknisi ${finisherName})`,
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
  alert(`Berhasil! ${rep.unit_name} ditandai SUDAH DIPERBAIKI oleh ${finisherName}.`);
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
    `Sudah Diperbaiki (Selesai oleh Teknisi ${finisherName})`,
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
  const tekBanner = document.getElementById('teknisi-alert-banner');
  const tekBannerTitle = document.getElementById('teknisi-alert-title');
  if (!listEl) return;

  const repairs = getRepairReports();
  const activeCount = repairs.filter(r => r.final_status !== 'siap').length;
  if (countEl) countEl.textContent = `${repairs.length} Laporan`;
  if (navBadge) navBadge.classList.toggle('hidden', activeCount === 0);

  if (tekBanner) {
    if (isTeknisiRole() && activeCount > 0) {
      tekBanner.classList.remove('hidden');
      if (tekBannerTitle) tekBannerTitle.textContent = `${activeCount} Tugas Perbaikan Menunggu Dikerjakan`;
    } else {
      tekBanner.classList.add('hidden');
    }
  }

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
        ? 'TUGAS TEKNISI 🔧'
        : 'MENUNGGU TEKNISI ⏳';

    const staffOptions = ['<option value="Tim Teknisi">Tim Teknisi</option>']
      .concat(usersData.filter(u => ['teknisi', 'petugas'].includes((u.role || '').toLowerCase())).map(u => `<option value="${escapeHtml(u.full_name)}" ${meta.executor === u.full_name ? 'selected' : ''}>${escapeHtml(u.full_name)} (${escapeHtml(roleLabel(u.role))})</option>`))
      .join('');

    return `
      <div class="glass-card rounded-2xl p-4 shadow-sm border ${isDone ? 'border-emerald-200' : 'border-purple-200'} space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h4 class="text-xs font-extrabold text-slate-900">${escapeHtml(r.unit_name)}</h4>
            <p class="text-[11px] text-slate-500">Pelapor: <strong>${escapeHtml(r.inspector_name)}</strong> • ${waktuStr}</p>
            <div class="flex flex-wrap items-center gap-1.5 mt-1">
              ${meta.feedbackDetail ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">${escapeHtml(meta.feedbackDetail)}</span>` : ''}
              <span class="text-[10px] font-extrabold px-2 py-0.5 rounded ${hasAssignee ? 'bg-indigo-50 text-indigo-800 border border-indigo-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                Pelaksana: ${escapeHtml(hasAssignee ? meta.executor : 'Tim Teknisi')}
              </span>
            </div>
          </div>
          <span class="shrink-0 text-[9px] font-extrabold px-2.5 py-1 rounded-full ${badgeClass}">${badgeText}</span>
        </div>

        ${cleanDetail ? `<p class="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">${escapeHtml(cleanDetail)}</p>` : ''}

        ${(isManagerRole() && !isDone) ? `
          <div class="bg-indigo-50/80 border border-indigo-200 rounded-xl p-2.5 space-y-1.5">
            <label class="block text-[10px] font-extrabold text-indigo-950">Pilih Teknisi yang Memperbaiki:</label>
            <select onchange="quickAssignRepairWorker('${escapeHtml(r.id)}', this.value)" class="w-full px-2.5 py-2 rounded-lg bg-white border border-indigo-200 text-xs font-bold text-slate-800 outline-none">
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
            <button type="button" onclick="openRepairReportInForm('${escapeHtml(r.id)}')" class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold rounded-xl flex items-center gap-1 transition">
              <i data-lucide="camera" class="w-3 h-3"></i> Upload Foto Sesudah
            </button>
            <button type="button" onclick="markRepairCompletedById('${escapeHtml(r.id)}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[11px] font-extrabold rounded-xl flex items-center gap-1 shadow-sm transition">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Sudah Diperbaiki
            </button>
          ` : ''}
          <button type="button" onclick="shareHistoryWaById('${escapeHtml(r.id)}')" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 shadow-sm transition">
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
    'Halo Rekan-Rekan Tim (Perawat, Petugas & Teknisi),',
    '',
    'Silakan akses aplikasi di bawah ini untuk melakukan permintaan kamar, pengecekan kesiapan kamar, perbaikan teknisi, dan dokumentasi foto:',
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
    document.getElementById('inspect-feedback-status').value = 'Menunggu Approval Perawat';
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
        last_checked_by: approved ? `Approved: ${latest.inspector_name}` : `${latest.inspector_name} (Menunggu Approval Perawat)`
      }).eq('id', unitId);
    } else {
      await db.from('master_units').update({ status: 'kotor', last_checked_at: null, last_checked_by: null }).eq('id', unitId);
    }
  }
  await loadAllData();
}

const BULAN_NAMA_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function initExportPeriodInputs() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');

  const unitEl = document.getElementById('export-filter-unit');
  const startMonthEl = document.getElementById('export-start-month');
  const startYearEl = document.getElementById('export-start-year');
  const endMonthEl = document.getElementById('export-end-month');
  const endYearEl = document.getElementById('export-end-year');

  const monthOptionsHtml = BULAN_NAMA_ID.map((nama, i) => {
    const val = String(i + 1).padStart(2, '0');
    return `<option value="${val}">${nama}</option>`;
  }).join('');

  if (startMonthEl && startMonthEl.options.length === 0) {
    startMonthEl.innerHTML = monthOptionsHtml;
    startMonthEl.value = '01';
  }
  if (endMonthEl && endMonthEl.options.length === 0) {
    endMonthEl.innerHTML = monthOptionsHtml;
    endMonthEl.value = mm;
  }

  const maxYear = Math.max(yyyy, 2026);
  const fullYears = [];
  for (let y = maxYear; y >= 2000; y--) fullYears.push(y);

  if (startYearEl && startYearEl.options.length === 0) {
    startYearEl.innerHTML = fullYears.map(y => `<option value="${y}">Tahun ${y}</option>`).join('');
    startYearEl.value = String(yyyy);
  }
  if (endYearEl && endYearEl.options.length === 0) {
    endYearEl.innerHTML = fullYears.map(y => `<option value="${y}">Tahun ${y}</option>`).join('');
    endYearEl.value = String(yyyy);
  }

  if (unitEl) {
    const prevUnit = unitEl.value || 'all';
    const unitOptions = ['<option value="all">Semua Kamar</option>'];
    unitsData.forEach(u => unitOptions.push(`<option value="${escapeHtml(u.unit_name)}">${escapeHtml(u.unit_name)}</option>`));
    unitEl.innerHTML = unitOptions.join('');
    unitEl.value = prevUnit;
  }
}

function handleExportPeriodTypeChange() {
  renderAnalytics();
}

function toggleAllExportSections() {
  const ids = ['exp-opt-room-usage', 'exp-opt-discipline', 'exp-opt-recap-table'];
  const allChecked = ids.every(id => document.getElementById(id)?.checked);
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = !allChecked;
  });
}

function getLocalYmd(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getLocalYmdFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getFilteredExportData() {
  const selectedUnit = document.getElementById('export-filter-unit')?.value || 'all';
  const sM = document.getElementById('export-start-month')?.value || '01';
  const sY = document.getElementById('export-start-year')?.value || String(new Date().getFullYear());
  const eM = document.getElementById('export-end-month')?.value || '12';
  const eY = document.getElementById('export-end-year')?.value || String(new Date().getFullYear());

  let startYm = `${sY}-${sM}`;
  let endYm = `${eY}-${eM}`;
  if (startYm > endYm) {
    const tmp = startYm;
    startYm = endYm;
    endYm = tmp;
  }

  let rows = [...inspectionsData];
  if (selectedUnit !== 'all') rows = rows.filter(r => r.unit_name === selectedUnit);

  rows = rows.filter(r => {
    if (!r.created_at) return false;
    const d = new Date(r.created_at);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return ym >= startYm && ym <= endYm;
  });

  const sMonthName = BULAN_NAMA_ID[Number(sM) - 1] || sM;
  const eMonthName = BULAN_NAMA_ID[Number(eM) - 1] || eM;
  let periodLabel = `${sMonthName} ${sY} s/d ${eMonthName} ${eY}`;
  let fileSuffix = `${sMonthName}_${sY}_sd_${eMonthName}_${eY}`;

  if (selectedUnit !== 'all') {
    periodLabel += ` • ${selectedUnit}`;
    fileSuffix += `_${selectedUnit.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }
  return { rows, label: periodLabel, fileSuffix };
}

let activeExportPreviewMode = 'pdf';

function buildExportPreviewHtml(mode) {
  const { rows, label } = getFilteredExportData();
  const incRoomUsage = document.getElementById('exp-opt-room-usage')?.checked ?? true;
  const incDiscipline = document.getElementById('exp-opt-discipline')?.checked ?? true;
  const incRecapTable = document.getElementById('exp-opt-recap-table')?.checked ?? true;
  const includePhotos = mode === 'pdf' && (document.getElementById('export-pdf-include-photos')?.checked ?? false);

  let html = `
    <div id="preview-printable-sheet" class="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-4 text-slate-900 text-xs">
      <div class="border-b-2 border-teal-600 pb-3">
        <span class="text-[10px] font-extrabold uppercase tracking-wider text-teal-600">RS Khusus Bedah SS Medika</span>
        <h2 class="text-sm sm:text-base font-extrabold text-slate-900 mt-0.5">PRATINJAU REKAP LAPORAN KESIAPAN KAMAR (${mode.toUpperCase()})</h2>
        <p class="text-[11px] text-slate-500 mt-0.5">Periode: <strong>${escapeHtml(label)}</strong> • Total Data: <strong>${rows.length} Laporan</strong></p>
      </div>
  `;

  if (incRoomUsage) {
    const usageSummary = getRoomUsageByPeriodSummary();
    html += `
      <div class="space-y-1.5">
        <h3 class="text-xs font-extrabold text-teal-800">1. Rekap Jumlah Kamar Dipakai &amp; Kosong</h3>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[11px]">
            <thead>
              <tr class="bg-teal-600 text-white">
                <th class="border border-slate-300 px-2.5 py-1.5 text-left">Kurun Waktu</th>
                <th class="border border-slate-300 px-2 py-1.5 text-center">Total Kamar</th>
                <th class="border border-slate-300 px-2 py-1.5 text-center">Dipakai</th>
                <th class="border border-slate-300 px-2 py-1.5 text-center">Kosong / Siap</th>
                <th class="border border-slate-300 px-2 py-1.5 text-center">Aktivitas</th>
              </tr>
            </thead>
            <tbody>
              ${usageSummary.map(u => `
                <tr>
                  <td class="border border-slate-300 px-2.5 py-1.5 font-bold">${escapeHtml(u.periode)}</td>
                  <td class="border border-slate-300 px-2 py-1.5 text-center">${unitsData.length}</td>
                  <td class="border border-slate-300 px-2 py-1.5 text-center font-bold text-orange-700">${u.dipakai}</td>
                  <td class="border border-slate-300 px-2 py-1.5 text-center font-bold text-emerald-700">${u.kosong}</td>
                  <td class="border border-slate-300 px-2 py-1.5 text-center">${u.aktivitas}x</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (incDiscipline) {
    const staffStats = computeDisciplineStats(rows);
    html += `
      <div class="space-y-1.5">
        <h3 class="text-xs font-extrabold text-indigo-800">2. Tabel Kedisiplinan Petugas &amp; Teknisi</h3>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[11px]">
            <thead>
              <tr class="bg-indigo-600 text-white">
                <th class="border border-slate-300 px-2 py-1.5">No</th>
                <th class="border border-slate-300 px-2.5 py-1.5 text-left">Nama</th>
                <th class="border border-slate-300 px-2 py-1.5">Bagian</th>
                <th class="border border-slate-300 px-2 py-1.5">Tugas</th>
                <th class="border border-slate-300 px-2 py-1.5">Tepat Waktu</th>
                <th class="border border-slate-300 px-2 py-1.5">Ulang</th>
                <th class="border border-slate-300 px-2 py-1.5">Skor</th>
              </tr>
            </thead>
            <tbody>
              ${staffStats.length === 0
                ? '<tr><td colspan="7" class="border border-slate-300 p-3 text-center text-slate-400">Tidak ada data kedisiplinan pada periode ini.</td></tr>'
                : staffStats.map((st, i) => `
                    <tr>
                      <td class="border border-slate-300 px-2 py-1.5 text-center">${i + 1}</td>
                      <td class="border border-slate-300 px-2.5 py-1.5 font-bold">${escapeHtml(st.name)}</td>
                      <td class="border border-slate-300 px-2 py-1.5 text-center">${escapeHtml(st.role)}</td>
                      <td class="border border-slate-300 px-2 py-1.5 text-center">${st.total}</td>
                      <td class="border border-slate-300 px-2 py-1.5 text-center">${st.onTime}</td>
                      <td class="border border-slate-300 px-2 py-1.5 text-center">${st.revisions}</td>
                      <td class="border border-slate-300 px-2 py-1.5 text-center font-extrabold">${st.score}%</td>
                    </tr>
                  `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (incRecapTable) {
    html += `
      <div class="space-y-1.5">
        <h3 class="text-xs font-extrabold text-slate-900">3. Tabel Rekapitulasi Laporan Kesiapan Kamar</h3>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[10.5px]">
            <thead>
              <tr class="bg-slate-900 text-white">
                <th class="border border-slate-300 px-2 py-1.5">No</th>
                <th class="border border-slate-300 px-2 py-1.5 text-left">Waktu</th>
                <th class="border border-slate-300 px-2 py-1.5 text-left">Kamar</th>
                <th class="border border-slate-300 px-2 py-1.5 text-left">Pelaksana</th>
                <th class="border border-slate-300 px-2 py-1.5">Skor</th>
                <th class="border border-slate-300 px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0
                ? '<tr><td colspan="6" class="border border-slate-300 p-3 text-center text-slate-400">Tidak ada data laporan pada filter ini.</td></tr>'
                : rows.map((r, i) => {
                    const meta = parseNotesMetadata(r.notes);
                    const statusStr = isInspectionOfficiallyApproved(r) || r.final_status === 'siap' ? 'SIAP PAKAI' : 'PROSES';
                    return `
                      <tr>
                        <td class="border border-slate-300 px-2 py-1 text-center">${i + 1}</td>
                        <td class="border border-slate-300 px-2 py-1">${r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td class="border border-slate-300 px-2 py-1 font-bold">${escapeHtml(r.unit_name)}</td>
                        <td class="border border-slate-300 px-2 py-1">${escapeHtml(meta.executor || r.inspector_name)}</td>
                        <td class="border border-slate-300 px-2 py-1 text-center">${r.readiness_score ?? 0}%</td>
                        <td class="border border-slate-300 px-2 py-1 text-center font-bold">${statusStr}</td>
                      </tr>
                    `;
                  }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (includePhotos) {
    const withPhotos = rows.filter(r => r.photo_room_url || r.photo_toilet_url).slice(0, 15);
    if (withPhotos.length > 0) {
      html += `<div class="space-y-2"><h3 class="text-xs font-extrabold text-slate-900">4. Lampiran Foto Dokumentasi</h3><div class="grid grid-cols-1 sm:grid-cols-2 gap-2">`;
      withPhotos.forEach(r => {
        html += `
          <div class="border border-slate-200 rounded-xl p-2 space-y-1">
            <p class="text-[10.5px] font-bold">${escapeHtml(r.unit_name)}</p>
            <div class="grid grid-cols-2 gap-1.5">
              ${r.photo_room_url ? `<img src="${r.photo_room_url}" class="w-full h-24 object-cover rounded-lg" />` : ''}
              ${r.photo_toilet_url ? `<img src="${r.photo_toilet_url}" class="w-full h-24 object-cover rounded-lg" />` : ''}
            </div>
          </div>
        `;
      });
      html += `</div></div>`;
    }
  }

  html += `</div>`;
  return html;
}

function openExportPreviewModal(mode) {
  const incRoomUsage = document.getElementById('exp-opt-room-usage')?.checked ?? true;
  const incDiscipline = document.getElementById('exp-opt-discipline')?.checked ?? true;
  const incRecapTable = document.getElementById('exp-opt-recap-table')?.checked ?? true;

  if (!incRoomUsage && !incDiscipline && !incRecapTable) {
    return alert('Centang minimal satu pilihan data yang akan ditampilkan sebelum melihat pratinjau.');
  }

  activeExportPreviewMode = mode;
  const { label } = getFilteredExportData();
  const titleEl = document.getElementById('export-preview-title');
  const subEl = document.getElementById('export-preview-subtitle');
  const iconWrap = document.getElementById('export-preview-icon-wrap');
  const bodyEl = document.getElementById('export-preview-body');
  const btnDownload = document.getElementById('btn-confirm-export-download');
  const btnPrint = document.getElementById('btn-confirm-export-print');

  if (mode === 'pdf') {
    titleEl.textContent = 'Pratinjau Laporan PDF';
    subEl.textContent = `Periode: ${label}`;
    iconWrap.className = 'w-8 h-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0';
    iconWrap.innerHTML = '<i data-lucide="file-text" class="w-4 h-4"></i>';
    btnDownload.className = 'py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-sm';
    btnDownload.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i> <span>Download PDF</span>';
    btnPrint?.classList.remove('hidden');
  } else {
    titleEl.textContent = 'Pratinjau Tabel Excel (.xls)';
    subEl.textContent = `Periode: ${label}`;
    iconWrap.className = 'w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0';
    iconWrap.innerHTML = '<i data-lucide="sheet" class="w-4 h-4"></i>';
    btnDownload.className = 'py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-sm';
    btnDownload.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i> <span>Download Excel</span>';
    btnPrint?.classList.add('hidden');
  }

  bodyEl.innerHTML = buildExportPreviewHtml(mode);
  openModalWithHistory('modal-export-preview');
  lucide.createIcons();
}

function confirmDownloadFromPreview() {
  closeActiveModal('modal-export-preview');
  if (activeExportPreviewMode === 'pdf') exportPdf();
  else exportCsv();
}

function printPreviewDocument() {
  const sheet = document.getElementById('preview-printable-sheet');
  if (!sheet) return;
  const win = window.open('', '_blank');
  if (!win) return window.print();
  win.document.write(`<html><head><title>Cetak Laporan Kesiapan Kamar</title><script src="https://cdn.tailwindcss.com"><\/script></head><body class="p-4">${sheet.outerHTML}<script>setTimeout(()=>{window.print();window.close();},500);<\/script></body></html>`);
  win.document.close();
}

// Rekap jumlah kamar dipakai & kosong dalam kurun hari, minggu, bulan, tahun
function getRoomUsageByPeriodSummary() {
  const totalRooms = unitsData.length;
  const now = new Date();
  const todayYmd = getLocalYmdFromDate(now);

  const dow = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow + 1);
  monday.setHours(0, 0, 0, 0);

  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const curYear = String(now.getFullYear());

  const calcStats = (filterFn) => {
    const periodEvents = inspectionsData.filter(r => r.created_at && filterFn(new Date(r.created_at)));
    const usedRoomSet = new Set();
    periodEvents.forEach(r => {
      if (r.unit_id) usedRoomSet.add(String(r.unit_id));
      else if (r.unit_name) usedRoomSet.add(normalizeText(r.unit_name));
    });
    // Pastikan unit yang saat ini berstatus terpakai / proses / maintenance ikut dihitung
    unitsData.forEach(u => {
      const eff = getEffectiveUnitStatus(u);
      if (eff !== 'siap' && eff !== 'kosong') {
        usedRoomSet.add(String(u.id));
      }
    });
    const dipakai = Math.min(totalRooms, usedRoomSet.size);
    const kosong = Math.max(0, totalRooms - dipakai);
    return { dipakai, kosong, aktivitas: periodEvents.length };
  };

  return [
    {
      periode: `Hari Ini (${now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })})`,
      ...calcStats(d => getLocalYmdFromDate(d) === todayYmd)
    },
    {
      periode: 'Minggu Ini (Senin – Hari Ini)',
      ...calcStats(d => d >= monday && d <= now)
    },
    {
      periode: `Bulan Ini (${BULAN_NAMA_ID[now.getMonth()]} ${curYear})`,
      ...calcStats(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === curYm)
    },
    {
      periode: `Tahun Ini (${curYear})`,
      ...calcStats(d => String(d.getFullYear()) === curYear)
    }
  ];
}

function playNotificationChime(long = true) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    // Compressor agar suara jauh lebih kencang, jernih & tidak pecah di speaker HP
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(10, ctx.currentTime);
    compressor.ratio.setValueAtTime(8, ctx.currentTime);
    compressor.attack.setValueAtTime(0.005, ctx.currentTime);
    compressor.release.setValueAtTime(0.15, ctx.currentTime);
    compressor.connect(ctx.destination);

    const now = ctx.currentTime;
    const phrase1 = long ? [783.99, 987.77, 1174.66, 1567.98, 1174.66, 1567.98] : [987.77, 1318.51, 1567.98];
    phrase1.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.13;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.85, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
      osc.connect(gain);
      gain.connect(compressor);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch (e) {}
}

// ====== PENGINGAT BERULANG PETUGAS & TEKNISI ======
let nurseReminderTimer = null;
const NURSE_REMINDER_INTERVAL_MS = 14000;

function latestNurseRequestForUnit(unitId) {
  return inspectionsData
    .filter(r => r && isNurseRequestRecord(r) && String(r.unit_id) === String(unitId))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

function getPendingNurseTaskUnits() {
  return unitsData.filter(u => {
    const stamp = String(u.last_checked_by || '');
    if (!isNurseMarkedUnit(stamp) || stamp.startsWith('Panggil Teknisi:')) return false;
    if (getEffectiveUnitStatus(u) === 'siap') return false;
    return true;
  });
}

function stopNurseReminder() {
  if (nurseReminderTimer) { clearInterval(nurseReminderTimer); nurseReminderTimer = null; }
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
}

function triggerPersistentNurseNotification(unit) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const req = latestNurseRequestForUnit(unit.id);
  const title = 'Permintaan Perawat: ' + unit.unit_name;
  const body = req ? getSpokenTextForReport(req) : 'Ketuk untuk membuka Cek & Siapkan Kamar.';
  const options = {
    body,
    icon: './192x192.png',
    badge: './192x192.png',
    vibrate: [400, 150, 400, 150, 400],
    tag: 'nurse-req-' + unit.id,
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url: window.location.href, unitId: String(unit.id) }
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg && reg.showNotification) {
        reg.showNotification(title, options).catch(() => {});
        postSwAlert({ title, body, tag: options.tag, url: options.data && options.data.url });
      }
    }).catch(() => {});
  }
}

function closeNurseNotificationForUnit(unitId) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration().then(reg => {
    if (!reg || !reg.getNotifications) return;
    reg.getNotifications({ tag: 'nurse-req-' + unitId }).then(list => list.forEach(n => n.close())).catch(() => {});
  }).catch(() => {});
}

function startNurseReminder() {
  if (!isPetugasRole() && !isTeknisiRole()) return stopNurseReminder();
  stopNurseReminder();
  const tick = () => {
    if (isTeknisiRole()) {
      const pendingRepairs = getRepairReports().filter(r => r.final_status !== 'siap');
      if (pendingRepairs.length === 0) return stopNurseReminder();
      const firstRep = pendingRepairs[0];
      const roomLabel = extractSpokenRoomLabel(firstRep.unit_name);
      playNotificationChime(true);
      if (!document.hidden) {
        speakIndonesianAlert(`Perhatian teknisi, ada ${pendingRepairs.length} panggilan perbaikan fasilitas. Segera cek kamar ${roomLabel}.`);
      }
      if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
      return;
    }

    if (!isPetugasRole()) return stopNurseReminder();
    const pending = getPendingNurseTaskUnits();
    if (pending.length === 0) return stopNurseReminder();
    pending.forEach(triggerPersistentNurseNotification);
    const first = pending[0];
    playNotificationChime(true);
    const req = latestNurseRequestForUnit(first.id);
    const roomLabel = extractSpokenRoomLabel(first.unit_name);
    const baseText = req ? getSpokenTextForReport(req) : `Perhatian petugas, tolong siapkan kamar ${roomLabel}.`;
    if (!document.hidden) {
      speakIndonesianAlert(pending.length > 1 ? `${pending.length} permintaan kamar menunggu. ${baseText}` : baseText);
    }
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
  };
  tick();
  nurseReminderTimer = setInterval(tick, NURSE_REMINDER_INTERVAL_MS);
}

function restartNurseReminderIfNeeded() {
  if (isTeknisiRole()) {
    if (getRepairReports().some(r => r.final_status !== 'siap')) startNurseReminder();
    else stopNurseReminder();
    return;
  }
  if (!isPetugasRole()) return stopNurseReminder();
  if (getPendingNurseTaskUnits().length > 0) startNurseReminder();
  else stopNurseReminder();
}

function syncOfficerInspectLanding(forceOpen) {
  const formCard = document.getElementById('inspect-form-card');
  const emptyState = document.getElementById('officer-empty-state');
  if (!isPetugasRole()) {
    if (formCard) formCard.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');
    return;
  }
  const pending = getPendingNurseTaskUnits();
  const revisions = getRoomChecklistReports().filter(r => isRevisionRequested(r));
  const hasTask = pending.length > 0 || revisions.length > 0;
  if (forceOpen) officerTaskOpen = true;
  else if (!hasTask) officerTaskOpen = false;
  if (formCard) formCard.classList.toggle('hidden', !officerTaskOpen);
  if (emptyState) emptyState.classList.toggle('hidden', officerTaskOpen || hasTask);
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
    if (label) label.textContent = 'Status Notifikasi HP & Luar Aplikasi: Aktif ✅';
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
  if (perm === 'granted') {
    ensurePushSubscription(true);
    testNotificationAlert();
  }
}

async function triggerNativePhoneNotification(title, body, reportId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const targetUrl = reportId ? getPublicReportUrl(reportId, true) : window.location.href;
  const options = {
    body,
    icon: './192x192.png',
    badge: './192x192.png',
    vibrate: [400, 150, 400, 150, 400],
    tag: 'cek-kamar-' + (reportId || Date.now()),
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url: targetUrl }
  };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        postSwAlert({ title, body, tag: options.tag, url: targetUrl });
        return;
      }
    }
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); if (reportId) window.location.href = targetUrl; };
  } catch (e) {}
}

function postSwAlert(msg) {
  try {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg => {
      if (reg.active) reg.active.postMessage(Object.assign({ type: 'SHOW_ALERT' }, msg));
    }).catch(() => {});
  } catch (e) {}
}

const VAPID_PUBLIC_KEY = 'BOiHAYDLSYy4v_TqqbA73hMPA-bGLV7KnRSf3WpYLotrqusCUg8l0-DWP9_eR_LWmXq2EeKvp0cpQ7sPmb3q0RE';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

async function savePushSubscription(sub) {
  if (!sub) return false;
  const json = sub.toJSON();
  try {
    const { error } = await db.from('push_subscriptions').upsert({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
      user_name: currentUser?.full_name || currentUser?.username || '',
      role: currentUser?.role || '',
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    return !error;
  } catch (e) {
    return false;
  }
}

async function ensurePushSubscription(showStatus = false) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return null;
  if (Notification.permission !== 'granted') return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const saved = await savePushSubscription(sub);
    const label = document.getElementById('push-status-label');
    if (label && showStatus) {
      label.classList.remove('hidden');
      label.textContent = saved
        ? 'Notifikasi latar belakang AKTIF ✅ — notifikasi tetap masuk walau keluar dari aplikasi.'
        : 'Terdaftar di perangkat. Pastikan izin notifikasi & latar belakang browser diizinkan.';
    }
    return sub;
  } catch (e) {
    return null;
  }
}

async function enableBackgroundPush() {
  if (!('PushManager' in window)) {
    return alert('Browser HP ini tidak mendukung Web Push. Gunakan Chrome/Edge Android dan pasang aplikasi sebagai PWA.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return alert('Izin notifikasi ditolak. Buka pengaturan situs browser → Notifikasi → Izinkan, lalu coba lagi.');
  }
  const sub = await ensurePushSubscription(true);
  const label = document.getElementById('push-status-label');
  if (sub) {
    if (label) label.classList.remove('hidden');
    testNotificationAlert();
  } else if (label) {
    label.classList.remove('hidden');
    label.textContent = 'Notifikasi sistem aktif untuk latar belakang.';
  }
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

  let statusLabel = 'MENUNGGU APPROVE PERAWAT ⏳';
  let badgeLabel = 'Butuh Tinjauan Perawat • Baru Saja';
  let bodyLabel = `Oleh ${actorName} • Klik untuk cek form & approve`;

  if (isNurseReq) {
    const reqType = getNurseRequestTypeFromString((report.notes || '') + ' ' + (report.shift || ''));
    statusLabel = reqType.toastTitle;
    badgeLabel = `Permintaan Perawat (${actorName})`;
    bodyLabel = getSpokenTextForReport(report);
  } else if (isRepair) {
    statusLabel = report.final_status === 'siap' ? 'SUDAH DIPERBAIKI ✅' : 'PANGGILAN TEKNISI 🔧';
    badgeLabel = 'Tugas Perbaikan Fasilitas • Baru Saja';
    bodyLabel = `Pelaksana: ${actorName} • ${meta.feedbackDetail || 'Perbaikan Kamar'}`;
  } else if (isApproved) {
    statusLabel = 'SIAP PAKAI ✅';
    badgeLabel = 'Sudah Di-Approve Perawat • Baru Saja';
    bodyLabel = `Oleh ${actorName} • Skor ${report.readiness_score}%`;
  } else if (isRev) {
    statusLabel = 'PERLU PERBAIKAN ⚠️';
    badgeLabel = 'Tinjauan Perawat • Baru Saja';
    bodyLabel = `Catatan: ${meta.feedbackDetail || 'Segera perbaiki kamar ini'}`;
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
    else switchTab('dashboard');
  } else if (latestNotifReport && isRepairRecord(latestNotifReport)) {
    openRepairReportInForm(latestNotifReport.id);
  } else if (latestNotifReport && latestNotifReport.id && !isInspectionOfficiallyApproved(latestNotifReport)) {
    openReportInForm(latestNotifReport.id);
  } else if (isReviewerRole()) {
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
  try {
    const ackList = JSON.parse(localStorage.getItem('ck_ack_notif_ids') || '[]');
    if (ackList.includes(report.id)) {
      loadAllData();
      return;
    }
  } catch (e) {}
  const isUpdate = lastKnownReportId === report.id;
  lastKnownReportId = report.id;
  localStorage.setItem('ck_last_seen_id', report.id);

  if (isCancelledNurseRecord(report)) { loadAllData(); return; }

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

    const spokenText = getSpokenTextForReport(report);
    playNotificationChime(true);
    if (!document.hidden) {
      speakIndonesianAlert(spokenText);
    }
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
    showInAppBanner(report);

    const meta = parseNotesMetadata(report.notes);
    const actorName = meta.executor || report.inspector_name;

    let notifTitle = `Approval Perawat Dibutuhkan: ${report.unit_name}`;
    let notifBody = `Petugas ${actorName} selesai cek (${report.readiness_score}%). Mohon perawat tinjau & approve.`;

    if (isNurseReq) {
      const reqType = getNurseRequestTypeFromString((report.notes || '') + ' ' + (report.shift || ''));
      notifTitle = `${reqType.label}: ${report.unit_name}`;
      notifBody = spokenText;
    } else if (isRepair) {
      notifTitle = report.final_status === 'siap' ? `Sudah Diperbaiki: ${report.unit_name}` : `Tugas Teknisi: ${report.unit_name}`;
      notifBody = `Pelaksana: ${actorName} • ${meta.feedbackDetail || meta.feedbackStatus}`;
    } else if (isApproved) {
      notifTitle = `Kamar Siap Pakai: ${report.unit_name}`;
      notifBody = `Sudah di-approve (${report.readiness_score}%).`;
    } else if (isRev) {
      notifTitle = `Perlu Perbaikan Ulang: ${report.unit_name}`;
      notifBody = `Catatan Perawat: ${meta.feedbackDetail || 'Segera lakukan perbaikan kamar.'}`;
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
  playNotificationChime(true);
  speakIndonesianAlert('Tes notifikasi suara lantang aktif. Perhatian petugas, tolong siapkan kamar nomor 201.');
  if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
  showInAppBanner(sample);
  triggerNativePhoneNotification('Tes Notifikasi Suara Cek Kamar', 'Notifikasi suara bahasa Indonesia aktif & siap berbunyi di luar aplikasi!', sample.id);
}

function openNotificationDrawer() {
  unreadNotifCount = 0;
  document.getElementById('notif-unread-badge')?.classList.add('hidden');
  const listEl = document.getElementById('notif-drawer-list');
  if (!inspectionsData.length) {
    listEl.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Belum ada riwayat laporan masuk.</p>';
  } else {
    const resolveBtnLabel = requireApprovalMode ? 'Selesai Perbaikan & Minta Approve Perawat' : 'Selesai Perbaikan (Siap Pakai)';
    listEl.innerHTML = inspectionsData.slice(0, 25).map(r => {
      const isNurseReq = isNurseRequestRecord(r);
      const isRepair = isRepairRecord(r);
      const isApproved = isInspectionOfficiallyApproved(r);
      const isRev = isRevisionRequested(r);
      const meta = parseNotesMetadata(r.notes);
      const actorName = meta.executor || r.inspector_name;
      const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const reqType = isNurseReq ? getNurseRequestTypeFromString((r.notes || '') + ' ' + (r.shift || '')) : null;
      const isCancelled = isCancelledNurseRecord(r);

      const cardStyle = isCancelled
        ? 'bg-slate-50/80 border-slate-200'
        : isNurseReq
        ? 'bg-orange-50/80 border-orange-200'
        : isRepair
          ? 'bg-purple-50/80 border-purple-200'
          : isApproved
            ? 'bg-slate-50 border-slate-200/80'
            : isRev
              ? 'bg-rose-50/80 border-rose-200'
              : 'bg-indigo-50/70 border-indigo-200';
      const badgeStyle = isCancelled
        ? 'bg-slate-200 text-slate-500'
        : isNurseReq
        ? reqType.badgeClass
        : isRepair
          ? (r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-800')
          : isApproved
            ? 'bg-emerald-100 text-emerald-700'
            : isRev
              ? 'bg-rose-100 text-rose-800'
              : 'bg-indigo-100 text-indigo-800';
      const badgeLabel = isCancelled
        ? 'DIBATALKAN'
        : isNurseReq
        ? reqType.shortTag
        : isRepair
          ? (r.final_status === 'siap' ? 'SUDAH DIPERBAIKI' : 'TUGAS TEKNISI')
          : isApproved ? 'SIAP PAKAI' : isRev ? 'PERLU PERBAIKAN' : 'MENUNGGU APPROVE PERAWAT';

      return `
        <div class="p-3 rounded-2xl ${cardStyle} border transition space-y-2">
          <div onclick="${(r.id && !isPerawatRole()) ? `openReportFullView('${escapeHtml(r.id)}')` : ''}" class="cursor-pointer space-y-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-extrabold text-slate-900 truncate">${escapeHtml(r.unit_name)}</span>
              <span class="shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full ${badgeStyle}">${badgeLabel}</span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500">
              <span class="truncate">Oleh: <strong>${escapeHtml(actorName)}</strong></span>
              <span class="shrink-0 text-[10px]">${waktu}</span>
            </div>
            ${isRev && meta.feedbackDetail ? `<p class="text-[11px] font-bold text-rose-700">Catatan: ${escapeHtml(meta.feedbackDetail)}</p>` : ''}
            ${isNurseReq ? `<p class="text-[11px] font-semibold text-orange-900">${escapeHtml(getSpokenTextForReport(r))}</p>` : ''}
            ${isRepair ? `<p class="text-[11px] font-semibold text-purple-900">${escapeHtml(meta.feedbackDetail || 'Perbaikan Fasilitas')}</p>` : ''}
          </div>
          ${(isPetugasRole() && isNurseReq && !isCancelled && r.unit_id) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); quickInspect('${escapeHtml(r.unit_id)}');" class="w-full py-2.5 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Cek & Siapkan Kamar Ini
            </button>
          ` : ''}
          ${isCancelled ? `<p class="text-[10.5px] font-bold text-slate-500">Permintaan ini sudah dibatalkan perawat.</p>` : ''}
          ${(isReviewerRole() && !isApproved && !isRepair && !isNurseReq && r.id) ? `
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" onclick="closeActiveModal('modal-notifications'); openReportInForm('${escapeHtml(r.id)}');" class="py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1">
                <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Tinjau Form
              </button>
              <button type="button" onclick="closeActiveModal('modal-notifications'); approveReportById('${escapeHtml(r.id)}');" class="py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Approve
              </button>
            </div>
          ` : ''}
          ${(isRepair && r.final_status !== 'siap' && r.id && !isPerawatRole()) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); openRepairReportInForm('${escapeHtml(r.id)}');" class="w-full py-2.5 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="wrench" class="w-3.5 h-3.5"></i> Kerjakan / Tandai Sudah Diperbaiki
            </button>
          ` : ''}
          ${(isPetugasRole() && isRev && !isRepair && !isNurseReq && r.id) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); markIssueResolvedByOfficer('${escapeHtml(r.id)}');" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
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
  }, 6000); // Polling dipercepat menjadi tiap 6 detik agar notifikasi luar aplikasi selalu responsif
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
    container.innerHTML = `<div class="bg-white rounded-3xl p-6 text-center shadow-sm space-y-2 border border-rose-200"><p class="text-sm font-extrabold text-rose-600">Laporan Tidak Ditemukan</p><p class="text-xs text-slate-500">${escapeHtml(err.message)}</p></div>`;
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
    ? r.checklist_data.map(c => `<div class="flex items-center justify-between py-2 px-3 rounded-xl ${c.checked ? 'bg-emerald-50/70 text-slate-800' : 'bg-rose-50/70 text-rose-800'}"><span class="text-xs font-bold">${escapeHtml(c.item)}</span><span class="text-xs font-extrabold">${c.checked ? '✅ Sesuai' : '❌ Belum'}</span></div>`).join('')
    : '<p class="text-xs text-slate-400">Tidak ada rincian checklist.</p>';

  const badgeClass = isNurseReq
    ? reqType.badgeClass
    : isRepair
      ? (r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-800')
      : isApproved
        ? 'bg-emerald-100 text-emerald-700'
        : isRev
          ? 'bg-rose-100 text-rose-800'
          : 'bg-indigo-100 text-indigo-800';
  const badgeText = isNurseReq
    ? reqType.shortTag
    : isRepair
      ? (r.final_status === 'siap' ? 'SUDAH DIPERBAIKI ✅' : 'PANGGILAN TEKNISI 🔧')
      : isApproved
        ? 'SIAP PAKAI ✅'
        : isRev
          ? 'PERLU PERBAIKAN ⚠️'
          : 'MENUNGGU APPROVE PERAWAT ⏳';

  const photo1Label = isRepair ? 'Foto Rusak (Awal)' : 'Area Kamar';
  const photo2Label = isRepair ? 'Foto Sesudah Diperbaiki' : 'Kamar Mandi';

  container.innerHTML = `
    <div id="public-pdf-area" class="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4">
      <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <span class="text-[10px] font-extrabold uppercase tracking-wider text-teal-600">RS Khusus Bedah SS Medika</span>
          <h2 class="text-lg font-extrabold text-slate-900 mt-0.5">${escapeHtml(r.unit_name)}</h2>
          <p class="text-xs text-slate-500 mt-0.5">Waktu Laporan: <strong>${waktu}</strong></p>
        </div>
        <div class="text-right shrink-0">
          <span class="inline-block text-xs font-extrabold px-3 py-1 rounded-full ${badgeClass}">${badgeText}</span>
          ${(!isRepair && !isNurseReq) ? `<p class="text-lg font-extrabold text-teal-700 mt-1">Skor: ${r.readiness_score}%</p>` : ''}
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-xs">
        <div><span class="text-[10px] text-slate-400 font-bold block">${isNurseReq ? 'PERAWAT PELAPOR' : isRepair ? 'PELAPOR' : 'PENINJAU'}</span><span class="font-extrabold text-slate-800">${escapeHtml(r.inspector_name)}</span></div>
        <div><span class="text-[10px] text-slate-400 font-bold block">WAKTU / SHIFT</span><span class="font-extrabold text-slate-800">${escapeHtml(r.shift)}</span></div>
        ${meta.executor ? `<div class="col-span-2 pt-1 border-t border-slate-200/70"><span class="text-[10px] text-indigo-600 font-bold block">${isNurseReq ? 'PERAWAT BERTUGAS' : isRepair ? 'TEKNISI PELAKSANA' : 'PETUGAS PELAKSANA'}</span><span class="font-extrabold text-slate-800">${escapeHtml(meta.executor)}</span></div>` : ''}
      </div>
      ${meta.feedbackStatus ? `<div class="${isApproved || r.final_status === 'siap' ? 'bg-emerald-50/80 border-emerald-200' : isRev ? 'bg-rose-50/80 border-rose-200' : 'bg-amber-50/80 border-amber-200'} border rounded-2xl p-3 space-y-1"><span class="text-[10px] font-extrabold uppercase ${isApproved || r.final_status === 'siap' ? 'text-emerald-800' : isRev ? 'text-rose-800' : 'text-amber-800'} block">Status & Tanggapan</span><p class="text-xs font-extrabold text-slate-800">${escapeHtml(meta.feedbackStatus)}</p>${meta.feedbackDetail ? `<p class="text-xs text-rose-700 font-semibold">${isNurseReq ? 'Tambahan / Instruksi' : isRepair ? 'Kategori' : 'Bagian Ditandai Perbaikan'}: ${escapeHtml(meta.feedbackDetail)}</p>` : ''}</div>` : ''}
      ${(r.photo_room_url || r.photo_toilet_url) ? `<div class="space-y-2"><h3 class="text-xs font-extrabold text-slate-800">Dokumentasi Foto</h3><div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${r.photo_room_url ? `<div class="space-y-1"><span class="text-[10px] font-bold text-slate-500">${photo1Label}</span><img src="${r.photo_room_url}" onclick="zoomPhoto(this.src)" class="w-full h-48 object-cover rounded-2xl border border-slate-200 cursor-pointer shadow-sm" /></div>` : ''}${r.photo_toilet_url ? `<div class="space-y-1"><span class="text-[10px] font-bold text-slate-500">${photo2Label}</span><img src="${r.photo_toilet_url}" onclick="zoomPhoto(this.src)" class="w-full h-48 object-cover rounded-2xl border border-slate-200 cursor-pointer shadow-sm" /></div>` : ''}</div></div>` : ''}
      <div class="space-y-2"><h3 class="text-xs font-extrabold text-slate-800">Rincian</h3><div class="space-y-1.5">${checklistHtml}</div></div>
      ${cleanNotesText ? `<div class="bg-amber-50/70 border border-amber-200 rounded-2xl p-3"><span class="text-[10px] font-extrabold uppercase text-amber-800 block">Catatan</span><p class="text-xs text-slate-700 mt-0.5">${escapeHtml(cleanNotesText)}</p></div>` : ''}
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
  const username = document.getElementById('login-username').value.trim().slice(0, 40);
  const password = document.getElementById('login-password').value.trim().slice(0, 64);
  const errBox = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');
  errBox.classList.add('hidden'); btn.disabled = true; btn.innerHTML = '<span>Memverifikasi...</span>';
  try {
    checkLoginRateLimit();
    if (!username || !password) throw new Error('Username dan password wajib diisi.');
    const { data, error } = await db.from('app_users').select('*').eq('username', username).eq('password', password).single();
    if (error || !data) {
      if ((username === 'admin' && password === 'azis123') || (username === 'petugas1' && password === 'petugas123') || (username === 'perawat1' && password === 'perawat123') || (username === 'teknisi1' && password === 'teknisi123')) {
        currentUser = {
          username,
          full_name: username === 'admin' ? 'Supervisor Manajemen' : username === 'perawat1' ? 'Perawat Nurse Station' : username === 'teknisi1' ? 'Teknisi Perbaikan' : 'Petugas Shift Pagi',
          role: username === 'admin' ? 'manajemen' : username === 'perawat1' ? 'perawat' : username === 'teknisi1' ? 'teknisi' : 'petugas'
        };
      } else {
        recordLoginFailure();
        throw new Error('Username atau password salah!');
      }
    } else {
      currentUser = data;
    }
    clearLoginFailures();
    localStorage.setItem('ck_user', JSON.stringify(currentUser));
    localStorage.setItem('ck_session_ts', String(Date.now()));
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

  // Peninjau utama: Perawat dan Manajemen
  let reviewerList = list.filter(u => {
    const role = (u.role || '').toLowerCase();
    return role === 'perawat' || role === 'manajemen';
  });

  if (currentUser && isReviewerRole() && !reviewerList.some(u => u.full_name === currentUser.full_name)) {
    reviewerList.unshift({ full_name: currentUser.full_name, role: currentUser.role });
  }
  if (reviewerList.length === 0) {
    reviewerList = [{ full_name: 'Perawat Nurse Station', role: 'perawat' }];
  }

  if (sel) {
    const prevReviewer = sel.value;
    sel.innerHTML = reviewerList.map(u => `<option value="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)} (${escapeHtml(roleLabel(u.role))})</option>`).join('');
    if (prevReviewer && reviewerList.some(u => u.full_name === prevReviewer)) sel.value = prevReviewer;
    else if (isReviewerRole() && currentUser?.full_name) sel.value = currentUser.full_name;
    else sel.value = reviewerList[0].full_name;
  }

  if (execSel) {
    if ((isPetugasRole() || isTeknisiRole()) && currentUser) {
      execSel.innerHTML = `<option value="${escapeHtml(currentUser.full_name)}">${escapeHtml(currentUser.full_name)}</option>`;
      execSel.value = currentUser.full_name;
      execSel.disabled = true;
      if (execBadge) execBadge.textContent = '🔒 Terkunci';
    } else {
      const prevExec = execSel.value;
      const petugasOnly = list.filter(u => ['petugas', 'teknisi'].includes((u.role || '').toLowerCase()));
      const finalPetugasList = petugasOnly.length > 0 ? petugasOnly : [{ full_name: 'Petugas Kebersihan', role: 'petugas' }];
      execSel.innerHTML = finalPetugasList.map(u => `<option value="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)}</option>`).join('');
      if (prevExec && finalPetugasList.some(u => u.full_name === prevExec)) execSel.value = prevExec;
      execSel.disabled = false;
      if (execBadge) execBadge.textContent = '';
    }
  }

  if (optApproved) {
    const lockApprovedOption = (isPetugasRole() || isTeknisiRole()) && requireApprovalMode;
    optApproved.disabled = lockApprovedOption;
    optApproved.hidden = lockApprovedOption;
  }
  if (fbSel && !activeReviewReportId) {
    if (isReviewerRole() || !requireApprovalMode) {
      fbSel.value = 'Sesuai Standar (Approved)';
    } else {
      fbSel.value = 'Menunggu Approval Perawat';
    }
  }

  const btnSubmit = document.getElementById('btn-submit-inspect');
  if (btnSubmit && !activeReviewReportId) {
    btnSubmit.textContent = ((isPetugasRole() || isTeknisiRole()) && requireApprovalMode)
      ? 'Simpan & Minta Approve Perawat'
      : 'Simpan Laporan';
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
    btnSubmit.textContent = ((isPetugasRole() || isTeknisiRole()) && requireApprovalMode)
      ? 'Simpan & Minta Approve Perawat'
      : 'Simpan Laporan';
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
    if ((isPetugasRole() || isTeknisiRole()) && currentUser) {
      execSel.innerHTML = `<option value="${escapeHtml(currentUser.full_name)}">${escapeHtml(currentUser.full_name)}</option>`;
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
    fbSel.value = (isReviewerRole() || !requireApprovalMode) ? 'Sesuai Standar (Approved)' : 'Menunggu Approval Perawat';
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
  const btnOfficerConfirm = document.getElementById('btn-officer-confirm-clean');

  if (btnDirectApprove) {
    btnDirectApprove.classList.toggle('hidden', !isReviewerRole());
  }
  if (btnOfficerConfirm) {
    btnOfficerConfirm.classList.toggle('hidden', isReviewerRole());
  }

  if (reviewBanner && reviewDesc) {
    const waktu = latestRep.created_at ? new Date(latestRep.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const extraComplaintHtml = isRev && meta.feedbackDetail
      ? `<span class="block mt-1 px-2 py-1 rounded-lg bg-rose-100 text-rose-800 font-extrabold">⚠️ Catatan Perbaikan: ${escapeHtml(meta.feedbackDetail)}</span>`
      : '';
    reviewDesc.innerHTML = `<strong>${escapeHtml(latestRep.unit_name || '')}</strong> • Dikerjakan oleh <strong>${escapeHtml(executorName)}</strong>${waktu ? ' (' + waktu + ')' : ''} • Skor <strong>${latestRep.readiness_score}%</strong>.${extraComplaintHtml} <button type="button" onclick="resetFormForFreshCheck()" class="underline font-extrabold text-indigo-950 ml-1">Kosongkan Form</button>`;
    reviewBanner.classList.remove('hidden');
    renderPrefillChecklistSummaryBox(savedChecklist, latestRep.photo_room_url, latestRep.photo_toilet_url);
  }

  const btnSubmit = document.getElementById('btn-submit-inspect');
  const btnWa = document.getElementById('btn-submit-wa');

  if (isReviewerRole() && btnSubmit) {
    const actionRow = btnSubmit.parentElement;
    if (actionRow) actionRow.classList.add('hidden');

    document.getElementById('bottom-review-actions')?.remove();
    const bottomBox = document.createElement('div');
    bottomBox.id = 'bottom-review-actions';
    bottomBox.className = 'pt-2 space-y-2.5';
    bottomBox.innerHTML = `
      <button type="button" onclick="approveActiveFormReport()" class="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition">
        <i data-lucide="check-circle-2" class="w-4 h-4"></i> APPROVE KAMAR INI (JADIKAN SIAP PAKAI)
      </button>
      <div class="grid grid-cols-2 gap-2.5">
        <button type="button" onclick="requestRevisionFromActiveForm()" class="py-3 px-3 bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition">
          <i data-lucide="alert-triangle" class="w-4 h-4"></i> Minta Perbaikan Ulang
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
        btnSubmit.textContent = requireApprovalMode ? 'Kirim Selesai & Minta Approve Perawat' : 'Simpan Selesai Perbaikan';
      } else {
        btnSubmit.textContent = requireApprovalMode ? 'Simpan & Minta Approve Perawat' : 'Simpan Laporan';
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
    if (isReviewerRole() || eff === 'perlu_perbaikan' || (currentUser && ownerName === currentUser.full_name)) {
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
    else switchTab('dashboard');
    return;
  }
  if (isRepairRecord(rep)) {
    openRepairReportInForm(reportId);
    return;
  }
  // Perawat & Manajemen bisa membuka form untuk meninjau & approve
  switchTab('inspect', false, true, true);
  syncOfficerInspectLanding(true);
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
    // Perawat: Dasbor (Nurse Station + Approval) dan Tinjau Form
    if (bottomNavContainer) bottomNavContainer.classList.remove('hidden');
    if (navGrid) {
      navGrid.classList.remove('hidden', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5');
      navGrid.classList.add('grid-cols-2');
    }
    btnDash?.classList.remove('hidden');
    btnInspect?.classList.remove('hidden');
    const inspectLabel = btnInspect?.querySelector('span');
    if (inspectLabel) inspectLabel.textContent = 'Tinjau Form';
    btnRepair?.classList.add('hidden');
    btnAnalytics?.classList.add('hidden');
    btnMaster?.classList.add('hidden');
    inviteBox?.classList.add('hidden');
  } else if (isTeknisiRole()) {
    // Teknisi: Fokus pada Perbaikan Fasilitas, Cek Kamar, & Analitik
    if (bottomNavContainer) bottomNavContainer.classList.remove('hidden');
    if (navGrid) {
      navGrid.classList.remove('hidden', 'grid-cols-2', 'grid-cols-4', 'grid-cols-5');
      navGrid.classList.add('grid-cols-3');
    }
    btnDash?.classList.add('hidden');
    btnRepair?.classList.remove('hidden');
    btnInspect?.classList.remove('hidden');
    btnAnalytics?.classList.remove('hidden');
    btnMaster?.classList.add('hidden');
    inviteBox?.classList.add('hidden');
  } else if (isPetugasRole()) {
    // Petugas Kebersihan: Cek Kamar, Perbaikan, & Analitik
    if (bottomNavContainer) bottomNavContainer.classList.remove('hidden');
    if (navGrid) {
      navGrid.classList.remove('hidden', 'grid-cols-2', 'grid-cols-4', 'grid-cols-5');
      navGrid.classList.add('grid-cols-3');
    }
    btnDash?.classList.add('hidden');
    btnInspect?.classList.remove('hidden');
    btnRepair?.classList.remove('hidden');
    btnAnalytics?.classList.remove('hidden');
    btnMaster?.classList.add('hidden');
    inviteBox?.classList.add('hidden');
  } else {
    // Manajemen: Semua 5 menu
    if (bottomNavContainer) bottomNavContainer.classList.remove('hidden');
    if (navGrid) {
      navGrid.classList.remove('hidden', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4');
      navGrid.classList.add('grid-cols-5');
    }
    btnDash?.classList.remove('hidden');
    btnInspect?.classList.remove('hidden');
    btnRepair?.classList.remove('hidden');
    btnAnalytics?.classList.remove('hidden');
    btnMaster?.classList.remove('hidden');
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
      : isTeknisiRole()
        ? 'shrink-0 text-[7.5px] font-extrabold uppercase px-1 py-0.5 rounded bg-purple-100 text-purple-800 tracking-wide'
        : 'shrink-0 text-[7.5px] font-extrabold uppercase px-1 py-0.5 rounded bg-teal-100 text-teal-700 tracking-wide';

  const userCard = document.getElementById('user-management-card');
  if (userCard) userCard.style.display = isManagerRole() ? 'block' : 'none';

  const savedTab = localStorage.getItem('ck_last_tab');
  const validTabs = isManagerRole()
    ? ['dashboard', 'inspect', 'repair', 'analytics', 'master']
    : isPerawatRole()
      ? ['dashboard', 'inspect']
      : isTeknisiRole()
        ? ['repair', 'inspect', 'analytics']
        : ['inspect', 'repair', 'analytics'];
  const startTab = validTabs.includes(savedTab)
    ? savedTab
    : ((isManagerRole() || isPerawatRole()) ? 'dashboard' : (isTeknisiRole() ? 'repair' : 'inspect'));
  try { window.history.replaceState({ tab: startTab }, ''); } catch (e) {}
  switchTab(startTab, true);

  await loadAllData();
  if (inspectionsData[0] && !lastKnownReportId) {
    lastKnownReportId = inspectionsData[0].id;
    localStorage.setItem('ck_last_seen_id', lastKnownReportId);
  }
  startRealtimeReportListener();
  restartNurseReminderIfNeeded();
  ensurePushSubscription(false);
}

function logout() {
  stopNurseReminder();
  localStorage.removeItem('ck_user');
  localStorage.removeItem('ck_session_ts');
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

function acknowledgeAndStopActiveAlerts(contextSource = '') {
  stopNurseReminder();
  hideToastBanner();
  unreadNotifCount = 0;
  document.getElementById('notif-unread-badge')?.classList.add('hidden');
  if (contextSource === 'repair' || isTeknisiRole()) {
    document.getElementById('repair-nav-badge')?.classList.add('hidden');
  }
  try {
    if (inspectionsData && inspectionsData[0]?.id) {
      lastKnownReportId = inspectionsData[0].id;
      localStorage.setItem('ck_last_seen_id', inspectionsData[0].id);
      const ackList = JSON.parse(localStorage.getItem('ck_ack_notif_ids') || '[]');
      if (!ackList.includes(inspectionsData[0].id)) {
        ackList.push(inspectionsData[0].id);
        localStorage.setItem('ck_ack_notif_ids', JSON.stringify(ackList.slice(-100)));
      }
    }
  } catch (e) {}
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg && reg.getNotifications) {
        reg.getNotifications().then(list => list.forEach(n => n.close())).catch(() => {});
      }
    }).catch(() => {});
  }
}

async function switchTab(tabName, fromPopState = false, skipAutoPrefill = false, allowNurseInspect = false) {
  if ((isPetugasRole() || isTeknisiRole()) && (tabName === 'dashboard' || tabName === 'master')) {
    tabName = isTeknisiRole() ? 'repair' : 'inspect';
  }
  if ((isPetugasRole() && tabName === 'inspect') || (isTeknisiRole() && tabName === 'repair')) {
    acknowledgeAndStopActiveAlerts(tabName);
  }
  if (isPerawatRole() && tabName !== 'dashboard' && tabName !== 'inspect') {
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

  const defaultTab = (isManagerRole() || isPerawatRole()) ? 'dashboard' : (isTeknisiRole() ? 'repair' : 'inspect');
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
    db.from('room_inspections').select('*').order('created_at', { ascending: false }).limit(500),
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
  restartNurseReminderIfNeeded();
  syncOfficerInspectLanding(false);
}

function applyNurseDashboardVisibility() {
  const dashSection = document.getElementById('tab-dashboard');
  if (!dashSection) return;

  const statSiapEl = document.getElementById('stat-siap');
  const statsRow = statSiapEl ? statSiapEl.closest('.grid') : null;
  if (statsRow) statsRow.classList.toggle('hidden', isPerawatRole());

  dashSection.querySelectorAll('button').forEach(btn => {
    if ((btn.textContent || '').includes('Scan QR')) {
      btn.classList.toggle('hidden', isPerawatRole());
    }
  });

  // Panel khusus Perawat: daftar laporan petugas yang menunggu approve perawat
  const nurseApprovalBox = document.getElementById('nurse-pending-approval-box');
  if (nurseApprovalBox) {
    if (!isPerawatRole()) {
      nurseApprovalBox.classList.add('hidden');
      nurseApprovalBox.innerHTML = '';
    } else {
      const pendingUnits = unitsData.filter(u => getEffectiveUnitStatus(u) === 'pending_approval');
      if (pendingUnits.length === 0) {
        nurseApprovalBox.classList.add('hidden');
        nurseApprovalBox.innerHTML = '';
      } else {
        nurseApprovalBox.classList.remove('hidden');
        nurseApprovalBox.innerHTML = `
          <div class="rounded-2xl bg-indigo-50 border-2 border-indigo-300 p-3.5 shadow-sm space-y-2.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-ping"></span>
                <h3 class="text-xs font-extrabold text-indigo-950 uppercase tracking-wide">Menunggu Tinjauan & Approve Perawat (${pendingUnits.length} Kamar)</h3>
              </div>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-900">Selesai Disiapkan Petugas</span>
            </div>
            <div class="space-y-2">
              ${pendingUnits.map(u => {
                const rep = getLatestInspectionForUnit(u.id, u.unit_name);
                const meta = rep ? parseNotesMetadata(rep.notes) : null;
                const executor = meta?.executor || rep?.inspector_name || 'Petugas';
                const score = rep?.readiness_score ?? 100;
                const safeUnit = escapeHtml(u.unit_name || '');
                return `
                  <div class="bg-white rounded-xl p-3 border border-indigo-200 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <div>
                        <p class="text-xs font-extrabold text-slate-900">${escapeHtml(u.unit_code)} - ${safeUnit}</p>
                        <p class="text-[11px] text-indigo-800 font-semibold">Disiapkan oleh: <strong>${escapeHtml(executor)}</strong> • Skor Kesiapan: <strong>${score}%</strong></p>
                      </div>
                      <span class="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">Siap Ditinjau</span>
                    </div>
                    <div class="grid grid-cols-3 gap-1.5">
                      <button type="button" onclick="${rep ? `openReportInForm('${escapeHtml(rep.id)}')` : `approveUnitByManagement('${escapeHtml(u.id)}', '${safeUnit}')`}" class="py-2 px-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-lg text-[10px] flex items-center justify-center gap-1">
                        <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Cek Form & Foto
                      </button>
                      <button type="button" onclick="approveUnitByManagement('${escapeHtml(u.id)}', '${safeUnit}')" class="py-2 px-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg text-[10px] flex items-center justify-center gap-1">
                        <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Approve Siap
                      </button>
                      <button type="button" onclick="requestRevisionByManagement('${escapeHtml(u.id)}', '${safeUnit}', '${rep ? escapeHtml(rep.id) : ''}')" class="py-2 px-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-extrabold rounded-lg text-[10px] flex items-center justify-center gap-1">
                        <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Perbaiki Ulang
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
    }
  }

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
    <div class="banner-gradient rounded-2xl text-white p-3.5 shadow-lg shadow-orange-500/25 mb-3 flex items-center justify-between gap-3">
      <div class="space-y-0.5">
        <span class="text-[9.5px] font-extrabold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">Nurse Station</span>
        <h3 class="text-xs sm:text-sm font-extrabold">Permintaan Kamar &amp; Tinjauan Approval</h3>
        <p class="text-[11px] text-orange-50">Gunakan <strong>Siapkan Kamar</strong> (bisa tulis tambahan), <strong>Panggil Teknisi</strong>, <strong>Minta Dibersihkan</strong>, atau <strong>Pasien Pulang</strong>.</p>
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
      document.getElementById('approval-alert-title').textContent = `${pendingUnitsCount} Kamar Menunggu Approval Perawat`;
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
  grid.innerHTML = unitsData.map((u, idx) => {
    const eff = getEffectiveUnitStatus(u);
    const latestRep = getLatestInspectionForUnit(u.id, u.unit_name);
    const isWaitingApproval = (eff === 'pending_approval' || eff === 'dibersihkan');
    const isNeedsRevision = (eff === 'perlu_perbaikan');
    const isNurseMarked = isNurseMarkedUnit(u.last_checked_by);
    const safeUnitName = escapeHtml(u.unit_name || '');

    const statusMap = {
      siap: { label: 'SIAP PAKAI', bg: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-200' },
      pending_approval: { label: 'MENUNGGU APPROVE PERAWAT', bg: 'bg-indigo-100 text-indigo-800', border: 'border-indigo-300' },
      perlu_perbaikan: { label: 'PERLU PERBAIKAN', bg: 'bg-rose-100 text-rose-800', border: 'border-rose-300' },
      dibersihkan: { label: 'SEDANG DIBERSIHKAN', bg: 'bg-amber-100 text-amber-700', border: 'border-amber-200' },
      kosong: { label: isNurseMarked ? 'PERMINTAAN PERAWAT' : 'KOSONG', bg: isNurseMarked ? 'bg-orange-100 text-orange-800' : 'bg-slate-200 text-slate-700', border: isNurseMarked ? 'border-orange-300' : 'border-slate-300' },
      maintenance: { label: 'MAINTENANCE / TEKNISI', bg: 'bg-purple-100 text-purple-800', border: 'border-purple-300' }
    };
    const st = statusMap[eff] || statusMap.kosong;

    const actorMeta = latestRep ? parseNotesMetadata(latestRep.notes) : null;
    const checkedInfo = eff === 'maintenance'
      ? (u.last_checked_by || 'Dalam Perbaikan Teknisi')
      : isNeedsRevision
        ? `⚠️ Catatan: ${actorMeta?.feedbackDetail || 'Menunggu perbaikan petugas'}`
        : isWaitingApproval
          ? `Selesai dicek: ${actorMeta?.executor || latestRep?.inspector_name || 'Petugas'} (${latestRep?.readiness_score ?? 0}%)`
          : isNurseMarked
            ? (u.last_checked_by || 'Permintaan Perawat')
            : (eff === 'siap' ? (u.last_checked_by || 'Siap Pakai') : 'Belum dicek (Kosong)');

    // Tampilan khusus Perawat: Siapkan Kamar terkunci setelah 1x klik hingga Pasien Pulang / Batal, Minta Dibersihkan buka deskripsi, & Tombol Pembatalan Kamar
    if (isPerawatRole()) {
      const siapkanLocked = isSiapkanLockedForUnit(u.id);
      const activeAdmission = latestSiapkanRecordForUnit(u.id);
      const pulangLatest = latestPulangRecordForUnit(u.id);
      const admissionSuperseded = !!(pulangLatest && activeAdmission && new Date(pulangLatest.created_at || 0) > new Date(activeAdmission.created_at || 0));
      const showCancelAdmission = !!activeAdmission && !admissionSuperseded;
      return `
        <div class="glass-card card-rise rounded-2xl p-4 shadow-sm border ${st.border} flex flex-col justify-between space-y-3" style="animation-delay:${Math.min(idx, 6) * 45}ms">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <span class="text-[10px] font-mono font-bold text-slate-400">${escapeHtml(u.unit_code)} • ${escapeHtml(u.floor || '')}</span>
              <h3 class="text-sm font-extrabold text-slate-900 truncate">${safeUnitName}</h3>
            </div>
            <span class="shrink-0 badge-pulse text-[9px] font-extrabold px-2.5 py-1 rounded-full ${st.bg}">${st.label}</span>
          </div>
          <p class="text-[11px] ${isNurseMarked ? 'text-orange-700 font-bold' : 'text-slate-500'} truncate">${escapeHtml(checkedInfo)}</p>

          ${isWaitingApproval ? `
            <div class="grid grid-cols-2 gap-1.5 bg-indigo-50 p-2 rounded-xl border border-indigo-200">
              <button type="button" onclick="${latestRep ? `openReportInForm('${escapeHtml(latestRep.id)}')` : `approveUnitByManagement('${escapeHtml(u.id)}', '${safeUnitName}')`}" class="py-1.5 px-2 bg-indigo-600 text-white font-extrabold rounded-lg text-[10px] flex items-center justify-center gap-1">
                <i data-lucide="file-check-2" class="w-3 h-3"></i> Cek Form
              </button>
              <button type="button" onclick="approveUnitByManagement('${escapeHtml(u.id)}', '${safeUnitName}')" class="py-1.5 px-2 bg-emerald-600 text-white font-extrabold rounded-lg text-[10px] flex items-center justify-center gap-1">
                <i data-lucide="check-circle-2" class="w-3 h-3"></i> Approve
              </button>
            </div>
          ` : ''}

          <div class="grid grid-cols-2 gap-1.5 pt-1">
            <button type="button" ${siapkanLocked ? 'disabled title="Tombol mati sampai Pasien Pulang atau Dibatalkan"' : ''} onclick="openNurseActionModal('${escapeHtml(u.id)}', '${safeUnitName}', 'siapkan')" class="nurse-btn py-2.5 px-2 ${siapkanLocked ? 'bg-slate-200 text-slate-500 border border-slate-300' : 'bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-md shadow-sky-600/30'} font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 transition">
              <span>${siapkanLocked ? '🔒' : '🛏️'}</span> ${siapkanLocked ? 'Sedang Disiapkan' : 'Siapkan Kamar'}
            </button>
            <button type="button" onclick="openNurseActionModal('${escapeHtml(u.id)}', '${safeUnitName}', 'teknisi')" class="nurse-btn py-2.5 px-2 bg-gradient-to-br from-purple-600 to-indigo-700 text-white shadow-md shadow-purple-600/30 font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 transition">
              <span>🔧</span> Panggil Teknisi
            </button>
            <button type="button" onclick="openNurseActionModal('${escapeHtml(u.id)}', '${safeUnitName}', 'bersihkan')" class="nurse-btn py-2.5 px-2 bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-600/30 font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 transition">
              <span>🧹</span> Minta Dibersihkan
            </button>
            <button type="button" onclick="sendNurseRoomAction('${escapeHtml(u.id)}', '${safeUnitName}', 'pulang')" class="nurse-btn pulse-warm py-2.5 px-2 bg-gradient-to-br from-orange-500 to-rose-600 text-white shadow-md shadow-orange-600/30 font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1 transition">
              <span>🚪</span> Pasien Pulang
            </button>
          </div>
          ${showCancelAdmission ? `
            <button type="button" onclick="cancelAdmissionRequest('${escapeHtml(u.id)}', '${safeUnitName}')" class="nurse-btn w-full py-2 px-2 bg-rose-50 border-2 border-dashed border-rose-300 text-rose-700 hover:bg-rose-100 active:scale-[0.98] font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 transition">
              <i data-lucide="x-circle" class="w-3.5 h-3.5"></i> Batal Siapkan Kamar (Pembatalan Kamar)
            </button>
          ` : ''}
        </div>
      `;
    }

    const dropdownOptions = `
      <option value="siap" ${eff === 'siap' ? 'selected' : ''}>SIAP PAKAI</option>
      <option value="pending_approval" ${eff === 'pending_approval' ? 'selected' : ''}>MENUNGGU APPROVE PERAWAT</option>
      <option value="perlu_perbaikan" ${eff === 'perlu_perbaikan' ? 'selected' : ''}>PERLU PERBAIKAN</option>
      <option value="dibersihkan" ${eff === 'dibersihkan' ? 'selected' : ''}>SEDANG DIBERSIHKAN</option>
      <option value="kosong" ${eff === 'kosong' ? 'selected' : ''}>KOSONG</option>
      <option value="maintenance" ${eff === 'maintenance' ? 'selected' : ''}>MAINTENANCE</option>
    `;

    const openAction = (latestRep && !isInspectionOfficiallyApproved(latestRep))
      ? `openReportInForm('${escapeHtml(latestRep.id)}')`
      : `quickInspect('${escapeHtml(u.id)}')`;

    const showApprovalButtons = isReviewerRole() && isWaitingApproval;

    return `
      <div class="glass-card card-rise rounded-2xl p-4 shadow-sm border ${st.border} flex flex-col justify-between space-y-3" style="animation-delay:${Math.min(idx, 6) * 45}ms">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <span class="text-[10px] font-mono font-bold text-slate-400">${escapeHtml(u.unit_code)} • ${escapeHtml(u.floor || '')}</span>
            <h3 class="text-sm font-extrabold text-slate-900 truncate">${safeUnitName}</h3>
          </div>
          <select onchange="quickChangeUnitStatus('${escapeHtml(u.id)}', this.value)" ${!isManagerRole() ? 'disabled' : ''} class="shrink-0 text-[9px] font-extrabold px-2 py-1 rounded-full ${st.bg} outline-none cursor-pointer">
            ${dropdownOptions}
          </select>
        </div>
        ${showApprovalButtons ? `
          <div class="space-y-1.5">
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" onclick="${openAction}" class="py-2 px-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Cek Form
              </button>
              <button type="button" onclick="approveUnitByManagement('${escapeHtml(u.id)}', '${safeUnitName}')" class="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Approve
              </button>
            </div>
            <button type="button" onclick="requestRevisionByManagement('${escapeHtml(u.id)}', '${safeUnitName}', '${latestRep ? escapeHtml(latestRep.id) : ''}')" class="w-full py-1.5 px-2 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 border border-rose-200 font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 transition">
              <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> Perlu Diperbaiki
            </button>
          </div>
        ` : ''}
        <div class="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100">
          <span class="text-[10px] ${isNeedsRevision ? 'text-rose-700 font-bold' : isNurseMarked ? 'text-orange-700 font-bold' : 'text-slate-500 font-medium'} truncate">${escapeHtml(checkedInfo)}</span>
          <div class="flex items-center gap-1.5 shrink-0">
            ${(eff === 'siap' && isManagerRole()) ? `<button type="button" onclick="confirmPatientCheckout('${escapeHtml(u.id)}', '${safeUnitName}')" title="Konfirmasi Pasien Pulang / Kosongkan" class="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-lg text-[10px] font-bold">Pasien Pulang</button>` : ''}
            <button type="button" onclick="quickInspect('${escapeHtml(u.id)}')" class="px-3 py-1 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-lg text-[11px] font-bold">Cek Sekarang</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

function quickInspect(unitId) {
  stopNurseReminder();
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  if (isReviewerRole()) {
    switchTab('inspect', false, true, true);
    syncOfficerInspectLanding(true);
    const sel0 = document.getElementById('inspect-unit');
    if (sel0 && unit) sel0.value = String(unit.id);
    loadExistingInspectionToForm(unitId);
    return;
  }
  switchTab('inspect', false, true);
  syncOfficerInspectLanding(true);
  populateOfficerDropdown();
  populateShiftDropdown();
  renderInspectForm();
  clearPrefillFormState();
  const unitSel = document.getElementById('inspect-unit');
  if (unitSel && unit) unitSel.value = String(unit.id);
  closeNurseNotificationForUnit(unitId);
  const req = latestNurseRequestForUnit(unitId);
  const banner = document.getElementById('prefill-review-banner');
  const desc = document.getElementById('prefill-review-desc');
  if (banner && desc) {
    const reqLabel = req ? getNurseRequestTypeFromString((req.notes || '') + ' ' + (req.shift || '')).label : 'Permintaan Perawat';
    const metaReq = req ? parseNotesMetadata(req.notes) : null;
    const reqDescNote = metaReq && metaReq.feedbackDetail ? `<span class="block mt-1 px-2 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold">Catatan Perawat: ${escapeHtml(metaReq.feedbackDetail)}</span>` : '';
    desc.innerHTML = `<strong>${escapeHtml(unit ? unit.unit_name : '')}</strong> • ${escapeHtml(reqLabel)}. Centang checklist kebersihan di bawah lalu klik tombol konfirmasi ke Perawat.${reqDescNote} <button type="button" onclick="resetFormForFreshCheck()" class="underline font-extrabold text-indigo-950 ml-1">Kosongkan Form</button>`;
    banner.classList.remove('hidden');
    document.getElementById('btn-officer-confirm-clean')?.classList.remove('hidden');
    document.getElementById('btn-direct-approve-form')?.classList.add('hidden');
    renderPrefillChecklistSummaryBox([], null, null);
  }
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  setTimeout(() => {
    document.getElementById('checklist-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 180);
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
  document.getElementById('inspect-unit').innerHTML = unitsData.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</option>`).join('');
  if (prevSelectedUnit && unitsData.some(u => String(u.id) === String(prevSelectedUnit))) {
    document.getElementById('inspect-unit').value = prevSelectedUnit;
  }
  const box = document.getElementById('checklist-container');
  const realChecklistItems = itemsData.filter(item => !isSystemMetaCategory(item.category));
  if (realChecklistItems.length === 0) { box.innerHTML = '<p class="text-xs text-slate-400">Belum ada item kelengkapan. Tambahkan di Pengaturan.</p>'; return; }
  box.innerHTML = realChecklistItems.map(item => `
    <label class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer active:scale-[0.99] transition">
      <div>
        <span class="text-xs font-bold text-slate-800">${escapeHtml(item.item_name)}</span>
        <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">${escapeHtml(item.category)}</span>
        ${item.is_critical ? '<span class="ml-1 text-[10px] font-bold text-rose-600">*Wajib</span>' : ''}
      </div>
      <input type="checkbox" class="inspect-chk w-5 h-5 rounded text-teal-600" data-id="${escapeHtml(item.id)}" data-name="${escapeHtml(item.item_name)}" data-critical="${item.is_critical}" onchange="updateScore()" />
    </label>
  `).join('');
  updateScore();
}

function updateScore() {
  const chks = document.querySelectorAll('.inspect-chk');
  if (chks.length === 0) return;
  document.getElementById('readiness-badge').textContent = `Skor: ${Math.round((Array.from(chks).filter(c => c.checked).length / chks.length) * 100)}%`;
  const banner = document.getElementById('prefill-review-banner');
  if (banner && !banner.classList.contains('hidden')) {
    renderPrefillChecklistSummaryBox(null, watermarkedPhotos.room, watermarkedPhotos.toilet);
  }
}
function togglePrefillChecklistDetail() {
  const box = document.getElementById('prefill-checklist-summary-box');
  if (box) box.classList.toggle('hidden');
}

function renderPrefillChecklistSummaryBox(checklistArr, roomPhoto, toiletPhoto) {
  const listEl = document.getElementById('prefill-checklist-items-list');
  const photosRow = document.getElementById('prefill-photos-preview-row');
  if (listEl) {
    const items = Array.isArray(checklistArr) && checklistArr.length > 0
      ? checklistArr
      : Array.from(document.querySelectorAll('.inspect-chk')).map(c => ({ item: c.dataset.name, checked: c.checked }));
    if (items.length === 0) {
      listEl.innerHTML = '<p class="text-slate-400 text-[10.5px]">Belum ada item checklist yang dicentang.</p>';
    } else {
      listEl.innerHTML = items.map(c => `
        <div class="flex items-center justify-between py-1 px-2 rounded-lg ${c.checked ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-50 text-slate-600'}">
          <span class="font-semibold truncate pr-2">${escapeHtml(c.item)}</span>
          <span class="font-extrabold shrink-0">${c.checked ? '✅ Selesai' : '⬜ Belum'}</span>
        </div>
      `).join('');
    }
  }
  if (photosRow) {
    if (roomPhoto || toiletPhoto) {
      photosRow.classList.remove('hidden');
      photosRow.innerHTML = `
        ${roomPhoto ? `<div class="space-y-0.5"><span class="text-[9px] font-bold text-slate-500">Foto Area Kamar</span><img src="${roomPhoto}" onclick="zoomPhoto(this.src)" class="w-full h-20 object-cover rounded-lg border cursor-pointer" /></div>` : ''}
        ${toiletPhoto ? `<div class="space-y-0.5"><span class="text-[9px] font-bold text-slate-500">Foto Kamar Mandi</span><img src="${toiletPhoto}" onclick="zoomPhoto(this.src)" class="w-full h-20 object-cover rounded-lg border cursor-pointer" /></div>` : ''}
      `;
    } else {
      photosRow.classList.add('hidden');
      photosRow.innerHTML = '';
    }
  }
}

async function confirmRoomCleanedToNurse() {
  const chks = Array.from(document.querySelectorAll('.inspect-chk'));
  const missingCritical = chks.filter(c => c.dataset.critical === 'true' && !c.checked);
  if (missingCritical.length > 0) {
    return alert(`Masih ada ${missingCritical.length} item wajib yang belum dicentang (${missingCritical[0].dataset.name}). Silakan lengkapi ceklis kebersihan terlebih dahulu.`);
  }
  await processInspectionSubmit(false);
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
      const officerName = (isPetugasRole() || isTeknisiRole()) ? currentUser.full_name : (document.getElementById('inspect-executor-select')?.value || currentUser.full_name);
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
      ? (data.final_status === 'siap' ? 'SUDAH DIPERBAIKI ✅' : 'PANGGILAN TEKNISI 🔧')
      : isApproved
        ? 'SIAP PAKAI ✅'
        : isRev
          ? 'PERLU PERBAIKAN ⚠️'
          : 'MENUNGGU APPROVE PERAWAT ⏳';
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
      ? '*LAPORAN PERBAIKAN TEKNISI*'
      : '*LAPORAN CEK KESIAPAN KAMAR*';

  const lines = [titleText, '*RS Khusus Bedah SS Medika*', '--------------------------------', `• *Kamar:* ${data.unit_name}`, `• *Waktu / Shift:* ${data.shift}`, `• *${isNurseReq ? 'Perawat Pelapor' : isRepair ? 'Pelapor' : 'Peninjau'}:* ${data.inspector_name}`];
  if (meta.executor && !isNurseReq) lines.push(`• *${isRepair ? 'Teknisi Pelaksana' : 'Petugas Pelaksana'}:* ${meta.executor}`);
  if (!isRepair && !isNurseReq) lines.push(`• *Skor Kesiapan:* ${data.readiness_score}%`);
  lines.push(`• *Status:* ${statusText}`, `• *Waktu:* ${waktu}`);
  if (meta.feedbackStatus) {
    lines.push('--------------------------------', `• *Tanggapan / Status:* ${meta.feedbackStatus}`);
    if (meta.feedbackDetail) lines.push(`• *${isNurseReq ? 'Tambahan / Instruksi' : isRepair ? 'Kategori' : 'Bagian Perbaikan'}:* ${meta.feedbackDetail}`);
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
  const msg = document.getElementById('wa-message-preview')?.value || '';
  if (!msg.trim()) return;
  if (usePhone) {
    const raw = document.getElementById('wa-target-phone')?.value.trim() || '';
    const phone = normalizePhone(raw);
    if (!phone) return alert('Masukkan nomor WhatsApp tujuan terlebih dahulu.');
    localStorage.setItem('ck_last_wa_phone', raw);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }
  closeActiveModal('modal-wa-share');
}

function shareHistoryWaById(reportId) {
  const rep = inspectionsData.find(r => String(r.id) === String(reportId));
  if (rep) openWaShareModal(rep);
}

// ==================== SUBMIT FORM INSPEKSI KAMAR (PETUGAS -> APPROVE PERAWAT) ====================

async function processInspectionSubmit(alsoSendWa = false) {
  const unitId = document.getElementById('inspect-unit')?.value;
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  if (!unit) return alert('Pilih unit kamar terlebih dahulu.');

  const shiftVal = document.getElementById('inspect-shift')?.value || 'Shift Pagi';
  const reviewerName = document.getElementById('inspect-officer-select')?.value || 'Perawat Nurse Station';
  const executorName = (isPetugasRole() || isTeknisiRole())
    ? currentUser.full_name
    : (document.getElementById('inspect-executor-select')?.value || currentUser.full_name);

  const chks = Array.from(document.querySelectorAll('.inspect-chk'));
  const checklistData = chks.map(c => ({
    item: c.dataset.name,
    checked: c.checked,
    critical: c.dataset.critical === 'true'
  }));
  const checkedCount = checklistData.filter(c => c.checked).length;
  const score = chks.length > 0 ? Math.round((checkedCount / chks.length) * 100) : 100;

  let fbStatus = document.getElementById('inspect-feedback-status')?.value || 'Menunggu Approval Perawat';
  const fbDetail = document.getElementById('inspect-feedback-detail')?.value.trim() || '';
  const extraNotes = document.getElementById('inspect-notes')?.value.trim() || '';

  let finalStatus = 'kotor';
  let unitStamp = `${executorName} (Menunggu Approval Perawat)`;

  if (isReviewerRole()) {
    if (fbStatus.includes('Approved')) {
      finalStatus = 'siap';
      fbStatus = `Sesuai Standar (Approved oleh ${currentUser.full_name})`;
      unitStamp = `Approved: ${currentUser.full_name}`;
    } else {
      finalStatus = 'kotor';
      unitStamp = `Perlu Perbaikan: ${fbDetail || 'Ditinjau Perawat'}`;
    }
  } else if (!requireApprovalMode && score === 100) {
    finalStatus = 'siap';
    fbStatus = `Sesuai Standar (Otomatis Siap Pakai - ${executorName})`;
    unitStamp = `Siap Pakai (${executorName})`;
  } else {
    finalStatus = 'kotor';
    fbStatus = `Menunggu Approval Perawat (Disiapkan oleh ${executorName})`;
    unitStamp = `${executorName} (Menunggu Approval Perawat)`;
  }

  const composedNotes = composeNotesWithMetadata(executorName, fbStatus, fbDetail, extraNotes);
  const payload = {
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: reviewerName,
    inspector_role: currentUser.role,
    shift: shiftVal,
    readiness_score: score,
    final_status: finalStatus,
    duration_seconds: secondsElapsed,
    checklist_data: checklistData,
    notes: composedNotes,
    photo_room_url: watermarkedPhotos.room,
    photo_toilet_url: watermarkedPhotos.toilet
  };

  const btnSubmit = document.getElementById('btn-submit-inspect');
  const btnWa = document.getElementById('btn-submit-wa');
  if (btnSubmit) btnSubmit.disabled = true;
  if (btnWa) btnWa.disabled = true;

  let savedRecord = { ...payload, created_at: new Date().toISOString() };
  let savedOk = false;

  if (!navigator.onLine) {
    const q = JSON.parse(localStorage.getItem('ck_offline_queue') || '[]');
    q.push(payload);
    localStorage.setItem('ck_offline_queue', JSON.stringify(q));
    savedOk = true;
  } else if (activeReviewReportId) {
    const { data: updatedRows, error } = await db.from('room_inspections')
      .update({ ...payload, created_at: new Date().toISOString() })
      .eq('id', activeReviewReportId)
      .select();
    if (error) {
      alert('Gagal memperbarui laporan: ' + error.message);
    } else {
      if (updatedRows?.[0]) savedRecord = updatedRows[0];
      await db.from('master_units').update({
        status: finalStatus,
        last_checked_by: unitStamp,
        last_checked_at: new Date().toISOString()
      }).eq('id', unit.id);
      savedOk = true;
    }
  } else {
    const { data: insertedRows, error } = await db.from('room_inspections').insert([payload]).select();
    if (error) {
      alert('Gagal menyimpan laporan: ' + error.message);
    } else {
      if (insertedRows?.[0]) {
        savedRecord = insertedRows[0];
        lastKnownReportId = savedRecord.id;
        localStorage.setItem('ck_last_seen_id', savedRecord.id);
      }
      await db.from('master_units').update({
        status: finalStatus,
        last_checked_by: unitStamp,
        last_checked_at: new Date().toISOString()
      }).eq('id', unit.id);
      savedOk = true;
    }
  }

  if (btnSubmit) btnSubmit.disabled = false;
  if (btnWa) btnWa.disabled = false;

  if (savedOk) {
    clearPrefillFormState();
    playNotificationChime(true);
    await loadAllData();
    restartNurseReminderIfNeeded();
    if (alsoSendWa) {
      openWaShareModal(savedRecord);
    } else {
      alert(finalStatus === 'siap'
        ? `Laporan tersimpan! ${unit.unit_name} berstatus SIAP PAKAI.`
        : `Laporan tersimpan & otomatis terkirim ke Perawat untuk ditinjau & di-Approve!`);
    }
  }
}

document.getElementById('inspection-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  await processInspectionSubmit(false);
});

async function saveAndSendWhatsApp() {
  await processInspectionSubmit(true);
}

async function syncOfflineQueue() {
  const q = JSON.parse(localStorage.getItem('ck_offline_queue') || '[]');
  if (q.length === 0 || !navigator.onLine) return;
  for (const item of q) {
    await db.from('room_inspections').insert([item]);
  }
  localStorage.removeItem('ck_offline_queue');
  await loadAllData();
}

// ==================== ANALITIK, KEDISIPLINAN & EXPORT PDF / EXCEL ====================

function renderAnalytics() {
  const { rows } = getFilteredExportData();
  const countBadge = document.getElementById('export-filter-count');
  if (countBadge) countBadge.textContent = `${rows.length} Data`;

  const siapCount = unitsData.filter(u => getEffectiveUnitStatus(u) === 'siap').length;
  const maintCount = unitsData.filter(u => getEffectiveUnitStatus(u) === 'maintenance').length;
  const prosesCount = Math.max(0, unitsData.length - siapCount - maintCount);

  if (document.getElementById('chip-live-siap')) document.getElementById('chip-live-siap').textContent = siapCount;
  if (document.getElementById('chip-live-proses')) document.getElementById('chip-live-proses').textContent = prosesCount;
  if (document.getElementById('chip-live-maint')) document.getElementById('chip-live-maint').textContent = maintCount;

  const ctx = document.getElementById('chart-status');
  if (ctx && window.Chart) {
    if (statusChart) statusChart.destroy();
    statusChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Siap Pakai', 'Proses / Kotor', 'Maintenance'],
        datasets: [{
          data: [siapCount, prosesCount, maintCount],
          backgroundColor: ['#10b981', '#f59e0b', '#e11d48'],
          borderWidth: 0
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '68%' }
    });
  }

  const pureChecks = rows.filter(r => !isRepairRecord(r) && !isNurseRequestRecord(r));
  const avgScore = pureChecks.length > 0
    ? Math.round(pureChecks.reduce((s, r) => s + (Number(r.readiness_score) || 0), 0) / pureChecks.length)
    : 0;
  const avgSec = pureChecks.length > 0
    ? Math.round(pureChecks.reduce((s, r) => s + (Number(r.duration_seconds) || 0), 0) / pureChecks.length)
    : 0;
  const occupancyPct = unitsData.length > 0
    ? Math.round(((unitsData.length - siapCount) / unitsData.length) * 100)
    : 0;

  if (document.getElementById('analytic-total')) document.getElementById('analytic-total').textContent = `${rows.length} Laporan`;
  if (document.getElementById('analytic-pure-score')) document.getElementById('analytic-pure-score').textContent = `${avgScore}%`;
  if (document.getElementById('analytic-occupancy')) document.getElementById('analytic-occupancy').textContent = `${occupancyPct}%`;
  if (document.getElementById('analytic-avg-time')) document.getElementById('analytic-avg-time').textContent = `${avgSec} Detik`;

  // Render tabel rekap kamar dipakai & kosong (Harian, Mingguan, Bulanan, Tahunan)
  const usageSummary = getRoomUsageByPeriodSummary();
  const totalUnitBadge = document.getElementById('rekap-total-unit-badge');
  if (totalUnitBadge) totalUnitBadge.textContent = String(unitsData.length);
  const usageTbody = document.getElementById('room-usage-period-tbody');
  if (usageTbody) {
    usageTbody.innerHTML = usageSummary.map(item => `
      <tr class="border-b border-slate-100">
        <td class="py-2 pr-2 font-bold text-slate-800">${escapeHtml(item.periode)}</td>
        <td class="py-2 pr-2 text-center font-extrabold text-orange-600">${item.dipakai} Kamar</td>
        <td class="py-2 pr-2 text-center font-extrabold text-emerald-600">${item.kosong} Kamar</td>
        <td class="py-2 text-right font-bold text-slate-500">${item.aktivitas}x</td>
      </tr>
    `).join('');
  }

  // Render tabel kedisiplinan petugas & teknisi
  const staffStats = computeDisciplineStats(rows);
  const discTbody = document.getElementById('discipline-tbody');
  if (discTbody) {
    if (staffStats.length === 0) {
      discTbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-400">Belum ada data aktivitas petugas/teknisi pada periode ini.</td></tr>';
    } else {
      discTbody.innerHTML = staffStats.map(st => `
        <tr class="border-b border-slate-100">
          <td class="py-2 pr-2 font-extrabold text-slate-800">${escapeHtml(st.name)} <span class="text-[9.5px] font-semibold text-slate-400">(${escapeHtml(st.role)})</span></td>
          <td class="py-2 pr-2 text-center font-bold">${st.total}</td>
          <td class="py-2 pr-2 text-center font-bold text-emerald-600">${st.onTime}</td>
          <td class="py-2 pr-2 text-center font-bold text-rose-600">${st.revisions}</td>
          <td class="py-2 text-right font-extrabold ${st.score >= 85 ? 'text-emerald-600' : 'text-amber-600'}">${st.score}%</td>
        </tr>
      `).join('');
    }
  }

  // Render riwayat inspeksi
  const histEl = document.getElementById('history-list');
  if (!histEl) return;
  if (rows.length === 0) {
    histEl.innerHTML = '<div class="text-center py-6 text-xs text-slate-400 bg-white/70 rounded-2xl border border-slate-200/70">Tidak ada data laporan pada filter yang dipilih.</div>';
    return;
  }

  histEl.innerHTML = rows.slice(0, 60).map(r => {
    const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const meta = parseNotesMetadata(r.notes);
    const isRepair = isRepairRecord(r);
    const isNurseReq = isNurseRequestRecord(r);
    const isApproved = isInspectionOfficiallyApproved(r);
    const actor = meta.executor || r.inspector_name;

    const statusBadge = isNurseReq
      ? 'PERMINTAAN PERAWAT'
      : isRepair
        ? (r.final_status === 'siap' ? 'PERBAIKAN SELESAI ✅' : 'TUGAS TEKNISI 🔧')
        : isApproved
          ? 'SIAP PAKAI ✅'
          : 'MENUNGGU APPROVE PERAWAT';

    return `
      <div class="glass-card rounded-2xl p-3.5 shadow-sm border border-slate-200/80 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h4 class="text-xs font-extrabold text-slate-900">${escapeHtml(r.unit_name)}</h4>
            <p class="text-[10.5px] text-slate-500">Pelaksana: <strong>${escapeHtml(actor)}</strong> • ${waktu}</p>
          </div>
          <span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full ${isApproved || r.final_status === 'siap' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}">${statusBadge}</span>
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-slate-100">
          <span class="text-[10.5px] font-bold text-slate-600">${(!isRepair && !isNurseReq) ? `Skor: ${r.readiness_score}% • Durasi: ${r.duration_seconds || 0} dtk` : escapeHtml(r.shift || '')}</span>
          <div class="flex items-center gap-1.5">
            ${creatorDeleteUnlocked ? `<button type="button" onclick="deleteHistoryRecord('${escapeHtml(r.id)}', '${escapeHtml(r.unit_name)}', '${escapeHtml(r.unit_id || '')}')" class="px-2 py-1 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-bold">Hapus</button>` : ''}
            <button type="button" onclick="openReportFullView('${escapeHtml(r.id)}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold">Detail</button>
            <button type="button" onclick="shareHistoryWaById('${escapeHtml(r.id)}')" class="px-2.5 py-1 bg-teal-600 text-white rounded-lg text-[10px] font-bold">WA</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function computeDisciplineStats(rows) {
  const map = new Map();
  rows.forEach(r => {
    if (isNurseRequestRecord(r)) return;
    const meta = parseNotesMetadata(r.notes);
    const isRep = isRepairRecord(r);
    const name = (meta.executor && meta.executor !== 'Belum Ditugaskan') ? meta.executor : (r.inspector_name || 'Petugas');
    const roleText = isRep ? 'Teknisi' : 'Petugas';

    if (!map.has(name)) {
      map.set(name, { name, role: roleText, total: 0, onTime: 0, revisions: 0 });
    }
    const entry = map.get(name);
    entry.total += 1;
    if (isRevisionRequested(r)) {
      entry.revisions += 1;
    } else if (isRep ? r.final_status === 'siap' : ((Number(r.duration_seconds) || 0) <= 1800 && (Number(r.readiness_score) || 0) >= 80)) {
      entry.onTime += 1;
    }
  });

  return Array.from(map.values()).map(item => {
    const rawScore = item.total > 0 ? Math.round(((item.onTime - item.revisions * 0.5) / item.total) * 100) : 0;
    return { ...item, score: Math.max(0, Math.min(100, rawScore)) };
  }).sort((a, b) => b.total - a.total);
}

// ==================== DOWNLOAD EXCEL (.XLS DENGAN TABEL TERSTRUKTUR & PILIHAN DATA) ====================

function exportCsv() {
  const { rows, label, fileSuffix } = getFilteredExportData();
  const incRoomUsage = document.getElementById('exp-opt-room-usage')?.checked ?? true;
  const incDiscipline = document.getElementById('exp-opt-discipline')?.checked ?? true;
  const incRecapTable = document.getElementById('exp-opt-recap-table')?.checked ?? true;

  if (!incRoomUsage && !incDiscipline && !incRecapTable) {
    return alert('Centang minimal satu pilihan data yang akan diambil sebelum mengunduh Excel.');
  }

  let htmlTables = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" /></head>
    <body style="font-family: Arial, sans-serif;">
      <h2>REKAP LAPORAN KESIAPAN KAMAR — RS KHUSUS BEDAH SS MEDIKA</h2>
      <p><strong>Periode Data:</strong> ${escapeHtml(label)} | <strong>Dicetak pada:</strong> ${new Date().toLocaleString('id-ID')}</p>
  `;

  if (incRoomUsage) {
    const usageSummary = getRoomUsageByPeriodSummary();
    htmlTables += `
      <h3>1. REKAP JUMLAH KAMAR DIPAKAI &amp; KOSONG (HARIAN, MINGGUAN, BULANAN, TAHUNAN)</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; margin-bottom: 18px;">
        <tr style="background-color: #0d9488; color: #ffffff; font-weight: bold;">
          <th>Kurun Waktu</th>
          <th>Total Kamar</th>
          <th>Jumlah Kamar Dipakai</th>
          <th>Jumlah Kamar Kosong / Siap</th>
          <th>Total Aktivitas</th>
        </tr>
        ${usageSummary.map(u => `
          <tr>
            <td>${escapeHtml(u.periode)}</td>
            <td align="center">${unitsData.length}</td>
            <td align="center">${u.dipakai}</td>
            <td align="center">${u.kosong}</td>
            <td align="center">${u.aktivitas}</td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  if (incDiscipline) {
    const staffStats = computeDisciplineStats(rows);
    htmlTables += `
      <h3>2. TABEL KEDISIPLINAN PETUGAS &amp; TEKNISI</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; margin-bottom: 18px;">
        <tr style="background-color: #4f46e5; color: #ffffff; font-weight: bold;">
          <th>No</th>
          <th>Nama Petugas / Teknisi</th>
          <th>Bagian</th>
          <th>Total Tugas</th>
          <th>Tepat Waktu &amp; Sesuai</th>
          <th>Perbaikan Ulang</th>
          <th>Nilai Kedisiplinan (%)</th>
        </tr>
        ${staffStats.length === 0
          ? '<tr><td colspan="7" align="center">Tidak ada data pada periode ini</td></tr>'
          : staffStats.map((st, idx) => `
              <tr>
                <td align="center">${idx + 1}</td>
                <td>${escapeHtml(st.name)}</td>
                <td>${escapeHtml(st.role)}</td>
                <td align="center">${st.total}</td>
                <td align="center">${st.onTime}</td>
                <td align="center">${st.revisions}</td>
                <td align="center">${st.score}%</td>
              </tr>
            `).join('')}
      </table>
    `;
  }

  if (incRecapTable) {
    htmlTables += `
      <h3>3. TABEL REKAPITULASI LAPORAN KESIAPAN KAMAR &amp; PERBAIKAN</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse;">
        <tr style="background-color: #0f172a; color: #ffffff; font-weight: bold;">
          <th>No</th>
          <th>Waktu</th>
          <th>Unit Kamar</th>
          <th>Jenis Laporan</th>
          <th>Pelaksana (Petugas / Teknisi)</th>
          <th>Peninjau / Pelapor</th>
          <th>Shift</th>
          <th>Skor (%)</th>
          <th>Status Akhir</th>
          <th>Keterangan / Catatan</th>
        </tr>
        ${rows.length === 0
          ? '<tr><td colspan="10" align="center">Tidak ada data pada periode ini</td></tr>'
          : rows.map((r, idx) => {
              const meta = parseNotesMetadata(r.notes);
              const jenis = isNurseRequestRecord(r) ? 'Permintaan Perawat' : isRepairRecord(r) ? 'Perbaikan Teknisi' : 'Cek Kesiapan Kamar';
              const statusStr = isInspectionOfficiallyApproved(r) || r.final_status === 'siap' ? 'SIAP PAKAI / SELESAI' : 'PROSES / MENUNGGU';
              const cleanNote = meta.cleanNotes.replace(REPAIR_RECORD_TAG, '').replace(NURSE_REQ_TAG, '').replace(CHECKOUT_RECORD_TAG, '').replace(/\[REQ_TYPE:\s*[a-z]+\]/gi, '').trim();
              return `
                <tr>
                  <td align="center">${idx + 1}</td>
                  <td>${r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '-'}</td>
                  <td>${escapeHtml(r.unit_name)}</td>
                  <td>${jenis}</td>
                  <td>${escapeHtml(meta.executor || r.inspector_name)}</td>
                  <td>${escapeHtml(r.inspector_name)}</td>
                  <td>${escapeHtml(r.shift || '-')}</td>
                  <td align="center">${r.readiness_score ?? 0}%</td>
                  <td>${statusStr}</td>
                  <td>${escapeHtml(cleanNote || meta.feedbackDetail || '-')}</td>
                </tr>
              `;
            }).join('')}
      </table>
    `;
  }

  htmlTables += '</body></html>';
  const blob = new Blob(['\ufeff', htmlTables], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Rekap_Kesiapan_Kamar_${fileSuffix}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==================== DOWNLOAD / PRINT PDF LENGKAP ====================

function exportPdf() {
  const { rows, label, fileSuffix } = getFilteredExportData();
  const incRoomUsage = document.getElementById('exp-opt-room-usage')?.checked ?? true;
  const incDiscipline = document.getElementById('exp-opt-discipline')?.checked ?? true;
  const incRecapTable = document.getElementById('exp-opt-recap-table')?.checked ?? true;
  const includePhotos = document.getElementById('export-pdf-include-photos')?.checked ?? false;

  if (!incRoomUsage && !incDiscipline && !incRecapTable) {
    return alert('Centang minimal satu pilihan data yang akan diambil sebelum mengunduh PDF.');
  }

  const wrapper = document.createElement('div');
  wrapper.style.padding = '16px';
  wrapper.style.fontFamily = 'Arial, sans-serif';
  wrapper.style.color = '#0f172a';
  wrapper.style.fontSize = '11px';

  let contentHtml = `
    <div style="border-bottom: 2px solid #0d9488; padding-bottom: 10px; margin-bottom: 14px;">
      <h1 style="margin:0; font-size: 16px; color: #0f172a;">LAPORAN REKAPITULASI KESIAPAN KAMAR</h1>
      <p style="margin:2px 0 0; font-size: 12px; font-weight: bold; color: #0d9488;">RS Khusus Bedah SS Medika</p>
      <p style="margin:4px 0 0; font-size: 10px; color: #475569;">Periode Data: <strong>${escapeHtml(label)}</strong> • Dicetak: ${new Date().toLocaleString('id-ID')}</p>
    </div>
  `;

  if (incRoomUsage) {
    const usageSummary = getRoomUsageByPeriodSummary();
    contentHtml += `
      <h2 style="font-size: 12px; margin: 12px 0 6px; color: #0f766e;">1. Rekap Jumlah Kamar Dipakai &amp; Kosong (Hari, Minggu, Bulan, Tahun)</h2>
      <table style="width:100%; border-collapse: collapse; margin-bottom: 14px; font-size: 10px;">
        <thead>
          <tr style="background:#0d9488; color:#fff;">
            <th style="border:1px solid #cbd5e1; padding:5px; text-align:left;">Kurun Waktu</th>
            <th style="border:1px solid #cbd5e1; padding:5px; text-align:center;">Total Kamar</th>
            <th style="border:1px solid #cbd5e1; padding:5px; text-align:center;">Kamar Dipakai</th>
            <th style="border:1px solid #cbd5e1; padding:5px; text-align:center;">Kamar Kosong / Siap</th>
            <th style="border:1px solid #cbd5e1; padding:5px; text-align:center;">Aktivitas</th>
          </tr>
        </thead>
        <tbody>
          ${usageSummary.map(u => `
            <tr>
              <td style="border:1px solid #cbd5e1; padding:5px; font-weight:bold;">${escapeHtml(u.periode)}</td>
              <td style="border:1px solid #cbd5e1; padding:5px; text-align:center;">${unitsData.length}</td>
              <td style="border:1px solid #cbd5e1; padding:5px; text-align:center; color:#c2410c; font-weight:bold;">${u.dipakai}</td>
              <td style="border:1px solid #cbd5e1; padding:5px; text-align:center; color:#047857; font-weight:bold;">${u.kosong}</td>
              <td style="border:1px solid #cbd5e1; padding:5px; text-align:center;">${u.aktivitas}x</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  if (incDiscipline) {
    const staffStats = computeDisciplineStats(rows);
    contentHtml += `
      <h2 style="font-size: 12px; margin: 12px 0 6px; color: #4338ca;">2. Tabel Kedisiplinan Petugas &amp; Teknisi</h2>
      <table style="width:100%; border-collapse: collapse; margin-bottom: 14px; font-size: 10px;">
        <thead>
          <tr style="background:#4f46e5; color:#fff;">
            <th style="border:1px solid #cbd5e1; padding:5px;">No</th>
            <th style="border:1px solid #cbd5e1; padding:5px; text-align:left;">Nama Petugas / Teknisi</th>
            <th style="border:1px solid #cbd5e1; padding:5px;">Bagian</th>
            <th style="border:1px solid #cbd5e1; padding:5px;">Tugas</th>
            <th style="border:1px solid #cbd5e1; padding:5px;">Tepat Waktu</th>
            <th style="border:1px solid #cbd5e1; padding:5px;">Perbaikan Ulang</th>
            <th style="border:1px solid #cbd5e1; padding:5px;">Kedisiplinan</th>
          </tr>
        </thead>
        <tbody>
          ${staffStats.length === 0
            ? '<tr><td colspan="7" style="border:1px solid #cbd5e1; padding:6px; text-align:center;">Tidak ada data pada periode ini.</td></tr>'
            : staffStats.map((st, i) => `
                <tr>
                  <td style="border:1px solid #cbd5e1; padding:5px; text-align:center;">${i + 1}</td>
                  <td style="border:1px solid #cbd5e1; padding:5px; font-weight:bold;">${escapeHtml(st.name)}</td>
                  <td style="border:1px solid #cbd5e1; padding:5px; text-align:center;">${escapeHtml(st.role)}</td>
                  <td style="border:1px solid #cbd5e1; padding:5px; text-align:center;">${st.total}</td>
                  <td style="border:1px solid #cbd5e1; padding:5px; text-align:center;">${st.onTime}</td>
                  <td style="border:1px solid #cbd5e1; padding:5px; text-align:center;">${st.revisions}</td>
                  <td style="border:1px solid #cbd5e1; padding:5px; text-align:center; font-weight:bold;">${st.score}%</td>
                </tr>
              `).join('')}
        </tbody>
      </table>
    `;
  }

  if (incRecapTable) {
    contentHtml += `
      <h2 style="font-size: 12px; margin: 12px 0 6px; color: #0f172a;">3. Tabel Rekapitulasi Laporan Kesiapan Kamar</h2>
      <table style="width:100%; border-collapse: collapse; font-size: 9.5px;">
        <thead>
          <tr style="background:#0f172a; color:#fff;">
            <th style="border:1px solid #cbd5e1; padding:4px;">No</th>
            <th style="border:1px solid #cbd5e1; padding:4px;">Waktu</th>
            <th style="border:1px solid #cbd5e1; padding:4px;">Kamar</th>
            <th style="border:1px solid #cbd5e1; padding:4px;">Pelaksana</th>
            <th style="border:1px solid #cbd5e1; padding:4px;">Peninjau</th>
            <th style="border:1px solid #cbd5e1; padding:4px;">Skor</th>
            <th style="border:1px solid #cbd5e1; padding:4px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0
            ? '<tr><td colspan="7" style="border:1px solid #cbd5e1; padding:6px; text-align:center;">Tidak ada data laporan pada periode ini.</td></tr>'
            : rows.map((r, i) => {
                const meta = parseNotesMetadata(r.notes);
                const statusStr = isInspectionOfficiallyApproved(r) || r.final_status === 'siap' ? 'SIAP PAKAI' : 'PROSES';
                return `
                  <tr>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${i + 1}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px;">${r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; font-weight:bold;">${escapeHtml(r.unit_name)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px;">${escapeHtml(meta.executor || r.inspector_name)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px;">${escapeHtml(r.inspector_name)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${r.readiness_score ?? 0}%</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-weight:bold;">${statusStr}</td>
                  </tr>
                `;
              }).join('')}
        </tbody>
      </table>
    `;
  }

  if (includePhotos) {
    const withPhotos = rows.filter(r => r.photo_room_url || r.photo_toilet_url).slice(0, 15);
    if (withPhotos.length > 0) {
      contentHtml += `<h2 style="font-size: 12px; margin: 14px 0 6px;">4. Lampiran Foto Dokumentasi</h2>`;
      withPhotos.forEach(r => {
        contentHtml += `
          <div style="margin-bottom:10px; border:1px solid #cbd5e1; padding:6px; border-radius:6px; page-break-inside: avoid;">
            <p style="margin:0 0 4px; font-weight:bold;">${escapeHtml(r.unit_name)} (${r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : ''})</p>
            <div style="display:flex; gap:8px;">
              ${r.photo_room_url ? `<img src="${r.photo_room_url}" style="width:180px; height:120px; object-fit:cover; border-radius:4px;" />` : ''}
              ${r.photo_toilet_url ? `<img src="${r.photo_toilet_url}" style="width:180px; height:120px; object-fit:cover; border-radius:4px;" />` : ''}
            </div>
          </div>
        `;
      });
    }
  }

  wrapper.innerHTML = contentHtml;
  html2pdf().set({
    margin: 8,
    filename: `Rekap_Kesiapan_Kamar_${fileSuffix}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(wrapper).save();
}

// ==================== MASTER DATA: AKUN, UNIT KAMAR, & ITEM CHECKLIST ====================

function renderUsers() {
  const list = document.getElementById('master-user-list');
  if (!list) return;
  list.innerHTML = usersData.map(u => `
    <div class="py-2.5 flex items-center justify-between gap-2">
      <div>
        <p class="text-xs font-extrabold text-slate-900">${escapeHtml(u.full_name)}</p>
        <p class="text-[11px] text-slate-500">@${escapeHtml(u.username)} • <span class="font-bold text-indigo-700">${escapeHtml(roleLabel(u.role))}</span></p>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="editUser('${escapeHtml(u.id)}')" class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold">Edit</button>
        <button type="button" onclick="deleteUser('${escapeHtml(u.id)}')" class="px-2.5 py-1 bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold">Hapus</button>
      </div>
    </div>
  `).join('');
}

function editUser(id) {
  if (!requireManagerAction('mengubah akun')) return;
  const u = usersData.find(x => String(x.id) === String(id));
  if (!u) return;
  document.getElementById('edit-user-id').value = u.id;
  document.getElementById('new-user-fullname').value = u.full_name;
  document.getElementById('new-user-username').value = u.username;
  document.getElementById('new-user-password').value = u.password;
  document.getElementById('new-user-role').value = u.role;
  document.getElementById('btn-save-user').textContent = 'Perbarui Akun';
}

async function deleteUser(id) {
  if (!requireManagerAction('menghapus akun')) return;
  if (!confirm('Hapus akun pengguna ini?')) return;
  await db.from('app_users').delete().eq('id', id);
  await loadAllData();
}

document.getElementById('form-add-user')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireManagerAction('menyimpan akun')) return;
  const id = document.getElementById('edit-user-id').value;
  const full_name = document.getElementById('new-user-fullname').value.trim();
  const username = document.getElementById('new-user-username').value.trim();
  const password = document.getElementById('new-user-password').value.trim();
  const role = document.getElementById('new-user-role').value;

  if (password.length < 6) return alert('Demi keamanan, password minimal 6 karakter.');

  if (id) {
    await db.from('app_users').update({ full_name, username, password, role }).eq('id', id);
  } else {
    await db.from('app_users').insert([{ full_name, username, password, role }]);
  }
  e.target.reset();
  document.getElementById('edit-user-id').value = '';
  document.getElementById('btn-save-user').textContent = '+ Tambah Akun';
  await loadAllData();
});

function renderMasterUnits() {
  const list = document.getElementById('master-unit-list');
  if (!list) return;
  list.innerHTML = unitsData.map(u => `
    <div class="py-2.5 flex items-center justify-between gap-2">
      <div>
        <p class="text-xs font-extrabold text-slate-900">${escapeHtml(u.unit_code)} - ${escapeHtml(u.unit_name)}</p>
        <p class="text-[11px] text-slate-500">${escapeHtml(u.floor || '-')}</p>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="openQrPrintModal('${escapeHtml(u.unit_code)}', '${escapeHtml(u.unit_name)}')" class="px-2.5 py-1 bg-teal-50 text-teal-700 rounded-lg text-[11px] font-bold">QR</button>
        <button type="button" onclick="editUnit('${escapeHtml(u.id)}')" class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold">Edit</button>
        <button type="button" onclick="deleteUnit('${escapeHtml(u.id)}')" class="px-2.5 py-1 bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold">Hapus</button>
      </div>
    </div>
  `).join('');
}

function editUnit(id) {
  if (!requireManagerAction('mengubah unit kamar')) return;
  const u = unitsData.find(x => String(x.id) === String(id));
  if (!u) return;
  document.getElementById('edit-unit-id').value = u.id;
  document.getElementById('unit-code').value = u.unit_code;
  document.getElementById('unit-name').value = u.unit_name;
  document.getElementById('unit-floor').value = u.floor || '';
  document.getElementById('btn-save-unit').textContent = 'Perbarui Unit Kamar';
}

async function deleteUnit(id) {
  if (!requireManagerAction('menghapus unit kamar')) return;
  if (!confirm('Hapus unit kamar ini?')) return;
  await db.from('master_units').delete().eq('id', id);
  await loadAllData();
}

document.getElementById('form-add-unit')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireManagerAction('menyimpan unit kamar')) return;
  const id = document.getElementById('edit-unit-id').value;
  const unit_code = document.getElementById('unit-code').value.trim();
  const unit_name = document.getElementById('unit-name').value.trim();
  const floor = document.getElementById('unit-floor').value.trim();

  if (id) {
    await db.from('master_units').update({ unit_code, unit_name, floor }).eq('id', id);
  } else {
    await db.from('master_units').insert([{ unit_code, unit_name, floor, status: 'kotor' }]);
  }
  e.target.reset();
  document.getElementById('edit-unit-id').value = '';
  document.getElementById('btn-save-unit').textContent = '+ Simpan Unit Kamar';
  await loadAllData();
});

function renderMasterItems() {
  const list = document.getElementById('master-item-list');
  if (!list) return;
  const realItems = itemsData.filter(i => !isSystemMetaCategory(i.category));
  list.innerHTML = realItems.map(item => `
    <div class="py-2.5 flex items-center justify-between gap-2">
      <div>
        <p class="text-xs font-extrabold text-slate-900">${escapeHtml(item.item_name)}</p>
        <p class="text-[11px] text-slate-500">${escapeHtml(item.category)} ${item.is_critical ? '• *Wajib' : ''}</p>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="editItem('${escapeHtml(item.id)}')" class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold">Edit</button>
        <button type="button" onclick="deleteItem('${escapeHtml(item.id)}')" class="px-2.5 py-1 bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold">Hapus</button>
      </div>
    </div>
  `).join('');
}

function editItem(id) {
  if (!requireManagerAction('mengubah item checklist')) return;
  const item = itemsData.find(x => String(x.id) === String(id));
  if (!item) return;
  document.getElementById('edit-item-id').value = item.id;
  document.getElementById('item-name').value = item.item_name;
  document.getElementById('item-category').value = item.category;
  document.getElementById('item-critical').checked = Boolean(item.is_critical);
  document.getElementById('btn-save-item').textContent = 'Perbarui Item Checklist';
}

async function deleteItem(id) {
  if (!requireManagerAction('menghapus item checklist')) return;
  if (!confirm('Hapus item checklist ini?')) return;
  await db.from('master_items').delete().eq('id', id);
  await loadAllData();
}

document.getElementById('form-add-item')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireManagerAction('menyimpan item checklist')) return;
  const id = document.getElementById('edit-item-id').value;
  const item_name = document.getElementById('item-name').value.trim();
  const category = document.getElementById('item-category').value;
  const is_critical = document.getElementById('item-critical').checked;

  if (id) {
    await db.from('master_items').update({ item_name, category, is_critical }).eq('id', id);
  } else {
    await db.from('master_items').insert([{ item_name, category, is_critical }]);
  }
  e.target.reset();
  document.getElementById('edit-item-id').value = '';
  document.getElementById('btn-save-item').textContent = '+ Simpan Item Checklist';
  await loadAllData();
});

// ==================== QR SCANNER & PRINT QR ====================

function openQrScanner() {
  openModalWithHistory('modal-qr-scanner');
  if (!window.Html5Qrcode) return;
  qrScannerInstance = new Html5Qrcode('qr-reader');
  qrScannerInstance.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 220, height: 220 } },
    (decodedText) => {
      closeQrScanner();
      const matched = unitsData.find(u => normalizeText(u.unit_code) === normalizeText(decodedText) || normalizeText(u.unit_name) === normalizeText(decodedText));
      if (matched) quickInspect(matched.id);
      else alert('QR Code terbaca: ' + decodedText);
    }
  ).catch(() => {});
}

function closeQrScanner() {
  if (qrScannerInstance) {
    qrScannerInstance.stop().catch(() => {});
    qrScannerInstance = null;
  }
  closeActiveModal('modal-qr-scanner');
}

function openQrPrintModal(code, name) {
  activeQrMeta = { code, name };
  document.getElementById('qr-print-title').textContent = name;
  document.getElementById('qr-print-code').textContent = code;
  const box = document.getElementById('qr-code-box');
  box.innerHTML = '';
  if (window.QRCode) {
    new QRCode(box, { text: code, width: 180, height: 180 });
  }
  openModalWithHistory('modal-qr-print');
}

function downloadQrImage() {
  const img = document.querySelector('#qr-code-box img') || document.querySelector('#qr-code-box canvas');
  if (!img) return;
  const dataUrl = img.tagName === 'CANVAS' ? img.toDataURL('image/png') : img.src;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `QR_${activeQrMeta.code}.png`;
  a.click();
}
