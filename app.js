/**
 * ============================================================
 * CEK KESIAPAN KAMAR - RS THT SS MEDIKA
 * Versi 8.0 - Hardened Security (Supabase Auth + RLS Strict)
 * ============================================================
 */

const SUPABASE_URL = 'https://eikfagvkyfjwzdbzocba.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpa2ZhZ3ZreWZqd3pkYnpvY2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzY1NzAsImV4cCI6MjA5MjI1MjU3MH0.w0s16cO-Q69W8eR9sB3R1lT8R-uI9G7m5W4b0h1X4s4';
const VAPID_PUBLIC_KEY = 'BEwA9l3h04_9p1zW0uD23sX8d73zM1xW3Y8V2b0X6h72a-X5t92jD38L0xW9sB11F21J63y0-X6b8w59C3o';
const AUTH_EMAIL_DOMAIN = '@ssmedika.local';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

let currentUser = null;
let masterUnits = [];
let masterItems = [];
let inspections = [];
let currentFilter = 'all';
let currentHistoryFilter = 'all';
let selectedUnitForCheck = null;
let currentCheckType = 'rutin';
let currentCheckItems = [];
let currentInspectingItemIdx = null;
let currentPhotoDataUrl = null;
let isPublicView = false;

// ============================================================
// 1. INISIALISASI & VALIDASI SESI SERVER (SUPABASE AUTH)
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  setupAuthListener();
  await verifyActiveSession();
});

function setupAuthListener() {
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      currentUser = null;
      localStorage.removeItem('ck_user_cache');
      showLoginScreen();
    }
  });
}

async function verifyActiveSession() {
  try {
    const { data: { session }, error } = await db.auth.getSession();
    if (error || !session || !session.user) {
      showLoginScreen();
      return;
    }

    // Ambil profil & role asli langsung dari database (dilindungi RLS)
    const { data: profile, error: profileErr } = await db
      .from('app_users')
      .select('id, username, full_name, role, is_active')
      .eq('id', session.user.id)
      .single();

    if (profileErr || !profile || profile.is_active === false) {
      await db.auth.signOut();
      showLoginScreen('Akun tidak aktif atau profil belum terdaftar di sistem.');
      return;
    }

    currentUser = {
      id: profile.id,
      username: profile.username,
      full_name: profile.full_name,
      role: profile.role
    };

    enterApp();
  } catch (err) {
    console.error('Session check failed:', err);
    showLoginScreen();
  }
}

function showLoginScreen(customError = '') {
  const loginScreen = document.getElementById('loginScreen');
  const mainApp = document.getElementById('mainApp');
  if (loginScreen) loginScreen.classList.remove('hidden');
  if (mainApp) mainApp.classList.add('hidden');
  if (customError) showLoginError(customError);
}

// ============================================================
// 2. AUTENTIKASI LOGIN & UBAH PASSWORD AMAN
// ============================================================
async function handleLogin(e) {
  if (e) e.preventDefault();
  const usernameInput = (document.getElementById('loginUsername')?.value || '').trim().toLowerCase();
  const passwordInput = (document.getElementById('loginPassword')?.value || '').trim();
  const btn = document.getElementById('btnLogin');

  if (!usernameInput || !passwordInput) {
    showLoginError('Username dan password wajib diisi.');
    return;
  }

  // Izinkan input username biasa (otomatis ditambah @ssmedika.local) atau email penuh
  const email = usernameInput.includes('@') ? usernameInput : `${usernameInput}${AUTH_EMAIL_DOMAIN}`;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Memverifikasi...';
  }
  hideLoginError();

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: email,
      password: passwordInput
    });

    if (error || !data?.user) {
      showLoginError('Username atau password salah.');
      return;
    }

    const { data: profile, error: profileErr } = await db
      .from('app_users')
      .select('id, username, full_name, role, is_active')
      .eq('id', data.user.id)
      .single();

    if (profileErr || !profile) {
      await db.auth.signOut();
      showLoginError('Profil pengguna tidak ditemukan. Hubungi Manajemen.');
      return;
    }

    if (profile.is_active === false) {
      await db.auth.signOut();
      showLoginError('Akun Anda telah dinonaktifkan oleh Manajemen.');
      return;
    }

    currentUser = {
      id: profile.id,
      username: profile.username,
      full_name: profile.full_name,
      role: profile.role
    };

    document.getElementById('loginPassword').value = '';
    enterApp();
  } catch (err) {
    showLoginError('Gagal terhubung ke server keamanan. Periksa koneksi internet.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Masuk';
    }
  }
}

async function handleLogout() {
  if (!confirm('Keluar dari aplikasi?')) return;
  await db.auth.signOut();
  currentUser = null;
  masterUnits = [];
  masterItems = [];
  inspections = [];
  showLoginScreen();
}

