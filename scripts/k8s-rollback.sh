#!/bin/bash

# Скрипт для отката деплоя в Kubernetes

set -e

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

ENVIRONMENT="${ENVIRONMENT:-prod}"
NAMESPACE="road-monitor"

if [ "${ENVIRONMENT}" = "dev" ]; then
    NAMESPACE="road-monitor-dev"
fi

show_history() {
    log_info "История деплоев:"
    echo ""
    echo "Backend:"
    kubectl rollout history deployment/backend -n "${NAMESPACE}"
    echo ""
    echo "Frontend:"
    kubectl rollout history deployment/frontend -n "${NAMESPACE}"
}

rollback() {
    COMPONENT=$1
    REVISION=$2
    
    log_info "Откат ${COMPONENT}..."
    
    if [ -z "${REVISION}" ]; then
        kubectl rollout undo deployment/${COMPONENT} -n "${NAMESPACE}"
    else
        kubectl rollout undo deployment/${COMPONENT} -n "${NAMESPACE}" --to-revision="${REVISION}"
    fi
    
    log_info "Ожидание завершения отката..."
    kubectl rollout status deployment/${COMPONENT} -n "${NAMESPACE}"
    
    log_info "✓ Откат ${COMPONENT} завершен"
}

if [ "$1" = "--history" ]; then
    show_history
    exit 0
fi

if [ "$1" = "--help" ] || [ -z "$1" ]; then
    echo "Использование: $0 <component> [revision]"
    echo ""
    echo "Компоненты: backend, frontend, all"
    echo "Revision: номер ревизии (опционально, без указания откат на предыдущую)"
    echo ""
    echo "Опции:"
    echo "  --history    Показать историю деплоев"
    echo "  --help       Показать эту справку"
    echo ""
    echo "Примеры:"
    echo "  $0 backend           # Откатить backend на предыдущую версию"
    echo "  $0 frontend 3        # Откатить frontend на ревизию 3"
    echo "  $0 all               # Откатить всё"
    exit 0
fi

COMPONENT=$1
REVISION=$2

case ${COMPONENT} in
    backend|frontend)
        rollback ${COMPONENT} ${REVISION}
        ;;
    all)
        rollback backend ${REVISION}
        rollback frontend ${REVISION}
        ;;
    *)
        log_error "Неизвестный компонент: ${COMPONENT}"
        echo "Используйте: backend, frontend или all"
        exit 1
        ;;
esac

log_info "🎉 Откат завершен!"