#!/bin/sh
set -e

echo "Building Osprey UI for production..."
npm run build

echo "Serving from /app/build on port 5002..."
npx serve -s build -l 5002
