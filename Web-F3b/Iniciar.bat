@echo off
rem COPIA "Web-F3b" (versao de 27/09/2026: motor em C++ ate a F3b, antes do medidor e do Capacitor).
rem Clique duas vezes para ligar o servidor e abrir no navegador: http://localhost:8082
rem (a versao principal fica na 8080 e a copia Webaudio na 8081).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1" -Porta 8082 -Abrir
pause
