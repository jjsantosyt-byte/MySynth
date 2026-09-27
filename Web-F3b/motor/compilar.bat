@echo off
rem Compila o motor em C++ (motor.cpp) para WebAssembly (motor.wasm).
rem Precisa do wasi-sdk em %USERPROFILE%\ferramentas\wasi-sdk-34.0-x86_64-windows
rem (so quem mexe no C++ precisa; o motor.wasm pronto vai junto no Git).
rem
rem Opcoes:
rem   -O3             contas o mais rapido possivel
rem   -msimd128       permite calcular 4 numeros de uma vez (SIMD)
rem   -nostartfiles   sem "programa principal": e uma biblioteca de funcoes
rem   --no-entry      idem, para o ligador
rem   -fno-exceptions -fno-rtti   sem recursos de C++ que pesam e nao usamos

setlocal
set SDK=%USERPROFILE%\ferramentas\wasi-sdk-34.0-x86_64-windows
cd /d "%~dp0"

"%SDK%\bin\clang++.exe" --target=wasm32-wasip1 --sysroot="%SDK%\share\wasi-sysroot" ^
  -O3 -msimd128 -std=c++20 -fno-exceptions -fno-rtti ^
  -nostartfiles -Wl,--no-entry -Wl,--export-dynamic -Wl,--strip-all ^
  -o motor.wasm motor.cpp

if errorlevel 1 (
  echo ERRO ao compilar o motor.
  exit /b 1
)
echo motor.wasm pronto.
