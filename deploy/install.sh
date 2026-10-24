#!/usr/bin/env bash
# Kickswarm: puts a public coordinator online on a fresh Ubuntu or Debian server (docs/deploy.md).
#
#   curl -fsSL https://raw.githubusercontent.com/Sciscito/kickswarm/main/deploy/install.sh \
#     | sudo bash -s -- --duckdns <name> --duckdns-token <token>
#
# A fork adds --repo https://github.com/<you>/kickswarm.
#
# Run it again at any time to update: it pulls the code, rebuilds, restarts and checks.
#
# What it does, in order: firewall (ports 80 and 443), swap on small machines, Node.js 24, Caddy
# (automatic HTTPS), a `kickswarm` system user, the code in /opt/kickswarm (built and packed), the
# service (self-check, then the prepared projects open by themselves), a daily backup, and a final
# check from the outside.
#
# The address: --domain <your domain> (its DNS record points to this server), or a free DuckDNS name
# with --duckdns <name> --duckdns-token <token> (https://www.duckdns.org), which this script keeps
# pointed at the server. With neither, <your-ip>.sslip.io: no sign-up, but its certificates share one
# weekly limit with every sslip.io user, so HTTPS may take a while to come.

set -euo pipefail

REPO="${KICKSWARM_REPO:-}"
DEFAULT_REPO="https://github.com/Sciscito/kickswarm"
BRANCH="main"
DOMAIN=""
DUCKDNS=""
DUCKDNS_TOKEN=""
EMAIL=""
PORT=7777
CODE=/opt/kickswarm
VAR=/var/lib/kickswarm
BACKUPS=/var/backups/kickswarm

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --duckdns) DUCKDNS="${2%.duckdns.org}"; shift 2 ;;
    --duckdns-token) DUCKDNS_TOKEN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    -h|--help) sed -n '2,21p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run it with sudo"
command -v apt-get >/dev/null || die "this script is for Ubuntu or Debian"
if [ -z "$REPO" ] && [ -d "$CODE/.git" ]; then REPO="$(git -c safe.directory="$CODE" -C "$CODE" remote get-url origin)"; fi
REPO="${REPO:-$DEFAULT_REPO}"
export DEBIAN_FRONTEND=noninteractive

say "System packages"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

say "Firewall: ports 80 and 443 open"
# Oracle Cloud's Ubuntu images reject everything but SSH in iptables, on top of the cloud's own rules.
for p in 80 443; do
  if command -v iptables >/dev/null && ! iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null; then
    iptables -I INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

# Building needs about 1.5 GB of memory: a swap file keeps small machines (1 GB) from running out.
if [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 2000 ] && ! swapon --show | grep -q .; then
  say "Swap: 2 GB (small machine)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  say "Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v)"

if ! command -v caddy >/dev/null; then
  say "Caddy (automatic HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

if [ -n "$DUCKDNS" ]; then
  [ -n "$DUCKDNS_TOKEN" ] || die "--duckdns needs --duckdns-token (shown on duckdns.org once you are signed in)"
  say "DuckDNS: $DUCKDNS.duckdns.org points to this server"
  answer="$(curl -fsS --max-time 15 "https://www.duckdns.org/update?domains=$DUCKDNS&token=$DUCKDNS_TOKEN&ip=")" || answer=""
  [ "$answer" = "OK" ] || die "DuckDNS refused the update: check the name and the token"
  DOMAIN="$DUCKDNS.duckdns.org"
  # Kept up to date every hour, in case the server's address changes.
  umask 077
  printf '#!/bin/sh
curl -fsS --max-time 15 "https://www.duckdns.org/update?domains=%s&token=%s&ip=" >/dev/null
' "$DUCKDNS" "$DUCKDNS_TOKEN" > /usr/local/sbin/kickswarm-duckdns
  umask 022
  chmod 700 /usr/local/sbin/kickswarm-duckdns
  echo '17 * * * * root /usr/local/sbin/kickswarm-duckdns' > /etc/cron.d/kickswarm-duckdns
fi
if [ -z "$DOMAIN" ]; then
  if [ -f "$VAR/domain" ]; then DOMAIN="$(cat "$VAR/domain")"; else
    IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me)" || die "cannot find this server's public address: pass --domain"
    DOMAIN="$(echo "$IP" | tr . -).sslip.io"
    echo "No --domain or --duckdns: using $DOMAIN (HTTPS may take a while, see the top of this script)."
  fi
fi

say "User and folders"
id kickswarm >/dev/null 2>&1 || useradd --system --home-dir "$VAR" --shell /usr/sbin/nologin kickswarm
mkdir -p "$VAR/data" "$VAR/home" "$BACKUPS" "$CODE"
echo "$DOMAIN" > "$VAR/domain"
chown -R kickswarm:kickswarm "$VAR" "$CODE"
chmod 700 "$VAR/home" "$BACKUPS"
as() { sudo -u kickswarm -H env HOME="$VAR" "$@"; }

say "Code: $REPO ($BRANCH)"
if [ -d "$CODE/.git" ]; then
  as git -C "$CODE" fetch --quiet origin "$BRANCH"
  as git -C "$CODE" checkout --quiet "$BRANCH"
  as git -C "$CODE" reset --quiet --hard "origin/$BRANCH"
else
  as git clone --quiet --branch "$BRANCH" "$REPO" "$CODE"
fi
echo "Version: $(as git -C "$CODE" log -1 --format='%h %s')"

