#!/bin/sh
set -e
cd /app

if [ ! -f .env ]; then
  cp .env.example .env
fi

npm install
exec npm run dev
