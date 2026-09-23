@echo off
rem Clique duas vezes neste arquivo para ligar o servidor e abrir o app no navegador.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1" -Abrir
pause
