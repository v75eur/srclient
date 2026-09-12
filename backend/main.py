import os
import json
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, List

import httpx
from fastapi import FastAPI, HTTPException, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============ CONFIG ============
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO = os.getenv("GITHUB_REPO", "v75eur/srclient")
GITHUB_BRANCH = os.getenv("GITHUB_BRANCH", "main")
CLIENTS_PATH = "backend/clients.json"
CURRENT_TOPIC = os.getenv("CURRENT_TOPIC", "sr-alertes-2026-09")
TRIAL_DAYS = 30

GITHUB_API = "https://api.github.com"

app = FastAPI(title="SR Client API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ HELPERS ============
def hash_key(key: str) -> str:
    return hashlib.sha256(key.strip().upper().encode()).hexdigest()

def today_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")

async def gh_get_clients() -> dict:
    """Lit clients.json depuis GitHub."""
    url = f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{CLIENTS_PATH}?ref={GITHUB_BRANCH}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=headers)
        if r.status_code != 200:
            raise HTTPException(500, f"GitHub read error: {r.status_code} {r.text}")
        data = r.json()
        import base64
        content = base64.b64decode(data["content"]).decode()
        return {"data": json.loads(content), "sha": data["sha"]}

async def gh_put_clients(data: dict, sha: str, message: str):
    """Écrit clients.json dans GitHub."""
    url = f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{CLIENTS_PATH}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
    import base64
    content = base64.b64encode(json.dumps(data, indent=2, ensure_ascii=False).encode()).decode()
    payload = {"message": message, "content": content, "sha": sha, "branch": GITHUB_BRANCH}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.put(url, headers=headers, json=payload)
        if r.status_code not in (200, 201):
            raise HTTPException(500, f"GitHub write error: {r.status_code} {r.text}")

def check_admin(password: Optional[str]):
    if password != ADMIN_PASSWORD:
        raise HTTPException(401, "Mot de passe admin invalide")

# ============ MODELS ============
class VerifyReq(BaseModel):
    key: str
    device_id: str

class GenerateReq(BaseModel):
    name: str
    days: Optional[int] = TRIAL_DAYS

class ResetDeviceReq(BaseModel):
    key: str

class ToggleReq(BaseModel):
    key: str
    active: bool

class DeleteReq(BaseModel):
    key: str

# ============ ROUTES PUBLIQUES ============
@app.get("/")
def root():
    return {"service": "SR Client API", "status": "ok"}

@app.post("/verify")
async def verify(req: VerifyReq):
    """Le client entre sa clé → on vérifie et on enregistre son device."""
    key_hash = hash_key(req.key)
    gh = await gh_get_clients()
    clients = gh["data"].get("clients", [])

    client = next((c for c in clients if c.get("key_hash") == key_hash), None)
    if not client:
        raise HTTPException(404, "Clé invalide")

    if not client.get("active", True):
        raise HTTPException(403, "Clé désactivée")

    # Expiration
    exp = client.get("expires")
    if exp:
        if datetime.strptime(exp, "%Y-%m-%d") < datetime.utcnow():
            raise HTTPException(403, "Essai expiré")

    # Device
    if not client.get("device_id"):
        # 1er usage → on enregistre
        client["device_id"] = req.device_id
        if not client.get("expires"):
            client["expires"] = (datetime.utcnow() + timedelta(days=TRIAL_DAYS)).strftime("%Y-%m-%d")
        client["activated_at"] = datetime.utcnow().isoformat()
        await gh_put_clients(gh["data"], gh["sha"], f"Activate: {client.get('name', 'client')}")
    elif client["device_id"] != req.device_id:
        raise HTTPException(403, "Cette clé est déjà utilisée sur un autre appareil")

    return {
        "ok": True,
        "topic": CURRENT_TOPIC,
        "ntfy_url": f"https://ntfy.sh/{CURRENT_TOPIC}",
        "expires": client.get("expires"),
        "name": client.get("name", ""),
    }

