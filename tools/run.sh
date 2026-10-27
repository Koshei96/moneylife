#!/usr/bin/env bash
# Проверка настроек входа Supabase (публичные данные: какие способы входа включены, открыта ли регистрация)
set -e
mkdir -p out
curl -sS "https://axypsnzhunhnapdvuecu.supabase.co/auth/v1/settings" -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4eXBzbnpodW5obmFwZHZ1ZWN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NDc3ODYsImV4cCI6MjEwODUyMzc4Nn0.YVBTyaKtDOH25X5J6udkZTHw-sMCaeKu0gtqm_X4vTk" > out/auth-settings.json
date -u +%FT%TZ > out/checked-at.txt
# проверка 2026-10-27T14:27:40Z
# CORS у курсов валют (нужно приложению для курса гривны)
curl -sSI -H 'Origin: https://koshei96.github.io' 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json' | tr -d '\r' > out/nbu-headers.txt || true
curl -sS 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json' > out/nbu.json || true
curl -sSI -H 'Origin: https://koshei96.github.io' 'https://api.monobank.ua/bank/currency' | tr -d '\r' > out/mono-headers.txt || true