async function changeOwnPassword(newPassword) {
  if (!newPassword || newPassword.length < 8) {
    alert('Password baru minimal 8 karakter.');
    return false;
  }
  const { error } = await db.auth.updateUser({ password: newPassword });
  if (error) {
    alert('Gagal memperbarui password: ' + error.message);
    return false;
  }
  alert('Password berhasil diperbarui.');
  return true;
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    alert(msg);
  }
}

function hideLoginError() {
  const el = document.getElementById('loginError');
  if (el) el.classList.add('hidden');
}

// ============================================================
// 3. MASUK APLIKASI & OTORISASI ROLE
// ============================================================
async function enterApp() {
  if (!currentUser) return showLoginScreen();

  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('mainApp')?.classList.remove('hidden');

  const nameEl = document.getElementById('headerUserName');
  const roleEl = document.getElementById('headerUserRole');
  if (nameEl) nameEl.textContent = currentUser.full_name || currentUser.username;
  if (roleEl) roleEl.textContent = formatRoleLabel(currentUser.role);

  applyRolePermissions();
  await loadAllData();
  subscribeRealtime();
}

function formatRoleLabel(role) {
  const map = {
    manajemen: 'Manajemen',
    perawat: 'Perawat',
    petugas: 'Petugas Kebersihan',
    teknisi: 'Teknisi'
  };
  return map[role] || role;
}

