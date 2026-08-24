"""Diagnose OTA software-update path for itpc07."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

import paramiko

HOST = "10.192.1.6"
USER = "root"
PASSWORD = "Mazambi47!"
REMOTE = "/root/omskscrin"


def ssh(cmd: str, timeout: int = 90) -> tuple[int, str, str]:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False
    )
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    client.close()
    return code, out, err


def http_json(url: str, method: str = "GET", body: dict | None = None, token: str | None = None, timeout: float = 20):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8", "replace")
            return res.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw) if raw else {"error": raw}
        except Exception:
            payload = {"error": raw}
        return e.code, payload
    except Exception as e:
        return 0, {"error": str(e)}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    base = f"http://{HOST}:8080"

    print("=== 1) Deploy package on server ===")
    code, meta = http_json(f"{base}/api/deploy/meta")
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    target = (meta or {}).get("softwareVersion")
    print(f"TARGET={target}")

    print("\n=== 2) Login admin ===")
    # credentials from .env on server
    _code, out, _err = ssh(
        f"grep -E '^(ADMIN_USER|ADMIN_PASSWORD|ADMIN_LOGIN)=' {REMOTE}/.env | tr -d '\\r'"
    )
    env = {}
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    user = env.get("ADMIN_USER") or env.get("ADMIN_LOGIN") or "admin"
    password = env.get("ADMIN_PASSWORD") or "admin"
    print(f"admin user={user!r} password_len={len(password)}")

    st, login = http_json(
        f"{base}/api/auth/login",
        method="POST",
        body={"login": user, "password": password},
    )
    if st != 200 or not isinstance(login, dict) or not login.get("token"):
        print("LOGIN FAILED", st, login)
        # show auth route shape
        code, routes, _ = ssh("grep -n 'login\\|auth' /root/omskscrin/apps/server/dist/routes/*.js 2>/dev/null | head -40")
        print(routes)
        return
    token = login["token"]
    print("login OK")

    print("\n=== 3) Locate itpc07 ===")
    st, kiosks = http_json(f"{base}/api/kiosks", token=token)
    if not isinstance(kiosks, list):
        print("kiosks list failed", st, kiosks)
        return
    matches = [
        k
        for k in kiosks
        if "itpc07" in str(k.get("hostname", "")).lower()
        or "itpc07" in str(k.get("kioskId", "")).lower()
        or "itpc07" in str(k.get("name", "")).lower()
    ]
    if not matches:
        print("itpc07 not found. sample hostnames:")
        for k in kiosks[:15]:
            print(" -", k.get("hostname"), k.get("softwareVersion"), k.get("online"), k.get("probeStatus"))
        return
    k = matches[0]
    kid = k["id"]
    print(
        json.dumps(
            {
                "id": kid,
                "hostname": k.get("hostname"),
                "kioskId": k.get("kioskId"),
                "name": k.get("name"),
                "softwareVersion": k.get("softwareVersion"),
                "online": k.get("online"),
                "probeStatus": k.get("probeStatus"),
                "otaPending": k.get("otaPending"),
                "otaTarget": k.get("otaTarget"),
                "healthPort": k.get("healthPort"),
                "lastSeenAt": k.get("lastSeenAt"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    print("\n=== 4) Direct agent health ===")
    host = k.get("hostname")
    port = k.get("healthPort") or 47821
    st, health = http_json(f"http://{host}:{port}/health", timeout=5)
    print("health", st, json.dumps(health, ensure_ascii=False, indent=2) if health else None)

    print("\n=== 5) Probe via admin ===")
    st, probed = http_json(f"{base}/api/kiosks/{kid}/probe", method="POST", token=token, timeout=30)
    print(
        "probe",
        st,
        {
            "softwareVersion": (probed or {}).get("softwareVersion") if isinstance(probed, dict) else probed,
            "probeStatus": (probed or {}).get("probeStatus") if isinstance(probed, dict) else None,
            "probeMessage": (probed or {}).get("probeMessage") if isinstance(probed, dict) else None,
            "online": (probed or {}).get("online") if isinstance(probed, dict) else None,
        },
    )

    local_before = None
    if isinstance(probed, dict):
        local_before = probed.get("softwareVersion")
    elif isinstance(health, dict):
        local_before = health.get("softwareVersion")
    else:
        local_before = k.get("softwareVersion")

    print("\n=== 6) Check updates endpoint (as agent would) ===")
    kiosk_key = k.get("kioskId") or host
    st, updates = http_json(
        f"{base}/api/kiosks/{kiosk_key}/updates?softwareVersion={urllib.parse.quote(str(local_before or ''))}",
        timeout=15,
    )
    print(st, json.dumps(updates, ensure_ascii=False, indent=2))

    print("\n=== 7) Trigger software-update (admin button) ===")
    t0 = time.time()
    st, upd = http_json(
        f"{base}/api/kiosks/{kid}/software-update",
        method="POST",
        token=token,
        timeout=60,
    )
    elapsed = time.time() - t0
    print(f"status={st} elapsed={elapsed:.1f}s")
    print(json.dumps(upd, ensure_ascii=False, indent=2))

    print("\n=== 8) Poll agent health / admin for up to 90s ===")
    deadline = time.time() + 90
    last = None
    while time.time() < deadline:
        st_h, health2 = http_json(f"http://{host}:{port}/health", timeout=4)
        agent_sw = (health2 or {}).get("softwareVersion") if isinstance(health2, dict) else None
        in_prog = (health2 or {}).get("updateInProgress") if isinstance(health2, dict) else None
        st_k, row = http_json(f"{base}/api/kiosks", token=token, timeout=15)
        admin_sw = None
        ota_pending = None
        if isinstance(row, list):
            hit = next((x for x in row if x.get("id") == kid), None)
            if hit:
                admin_sw = hit.get("softwareVersion")
                ota_pending = hit.get("otaPending")
        snap = {
            "t": round(time.time() - t0, 1),
            "agent": agent_sw,
            "updateInProgress": in_prog,
            "admin": admin_sw,
            "otaPending": ota_pending,
            "target": target,
        }
        if snap != last:
            print(snap)
            last = snap
        if agent_sw and target and agent_sw == target:
            print("\nSUCCESS: agent reached target version")
            break
        time.sleep(3)
    else:
        print("\nTIMEOUT: did not reach target within 90s")

    print("\n=== 9) force-update endpoint probe ===")
    # only GET check via OPTIONS/404 — don't trigger again unless needed
    st, force_try = http_json(
        f"http://{host}:{port}/force-update",
        method="POST",
        body={"softwareVersion": target},
        timeout=8,
    )
    print("POST /force-update", st, force_try)


if __name__ == "__main__":
    import urllib.parse

    main()
