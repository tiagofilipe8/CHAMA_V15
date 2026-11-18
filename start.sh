#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f ".env" ]; then
  echo "[AVISO] Arquivo .env nao encontrado. Criando a partir do exemplo..."
  cp ".env.example" ".env"
fi

if [ ! -d "node_modules" ]; then
  echo "[AVISO] Instalando dependencias..."
  npm install
fi

echo ""
echo "=== Inicializando banco de dados (tabelas + usuario admin) ==="
npm run init

echo ""
echo "=== Iniciando o servidor ==="
npm start