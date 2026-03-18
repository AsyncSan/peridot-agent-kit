#!/usr/bin/env bash
# =============================================================================
#  peridot-mcp-server — server provisioning script
#
#  Tested on: Ubuntu 22.04 LTS, Ubuntu 24.04 LTS
#  Run as:    root  (ssh -i ~/.ssh/id_rsa root@<droplet-ip>)
#  Usage:     curl ... | bash  OR  bash server-setup.sh
#
#  Safe to re-run (idempotent where possible).
#
#  What this script does:
#    1. System update + install essentials
#    2. fail2ban  — SSH brute-force protection (conservative thresholds,
#                   won't affect key-based auth)
#    3. Unattended upgrades — auto-apply security patches
#    4. Docker CE — container runtime
#    5. App directory + docker-compose.prod.yml + .env template
#    6. Systemd service — starts the container on boot
#    7. Deploy key instructions — what to do in GitHub Actions
#
#  What this script does NOT touch:
#    - SSH port, SSH config, root login — deliberately left alone
#      to avoid any risk of lockout
#    - UFW — DigitalOcean's firewall already handles ingress filtering
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▶ $*${RESET}"; }
success() { echo -e "${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
error()   { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
section() { echo -e "\n${BOLD}━━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
section "Pre-flight checks"

[[ $EUID -eq 0 ]] || error "Run this script as root (you are: $(whoami))"

. /etc/os-release
[[ "$ID" == "ubuntu" ]] || warn "Expected Ubuntu, got '$ID' — proceed with caution"

info "Detected: $PRETTY_NAME on $(uname -m)"
success "Running as root"

# ── 1. System update ──────────────────────────────────────────────────────────
section "System update"
info "Updating package lists and upgrading installed packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -y -q
success "System up to date"

# ── 2. Install essentials ─────────────────────────────────────────────────────
section "Installing essentials"
info "Installing curl, git, fail2ban, unattended-upgrades, logrotate, wget..."
apt-get install -y -q \
  curl \
  git \
  wget \
  logrotate \
  fail2ban \
  unattended-upgrades \
  apt-listchanges

success "Essentials installed"

# ── 3. Configure fail2ban ─────────────────────────────────────────────────────
section "Configuring fail2ban"

# jail.local overrides jail.conf — survives package upgrades.
# Thresholds are conservative on purpose:
#   • maxretry=5  — 5 failed attempts before a ban
#   • findtime=600 — within a 10-minute sliding window
#   • bantime=3600 — banned for 1 hour
#
# SSH key users cannot trigger fail2ban (keys don't "fail" — only
# wrong passwords do). This configuration protects against bots trying
# password auth while leaving your key-based access completely unaffected.

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
# 1 hour ban, 5 failures in 10 minutes
bantime  = 3600
findtime = 600
maxretry = 5

# Use systemd backend (Ubuntu 22.04+)
backend = systemd

# Do not ban the loopback interface
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled  = true
port     = ssh
filter   = sshd
logpath  = %(sshd_log)s
maxretry = 5
EOF

systemctl enable fail2ban
systemctl restart fail2ban
success "fail2ban configured (SSH jail: maxretry=5, bantime=1h)"

# ── 4. Unattended security upgrades ──────────────────────────────────────────
section "Configuring automatic security upgrades"

cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

systemctl enable unattended-upgrades
systemctl restart unattended-upgrades
success "Unattended security upgrades enabled (no auto-reboots)"

# ── 5. Install Docker CE ──────────────────────────────────────────────────────
section "Installing Docker CE"

if command -v docker &>/dev/null; then
  DOCKER_VERSION=$(docker --version)
  warn "Docker already installed: $DOCKER_VERSION — skipping installation"
else
  info "Removing legacy Docker packages if present..."
  for pkg in docker.io docker-doc docker-compose podman-docker containerd runc; do
    apt-get remove -y "$pkg" 2>/dev/null || true
  done

  info "Adding Docker's official GPG key and repository..."
  apt-get install -y -q ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu \
$(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -q
  apt-get install -y -q \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

  systemctl enable docker
  systemctl start docker
  success "Docker CE installed: $(docker --version)"
fi

# Allow root to use Docker (already the case; here for clarity)
# For a non-root deploy user you would: usermod -aG docker <user>

# ── 6. Application directory ──────────────────────────────────────────────────
section "Setting up application directory"

APP_DIR="/opt/peridot-mcp-server"
mkdir -p "$APP_DIR"
info "App directory: $APP_DIR"

# ── docker-compose.prod.yml ───────────────────────────────────────────────────
if [[ ! -f "$APP_DIR/docker-compose.prod.yml" ]]; then
  cat > "$APP_DIR/docker-compose.prod.yml" << 'EOF'
services:
  app:
    # PERIDOT_IMAGE is set in .env below
    # Format: ghcr.io/<github-owner>/peridot-mcp-server:latest
    image: ${PERIDOT_IMAGE}
    restart: unless-stopped
    ports:
      - "3001:3001"
    env_file:
      - .env
    healthcheck:
      test: wget -qO- http://localhost:3001/health || exit 1
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
EOF
  success "Written: $APP_DIR/docker-compose.prod.yml"
else
  warn "docker-compose.prod.yml already exists — not overwriting"
fi

# ── .env template ─────────────────────────────────────────────────────────────
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat > "$APP_DIR/.env" << 'EOF'
# =============================================================================
#  peridot-mcp-server — production environment
#  Edit this file, then run: docker compose -f docker-compose.prod.yml up -d
# =============================================================================

# ── Docker image (set to your GitHub Container Registry image) ───────────────
PERIDOT_IMAGE=ghcr.io/REPLACE_ME/peridot-mcp-server:latest

# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgres://user:password@host:25060/db?sslmode=require
# Path to DigitalOcean CA cert (download from your DB cluster page)
# PGSSLROOTCERT=/opt/peridot-mcp-server/certs/ca-certificate.crt

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=https://app.peridot.finance
NETWORK_PRESET=mainnet

# ── Rate limiting ─────────────────────────────────────────────────────────────
RATE_LIMIT_RPM=120
RATE_LIMIT_WINDOW_MS=60000

# ── Biconomy (if needed for cross-chain tools) ────────────────────────────────
# BICONOMY_API_KEY=your_key_here
EOF
  chmod 600 "$APP_DIR/.env"  # only root can read — contains credentials
  success "Written: $APP_DIR/.env  (chmod 600 — edit before first deploy)"
else
  warn ".env already exists — not overwriting"
fi

# ── CA cert directory ─────────────────────────────────────────────────────────
mkdir -p "$APP_DIR/certs"
info "Place DigitalOcean CA cert at: $APP_DIR/certs/ca-certificate.crt"
info "Then uncomment PGSSLROOTCERT in .env"

# ── 7. Systemd service ────────────────────────────────────────────────────────
section "Creating systemd service"

cat > /etc/systemd/system/peridot-mcp-server.service << EOF
[Unit]
Description=Peridot MCP Server (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
TimeoutStartSec=120
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable peridot-mcp-server
success "Systemd service enabled: peridot-mcp-server"

# ── 8. Log rotation for Docker JSON logs ─────────────────────────────────────
section "Configuring log rotation"

# Docker's json-file driver handles log rotation via compose config (max-size,
# max-file). This logrotate entry handles any loose server logs under /var/log.
cat > /etc/logrotate.d/peridot-mcp-server << 'EOF'
/var/log/peridot-mcp-server/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
}
EOF
mkdir -p /var/log/peridot-mcp-server
success "Log rotation configured (14 days)"

# ── 9. Login to GitHub Container Registry ─────────────────────────────────────
section "GitHub Container Registry"
warn "The container image is hosted on ghcr.io (GitHub Container Registry)."
info "If your GitHub repository is PRIVATE, you must authenticate Docker:"
echo ""
echo "  docker login ghcr.io -u <github-username> --password-stdin"
echo "  # (enter a GitHub PAT with 'read:packages' scope)"
echo ""
info "If the repository is PUBLIC, no authentication is needed to pull."

# ── Done — next steps ─────────────────────────────────────────────────────────
section "Setup complete"

echo ""
echo -e "${BOLD}${GREEN}Server is provisioned. Manual steps remaining:${RESET}"
echo ""
echo -e "${BOLD}1. Edit the .env file with your real credentials:${RESET}"
echo "     nano $APP_DIR/.env"
echo "   Required: DATABASE_URL, PERIDOT_IMAGE, CORS_ORIGIN"
echo ""
echo -e "${BOLD}2. (Optional) Add the DigitalOcean CA certificate:${RESET}"
echo "   Download from your DB cluster → Settings → CA Certificate"
echo "     cp ca-certificate.crt $APP_DIR/certs/"
echo "     # then uncomment PGSSLROOTCERT in .env"
echo ""
echo -e "${BOLD}3. Configure GitHub Actions secrets (for CI/CD auto-deploy):${RESET}"
echo ""
echo "   a) Generate a deploy SSH key (on your LOCAL machine):"
echo "        ssh-keygen -t ed25519 -f ~/.ssh/peridot-deploy -N ''"
echo ""
echo "   b) Authorise it on THIS server:"
echo "        ssh-copy-id -i ~/.ssh/peridot-deploy.pub root@$(hostname -I | awk '{print $1}')"
echo ""
echo "   c) Add these secrets in GitHub → repo → Settings → Secrets → Actions:"
echo "        DEPLOY_HOST     = $(hostname -I | awk '{print $1}')"
echo "        DEPLOY_SSH_KEY  = <contents of ~/.ssh/peridot-deploy>"
echo ""
echo -e "${BOLD}4. First deployment (once .env is filled in):${RESET}"
echo "   a) Push to main → GitHub Actions will build, push, and deploy"
echo "   OR manually:"
echo "        cd $APP_DIR"
echo "        docker compose -f docker-compose.prod.yml up -d"
echo ""
echo -e "${BOLD}5. Verify it's running:${RESET}"
echo "     curl http://localhost:3001/health"
echo "     curl http://localhost:3001/health/db"
echo ""
echo -e "${BOLD}Security status:${RESET}"
systemctl is-active fail2ban          && echo "  ✓ fail2ban        active" || echo "  ✗ fail2ban        INACTIVE"
systemctl is-active unattended-upgrades && echo "  ✓ auto-upgrades   active" || echo "  ✗ auto-upgrades   INACTIVE"
systemctl is-active docker            && echo "  ✓ docker          active" || echo "  ✗ docker          INACTIVE"
echo ""
echo "  Firewall: managed by DigitalOcean (not UFW)"
echo "  SSH:      key-based auth, root login unchanged"
echo "  Secrets:  .env is chmod 600 (root-only)"
echo ""
