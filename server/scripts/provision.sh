#!/usr/bin/env bash
# =============================================================================
#  provision.sh — full automated server provisioning
#
#  Run from the repo root: bash scripts/provision.sh
#  Re-running is safe: completed steps are skipped.
#  If a step fails, fix the issue and re-run — it resumes from that step.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
SERVER_IP="164.92.131.71"
SERVER_USER="root"
SSH_KEY="$HOME/.ssh/id_rsa"
DEPLOY_KEY="$HOME/.ssh/peridot-deploy"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.provision-state"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -o BatchMode=yes"
SERVER="${SERVER_USER}@${SERVER_IP}"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}  ▶ $*${RESET}"; }
success() { echo -e "${GREEN}  ✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}  ⚠ $*${RESET}"; }
die()     { echo -e "${RED}  ✗ $*${RESET}" >&2; exit 1; }
section() { echo -e "\n${BOLD}━━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"; }

# ── Step runner ───────────────────────────────────────────────────────────────
is_done()  { grep -qxF "$1" "$STATE_FILE" 2>/dev/null; }
mark_done(){ echo "$1" >> "$STATE_FILE"; }

run_step() {
  local name="$1"; shift
  if is_done "$name"; then
    echo -e "${CYAN}  ⏭  $name — already done, skipping${RESET}"
    return 0
  fi
  section "$name"
  if "$@"; then
    mark_done "$name"
    success "$name complete"
  else
    die "$name FAILED — fix the error above and re-run: bash scripts/provision.sh"
  fi
}

