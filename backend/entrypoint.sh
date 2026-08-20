#!/bin/sh
set -eu

python /app/scripts/prepare_db.py
exec "$@"
