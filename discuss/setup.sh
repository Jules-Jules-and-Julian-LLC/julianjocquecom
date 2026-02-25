#!/usr/bin/env bash
set -euo pipefail

# === Configuration ===
DOMAIN="discuss.julianjocque.com"
MOD_SECRET="changeme"
OWNER_NAME="julian"
APP_DIR="/opt/discuss"
APP_USER="discuss"

echo "=== Setting up discuss on ${DOMAIN} ==="

# --- Install packages ---
echo "Installing OpenJDK 21, Nginx, certbot, sqlite3..."
apt-get update -qq
apt-get install -y -qq openjdk-21-jre-headless nginx certbot python3-certbot-nginx sqlite3

# --- Create system user ---
if id "${APP_USER}" &>/dev/null; then
    echo "User ${APP_USER} already exists, skipping."
else
    echo "Creating system user ${APP_USER}..."
    useradd --system --no-create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

# --- Create app directory ---
echo "Creating ${APP_DIR}..."
mkdir -p "${APP_DIR}/backups"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# --- Write .env file ---
ENV_FILE="${APP_DIR}/.env"
if [ ! -f "${ENV_FILE}" ]; then
    echo "Writing ${ENV_FILE}..."
    cat > "${ENV_FILE}" <<EOF
MOD_SECRET=${MOD_SECRET}
OWNER_NAME=${OWNER_NAME}
DB_PATH=${APP_DIR}/discuss.db
EOF
    chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"
    chmod 600 "${ENV_FILE}"
else
    echo "${ENV_FILE} already exists, skipping. Edit it manually if needed."
fi

# --- Write systemd unit ---
echo "Writing systemd unit..."
cat > /etc/systemd/system/discuss.service <<EOF
[Unit]
Description=discuss forum
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/java -jar ${APP_DIR}/discuss.jar
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable discuss

# --- Write Nginx config ---
echo "Writing Nginx config..."
cat > /etc/nginx/sites-available/discuss <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    location /style.css {
        proxy_pass http://127.0.0.1:7070;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=86400";
    }

    location / {
        proxy_pass http://127.0.0.1:7070;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/discuss /etc/nginx/sites-enabled/discuss
rm -f /etc/nginx/sites-enabled/default

# --- Obtain SSL certificate ---
echo "Obtaining SSL certificate from Let's Encrypt..."
# Temporarily allow HTTP so certbot can do its challenge
# We need a basic nginx running on port 80 for the challenge
cat > /etc/nginx/sites-available/certbot-temp <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
}
NGINX
ln -sf /etc/nginx/sites-available/certbot-temp /etc/nginx/sites-enabled/certbot-temp
rm -f /etc/nginx/sites-enabled/discuss
nginx -t
systemctl restart nginx

certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email "julian@julianjocque.com" --redirect

# Now put the real config back
rm -f /etc/nginx/sites-enabled/certbot-temp
rm -f /etc/nginx/sites-available/certbot-temp
ln -sf /etc/nginx/sites-available/discuss /etc/nginx/sites-enabled/discuss
nginx -t
systemctl restart nginx

# --- Verify certbot auto-renewal ---
echo "Verifying certbot auto-renewal..."
systemctl is-enabled certbot.timer && echo "certbot timer is enabled." || systemctl enable --now certbot.timer

# --- Set up nightly SQLite backup cron ---
echo "Setting up nightly backup cron job..."
CRON_CMD="sqlite3 ${APP_DIR}/discuss.db \".backup ${APP_DIR}/backups/discuss-\$(date +\\%Y\\%m\\%d).db\" && find ${APP_DIR}/backups -name 'discuss-*.db' -mtime +30 -delete"
CRON_LINE="0 3 * * * ${CRON_CMD}"

# Write cron job for root (needs read access to the db)
( crontab -l 2>/dev/null | grep -v "${APP_DIR}/discuss.db" || true; echo "${CRON_LINE}" ) | crontab -

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit ${ENV_FILE} and set a real MOD_SECRET"
echo "  2. Copy discuss.jar and discuss.db to ${APP_DIR}/"
echo "  3. chown ${APP_USER}:${APP_USER} ${APP_DIR}/discuss.jar ${APP_DIR}/discuss.db"
echo "  4. systemctl start discuss"
echo "  5. Check: journalctl -u discuss -f"
