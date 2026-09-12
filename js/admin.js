// ============================================================
// SR Client — admin.js
// Dashboard admin
// ============================================================

const API_URL = 'https://srclient-backend.onrender.com';
const PWD_KEY = 'srclient_admin_pwd';

let adminPassword = localStorage.getItem(PWD_KEY) || '';
let pendingAction = null;

// ============ HELPERS ============
function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function showAlert(containerId, msg, type) {
    const el = document.getElementById(containerId);
    el.className = 'alert alert-' + (type || 'info');
    el.innerHTML = msg;
    el.style.display = 'block';
}
function hideAlert(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.style.display = 'none';
}

function fmtDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch (e) { return iso; }
}

function fmtDevice(d) {
    if (!d) return '—';
    return d.slice(0, 12) + '…';
}

function statusBadge(status) {
    const map = {
        active:   ['badge-active',   '✅ Actif'],
        pending:  ['badge-pending',  '⏳ En attente'],
        expired:  ['badge-expired',  '❌ Expiré'],
        disabled: ['badge-disabled', '🚫 Désactivé'],
    };
    const [cls, txt] = map[status] || ['badge-disabled', status];
    return `<span class="badge-status ${cls}">${txt}</span>`;
}

// ============ API ============
async function api(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Admin-Password': adminPassword,
        },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API_URL + path, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        logout();
        throw new Error('Session expirée, reconnectez-vous.');
    }
    if (!res.ok) throw new Error(data.detail || 'Erreur ' + res.status);
    return data;
}

// ============ LOGIN ============
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('loginAlert');
    const pwd = document.getElementById('password').value;
    if (!pwd) return;

    const btn = document.getElementById('loginBtn');
    const txt = document.getElementById('loginBtnText');
    const ldr = document.getElementById('loginBtnLoader');
    btn.disabled = true; txt.style.display = 'none'; ldr.style.display = 'inline-flex';

    adminPassword = pwd;
    try {
        await api('/admin/clients');
        localStorage.setItem(PWD_KEY, adminPassword);
        showDashboard();
    } catch (err) {
        adminPassword = '';
        localStorage.removeItem(PWD_KEY);
        showAlert('loginAlert', '❌ ' + err.message, 'error');
    } finally {
        btn.disabled = false; txt.style.display = 'inline'; ldr.style.display = 'none';
    }
});

function logout() {
    adminPassword = '';
    localStorage.removeItem(PWD_KEY);
    document.getElementById('loginView').style.display = 'block';
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('password').value = '';
}

document.getElementById('logoutBtn').addEventListener('click', logout);

// ============ DASHBOARD ============
function showDashboard() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'block';
    loadClients();
}

async function loadClients() {
    hideAlert('dashboardAlert');
    const tbody = document.getElementById('clientsBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:rgba(255,255,255,.3)">Chargement…</td></tr>';

    try {
        const data = await api('/admin/clients');
        const clients = data.clients || [];
        document.getElementById('topicDisplay').textContent = data.topic || '—';

        // Stats
        const stats = { active: 0, pending: 0, expired: 0, disabled: 0 };
        clients.forEach(c => { stats[c.status] = (stats[c.status] || 0) + 1; });
        document.getElementById('statTotal').textContent = clients.length;
        document.getElementById('statActive').textContent = stats.active;
        document.getElementById('statPending').textContent = stats.pending;
        document.getElementById('statExpired').textContent = stats.expired;

        // Tableau
        if (!clients.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:3rem;color:rgba(255,255,255,.3)">Aucun client. Clique sur <strong>+ Nouvelle clé</strong> pour commencer.</td></tr>';
            return;
        }

        tbody.innerHTML = clients.map((c, i) => `
            <tr>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td class="key-cell">${escapeHtml(c.key_preview || '—')}</td>
                <td>${statusBadge(c.status)}</td>
                <td>${fmtDate(c.expires)}</td>
                <td class="device-cell">${fmtDevice(c.device_id)}</td>
                <td>
                    <div class="actions-cell">
                        ${c.device_id ? `<button class="btn btn-secondary" onclick="resetDevice('${escapeHtml(c.name)}')">Reset device</button>` : ''}
                        <button class="btn ${c.active ? 'btn-danger' : 'btn-success'}" onclick="toggleClient('${escapeHtml(c.name)}', ${!c.active})">
                            ${c.active ? 'Désactiver' : 'Réactiver'}
                        </button>
                        <button class="btn btn-danger" onclick="deleteClient('${escapeHtml(c.name)}')">Suppr</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:#ff5f57">${escapeHtml(err.message)}</td></tr>`;
    }
}

document.getElementById('refreshBtn').addEventListener('click', loadClients);

// ============ NOUVELLE CLÉ ============
document.getElementById('newKeyBtn').addEventListener('click', () => {
    document.getElementById('newKeyForm').style.display = 'block';
    document.getElementById('newKeyResult').style.display = 'none';
    document.getElementById('newKeyName').value = '';
    hideAlert('newKeyAlert');
    document.getElementById('newKeyModal').classList.add('show');
});

document.getElementById('newKeyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('newKeyAlert');
    const name = document.getElementById('newKeyName').value.trim();
    if (!name) return;

    const btn = document.getElementById('newKeySubmit');
    const txt = document.getElementById('newKeyBtnText');
    const ldr = document.getElementById('newKeyBtnLoader');
    btn.disabled = true; txt.style.display = 'none'; ldr.style.display = 'inline-flex';

    try {
        const data = await api('/admin/generate', 'POST', { name });
        document.getElementById('newKeyForm').style.display = 'none';
        const result = document.getElementById('newKeyResult');
        result.style.display = 'block';
        result.innerHTML = `
            <div class="alert alert-success">
                <strong>✅ Clé créée pour ${escapeHtml(name)}</strong>
            </div>
            <p style="color:rgba(255,255,255,.5);font-size:.85rem;margin-bottom:.5rem">Envoie cette clé au client :</p>
            <div class="topic" style="font-family:'JetBrains Mono',monospace;background:#08080f;border:1px solid rgba(255,255,255,.08);padding:1rem;border-radius:10px;color:#00d4ff;font-size:1.1rem;text-align:center;letter-spacing:2px">${escapeHtml(data.key)}</div>
            <button class="btn btn-secondary" style="margin-top:1rem" onclick="navigator.clipboard.writeText('${escapeHtml(data.key)}'); this.textContent='✅ Copié !'">📋 Copier la clé</button>
            <p style="color:rgba(255,255,255,.3);font-size:.75rem;margin-top:1rem">⚠️ Note-la maintenant, elle ne sera plus jamais affichée.</p>
        `;
        loadClients();
    } catch (err) {
        showAlert('newKeyAlert', '❌ ' + err.message, 'error');
    } finally {
        btn.disabled = false; txt.style.display = 'inline'; ldr.style.display = 'none';
    }
});

// ============ ACTIONS ============
function confirmAction(title, msg, callback) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    pendingAction = callback;
    document.getElementById('confirmModal').classList.add('show');
}

