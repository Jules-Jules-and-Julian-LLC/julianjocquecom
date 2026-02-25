#!/usr/bin/env bash
set -euo pipefail

# === Configuration ===
SERVER="root@your-server-ip"
APP_DIR="/opt/discuss"
JAR_NAME="discuss.jar"

echo "=== Deploying discuss ==="

# --- Build ---
echo "Building fat JAR..."
mvn package -q -DskipTests

# --- Upload ---
echo "Uploading JAR to ${SERVER}..."
scp target/discuss-0.1.0.jar "${SERVER}:${APP_DIR}/${JAR_NAME}.new"

# --- Restart ---
echo "Stopping service, swapping JAR, starting service..."
ssh "${SERVER}" bash -s <<EOF
set -euo pipefail
systemctl stop discuss
mv ${APP_DIR}/${JAR_NAME}.new ${APP_DIR}/${JAR_NAME}
chown discuss:discuss ${APP_DIR}/${JAR_NAME}
systemctl start discuss
echo "Tailing journal for 5 seconds..."
timeout 5 journalctl -u discuss -f --no-pager || true
EOF

echo "=== Deploy complete ==="
