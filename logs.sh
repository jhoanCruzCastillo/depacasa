#!/bin/bash
# Script para ver logs en tiempo real

if [ -z "$1" ]; then
    echo "Uso: ./logs.sh [servicio]"
    echo ""
    echo "Servicios disponibles:"
    echo "  - backend"
    echo "  - frontend"
    echo "  - db"
    echo "  - redis"
    echo "  - celery"
    echo "  - all"
    echo ""
    exit 1
fi

if [ "$1" = "all" ]; then
    docker-compose logs -f
else
    docker-compose logs -f $1
fi
