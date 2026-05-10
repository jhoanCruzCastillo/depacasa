#!/bin/bash
# Script para detener PropScraper

echo "Deteniendo servicios PropScraper..."
docker-compose down

echo ""
echo "Servicios detenidos."
echo "Para eliminar volúmenes también, ejecuta:"
echo "  docker-compose down -v"
echo ""
