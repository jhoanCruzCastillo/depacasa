@echo off
REM Script de inicialización para PropScraper en Windows

echo ========================================
echo  PropScraper - Setup Inicial
echo ========================================
echo.

REM Verificar Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker no está instalado o no está en el PATH
    exit /b 1
)

echo [1/4] Creando directorio de datos...
if not exist "backend\.env" (
    copy backend\.env.example backend\.env
    echo - backend\.env creado
)

if not exist "frontend\.env" (
    copy frontend\.env.example frontend\.env
    echo - frontend\.env creado
)

echo.
echo [2/4] Levantando servicios con Docker Compose...
docker-compose up -d

echo.
echo [3/4] Esperando a que PostgreSQL esté listo...
timeout /t 5 /nobreak

echo.
echo [4/4] Creando tablas de base de datos...
REM Esto se ejecutaría después que el backend esté listo
docker-compose exec -T backend python -c "from database import Base, engine; Base.metadata.create_all(bind=engine)"

echo.
echo ========================================
echo  PropScraper está listo!
echo ========================================
echo.
echo URLs:
echo - Frontend:  http://localhost:3000
echo - Backend:   http://localhost:8000
echo - API Docs:  http://localhost:8000/docs
echo.
echo Comandos útiles:
echo   docker-compose logs -f backend     # Ver logs del backend
echo   docker-compose logs -f frontend    # Ver logs del frontend
echo   docker-compose down                # Detener servicios
echo.
pause
