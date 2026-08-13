#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute este instalador como root."
  exit 1
fi

PROJECT_DIR="${1:-/root/oriontrack}"
SOURCE_SCRIPT="${PROJECT_DIR}/scripts/orion-health-monitor.sh"

if [ ! -f "$SOURCE_SCRIPT" ]; then
  echo "Monitor nao encontrado em ${SOURCE_SCRIPT}."
  exit 1
fi

install -m 0755 "$SOURCE_SCRIPT" /usr/local/bin/orion-health-monitor
mkdir -p /var/log/oriontrack-monitor

cat > /etc/oriontrack-monitor.env <<'EOF'
ORION_MONITOR_URL=https://track.orionassessoriaa.com.br
ORION_MONITOR_SERVICE=oriontrack_oriontrack
ORION_MONITOR_INTERVAL=60
ORION_MONITOR_LOG_DIR=/var/log/oriontrack-monitor
ORION_MONITOR_WHATSAPP=5561984409328
ORION_MONITOR_APOLO_INSTANCE=apolo_master_sender
EOF

cat > /etc/systemd/system/oriontrack-monitor.service <<'EOF'
[Unit]
Description=Orion Track independent health monitor
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
EnvironmentFile=-/root/oriontrack/.env.production
EnvironmentFile=/etc/oriontrack-monitor.env
ExecStart=/usr/local/bin/orion-health-monitor
Restart=always
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/logrotate.d/oriontrack-monitor <<'EOF'
/var/log/oriontrack-monitor/*.jsonl /var/log/oriontrack-monitor/incidents/*.log {
  daily
  rotate 30
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
EOF

systemctl daemon-reload
systemctl enable oriontrack-monitor.service
systemctl restart oriontrack-monitor.service
systemctl --no-pager --full status oriontrack-monitor.service

echo "Monitor instalado. Eventos: /var/log/oriontrack-monitor/health.jsonl"
