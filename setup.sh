#!/bin/bash
# Script de inicialización para PropScraper en Linux/macOS

echo "========================================"
echo "  PropScraper - Setup Inicial"
echo "========================================"
echo ""

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker no está instalado"
    exit 1
fi

echo "[1/4] Creando archivos de configuración..."
[ ! -f "backend/.env" ] && cp backend/.env.example backend/.env && echo "- backend/.env creado"
[ ! -f "frontend/.env" ] && cp frontend/.env.example frontend/.env && echo "- frontend/.env creado"

echo ""
echo "[2/4] Levantando servicios con Docker Compose..."
docker-compose up -d

echo ""
echo "[3/4] Esperando a que PostgreSQL esté listo..."
sleep 5

echo ""
echo "[4/4] Creando tablas de base de datos..."
docker-compose exec -T backend python -c "from database import Base, engine; Base.metadata.create_all(bind=engine)"

echo ""
echo "========================================"
echo "  PropScraper está listo!"
echo "========================================"
echo ""
echo "URLs:"
echo "- Frontend:  http://localhost:3000"
echo "- Backend:   http://localhost:8000"
echo "- API Docs:  http://localhost:8000/docs"
echo ""
echo "Comandos útiles:"
echo "  docker-compose logs -f backend     # Ver logs del backend"
echo "  docker-compose logs -f frontend    # Ver logs del frontend"
echo "  docker-compose down                # Detener servicios"
echo ""
