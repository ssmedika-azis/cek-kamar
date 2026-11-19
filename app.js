const APP_VERSION = '5.7';
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

function isPetugasRole() {
  return currentUser && !isManagerRole();
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
  const defaultTab = isManagerRole() ? 'dashboard' : 'inspect';
  if (activeTabName !== defaultTab) switchTab(defaultTab, true);
});

function normalizeText(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getLatestInspectionForUnit(unitId, unitName = '') {
  const unitObj = unitsData.find(u => String(u.id) === String(unitId));
  const targetName = normalizeText(unitName || unitObj?.unit_name || '');
  const targetCode = normalizeText(unitObj?.unit_code || '');

  return inspectionsData.find(r => {
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
  return rep.final_status === 'siap' && meta.feedbackStatus.includes('Approved');
}

function getEffectiveUnitStatus(u) {
  if (u.status === 'maintenance') return 'maintenance';

  const latestRep = getLatestInspectionForUnit(u.id, u.unit_name);
  const checkedByStr = String(u.last_checked_by || '');
  const hasApprovedStampOnUnit = checkedByStr.includes('Approved:');
  const unitUpdatedAt = u.last_checked_at ? new Date(u.last_checked_at).getTime() : 0;
  const repCreatedAt = latestRep?.created_at ? new Date(latestRep.created_at).getTime() : 0;

  const isExplicitlyClearedAfterReport = (!checkedByStr && u.status === 'kotor' && unitUpdatedAt > (repCreatedAt + 2000));
  if (isExplicitlyClearedAfterReport) return 'kosong';

  if (latestRep && !isInspectionOfficiallyApproved(latestRep)) {
    const meta = parseNotesMetadata(latestRep.notes);
    if (meta.feedbackStatus.includes('Sedang Dibersihkan')) return 'dibersihkan';
    return 'pending_approval';
  }

  if (latestRep && isInspectionOfficiallyApproved(latestRep)) return 'siap';
  if (u.status === 'siap' && hasApprovedStampOnUnit) return 'siap';
  if (checkedByStr && !hasApprovedStampOnUnit) return 'pending_approval';

  return 'kosong';
}

function openFirstPendingApproval() {
  const pendingUnit = unitsData.find(u => getEffectiveUnitStatus(u) === 'pending_approval');
  if (pendingUnit) {
    quickInspect(pendingUnit.id);
    return;
  }
  const pendingRep = inspectionsData.find(r => !isInspectionOfficiallyApproved(r));
  if (pendingRep) {
    openReportInForm(pendingRep.id);
    return;
  }
  openNotificationDrawer();
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

async function confirmPatientCheckout(unitId, unitName) {
  if (!isManagerRole()) return;
  if (!confirm(`Konfirmasi pasien pulang di "${unitName}"?\n\nStatus kamar akan diubah menjadi KOSONG (Perlu Dibersihkan & Dicek).`)) return;
  const { error } = await db.from('master_units').update({
    status: 'kotor',
    last_checked_by: null,
    last_checked_at: new Date().toISOString()
  }).eq('id', unitId);

  if (error) return alert('Gagal memperbarui status kamar: ' + error.message);
  playNotificationChime();
  await loadAllData();
}

async function quickChangeUnitStatus(unitId, newMode) {
  if (!isManagerRole()) {
    alert('Petugas tidak diizinkan mengubah status kamar secara manual. Silakan isi Form Cek Kamar.');
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

  let dbStatus = 'kotor';
  let checkedBy = null;
  if (newMode === 'pending_approval') checkedBy = 'Menunggu Approval';
  else if (newMode === 'dibersihkan') checkedBy = currentUser ? currentUser.full_name : 'Petugas';

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

  const managerDirectApprove = isManagerRole();
  const confirmMsg = managerDirectApprove
    ? `Approve perbaikan pada "${report.unit_name}" dan ubah status menjadi SIAP PAKAI?`
    : `Konfirmasi perbaikan pada "${report.unit_name}" sudah selesai?\n\nNotifikasi akan dikirim ke bagian Manajemen agar segera di-approve menjadi Siap Pakai.`;

  if (!confirm(confirmMsg)) return;

  const meta = parseNotesMetadata(report.notes);
  const actorName = currentUser ? currentUser.full_name : 'Petugas';

  if (managerDirectApprove) {
    await approveReportById(report.id);
  } else {
    const pendingNote = composeNotesWithMetadata(
      actorName,
      `Menunggu Approval Manajemen (Selesai Dikerjakan ${actorName})`,
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

    if (report.unit_id) {
      await db.from('master_units').update({
        status: 'kotor',
        last_checked_by: `${actorName} (Menunggu Approval)`,
        last_checked_at: new Date().toISOString()
      }).eq('id', report.unit_id);
    }

    playNotificationChime();
    await loadAllData();
    alert(`Terkirim ke Manajemen! Status ${report.unit_name} menunggu approval dari bagian Manajemen agar menjadi SIAP PAKAI.`);
  }
}

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
    'Berikut tautan aplikasi resmi untuk memantau status kesiapan kamar rawat inap, menerima notifikasi approval laporan masuk secara real-time, serta mengunduh rekap laporan (PDF/Excel):',
    '',
    '🔗 *Link Aplikasi:*',
    appUrl,
    '',
    'Terima kasih.'
  ] : [
    '*UNDANGAN OPERASIONAL PETUGAS*',
    '*Aplikasi Cek Kesiapan Kamar*',
    '*RS Khusus Bedah SS Medika*',
    '--------------------------------',
    'Halo Rekan-Rekan Petugas,',
    '',
    'Silakan akses aplikasi di bawah ini untuk melakukan pengecekan kesiapan kamar, scan QR pintu, dan dokumentasi foto:',
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
  if (isPetugasRole() && st.includes('Approved')) {
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
    const remainingForUnit = inspectionsData.filter(item => String(item.unit_id) === String(unitId));
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
  const isPending = !isInspectionOfficiallyApproved(report);
  const statusLabel = isPending ? 'MENUNGGU APPROVAL ⏳' : 'SIAP PAKAI ✅';
  const meta = parseNotesMetadata(report.notes);
  const actorName = meta.executor || report.inspector_name;

  document.getElementById('toast-banner-badge').textContent = isPending ? 'Butuh Approval Manajemen • Baru Saja' : 'Laporan Disetujui • Baru Saja';
  document.getElementById('toast-banner-title').textContent = `${report.unit_name} • ${statusLabel}`;
  document.getElementById('toast-banner-body').textContent = isPending
    ? `Oleh ${actorName} • Klik untuk cek form & approve`
    : `Approved oleh ${report.inspector_name} • Skor ${report.readiness_score}%`;
  document.getElementById('toast-banner-time').textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  banner.classList.remove('hidden', 'banner-slide-in');
  void banner.offsetWidth;
  banner.classList.add('banner-slide-in');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(hideToastBanner, 8500);
}

function hideToastBanner() { document.getElementById('live-toast-banner')?.classList.add('hidden'); }

function openLatestNotifFromBanner() {
  hideToastBanner();
  if (isManagerRole() && latestNotifReport && latestNotifReport.id && !isInspectionOfficiallyApproved(latestNotifReport)) {
    openReportInForm(latestNotifReport.id);
  } else if (isManagerRole()) {
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

  const isPending = !isInspectionOfficiallyApproved(report);
  if (!isUpdate || isPending) {
    unreadNotifCount++;
    const badge = document.getElementById('notif-unread-badge');
    const bell = document.getElementById('notif-bell-icon');
    if (badge) { badge.textContent = unreadNotifCount > 9 ? '9+' : String(unreadNotifCount); badge.classList.remove('hidden'); }
    if (bell) { bell.classList.remove('bell-animate'); void bell.offsetWidth; bell.classList.add('bell-animate'); }

    playNotificationChime();
    if (navigator.vibrate) navigator.vibrate([250, 100, 250]);
    showInAppBanner(report);

    const meta = parseNotesMetadata(report.notes);
    const actorName = meta.executor || report.inspector_name;
    const notifTitle = isPending
      ? `Approval Dibutuhkan: ${report.unit_name}`
      : `Kamar Siap Pakai: ${report.unit_name}`;
    const notifBody = isPending
      ? `Petugas ${actorName} selesai cek (${report.readiness_score}%). Mohon cek form & approve.`
      : `Approved oleh ${report.inspector_name} (${report.readiness_score}%).`;
    triggerNativePhoneNotification(notifTitle, notifBody, report.id);
  }
  loadAllData();
}

function testNotificationAlert() {
  const sample = inspectionsData[0] || { id: null, unit_name: 'Kamar 101 - Anggrek', inspector_name: currentUser ? currentUser.full_name : 'Petugas', shift: 'Shift Siang', readiness_score: 100, final_status: 'kotor', notes: '[Tanggapan Pemeriksa: Menunggu Approval Manajemen]' };
  playNotificationChime();
  if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
  showInAppBanner(sample);
  triggerNativePhoneNotification('Tes Notifikasi Approval Cek Kamar', 'Notifikasi aktif! Setiap laporan petugas akan langsung masuk ke Manajemen untuk di-approve.', sample.id);
}

function openNotificationDrawer() {
  unreadNotifCount = 0;
  document.getElementById('notif-unread-badge')?.classList.add('hidden');
  const listEl = document.getElementById('notif-drawer-list');
  if (!inspectionsData.length) {
    listEl.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Belum ada riwayat laporan masuk.</p>';
  } else {
    listEl.innerHTML = inspectionsData.slice(0, 20).map(r => {
      const isApproved = isInspectionOfficiallyApproved(r);
      const meta = parseNotesMetadata(r.notes);
      const actorName = meta.executor || r.inspector_name;
      const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="p-3 rounded-2xl ${isApproved ? 'bg-slate-50 border-slate-200/80' : 'bg-indigo-50/70 border-indigo-200'} border transition space-y-2">
          <div onclick="${r.id ? `openReportFullView('${r.id}')` : ''}" class="cursor-pointer space-y-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-extrabold text-slate-900 truncate">${r.unit_name}</span>
              <span class="shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full ${isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-800'}">${isApproved ? 'SIAP PAKAI' : 'MENUNGGU APPROVAL'} (${r.readiness_score}%)</span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500">
              <span class="truncate">Petugas: <strong>${actorName}</strong></span>
              <span class="shrink-0 text-[10px]">${waktu}</span>
            </div>
          </div>
          ${(isManagerRole() && !isApproved && r.id) ? `
            <button type="button" onclick="closeActiveModal('modal-notifications'); openReportInForm('${r.id}');" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Cek & Approve Form
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
  }, 10000);
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
  const isApproved = isInspectionOfficiallyApproved(r);
  const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '-';
  const meta = parseNotesMetadata(r.notes);
  const checklistHtml = Array.isArray(r.checklist_data) && r.checklist_data.length > 0
    ? r.checklist_data.map(c => `<div class="flex items-center justify-between py-2 px-3 rounded-xl ${c.checked ? 'bg-emerald-50/70 text-slate-800' : 'bg-rose-50/70 text-rose-800'}"><span class="text-xs font-bold">${c.item}</span><span class="text-xs font-extrabold">${c.checked ? '✅ Sesuai' : '❌ Belum'}</span></div>`).join('')
    : '<p class="text-xs text-slate-400">Tidak ada rincian checklist.</p>';

  container.innerHTML = `
    <div id="public-pdf-area" class="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4">
      <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <span class="text-[10px] font-extrabold uppercase tracking-wider text-teal-600">RS Khusus Bedah SS Medika</span>
          <h2 class="text-lg font-extrabold text-slate-900 mt-0.5">${r.unit_name}</h2>
          <p class="text-xs text-slate-500 mt-0.5">Waktu Cek: <strong>${waktu}</strong></p>
        </div>
        <div class="text-right shrink-0">
          <span class="inline-block text-xs font-extrabold px-3 py-1 rounded-full ${isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-800'}">${isApproved ? 'SIAP PAKAI ✅' : 'MENUNGGU APPROVAL ⏳'}</span>
          <p class="text-lg font-extrabold text-teal-700 mt-1">Skor: ${r.readiness_score}%</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-xs">
        <div><span class="text-[10px] text-slate-400 font-bold block">PETUGAS PEMERIKSA</span><span class="font-extrabold text-slate-800">${r.inspector_name}</span></div>
        <div><span class="text-[10px] text-slate-400 font-bold block">SHIFT KERJA</span><span class="font-extrabold text-slate-800">${r.shift}</span></div>
        ${meta.executor ? `<div class="col-span-2 pt-1 border-t border-slate-200/70"><span class="text-[10px] text-indigo-600 font-bold block">PETUGAS PELAKSANA</span><span class="font-extrabold text-slate-800">${meta.executor}</span></div>` : ''}
      </div>
      ${meta.feedbackStatus ? `<div class="${isApproved ? 'bg-emerald-50/80 border-emerald-200' : 'bg-amber-50/80 border-amber-200'} border rounded-2xl p-3 space-y-1"><span class="text-[10px] font-extrabold uppercase ${isApproved ? 'text-emerald-800' : 'text-amber-800'} block">Status Approval & Tanggapan Pemeriksa</span><p class="text-xs font-extrabold text-slate-800">${meta.feedbackStatus}</p>${meta.feedbackDetail ? `<p class="text-xs text-rose-700 font-semibold">Bagian Ditandai Perbaikan: ${meta.feedbackDetail}</p>` : ''}</div>` : ''}
      ${(r.photo_room_url || r.photo_toilet_url) ? `<div class="space-y-2"><h3 class="text-xs font-extrabold text-slate-800">Dokumentasi Foto</h3><div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${r.photo_room_url ? `<div class="space-y-1"><span class="text-[10px] font-bold text-slate-500">Area Kamar</span><img src="${r.photo_room_url}" onclick="zoomPhoto(this.src)" class="w-full h-48 object-cover rounded-2xl border border-slate-200 cursor-pointer shadow-sm" /></div>` : ''}${r.photo_toilet_url ? `<div class="space-y-1"><span class="text-[10px] font-bold text-slate-500">Kamar Mandi</span><img src="${r.photo_toilet_url}" onclick="zoomPhoto(this.src)" class="w-full h-48 object-cover rounded-2xl border border-slate-200 cursor-pointer shadow-sm" /></div>` : ''}</div></div>` : ''}
      <div class="space-y-2"><h3 class="text-xs font-extrabold text-slate-800">Rincian Kelengkapan & Kebersihan</h3><div class="space-y-1.5">${checklistHtml}</div></div>
      ${meta.cleanNotes ? `<div class="bg-amber-50/70 border border-amber-200 rounded-2xl p-3"><span class="text-[10px] font-extrabold uppercase text-amber-800 block">Catatan Tambahan</span><p class="text-xs text-slate-700 mt-0.5">${meta.cleanNotes}</p></div>` : ''}
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
      if ((username === 'admin' && password === 'azis123') || (username === 'petugas1' && password === 'petugas123')) {
        currentUser = { username, full_name: username === 'admin' ? 'Supervisor Manajemen' : 'Petugas Shift Pagi', role: username === 'admin' ? 'manajemen' : 'petugas' };
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
    optApproved.disabled = isPetugasRole();
    optApproved.hidden = isPetugasRole();
  }
  if (fbSel && !activeReviewReportId) {
    fbSel.value = isManagerRole() ? 'Sesuai Standar (Approved)' : 'Menunggu Approval Manajemen';
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

function clearPrefillFormState() {
  activeReviewReportId = null;
  document.getElementById('prefill-review-banner')?.classList.add('hidden');
  document.querySelectorAll('.inspect-chk').forEach(c => { c.checked = false; });
  updateScore();
  resetPhotoBoxes();
  const notesEl = document.getElementById('inspect-notes');
  if (notesEl) notesEl.value = '';
  const detailEl = document.getElementById('inspect-feedback-detail');
  if (detailEl) detailEl.value = '';
  const btnSubmit = document.getElementById('btn-submit-inspect');
  if (btnSubmit) btnSubmit.textContent = 'Simpan Laporan';
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

  const realChecklistItems = itemsData.filter(i => i.category !== SHIFT_CATEGORY_KEY);
  if (document.querySelectorAll('.inspect-chk').length === 0 && realChecklistItems.length > 0) {
    renderInspectForm();
  }

  activeReviewReportId = latestRep.id;
  const meta = parseNotesMetadata(latestRep.notes);

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
    fbSel.value = isManagerRole() ? 'Sesuai Standar (Approved)' : 'Menunggu Approval Manajemen';
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
  if (reviewBanner && reviewDesc) {
    const waktu = latestRep.created_at ? new Date(latestRep.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    reviewDesc.innerHTML = `Diajukan oleh <strong>${executorName}</strong>${waktu ? ' (' + waktu + ')' : ''} • Skor <strong>${latestRep.readiness_score}%</strong>. Silakan periksa hasil checklist & foto di bawah sebelum Approve. <button type="button" onclick="resetFormForFreshCheck()" class="underline font-extrabold text-indigo-950 ml-1">Kosongkan Form</button>`;
    reviewBanner.classList.remove('hidden');
    if (btnDirectApprove) {
      btnDirectApprove.classList.toggle('hidden', !isManagerRole());
    }
  }

  const btnSubmit = document.getElementById('btn-submit-inspect');
  if (btnSubmit) {
    btnSubmit.textContent = isManagerRole() ? 'Approve & Simpan' : 'Ajukan Approval';
  }
  lucide.createIcons();
}

function loadExistingInspectionToForm(unitId) {
  const unit = unitsData.find(u => String(u.id) === String(unitId));
  if (!unit) { clearPrefillFormState(); return; }

  const eff = getEffectiveUnitStatus(unit);
  const latestRep = getLatestInspectionForUnit(unit.id, unit.unit_name);

  if ((eff === 'pending_approval' || eff === 'dibersihkan') && latestRep && !isInspectionOfficiallyApproved(latestRep)) {
    const meta = parseNotesMetadata(latestRep.notes);
    const ownerName = meta.executor || latestRep.inspector_name;
    if (isManagerRole() || (currentUser && ownerName === currentUser.full_name)) {
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
  const navGrid = document.getElementById('bottom-nav-grid');
  const btnDash = document.getElementById('nav-item-dashboard');
  const btnMaster = document.getElementById('nav-item-master');
  const inviteBox = document.getElementById('invite-box-about');

  if (isPetugasRole()) {
    btnDash?.classList.add('hidden');
    btnMaster?.classList.add('hidden');
    if (navGrid) {
      navGrid.classList.remove('grid-cols-4');
      navGrid.classList.add('grid-cols-2');
    }
    inviteBox?.classList.add('hidden');
  } else {
    btnDash?.classList.remove('hidden');
    btnMaster?.classList.remove('hidden');
    if (navGrid) {
      navGrid.classList.remove('grid-cols-2');
      navGrid.classList.add('grid-cols-4');
    }
    inviteBox?.classList.remove('hidden');
  }
}

async function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('user-greeting').textContent = 'Halo, ' + currentUser.full_name;
  configureNavigationByRole();
  populateOfficerDropdown();
  populateShiftDropdown();
  renderMasterShifts();
  updateNotificationPermissionUI();

  const badge = document.getElementById('user-role-badge');
  badge.textContent = currentUser.role.toUpperCase();
  badge.className = isManagerRole()
    ? 'shrink-0 text-[7.5px] font-extrabold uppercase px-1 py-0.5 rounded bg-indigo-100 text-indigo-700 tracking-wide'
    : 'shrink-0 text-[7.5px] font-extrabold uppercase px-1 py-0.5 rounded bg-teal-100 text-teal-700 tracking-wide';

  const userCard = document.getElementById('user-management-card');
  if (userCard) userCard.style.display = isManagerRole() ? 'block' : 'none';

  await loadAllData();
  if (inspectionsData[0] && !lastKnownReportId) {
    lastKnownReportId = inspectionsData[0].id;
    localStorage.setItem('ck_last_seen_id', lastKnownReportId);
  }
  startRealtimeReportListener();

  const startTab = isManagerRole() ? 'dashboard' : 'inspect';
  try { window.history.replaceState({ tab: startTab }, ''); } catch (e) {}
  switchTab(startTab, true);
}

function logout() { localStorage.removeItem('ck_user'); document.documentElement.classList.remove('has-session'); location.reload(); }

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

function switchTab(tabName, fromPopState = false, skipAutoPrefill = false) {
  if (isPetugasRole() && (tabName === 'dashboard' || tabName === 'master')) {
    tabName = 'inspect';
  }
  activeTabName = tabName;
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

  const defaultTab = isManagerRole() ? 'dashboard' : 'inspect';
  if (!fromPopState && tabName !== defaultTab) {
    try { window.history.pushState({ tab: tabName }, ''); } catch (e) {}
  }
  if (tabName === 'inspect') {
    populateOfficerDropdown();
    populateShiftDropdown();
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
  if (tabName === 'master') {
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

  await ensureDefaultShiftsInDb();
  rebuildShiftsFromItems();
  populateOfficerDropdown();
  initExportPeriodInputs();
  renderDashboard();
  renderInspectForm();
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

function renderDashboard() {
  const siap = unitsData.filter(u => getEffectiveUnitStatus(u) === 'siap').length;
  const kosongOrProses = unitsData.filter(u => ['kosong', 'dibersihkan', 'pending_approval'].includes(getEffectiveUnitStatus(u))).length;
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
    const statusMap = {
      siap: { label: 'SIAP PAKAI', bg: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-200' },
      pending_approval: { label: 'MENUNGGU APPROVAL', bg: 'bg-indigo-100 text-indigo-800', border: 'border-indigo-300' },
      dibersihkan: { label: 'SEDANG DIBERSIHKAN', bg: 'bg-amber-100 text-amber-700', border: 'border-amber-200' },
      kosong: { label: 'KOSONG', bg: 'bg-slate-200 text-slate-700', border: 'border-slate-300' },
      maintenance: { label: 'MAINTENANCE', bg: 'bg-rose-100 text-rose-700', border: 'border-rose-200' }
    };
    const st = statusMap[eff] || statusMap.kosong;

    const dropdownOptions = `
      <option value="siap" ${eff === 'siap' ? 'selected' : ''}>SIAP PAKAI</option>
      <option value="pending_approval" ${eff === 'pending_approval' ? 'selected' : ''}>MENUNGGU APPROVAL</option>
      <option value="dibersihkan" ${eff === 'dibersihkan' ? 'selected' : ''}>SEDANG DIBERSIHKAN</option>
      <option value="kosong" ${eff === 'kosong' ? 'selected' : ''}>KOSONG</option>
    `;

    const actorMeta = latestRep ? parseNotesMetadata(latestRep.notes) : null;
    const checkedInfo = isWaitingApproval
      ? `Diajukan: ${actorMeta?.executor || latestRep?.inspector_name || 'Petugas'} (${latestRep?.readiness_score ?? 0}%)`
      : (eff === 'siap' ? (u.last_checked_by || 'Approved Manajemen') : 'Belum dicek (Kosong)');

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
          <div class="grid grid-cols-2 gap-1.5">
            <button type="button" onclick="${openAction}" class="py-2 px-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
              <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Cek Form
            </button>
            <button type="button" onclick="approveUnitByManagement('${u.id}', '${(u.unit_name || '').replace(/'/g, "\\'")}')" class="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-xl text-[10.5px] flex items-center justify-center gap-1 shadow-sm transition">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Approve
            </button>
          </div>
        ` : ''}
        <div class="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100">
          <span class="text-[10px] text-slate-500 font-medium truncate">${checkedInfo}</span>
          <div class="flex items-center gap-1.5 shrink-0">
            ${(eff === 'siap' && isManagerRole()) ? `<button type="button" onclick="confirmPatientCheckout('${u.id}', '${(u.unit_name || '').replace(/'/g, "\\'")}')" title="Konfirmasi Pasien Pulang / Kosongkan" class="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-lg text-[10px] font-bold">Pasien Pulang</button>` : ''}
            <button type="button" onclick="quickInspect('${u.id}')" class="px-3 py-1 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-lg text-[11px] font-bold">Cek Sekarang</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

function quickInspect(unitId) {
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
  const realChecklistItems = itemsData.filter(item => item.category !== SHIFT_CATEGORY_KEY);
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
  const isApproved = isInspectionOfficiallyApproved(data);
  const statusText = isApproved ? 'SIAP PAKAI ✅' : 'MENUNGGU APPROVAL MANAJEMEN ⏳';
  const meta = parseNotesMetadata(data.notes);
  const lines = ['*LAPORAN CEK KESIAPAN KAMAR*', '*RS Khusus Bedah SS Medika*', '--------------------------------', `• *Kamar:* ${data.unit_name}`, `• *Shift:* ${data.shift}`, `• *Pemeriksa:* ${data.inspector_name}`];
  if (meta.executor) lines.push(`• *Pelaksana:* ${meta.executor}`);
  lines.push(`• *Skor Kesiapan:* ${data.readiness_score}%`, `• *Status:* ${statusText}`, `• *Waktu:* ${waktu}`);
  if (meta.feedbackStatus) {
    lines.push('--------------------------------', `• *Tanggapan / Status:* ${meta.feedbackStatus}`);
    if (meta.feedbackDetail) lines.push(`• *Bagian Perbaikan:* ${meta.feedbackDetail}`);
  }
  if (includeChecklist && Array.isArray(data.checklist_data) && data.checklist_data.length > 0) {
    lines.push('--------------------------------', '*Rincian Kelengkapan:*');
    data.checklist_data.forEach(c => lines.push(`${c.checked ? '✅' : '❌'} ${c.item}`));
  }
  if (meta.cleanNotes) lines.push('--------------------------------', `• *Catatan:* ${meta.cleanNotes}`);
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

  let isApproved = false;
  if (isManagerRole() && feedbackStatus.includes('Approved') && score === 100 && !missingCritical) {
    isApproved = true;
    feedbackStatus = `Sesuai Standar (Approved oleh ${currentUser.full_name || officerName})`;
  } else {
    isApproved = false;
    if (feedbackStatus.includes('Approved') || feedbackStatus.includes('Sesuai Standar')) {
      feedbackStatus = 'Menunggu Approval Manajemen';
    }
  }

  const finalStatus = isApproved ? 'siap' : 'kotor';
  const unitCheckedByLabel = isApproved
    ? `Approved: ${currentUser.full_name || officerName}`
    : `${executorVal} (Menunggu Approval)`;

  const payload = {
    unit_id: unit.id,
    unit_name: unit.unit_name,
    inspector_name: isApproved ? (currentUser.full_name || officerName) : officerName,
    inspector_role: currentUser.role,
    shift: selectedShift,
    readiness_score: score,
    final_status: finalStatus,
    duration_seconds: secondsElapsed,
    checklist_data: chks.map(c => ({ item: c.dataset.name, checked: c.checked })),
    notes: composeNotesWithMetadata(executorVal, feedbackStatus, feedbackDetail, rawExtraNotes),
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

  btn.disabled = false; btnWa.disabled = false; btn.textContent = 'Simpan Laporan';

  if (savedOk) {
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
    else if (!isApproved) alert('Laporan tersimpan! Notifikasi telah dikirim ke bagian Manajemen agar segera di-approve menjadi SIAP PAKAI.');
    else alert('Approved! Laporan kesiapan kamar berhasil disimpan dan berstatus SIAP PAKAI.');
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
    if (found) quickInspect(found.id);
    else alert('Kode QR tidak dikenali: ' + decodedText);
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
  const list = document.getElementById('master-user-list');
  if (!list) return;
  list.innerHTML = usersData.map(u => `
    <div class="py-3 flex items-center justify-between gap-2">
      <div>
        <div class="flex items-center gap-2">
          <p class="text-xs font-extrabold text-slate-900">${u.full_name}</p>
          <span class="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${u.role === 'manajemen' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}">${u.role}</span>
        </div>
        <p class="text-[11px] text-slate-500 font-mono mt-0.5">User: ${u.username} • Pass: ${u.password}</p>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="editUser('${u.id}')" class="px-2.5 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-[11px] font-bold">Edit</button>
        ${u.username !== 'admin' ? `<button type="button" onclick="deleteUser('${u.id}')" class="px-2.5 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-[11px] font-bold">Hapus</button>` : ''}
      </div>
    </div>
  `).join('');
}

function editUser(id) {
  if (!isManagerRole()) return;
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
  const realChecklistItems = itemsData.filter(i => i.category !== SHIFT_CATEGORY_KEY);
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
  const kotor = unitsData.filter(u => ['kosong', 'dibersihkan', 'pending_approval'].includes(getEffectiveUnitStatus(u))).length;
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

  historyBox.innerHTML = filteredRows.map((r) => {
    const waktuStr = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const meta = parseNotesMetadata(r.notes);
    const isApproved = isInspectionOfficiallyApproved(r);
    const needsFix = !isApproved && (meta.feedbackStatus.includes('Perbaikan') || meta.feedbackStatus.includes('Wajib Diperbaiki'));
    const isPendingApproval = !isApproved && !needsFix;
    const ownerName = meta.executor || r.inspector_name;
    const canResolveFix = needsFix && r.id && (isManagerRole() || (currentUser && ownerName === currentUser.full_name));

    return `
      <div class="glass-card rounded-2xl p-4 shadow-sm space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h4 class="text-xs font-extrabold text-slate-900">${r.unit_name}</h4>
            <p class="text-[11px] text-slate-500">Pemeriksa: <strong>${r.inspector_name}</strong> • ${r.shift}</p>
            ${meta.executor ? `<p class="text-[11px] text-indigo-700 font-semibold">Pelaksana: <strong>${meta.executor}</strong></p>` : ''}
            <p class="text-[10px] text-slate-400 mt-0.5">${waktuStr}</p>
          </div>
          <span class="shrink-0 text-[9.5px] font-extrabold px-2.5 py-1 rounded-full ${isApproved ? 'bg-emerald-100 text-emerald-700' : isPendingApproval ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-700'}">${isApproved ? 'SIAP PAKAI' : isPendingApproval ? 'MENUNGGU APPROVAL' : 'PERLU PERBAIKAN'} (${r.readiness_score}%)</span>
        </div>
        <div class="text-[11px] px-2.5 py-2 rounded-xl border ${isApproved ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' : isPendingApproval ? 'bg-indigo-50/80 border-indigo-200 text-indigo-900' : 'bg-rose-50/80 border-rose-200 text-rose-900'} space-y-1.5">
          <div>
            <p class="font-extrabold">Status: ${meta.feedbackStatus || (isApproved ? 'Sesuai Standar (Approved)' : 'Menunggu Approval Manajemen')}</p>
            ${meta.feedbackDetail ? `<p class="text-[10.5px] mt-0.5">Bagian Perbaikan: <strong>${meta.feedbackDetail}</strong></p>` : ''}
          </div>
          ${canResolveFix ? `
            <button type="button" onclick="markIssueResolvedByOfficer('${r.id}')" class="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> ${isManagerRole() ? 'Masalah Selesai & Approve Siap Pakai' : 'Masalah Selesai & Kirim Approval Manajemen'}
            </button>
          ` : ''}
          ${(isManagerRole() && !isApproved && r.id) ? `
            <button type="button" onclick="openReportInForm('${r.id}')" class="w-full py-2 px-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="file-check-2" class="w-3.5 h-3.5"></i> Cek & Approve Form
            </button>
          ` : ''}
        </div>
        ${meta.cleanNotes ? `<p class="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">Catatan: ${meta.cleanNotes}</p>` : ''}
        <div class="grid grid-cols-2 gap-2">
          ${r.photo_room_url ? `<img src="${r.photo_room_url}" onclick="zoomPhoto(this.src)" class="w-full h-28 object-cover rounded-xl border cursor-pointer" />` : ''}
          ${r.photo_toilet_url ? `<img src="${r.photo_toilet_url}" onclick="zoomPhoto(this.src)" class="w-full h-28 object-cover rounded-xl border cursor-pointer" />` : ''}
        </div>
        <div class="pt-1 flex items-center justify-end gap-2 flex-wrap">
          ${(creatorDeleteUnlocked && isManagerRole() && r.id) ? `<button type="button" onclick="deleteHistoryRecord('${r.id}', '${(r.unit_name || '').replace(/'/g, "\\'")}', '${r.unit_id || ''}')" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-[11px] font-bold rounded-xl flex items-center gap-1 transition"><i data-lucide="trash-2" class="w-3 h-3"></i> Hapus</button>` : ''}
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
    const checklistStr = Array.isArray(r.checklist_data) ? r.checklist_data.map(c => `${c.item}: ${c.checked ? 'OK' : 'BELUM'}`).join(' | ') : '';
    return `${idx + 1},"${new Date(r.created_at).toLocaleString('id-ID')}","${r.unit_name}","${r.inspector_name}","${meta.executor || r.inspector_name}","${r.shift}",${r.readiness_score},"${r.final_status.toUpperCase()}","${(meta.feedbackStatus || '-').replace(/"/g, '""')}","${(meta.feedbackDetail || '-').replace(/"/g, '""')}",${r.duration_seconds || 0},"${checklistStr.replace(/"/g, '""')}","${(meta.cleanNotes || '').replace(/"/g, '""')}"`;
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
    const feedbackFull = [meta.feedbackStatus, meta.feedbackDetail ? `Perbaikan: ${meta.feedbackDetail}` : ''].filter(Boolean).join(' • ') || '-';
    return `<tr><td>${i + 1}</td><td>${new Date(r.created_at).toLocaleString('id-ID')}</td><td>${r.unit_name}</td><td>${r.inspector_name}</td><td>${meta.executor || r.inspector_name}</td><td>${r.shift}</td><td>${r.readiness_score}%</td><td>${r.final_status.toUpperCase()}</td><td>${feedbackFull}</td><td>${meta.cleanNotes || '-'}</td>${includePhotos ? `<td><div style="display:flex;gap:4px;">${r.photo_room_url ? `<img src="${r.photo_room_url}" style="width:55px;height:42px;object-fit:cover;border-radius:4px;" />` : ''}${r.photo_toilet_url ? `<img src="${r.photo_toilet_url}" style="width:55px;height:42px;object-fit:cover;border-radius:4px;" />` : ''}</div></td>` : ''}</tr>`;
  }).join('');

  printWin.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8" /><title>Rekap Kesiapan Kamar</title><script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script><style>body{font-family:Arial,sans-serif;padding:20px;color:#1e293b;background:#f8fafc;margin:0}.toolbar{display:flex;gap:10px;margin-bottom:16px;background:#fff;padding:12px 16px;border-radius:12px;border:1px solid #e2e8f0}.btn{padding:10px 16px;border:none;border-radius:10px;font-weight:bold;font-size:13px;cursor:pointer}.btn-download{background:#0d9488;color:#fff}.btn-print{background:#334155;color:#fff}.report-box{background:#fff;padding:24px;border-radius:12px;border:1px solid #e2e8f0}h2{margin:0 0 4px;color:#0d9488;font-size:18px}p{margin:0 0 14px;font-size:12px;color:#64748b}.summary{display:flex;gap:16px;margin-bottom:14px;font-size:12px;background:#f1f5f9;padding:10px 14px;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:middle}th{background-color:#f1f5f9;font-weight:bold}@media print{.no-print{display:none!important}body{background:#fff;padding:0}.report-box{border:none;padding:0}}</style></head><body><div class="toolbar no-print"><button type="button" id="btn-dl-pdf" class="btn btn-download" onclick="downloadDirectPdf()">⬇ Download PDF</button><button type="button" class="btn btn-print" onclick="window.print()">🖨 Cetak / Print</button></div><div id="pdf-content" class="report-box"><h2>REKAPITULASI LAPORAN KESIAPAN KAMAR</h2><p>RS Khusus Bedah SS Medika • Filter: <strong>${label}</strong> • Dicetak: ${new Date().toLocaleString('id-ID')}</p><div class="summary"><span><strong>Total Laporan:</strong> ${total}</span><span><strong>Rata-Rata Skor Kesiapan:</strong> ${avgScore}%</span></div><table><thead><tr><th>No</th><th>Waktu</th><th>Unit Kamar</th><th>Pemeriksa</th><th>Pelaksana</th><th>Shift</th><th>Skor</th><th>Status</th><th>Tanggapan Pemeriksa</th><th>Catatan</th>${includePhotos ? '<th>Foto</th>' : ''}</tr></thead><tbody>${rowsHtml}</tbody></table></div><script>function downloadDirectPdf(){const btn=document.getElementById('btn-dl-pdf');btn.textContent='Memproses PDF...';btn.disabled=true;html2pdf().set({margin:10,filename:'Rekap_Kesiapan_Kamar_${fileSuffix}.pdf',image:{type:'jpeg',quality:0.95},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'landscape'}}).from(document.getElementById('pdf-content')).save().then(()=>{btn.textContent='⬇ Download PDF';btn.disabled=false;});}<\/script></body></html>`);
  printWin.document.close();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=5.7').catch(() => {});
  });
}
