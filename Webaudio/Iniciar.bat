@echo off
rem COPIA "Webaudio" (som todo em JavaScript, para comparar com a versao em C++).
rem Clique duas vezes para ligar o servidor e abrir no navegador: http://localhost:8081
rem (a versao principal, do Iniciar.bat da pasta MySynth, fica na 8080).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1" -Porta 8081 -Abrir
pause
