#!/usr/bin/env bash
# Какую служебную задачу запускать — правится перед пушем
set -e
python3 tools/build_coins.py
# проверка: отдаёт ли сервер картинок CoinGecko заголовок CORS (нужно для кэша без «непрозрачных» ответов)
curl -sI -H 'Origin: https://koshei96.github.io' 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png' | tr -d '\r' > out/img-headers.txt || true
