#!/bin/sh
set -eu

APP_USER="readlater"
APP_GROUP="readlater"
APP_HOME="/home/${APP_USER}"

PUID_VALUE="${PUID:-}"
PGID_VALUE="${PGID:-}"

mkdir -p /data /books

if [ -n "$PUID_VALUE" ] || [ -n "$PGID_VALUE" ]; then
  : "${PUID_VALUE:=1000}"
  : "${PGID_VALUE:=1000}"

  if getent group "$APP_GROUP" >/dev/null 2>&1; then
    CURRENT_GID="$(getent group "$APP_GROUP" | cut -d: -f3)"
    if [ "$CURRENT_GID" != "$PGID_VALUE" ]; then
      groupmod -g "$PGID_VALUE" "$APP_GROUP"
    fi
  elif getent group "$PGID_VALUE" >/dev/null 2>&1; then
    EXISTING_GROUP="$(getent group "$PGID_VALUE" | cut -d: -f1)"
    APP_GROUP="$EXISTING_GROUP"
  else
    groupadd -g "$PGID_VALUE" "$APP_GROUP"
  fi

  if id -u "$APP_USER" >/dev/null 2>&1; then
    CURRENT_UID="$(id -u "$APP_USER")"
    CURRENT_GID="$(id -g "$APP_USER")"
    if [ "$CURRENT_UID" != "$PUID_VALUE" ] || [ "$CURRENT_GID" != "$PGID_VALUE" ]; then
      usermod -u "$PUID_VALUE" -g "$PGID_VALUE" "$APP_USER"
    fi
  elif getent passwd "$PUID_VALUE" >/dev/null 2>&1; then
    EXISTING_USER="$(getent passwd "$PUID_VALUE" | cut -d: -f1)"
    APP_USER="$EXISTING_USER"
  else
    useradd -m -d "$APP_HOME" -s /bin/sh -u "$PUID_VALUE" -g "$PGID_VALUE" "$APP_USER"
  fi

  APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
  mkdir -p "$APP_HOME"
  mkdir -p /data /books "$APP_HOME/.cache" "$APP_HOME/tmp" /tmp/bun-cache
  chown -R "$PUID_VALUE:$PGID_VALUE" /data /books "$APP_HOME" /tmp/bun-cache

  export HOME="$APP_HOME"
  export TMPDIR="${TMPDIR:-$APP_HOME/tmp}"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$APP_HOME/.cache}"
  export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-/tmp/bun-cache}"

  mkdir -p "$TMPDIR" "$XDG_CACHE_HOME" "$BUN_INSTALL_CACHE_DIR"
  chown -R "$PUID_VALUE:$PGID_VALUE" "$TMPDIR" "$XDG_CACHE_HOME" "$BUN_INSTALL_CACHE_DIR"

  exec gosu "$APP_USER:$APP_GROUP" "$@"
fi

exec "$@"
