#!/usr/bin/env bash
# Install, switch on, or remove the sat-celery-beat watchdog. Run as root on the app host.
#
#   bash deploy/watchdog/install.sh             # install in DRY-RUN: decides and logs, never restarts or alerts
#   bash deploy/watchdog/install.sh --live      # let it restart beat and alert
#   bash deploy/watchdog/install.sh --uninstall # stop it; keeps /var/lib/sat-beat-watchdog (state + incidents)
#
# Touches only: /usr/local/sbin/sat-beat-watchdog, /etc/systemd/system/sat-beat-watchdog.{service,timer}
# (+ .service.d/10-dry-run.conf) and /var/log/sat-beat-watchdog.log. No PM2 process is restarted by
# installing it; the first check runs at the next :30.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR=/etc/systemd/system
DROPIN_DIR="$UNIT_DIR/sat-beat-watchdog.service.d"
ALERT_CMD=/var/www/satapp/current/backend/assessments/management/commands/celery_beat_watchdog_alert.py

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

case "${1:-}" in
  --uninstall)
    systemctl disable --now sat-beat-watchdog.timer 2>/dev/null || true
    rm -f "$UNIT_DIR/sat-beat-watchdog.service" "$UNIT_DIR/sat-beat-watchdog.timer" /usr/local/sbin/sat-beat-watchdog
    rm -rf "$DROPIN_DIR"
    systemctl daemon-reload
    echo "removed; state and incidents kept in /var/lib/sat-beat-watchdog"
    exit 0
    ;;
  --live|"") ;;
  *) echo "usage: $0 [--live|--uninstall]" >&2; exit 2 ;;
esac

python3 -I -m py_compile "$HERE/sat_beat_watchdog.py"
install -o root -g root -m 0755 "$HERE/sat_beat_watchdog.py" /usr/local/sbin/sat-beat-watchdog
install -o root -g root -m 0644 "$HERE/sat-beat-watchdog.service" "$HERE/sat-beat-watchdog.timer" "$UNIT_DIR/"
install -d -o root -g root -m 0755 "$DROPIN_DIR"
touch /var/log/sat-beat-watchdog.log && chmod 0640 /var/log/sat-beat-watchdog.log

if [[ "${1:-}" == "--live" ]]; then
  # Live mode alerts through the release's manage.py; refuse if the live release cannot.
  [[ -f "$ALERT_CMD" ]] || { echo "live release has no celery_beat_watchdog_alert command; deploy it first" >&2; exit 1; }
  rm -f "$DROPIN_DIR/10-dry-run.conf"
  mode=LIVE
else
  printf '[Service]\nEnvironment=SAT_BEAT_WD_DRY_RUN=1\n' > "$DROPIN_DIR/10-dry-run.conf"
  mode=DRY-RUN
fi

systemctl daemon-reload
systemctl enable --now sat-beat-watchdog.timer
systemctl start sat-beat-watchdog.service   # one check now, so the journal shows it working
journalctl -u sat-beat-watchdog.service -n 3 --no-pager -o cat
echo "sat-beat-watchdog installed ($mode); next: systemctl list-timers sat-beat-watchdog.timer"
