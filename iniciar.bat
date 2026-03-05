@echo off
title Gerador de Curriculo - IA
color 0A
cd /d "%~dp0"

echo.
echo  ========================================
echo    Gerador de Curriculo com IA
echo  ========================================
echo.

echo  Verificando dependencias...
call npm install --silent
echo.

echo  Iniciando servidor...
start "" /B node server.js
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000/abrir-app.html"

echo  Servidor rodando! Nao feche esta janela.
echo.
node server.js

echo.
echo  O servidor parou.
pause
