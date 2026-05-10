@echo off
REM Script para ver logs en tiempo real

if "%1"=="" (
    echo Uso: logs.bat [servicio]
    echo.
    echo Servicios disponibles:
    echo   - backend
    echo   - frontend
    echo   - db
    echo   - redis
    echo   - celery
    echo   - all
    echo.
    exit /b 1
)

if "%1"=="all" (
    docker-compose logs -f
) else (
    docker-compose logs -f %1
)
