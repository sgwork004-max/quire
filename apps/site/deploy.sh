#!/bin/sh
# Publishes the website to https://getquire.pages.dev, with the install
# scripts from ../../scripts served at /install.sh and /install.ps1.
set -eu
cd "$(dirname "$0")"
cp ../../scripts/install.sh ../../scripts/install.ps1 .
npx wrangler pages deploy . --project-name getquire --branch main --commit-dirty=true