say "Build (a few minutes on a small machine)"
cd "$CODE"
as npm ci --no-audit --no-fund --loglevel=error
as npm run build --silent
# The package the join command installs, served by the coordinator itself at /kickswarm.tgz.
rm -f kickswarm*.tgz
as npm pack --silent >/dev/null
mv kickswarm-*.tgz kickswarm.tgz

say "Service"
cat > /etc/systemd/system/kickswarm.service <<EOF
[Unit]
Description=Kickswarm public coordinator
After=network-online.target
Wants=network-online.target

[Service]
User=kickswarm
Group=kickswarm
Environment=KICKSWARM_HOME=$VAR/home
Environment=NODE_ENV=production
WorkingDirectory=$CODE
ExecStart=$(command -v node) $CODE/dist/cli.js coordinator --public --port $PORT --data $VAR/data
Restart=always
RestartSec=5
TimeoutStartSec=300
LimitNOFILE=65536
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$VAR
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
EOF

# Caddy: HTTPS for the address, and a proxy that never buffers the live feed.
{
  if [ -n "$EMAIL" ]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
  cat <<EOF
$DOMAIN {
	encode {
		gzip
		zstd
		match {
			header Content-Type text/html* text/css* application/javascript* application/json* application/wasm* image/svg+xml*
		}
	}
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:$PORT {
		flush_interval -1
	}
}
EOF
} > /etc/caddy/Caddyfile

# The operator's tool on this server: `kickswarm-admin decide …`, `kickswarm-admin audit …`, signed with the founder's key.
cat > /usr/local/bin/kickswarm-admin <<EOF
#!/bin/sh
exec sudo -u kickswarm env HOME=$VAR KICKSWARM_HOME=$VAR/home KICKSWARM_URL=http://127.0.0.1:$PORT $(command -v node) $CODE/dist/cli.js "\$@"
EOF
chmod 755 /usr/local/bin/kickswarm-admin

say "Daily backup (14 days kept in $BACKUPS)"
cat > /usr/local/bin/kickswarm-backup <<EOF
#!/bin/sh
# The registry is hash-chained: any copy can be checked with "kickswarm audit --file".
set -e
umask 077
f=$BACKUPS/kickswarm-\$(date +%Y%m%d-%H%M).tar.gz
tar -czf "\$f" -C $VAR data home domain
ls -1t $BACKUPS/kickswarm-*.tar.gz | tail -n +15 | xargs -r rm -f
# "kickswarm-backup --copy-to ubuntu": a copy in that user's home, to download with scp.
if [ "\${1:-}" = "--copy-to" ] && [ -n "\${2:-}" ]; then
  d="\$(getent passwd "\$2" | cut -d: -f6)/kickswarm-backup.tar.gz"
  cp "\$f" "\$d" && chown "\$2" "\$d" && chmod 600 "\$d" && echo "\$d"
else
  echo "\$f"
fi
EOF
chmod 755 /usr/local/bin/kickswarm-backup
cat > /etc/systemd/system/kickswarm-backup.service <<EOF
[Unit]
Description=Kickswarm backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/kickswarm-backup
EOF
cat > /etc/systemd/system/kickswarm-backup.timer <<EOF
[Unit]
Description=Kickswarm daily backup
[Timer]
OnCalendar=daily
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now kickswarm-backup.timer >/dev/null
systemctl enable kickswarm >/dev/null
systemctl restart kickswarm

say "Waiting for the self-check and the start (up to 5 minutes)"
ok=""
for _ in $(seq 1 150); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  if ! systemctl is-active --quiet kickswarm && [ "$(systemctl show -p NRestarts --value kickswarm)" -gt 2 ]; then break; fi
  sleep 2
done
if [ -z "$ok" ]; then
  journalctl -u kickswarm -n 40 --no-pager >&2 || true
  die "the coordinator did not start (its last lines are above)"
fi
journalctl -u kickswarm -n 30 --no-pager -o cat | grep -E "Self-check|Project|Founder|coordinator on" || true

systemctl enable caddy >/dev/null
systemctl restart caddy

say "Check from the outside: https://$DOMAIN"
seen=""
for _ in $(seq 1 45); do
  if curl -fsS --max-time 5 "https://$DOMAIN/v0/stats" >/dev/null 2>&1; then seen=1; break; fi
  sleep 4
done
if [ -n "$seen" ]; then
  for path in /join /bee /hive /v0/hives /v0/stats /kickswarm.tgz; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN$path")"
    printf '  %-16s %s\n' "$path" "$code"
  done
else
  cat >&2 <<EOF

The coordinator runs, but https://$DOMAIN cannot be reached from here yet. Usually:
  - Oracle Cloud: open ports 80 and 443 in the instance's subnet (docs/deploy.md, step 3);
  - a domain of your own: its DNS record must point to this server's address;
  - the certificate takes a minute: run this script again.
Caddy's last lines:
EOF
  journalctl -u caddy -n 15 --no-pager -o cat >&2 || true
fi

FOUNDER="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).id)' "$VAR/home/identite.json" 2>/dev/null || echo '?')"
cat <<EOF

────────────────────────────────────────────────────────────
  Kickswarm is online:  https://$DOMAIN
  Share this link:      https://$DOMAIN/join
  Founder identity:     $FOUNDER
                        (key in $VAR/home/identite.json: back it up somewhere safe)

  Logs:      journalctl -u kickswarm -f
  Approve:   kickswarm-admin decide approbation_ruche <hive> "reason"
  Backups:   $BACKUPS (daily); to download one: sudo kickswarm-backup --copy-to ubuntu
  Update:    run the same install command again
────────────────────────────────────────────────────────────
EOF