function applyRolePermissions() {
  const isManajemen = currentUser?.role === 'manajemen';
  document.querySelectorAll('.manajemen-only').forEach(el => {
    if (isManajemen) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

// ============================================================
// 4. PENGAMBILAN DATA (DILINDUNGI RLS SUPABASE)
// ============================================================
async function loadAllData() {
  if (!currentUser) return;
  try {
    const [unitsRes, itemsRes, inspRes] = await Promise.all([
      db.from('master_units').select('*').order('floor', { ascending: true }).order('name', { ascending: true }),
      db.from('master_items').select('*').order('category', { ascending: true }).order('name', { ascending: true }),
      db.from('room_inspections').select('*').order('created_at', { ascending: false }).limit(200)
    ]);

    if (unitsRes.error) throw unitsRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (inspRes.error) throw inspRes.error;

    masterUnits = unitsRes.data || [];
    masterItems = itemsRes.data || [];
    inspections = inspRes.data || [];

    renderDashboard();
    renderRooms();
    renderHistory();
    if (currentUser.role === 'manajemen') {
      renderMasterData();
    }
  } catch (err) {
    console.error('Error loading data:', err);
    if (err.code === 'PGRST301' || err.status === 401) {
      await db.auth.signOut();
      showLoginScreen('Sesi berakhir, silakan login kembali.');
    }
  }
}

function subscribeRealtime() {
  db.channel('cek-kamar-secure-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'master_units' }, () => loadAllData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_inspections' }, (payload) => {
      loadAllData();
      if (payload.eventType === 'INSERT' && payload.new?.inspector_id !== currentUser?.id) {
        speakAlert(`Pembaruan status kamar ${payload.new.unit_name || ''}`);
      }
    })
    .subscribe();
}

// ============================================================
// 5. DASHBOARD & DAFTAR KAMAR
// ============================================================
function renderDashboard() {
  const total = masterUnits.length;
  const siap = masterUnits.filter(u => u.status === 'siap').length;
  const proses = masterUnits.filter(u => ['proses_bersih', 'perbaikan', 'menunggu_approval'].includes(u.status)).length;
  const kotor = masterUnits.filter(u => u.status === 'kotor' || u.status === 'rusak').length;

  setText('statTotal', total);
  setText('statSiap', siap);
  setText('statProses', proses);
  setText('statKotor', kotor);
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderRooms();
}

function renderRooms() {
  const container = document.getElementById('roomListContainer');
  if (!container) return;

  const search = (document.getElementById('searchRoomInput')?.value || '').toLowerCase();
  const filtered = masterUnits.filter(u => {
    const matchSearch = (u.name || '').toLowerCase().includes(search) || (u.floor || '').toLowerCase().includes(search);
    if (!matchSearch) return false;
    if (currentFilter === 'all') return true;
    if (currentFilter === 'proses') return ['proses_bersih', 'perbaikan', 'menunggu_approval'].includes(u.status);
    return u.status === currentFilter;
  });

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state">Tidak ada unit/kamar yang sesuai filter.</div>';
    return;
  }

  container.innerHTML = filtered.map(u => {
    const badge = getStatusBadge(u.status);
    return `
      <div class="room-card status-${escapeHtml(u.status)}" onclick="openRoomAction('${escapeHtml(u.id)}')">
        <div class="room-card-header">
          <div>
            <div class="room-name">${escapeHtml(u.name)}</div>
            <div class="room-meta">Lantai ${escapeHtml(u.floor || '-')} &bull; ${escapeHtml(u.category || 'Rawat Inap')}</div>
          </div>
          <span class="badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="room-card-footer">
          <span>Update: ${formatDateTime(u.updated_at)}</span>
          <span class="action-link">Periksa &rarr;</span>
        </div>
      </div>
    `;
  }).join('');
}

function getStatusBadge(status) {
  const map = {
    siap: { label: 'SIAP PAKAI', cls: 'badge-green' },
    kotor: { label: 'PERLU DIBERSIHKAN', cls: 'badge-red' },
    proses_bersih: { label: 'SEDANG DIBERSIHKAN', cls: 'badge-yellow' },
    rusak: { label: 'PERLU PERBAIKAN', cls: 'badge-red' },
    perbaikan: { label: 'SEDANG DIPERBAIKI', cls: 'badge-yellow' },
    menunggu_approval: { label: 'MENUNGGU APPROVAL', cls: 'badge-blue' }
  };
  return map[status] || { label: (status || 'UNKNOWN').toUpperCase(), cls: 'badge-gray' };
}

// ============================================================
// 6. ALUR INSPEKSI & VALIDASI FOTO WAJIB
// ============================================================
function openRoomAction(unitId) {
  const unit = masterUnits.find(u => u.id === unitId);
  if (!unit) return;
  selectedUnitForCheck = unit;

  const modal = document.getElementById('checklistModal');
  if (!modal) return;

  setText('checklistUnitTitle', `${unit.name} (Lt. ${unit.floor || '-'})`);
  currentCheckType = unit.status === 'kotor' ? 'pasca_pasien' : 'rutin';

  currentCheckItems = masterItems.map(item => ({
    item_id: item.id,
    name: item.name,
    category: item.category,
    require_photo: item.require_photo !== false,
    status: 'ok',
    note: '',
    photo_url: null
  }));

  renderChecklistItems();
  modal.classList.remove('hidden');
}

function closeChecklistModal() {
  document.getElementById('checklistModal')?.classList.add('hidden');
  selectedUnitForCheck = null;
}

function renderChecklistItems() {
  const listEl = document.getElementById('checklistItemsContainer');
  if (!listEl) return;

  listEl.innerHTML = currentCheckItems.map((item, idx) => `
    <div class="check-item-row">
      <div class="check-item-info">
        <div class="check-item-name">${escapeHtml(item.name)}</div>
        <div class="check-item-cat">${escapeHtml(item.category || '')} ${item.require_photo ? '<span class="req-photo">*Wajib Foto</span>' : ''}</div>
      </div>
      <div class="check-item-controls">
        <select onchange="updateCheckItemStatus(${idx}, this.value)">
          <option value="ok" ${item.status === 'ok' ? 'selected' : ''}>Siap / Baik</option>
          <option value="dirty" ${item.status === 'dirty' ? 'selected' : ''}>Kotor</option>
          <option value="broken" ${item.status === 'broken' ? 'selected' : ''}>Rusak</option>
        </select>
        <button type="button" class="btn-photo ${item.photo_url ? 'has-photo' : ''}" onclick="triggerItemPhoto(${idx})">
          ${item.photo_url ? 'Foto Ada' : 'Foto'}
        </button>
      </div>
    </div>
  `).join('');
}

function updateCheckItemStatus(idx, val) {
  if (!currentCheckItems[idx]) return;
  currentCheckItems[idx].status = val;
}

function triggerItemPhoto(idx) {
  currentInspectingItemIdx = idx;
  const input = document.getElementById('hiddenPhotoInput');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function handlePhotoSelected(event) {
  const file = event.target.files?.[0];
  if (!file || currentInspectingItemIdx === null) return;

  const compressedDataUrl = await compressImage(file, 900, 0.72);
  currentCheckItems[currentInspectingItemIdx].photo_url = compressedDataUrl;
  renderChecklistItems();
}

function compressImage(file, maxWidth, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function submitInspection() {
  if (!selectedUnitForCheck || !currentUser) return;

  // Validasi foto wajib
  const missingPhoto = currentCheckItems.find(it => (it.require_photo || it.status !== 'ok') && !it.photo_url);
  if (missingPhoto) {
    alert(`Item "${missingPhoto.name}" wajib melampirkan bukti foto sebelum disimpan.`);
    return;
  }

  const hasBroken = currentCheckItems.some(it => it.status === 'broken');
  const hasDirty = currentCheckItems.some(it => it.status === 'dirty');

  let nextUnitStatus = 'siap';
  if (hasBroken) nextUnitStatus = 'rusak';
  else if (hasDirty) nextUnitStatus = 'kotor';
  else if (currentUser.role !== 'manajemen' && currentUser.role !== 'perawat') {
    nextUnitStatus = 'menunggu_approval';
  }

  const payload = {
    unit_id: selectedUnitForCheck.id,
    unit_name: selectedUnitForCheck.name,
    check_type: currentCheckType,
    inspector_id: currentUser.id,
    inspector_name: currentUser.full_name || currentUser.username,
    inspector_role: currentUser.role,
    result_status: nextUnitStatus,
    items_data: currentCheckItems,
    created_at: new Date().toISOString()
  };

  try {
    const { error: insErr } = await db.from('room_inspections').insert([payload]);
    if (insErr) throw insErr;

    const { error: updErr } = await db
      .from('master_units')
      .update({ status: nextUnitStatus, updated_at: new Date().toISOString() })
      .eq('id', selectedUnitForCheck.id);

    if (updErr) throw updErr;

    closeChecklistModal();
    await loadAllData();
    alert('Laporan pemeriksaan berhasil disimpan.');
  } catch (err) {
    alert('Gagal menyimpan laporan (Akses ditolak atau jaringan bermasalah): ' + err.message);
  }
}

// ============================================================
// 7. RIWAYAT & PENGHAPUSAN KHUSUS MANAJEMEN (DILINDUNGI RLS)
// ============================================================
function renderHistory() {
  const container = document.getElementById('historyListContainer');
  if (!container) return;

  if (!inspections.length) {
    container.innerHTML = '<div class="empty-state">Belum ada riwayat pemeriksaan.</div>';
    return;
  }

  const isManajemen = currentUser?.role === 'manajemen';

  container.innerHTML = inspections.map(item => `
    <div class="history-card">
      <div class="history-header">
        <strong>${escapeHtml(item.unit_name)}</strong>
        <span>${formatDateTime(item.created_at)}</span>
      </div>
      <div class="history-body">
        Petugas: ${escapeHtml(item.inspector_name)} (${escapeHtml(formatRoleLabel(item.inspector_role))})<br/>
        Hasil: <strong>${escapeHtml(getStatusBadge(item.result_status).label)}</strong>
      </div>
      ${isManajemen ? `
        <div class="history-actions">
          <button type="button" class="btn-danger-sm" onclick="deleteInspection('${escapeHtml(item.id)}')">Hapus Permanen</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

async function deleteInspection(id) {
  if (currentUser?.role !== 'manajemen') {
    alert('Hanya Manajemen yang memiliki otorisasi menghapus riwayat.');
    return;
  }
  if (!confirm('Hapus riwayat inspeksi ini secara permanen?')) return;

  const { error } = await db.from('room_inspections').delete().eq('id', id);
  if (error) {
    alert('Gagal menghapus riwayat: ' + error.message);
    return;
  }
  await loadAllData();
}

// ============================================================
// 8. KELOLA MASTER UNIT & ITEM (KHUSUS MANAJEMEN)
// ============================================================
function renderMasterData() {
  const unitList = document.getElementById('masterUnitList');
  if (unitList) {
    unitList.innerHTML = masterUnits.map(u => `
      <div class="master-row">
        <span>${escapeHtml(u.name)} (Lt. ${escapeHtml(u.floor || '-')})</span>
        <button type="button" class="btn-danger-sm" onclick="deleteMasterUnit('${escapeHtml(u.id)}')">Hapus</button>
      </div>
    `).join('');
  }
}

async function addMasterUnit(name, floor, category) {
  if (currentUser?.role !== 'manajemen') return alert('Akses ditolak.');
  const { error } = await db.from('master_units').insert([{
    name: name.trim(),
    floor: floor.trim(),
    category: category || 'Rawat Inap',
    status: 'siap',
    updated_at: new Date().toISOString()
  }]);
  if (error) return alert('Gagal menambah unit: ' + error.message);
  await loadAllData();
}

async function deleteMasterUnit(id) {
  if (currentUser?.role !== 'manajemen') return alert('Akses ditolak.');
  if (!confirm('Hapus kamar ini dari master data?')) return;
  const { error } = await db.from('master_units').delete().eq('id', id);
  if (error) return alert('Gagal menghapus unit: ' + error.message);
  await loadAllData();
}

// ============================================================
// 9. UTILITAS KEAMANAN XSS, SUARA & SERVICE WORKER
// ============================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function formatDateTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function speakAlert(text) {
  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'id-ID';
    window.speechSynthesis.speak(utter);
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
