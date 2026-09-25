#!/bin/bash
set -euo pipefail
umask 077
# Arguments are non-secret configuration from the dedicated stack outputs.
release_bucket=$1
release_key=$2
release_digest=$3
host_domain=$4
model_secret_arn=$5
provision_role=$6
boundary_arn=$7
region=$8
account=$9
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq caddy python3 curl xz-utils unzip
if ! command -v aws >/dev/null; then
  aws_dir=$(mktemp -d)
  curl -fsS https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o "$aws_dir/aws.zip"
  unzip -q "$aws_dir/aws.zip" -d "$aws_dir"
  "$aws_dir/aws/install"
  rm -rf "$aws_dir"
fi
chmod -R a+rX /usr/local/aws-cli
if ! /usr/local/bin/node --version 2>/dev/null | grep -q '^v22\.'; then
  node_dir=$(mktemp -d)
  curl -fsS https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$node_dir/SHASUMS256.txt"
  node_archive=$(awk '$2 ~ /linux-arm64.tar.xz$/ {print $2}' "$node_dir/SHASUMS256.txt")
  test -n "$node_archive"
  curl -fsS "https://nodejs.org/dist/latest-v22.x/$node_archive" -o "$node_dir/$node_archive"
  (cd "$node_dir" && grep " $node_archive\$" SHASUMS256.txt | sha256sum --check)
  tar -xJf "$node_dir/$node_archive" -C /usr/local --strip-components=1
  rm -rf "$node_dir"
fi
id launchlab >/dev/null 2>&1 || useradd --system --home /var/lib/launchlab --create-home --shell /usr/sbin/nologin launchlab
install -d -m 700 -o launchlab -g launchlab /var/lib/launchlab
install -d -m 755 /opt/launchlab/releases
install -d -m 700 /etc/launchlab
release_dir="/opt/launchlab/releases/$release_digest"
if [ ! -f "$release_dir/.installed" ]; then
  install -d -m 755 "$release_dir"
  aws s3 cp "s3://$release_bucket/$release_key" /tmp/launchlab-release.tar.gz --region "$region" --only-show-errors
  printf '%s  %s\n' "$release_digest" /tmp/launchlab-release.tar.gz | sha256sum --check
  tar -xzf /tmp/launchlab-release.tar.gz -C "$release_dir"
  (cd "$release_dir" && /usr/local/bin/npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
  touch "$release_dir/.installed"
  chmod -R a+rX "$release_dir"
  rm /tmp/launchlab-release.tar.gz
fi
cat > /etc/launchlab/hosting.json <<EOF
{"credentialSource":"instance-role","region":"$region","account":"$account","maxActiveDeployments":3,"resourcePrefix":"llh","cloudFormationRoleArn":"$provision_role","roleBoundaryArn":"$boundary_arn"}
EOF
chown launchlab:launchlab /etc/launchlab/hosting.json
chmod 755 /etc/launchlab
cat > /etc/launchlab/service.env <<EOF
LAUNCHLAB_HOSTED_DATA=/var/lib/launchlab
LAUNCHLAB_MANAGED_CONFIG=/etc/launchlab/hosting.json
LAUNCHLAB_HOSTED_PORT=4314
AWS_REGION=$region
LAUNCHLAB_MODEL_SECRET_ARN=$model_secret_arn
LAUNCHLAB_BACKUP_BUCKET=$release_bucket
EOF
cat > /etc/systemd/system/launchlab-api.service <<'EOF'
[Unit]
Description=LaunchLab authenticated workflow API
After=network-online.target
Wants=network-online.target
[Service]
User=launchlab
Group=launchlab
WorkingDirectory=/opt/launchlab/current
EnvironmentFile=/etc/launchlab/service.env
ExecStart=/usr/local/bin/node src/hosted/server.mjs
Restart=always
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/launchlab
IPAddressDeny=169.254.169.254
MemoryMax=384M
TasksMax=64
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/launchlab-worker.service <<'EOF'
[Unit]
Description=LaunchLab durable workflow worker
After=network-online.target
Wants=network-online.target
[Service]
User=launchlab
Group=launchlab
WorkingDirectory=/opt/launchlab/current
EnvironmentFile=/etc/launchlab/service.env
ExecStart=/usr/bin/flock --no-fork -n /var/lib/launchlab/worker.flock /usr/local/bin/node scripts/hosted-worker.mjs
Restart=always
RestartSec=5
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/launchlab
MemoryMax=1024M
TasksMax=128
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/caddy/Caddyfile <<EOF
$host_domain {
  request_body {
    max_size 16KB
  }
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options nosniff
    Referrer-Policy no-referrer
    -Server
  }
  reverse_proxy 127.0.0.1:4314
}
EOF
# Do not enable HTTP access logs: bearer headers and private response contents
# must never be written to access logs. Caddy's operational logs remain enabled.
systemctl stop launchlab-api launchlab-worker 2>/dev/null || true
ln -sfn "$release_dir" /opt/launchlab/current
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable launchlab-api launchlab-worker caddy >/dev/null
systemctl restart launchlab-api launchlab-worker caddy
echo 'LaunchLab release installed. Verify HTTPS health and authenticated workflows.'
