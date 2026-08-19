@echo off
setlocal
title Validacion Gestion Almacen Web
echo ==========================================
echo  GESTION ALMACEN WEB - VALIDACION FINAL
echo ==========================================
echo.
where node >nul 2>&1 || (
  echo ERROR: Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 1
)
where npm >nul 2>&1 || (
  echo ERROR: npm no esta disponible.
  pause
  exit /b 1
)
echo [1/3] Instalando dependencias...
call npm install
if errorlevel 1 goto :error
echo.
echo [2/3] Ejecutando pruebas...
call npm test
if errorlevel 1 goto :error
echo.
echo [3/3] Generando build de produccion...
call npm run build
if errorlevel 1 goto :error
echo.
echo ==========================================
echo  VALIDACION AUTOMATICA COMPLETADA
echo ==========================================
echo Build generado en: dist\
echo Ahora ejecuta: npm run preview
echo y completa CHECKLIST_FINAL.md
pause
exit /b 0

:error
echo.
echo ==========================================
echo  LA VALIDACION SE DETUVO POR UN ERROR
echo ==========================================
echo Copia el error mostrado arriba si necesitas revisarlo.
pause
exit /b 1
