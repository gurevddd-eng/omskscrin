import json, urllib.request, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
for host in ["patriotstela17.udhb.local", "10.192.1.6"]:
    try:
        if host.startswith("10."):
            url = f"http://{host}:8080/api/deploy/meta"
        else:
            url = f"http://{host}:47821/health"
        with urllib.request.urlopen(url, timeout=8) as r:
            print(host, json.dumps(json.loads(r.read().decode()), ensure_ascii=False)[:500])
    except Exception as e:
        print(host, "FAIL", e)
