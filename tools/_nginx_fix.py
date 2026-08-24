import paramiko
import re

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("10.192.1.6", username="root", password="Mazambi47!", timeout=20, allow_agent=False, look_for_keys=False)

# Write updated nginx site config
config = '''server {
    listen 80 default_server;
    server_name omskekran.udhb.local _;

    # Match Fastify multipart limit (photos / video / audio uploads)
    client_max_body_size 512m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # long uploads
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_request_buffering off;
    }
}
'''

sftp = client.open_sftp()
with sftp.file("/etc/nginx/sites-available/omskscrin", "w") as f:
    f.write(config)
sftp.close()

cmd = r'''
nginx -t
systemctl reload nginx
echo '=== applied ==='
grep -n client_max_body /etc/nginx/sites-available/omskscrin
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1/
'''
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
out = (stdout.read()+stderr.read()).decode('utf-8','replace')
print(re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',out).encode('ascii','replace').decode())
client.close()