# ── Remote helpers ────────────────────────────────────────────────────────────
ssh_run() {
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$SERVER" "$@"
}
ssh_run_interactive() {
  # -t allocates a pseudo-TTY so progress output streams live
  # shellcheck disable=SC2086
  ssh $SSH_OPTS -t "$SERVER" "$@"
}
scp_to() {
  local src="$1" dst="$2"
  # shellcheck disable=SC2086
  scp $SSH_OPTS "$src" "${SERVER}:${dst}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEPS
# ═══════════════════════════════════════════════════════════════════════════════

# ── 1. Verify SSH connectivity ────────────────────────────────────────────────
step_check_ssh() {
  info "Verifying SSH access to ${SERVER}..."
  ssh_run "echo 'SSH OK: hostname=$(hostname), os=$(. /etc/os-release && echo $PRETTY_NAME)'"
}

# ── 2. Copy server-setup.sh ───────────────────────────────────────────────────
step_copy_setup_script() {
  info "Copying server-setup.sh to server..."
  scp_to "$SCRIPT_DIR/server-setup.sh" "/root/server-setup.sh"
  ssh_run "chmod +x /root/server-setup.sh"
  success "Copied to /root/server-setup.sh"
}

# ── 3. Run server-setup.sh on the server ─────────────────────────────────────
step_run_server_setup() {
  info "Running server-setup.sh on the server (this takes ~3-5 minutes)..."
  info "apt-get upgrade, Docker install, fail2ban, unattended-upgrades..."
  # Use -tt to force TTY even in script so apt-get output streams live
  # DEBIAN_FRONTEND=noninteractive suppresses all interactive prompts
  ssh_run_interactive "DEBIAN_FRONTEND=noninteractive bash /root/server-setup.sh"
}

# ── 4. Generate deploy SSH key (local) ───────────────────────────────────────
step_generate_deploy_key() {
  if [[ -f "$DEPLOY_KEY" ]]; then
    warn "Deploy key already exists at $DEPLOY_KEY — not overwriting"
    return 0
  fi
  info "Generating ed25519 deploy key at $DEPLOY_KEY..."
  ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "peridot-mcp-server-deploy"
  success "Deploy key generated"
  echo ""
  info "Public key:"
  cat "${DEPLOY_KEY}.pub"
}

# ── 5. Install deploy key on server ──────────────────────────────────────────
step_install_deploy_key() {
  local pubkey
  pubkey=$(cat "${DEPLOY_KEY}.pub")

  info "Adding deploy public key to server authorized_keys..."

  ssh_run "bash -s" << EOF
# Ensure .ssh exists with correct permissions
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Add the key only if not already present
PUBKEY='${pubkey}'
if grep -qF "\$PUBKEY" ~/.ssh/authorized_keys; then
  echo "  Key already present — skipping"
else
  echo "\$PUBKEY" >> ~/.ssh/authorized_keys
  echo "  Key added"
fi
EOF

  # Verify the new key works before we rely on it
  info "Verifying deploy key access..."
  # shellcheck disable=SC2086
  ssh -i "$DEPLOY_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes \
    "${SERVER_USER}@${SERVER_IP}" "echo 'Deploy key works'"
  success "Deploy key installed and verified"
}

# ── 6. Configure GitHub Actions secrets ──────────────────────────────────────
step_configure_github_secrets() {
  # Detect GitHub repo from remote origin
  local repo
  repo=$(git remote get-url origin 2>/dev/null \
    | sed -E 's|.*github\.com[:/]||;s|\.git$||') || true

  if [[ -z "$repo" ]]; then
    warn "Could not detect GitHub repository from git remote — skipping secret setup"
    warn "Set these manually in GitHub → $repo → Settings → Secrets → Actions:"
    echo "   DEPLOY_HOST    = ${SERVER_IP}"
    echo "   DEPLOY_SSH_KEY = <contents of ${DEPLOY_KEY}>"
    return 0
  fi

  info "Detected repo: $repo"

  # Try gh CLI
  if ! command -v gh &>/dev/null; then
    warn "GitHub CLI (gh) not found — install from https://cli.github.com to set secrets automatically"
    info "Set these secrets manually in: https://github.com/${repo}/settings/secrets/actions"
    echo ""
    echo "   DEPLOY_HOST    = ${SERVER_IP}"
    echo "   DEPLOY_SSH_KEY ="
    cat "$DEPLOY_KEY"
    return 0
  fi

  if ! gh auth status &>/dev/null; then
    warn "gh is installed but not authenticated — run: gh auth login"
    info "Then re-run: bash scripts/provision.sh"
    return 1
  fi

  info "Setting DEPLOY_HOST secret..."
  echo -n "${SERVER_IP}" | gh secret set DEPLOY_HOST --repo "$repo"
  success "DEPLOY_HOST set"

  info "Setting DEPLOY_SSH_KEY secret..."
  gh secret set DEPLOY_SSH_KEY --repo "$repo" < "$DEPLOY_KEY"
  success "DEPLOY_SSH_KEY set"

  info "Current secrets in $repo:"
  gh secret list --repo "$repo"
}

# ── 7. Set PERIDOT_IMAGE in server .env ───────────────────────────────────────
step_configure_image_name() {
  local repo
  repo=$(git remote get-url origin 2>/dev/null \
    | sed -E 's|.*github\.com[:/]||;s|\.git$||') || true

  if [[ -z "$repo" ]]; then
    warn "Could not detect GitHub repo — set PERIDOT_IMAGE in /opt/peridot-mcp-server/.env manually"
    return 0
  fi

  # GHCR requires lowercase image names
  local image
  image="ghcr.io/$(echo "$repo" | tr '[:upper:]' '[:lower:]'):latest"

  info "Setting PERIDOT_IMAGE=$image in server .env..."

  ssh_run "bash -s" << EOF
sed -i "s|^PERIDOT_IMAGE=.*|PERIDOT_IMAGE=${image}|" /opt/peridot-mcp-server/.env
grep PERIDOT_IMAGE /opt/peridot-mcp-server/.env
EOF
  success "PERIDOT_IMAGE configured"
}

# ── 8. Print remaining manual steps ──────────────────────────────────────────
step_show_remaining() {
  echo ""
  echo -e "${BOLD}${GREEN}━━━ Provisioning complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo -e "${BOLD}One remaining manual step:${RESET}"
  echo ""
  echo -e "${YELLOW}  Set your DATABASE_URL on the server:${RESET}"
  echo ""
  echo "    ssh -i ~/.ssh/id_rsa root@${SERVER_IP}"
  echo "    nano /opt/peridot-mcp-server/.env"
  echo ""
  echo "  Required fields in .env:"
  echo "    DATABASE_URL=postgres://user:pass@host:25060/db?sslmode=require"
  echo "    CORS_ORIGIN=https://app.peridot.finance"
  echo ""
  echo "  Optional (DigitalOcean Managed DB CA cert for SSL verification):"
  echo "    scp ca-certificate.crt root@${SERVER_IP}:/opt/peridot-mcp-server/certs/"
  echo "    # then uncomment PGSSLROOTCERT in .env"
  echo ""
  echo -e "${BOLD}After setting DATABASE_URL — first deploy:${RESET}"
  echo ""
  echo "    git push origin main"
  echo "    # GitHub Actions: typecheck → test → docker build → push GHCR → deploy"
  echo ""
  echo -e "${BOLD}To verify once deployed:${RESET}"
  echo ""
  echo "    curl http://${SERVER_IP}:3001/health"
  echo "    curl http://${SERVER_IP}:3001/health/db"
  echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}peridot-mcp-server — automated server provisioning${RESET}"
echo -e "  Server:     ${SERVER_IP}"
echo -e "  State file: ${STATE_FILE}"
echo -e "  Re-run this script any time to continue from where it left off."
echo ""

run_step "01_check_ssh"               step_check_ssh
run_step "02_copy_setup_script"       step_copy_setup_script
run_step "03_run_server_setup"        step_run_server_setup
run_step "04_generate_deploy_key"     step_generate_deploy_key
run_step "05_install_deploy_key"      step_install_deploy_key
run_step "06_configure_github_secrets" step_configure_github_secrets
run_step "07_configure_image_name"    step_configure_image_name
run_step "08_show_remaining"          step_show_remaining
