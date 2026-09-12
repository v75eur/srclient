// ============================================================
// SR Client — app.js
// Page d'activation client
// ============================================================

const API_URL = 'https://srclient-backend.onrender.com';

async function getDeviceId() {
    try {
        const parts = [
            navigator.userAgent,
            navigator.language,
            screen.width + 'x' + screen.height,
            screen.colorDepth,
            new Date().getTimezoneOffset(),
            navigator.hardwareConcurrency || 0,
            navigator.platform || '',
        ];
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('SR-Bot-Fingerprint', 2, 15);
            parts.push(canvas.toDataURL().slice(-50));
        } catch (e) {}
        const raw = parts.join('|');
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        return 'fallback-' + Math.random().toString(36).slice(2) + Date.now();
    }
}

function showAlert(msg, type) {
    const el = document.getElementById('alert');
    el.className = 'alert alert-' + (type || 'info');
    el.innerHTML = msg;
    el.style.display = 'block';
}
function hideAlert() { document.getElementById('alert').style.display = 'none'; }

function setLoading(loading) {
    const btn = document.getElementById('submitBtn');
    const txt = document.getElementById('btnText');
    const loader = document.getElementById('btnLoader');
    btn.disabled = loading;
    txt.style.display = loading ? 'none' : 'inline';
    loader.style.display = loading ? 'inline-flex' : 'none';
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function showResult(data) {
    document.getElementById('card').querySelector('form').style.display = 'none';
    hideAlert();
    const exp = data.expires
        ? new Date(data.expires).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        : '—';
    const result = document.getElementById('result');
    result.className = 'result-box';
    result.style.display = 'block';
    result.innerHTML = `
        <h3>✅ Essai activé !</h3>
        <p class="info">Bonjour <strong>${escapeHtml(data.name || '')}</strong>,</p>
        <p class="info">Votre essai est valable jusqu'au <strong style="color:#00d4ff">${exp}</strong></p>
        <p class="info" style="margin-top:1.2rem">Abonnez-vous à ce topic dans l'app <strong>ntfy</strong> :</p>
        <div class="topic">${escapeHtml(data.topic)}</div>
        <a href="${escapeHtml(data.ntfy_url)}" target="_blank" class="btn btn-primary" style="margin-top:1rem">
            📱 Ouvrir dans ntfy
        </a>
        <p class="info" style="margin-top:1.2rem;font-size:.75rem;opacity:.6">
            ⚠️ Cet essai est lié à cet appareil. Il ne fonctionnera sur aucun autre.
        </p>
    `;
}

function showError(msg) {
    showAlert('❌ ' + msg, 'error');
    setLoading(false);
}

document.getElementById('activateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();
    const key = document.getElementById('key').value.trim().toUpperCase();
    if (!key) { showAlert('Veuillez entrer votre clé.', 'error'); return; }
    setLoading(true);
    try {
        const deviceId = await getDeviceId();
        const res = await fetch(API_URL + '/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, device_id: deviceId }),
        });
        const data = await res.json();
        if (!res.ok) { showError(data.detail || 'Erreur inconnue (' + res.status + ')'); return; }
        if (data.ok) { showResult(data); } else { showError('Réponse inattendue du serveur.'); }
    } catch (err) {
        console.error(err);
        showError('Impossible de contacter le serveur. Vérifiez votre connexion.');
    } finally {
        setLoading(false);
    }
});

document.getElementById('key').addEventListener('input', (e) => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const raw = v.replace(/-/g, '');
    if (raw.length > 2) {
        let formatted = raw.slice(0, 2);
        if (raw.length > 2) formatted += '-' + raw.slice(2, 6);
        if (raw.length > 6) formatted += '-' + raw.slice(6, 10);
        e.target.value = formatted;
    } else {
        e.target.value = v;
    }
});

console.log('%c SR Client v1.0 — page activation chargée', 'color:#00d4ff;font-weight:bold');
