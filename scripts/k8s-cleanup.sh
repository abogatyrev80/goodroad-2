#!/bin/bash

# Скрипт для очистки ресурсов Kubernetes

set -e

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

ENVIRONMENT="${ENVIRONMENT:-prod}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
NAMESPACE="road-monitor"

if [ "${ENVIRONMENT}" = "dev" ]; then
    NAMESPACE="road-monitor-dev"
fi

if [ "$1" = "--help" ]; then
    echo "Использование: $0 [OPTIONS]"
    echo ""
    echo "Опции:"
    echo "  --keep-data      Сохранить PersistentVolumeClaims (данные MongoDB)"
    echo "  --environment ENV Окружение (dev/prod, по умолчанию: prod)"
    echo "  --help           Показать эту справку"
    echo ""
    echo "Примеры:"
    echo "  $0                      # Удалить всё включая данные"
    echo "  $0 --keep-data          # Удалить всё кроме данных"
    echo "  $0 -e dev --keep-data   # Удалить dev окружение, сохранить данные"
    exit 0
fi

KEEP_DATA=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-data)
            KEEP_DATA=true
            shift
            ;;
        --environment|-e)
            ENVIRONMENT="$2"
            NAMESPACE="road-monitor"
            if [ "${ENVIRONMENT}" = "dev" ]; then
                NAMESPACE="road-monitor-dev"
            fi
            shift 2
            ;;
        *)
            log_error "Неизвестная опция: $1"
            exit 1
            ;;
    esac
done

log_warn "═══════════════════════════════════════════"
log_warn "  ВНИМАНИЕ: Удаление ресурсов!"
log_warn "═══════════════════════════════════════════"
log_warn "Namespace: ${NAMESPACE}"
if [ "${KEEP_DATA}" = "true" ]; then
    log_info "Данные MongoDB будут сохранены"
else
    log_error "Данные MongoDB будут УДАЛЕНЫ!"
fi
log_warn "═══════════════════════════════════════════"
echo ""

read -p "Вы уверены? Введите 'yes' для подтверждения: " -r
echo
if [[ ! $REPLY =~ ^yes$ ]]; then
    log_info "Отменено"
    exit 0
fi

log_info "Удаление ресурсов..."

if [ "${KEEP_DATA}" = "true" ]; then
    # Удалить всё кроме PVC
    log_info "Удаление deployments, services, и т.д..."
    kubectl delete deployment,service,configmap,ingress,hpa -n "${NAMESPACE}" --all
else
    # Удалить всё включая namespace
    log_info "Удаление namespace ${NAMESPACE}..."
    kubectl delete namespace "${NAMESPACE}"
fi

log_info "✓ Ресурсы удалены"

if [ "${KEEP_DATA}" = "true" ]; then
    log_info "Сохраненные PVC:"
    kubectl get pvc -n "${NAMESPACE}"
fi