document.getElementById('confirmBtn').addEventListener('click', async () => {
    if (pendingAction) {
        const cb = pendingAction;
        pendingAction = null;
        closeModal('confirmModal');
        await cb();
    }
});

async function resetDevice(name) {
    confirmAction(
        '🔄 Réinitialiser le device',
        `Le client "${name}" pourra réactiver sa clé sur un nouvel appareil. Sa date d'expiration ne changera PAS.`,
        async () => {
            try {
                await api('/admin/reset-device', 'POST', { key: name });
                showAlert('dashboardAlert', `✅ Device réinitialisé pour ${escapeHtml(name)}.`, 'success');
                loadClients();
            } catch (err) {
                showAlert('dashboardAlert', '❌ ' + err.message, 'error');
            }
        }
    );
}

async function toggleClient(name, newActive) {
    const action = newActive ? 'réactiver' : 'désactiver';
    confirmAction(
        (newActive ? '✅ Réactiver' : '🚫 Désactiver') + ` "${name}"`,
        `Confirmer : ${action} la clé de "${name}" ?`,
        async () => {
            try {
                await api('/admin/toggle', 'POST', { key: name, active: newActive });
                showAlert('dashboardAlert', `✅ ${escapeHtml(name)} ${newActive ? 'réactivé' : 'désactivé'}.`, 'success');
                loadClients();
            } catch (err) {
                showAlert('dashboardAlert', '❌ ' + err.message, 'error');
            }
        }
    );
}

async function deleteClient(name) {
    confirmAction(
        `🗑️ Supprimer "${name}"`,
        `Cette action est IRRÉVERSIBLE. La clé sera définitivement supprimée. Confirmer ?`,
        async () => {
            try {
                await api('/admin/delete', 'POST', { key: name });
                showAlert('dashboardAlert', `✅ ${escapeHtml(name)} supprimé.`, 'success');
                loadClients();
            } catch (err) {
                showAlert('dashboardAlert', '❌ ' + err.message, 'error');
            }
        }
    );
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}
// ============ INIT ============
// On cache TOUT au départ, puis on décide quoi afficher
document.getElementById('loginView').style.display = 'none';
document.getElementById('dashboardView').style.display = 'none';

if (adminPassword) {
    // Il y a un mot de passe stocké → on essaie de se reconnecter
    api('/admin/clients')
        .then(() => showDashboard())
        .catch(() => {
            // Échec (mauvais mdp, backend endormi, etc.) → on montre le login
            adminPassword = '';
            localStorage.removeItem(PWD_KEY);
            document.getElementById('loginView').style.display = 'block';
        });
} else {
    // Pas de mot de passe stocké → login direct
    document.getElementById('loginView').style.display = 'block';
}

// Cache le dashboard dès qu'on appelle logout
const _origLogout = logout;
logout = function() {
    _origLogout();
    document.getElementById('dashboardView').style.display = 'none';
};

console.log('%c SR Client Admin chargé', 'color:#00d4ff;font-weight:bold');