# ============ ROUTES ADMIN ============
@app.get("/admin/clients")
async def admin_clients(x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    gh = await gh_get_clients()
    clients = gh["data"].get("clients", [])
    now = datetime.utcnow()
    for c in clients:
        exp = c.get("expires")
        if not c.get("active", True):
            c["status"] = "disabled"
        elif not exp:
            c["status"] = "pending"
        elif datetime.strptime(exp, "%Y-%m-%d") < now:
            c["status"] = "expired"
        else:
            c["status"] = "active"
        # on cache le hash complet pour l'affichage
        c["key_preview"] = c.get("key_preview", "—")
    return {"clients": clients, "topic": CURRENT_TOPIC}

@app.post("/admin/generate")
async def admin_generate(
    req: GenerateReq,
    x_admin_password: Optional[str] = Header(None),
):
    check_admin(x_admin_password)
    gh = await gh_get_clients()
    data = gh["data"]
    clients = data.get("clients", [])

    # Génère une clé lisible : SR-XXXX-XXXX
    raw = secrets.token_hex(4).upper()
    key = f"SR-{raw[:4]}-{raw[4:]}"
    key_hash = hash_key(key)

    # évite les collisions
    while any(c.get("key_hash") == key_hash for c in clients):
        raw = secrets.token_hex(4).upper()
        key = f"SR-{raw[:4]}-{raw[4:]}"
        key_hash = hash_key(key)

    new_client = {
        "key_hash": key_hash,
        "key_preview": f"SR-****-{raw[4:]}",
        "name": req.name,
        "created": today_iso(),
        "expires": None,
        "activated_at": None,
        "device_id": None,
        "active": True,
    }
    clients.append(new_client)
    data["clients"] = clients
    await gh_put_clients(data, gh["sha"], f"Generate key for {req.name}")

    return {"ok": True, "key": key, "name": req.name, "days": req.days}

@app.post("/admin/reset-device")
async def admin_reset_device(
    req: ResetDeviceReq,
    x_admin_password: Optional[str] = Header(None),
):
    check_admin(x_admin_password)
    gh = await gh_get_clients()
    data = gh["data"]
    clients = data.get("clients", [])
    found = False
    for c in clients:
        if c.get("key_preview", "").endswith(req.key[-4:]) or c.get("name") == req.key:
            c["device_id"] = None
            found = True
            break
    if not found:
        raise HTTPException(404, "Client introuvable")
    await gh_put_clients(data, gh["sha"], f"Reset device: {req.key}")
    return {"ok": True}

@app.post("/admin/toggle")
async def admin_toggle(
    req: ToggleReq,
    x_admin_password: Optional[str] = Header(None),
):
    check_admin(x_admin_password)
    gh = await gh_get_clients()
    data = gh["data"]
    clients = data.get("clients", [])
    found = False
    for c in clients:
        if c.get("key_preview", "").endswith(req.key[-4:]) or c.get("name") == req.key:
            c["active"] = req.active
            found = True
            break
    if not found:
        raise HTTPException(404, "Client introuvable")
    await gh_put_clients(data, gh["sha"], f"Toggle {req.key} → {req.active}")
    return {"ok": True}

@app.post("/admin/delete")
async def admin_delete(
    req: DeleteReq,
    x_admin_password: Optional[str] = Header(None),
):
    check_admin(x_admin_password)
    gh = await gh_get_clients()
    data = gh["data"]
    clients = data.get("clients", [])
    new_clients = [c for c in clients if not (c.get("key_preview", "").endswith(req.key[-4:]) or c.get("name") == req.key)]
    if len(new_clients) == len(clients):
        raise HTTPException(404, "Client introuvable")
    data["clients"] = new_clients
    await gh_put_clients(data, gh["sha"], f"Delete {req.key}")
    return {"ok": True}
