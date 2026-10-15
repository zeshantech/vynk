#!/usr/bin/env bash
# One-time Vynk server bootstrap. Run as root ON THE SERVER, yourself:
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA... deploy@vynk" bash bootstrap-server.sh
# Installs Docker, creates a 'deploy' user (key-only), opens ports 22/80/443, disables SSH password login.
set -euo pipefail

: "${DEPLOY_PUBKEY:?Set DEPLOY_PUBKEY to the PUBLIC key that GitHub Actions will use}"
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl ufw fail2ban

# Docker (official convenience script) + compose plugin
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

# deploy user
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "$DEPLOY_PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# swap (helps small servers during image pulls/builds)
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# SSH hardening: ONLY after confirming you can log in as deploy with the key (open a 2nd terminal first!)
read -r -p "In another terminal, confirm 'ssh deploy@<ip>' works with your key. Disable password + root SSH login now? [y/N] " ans
if [ "${ans:-N}" = "y" ]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  systemctl reload ssh || systemctl reload sshd
  echo "SSH hardened."
fi
echo "Done. Docker: $(docker --version)"
