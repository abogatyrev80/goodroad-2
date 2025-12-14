#!/bin/bash

# Скрипт для деплоя Road Monitor в Kubernetes

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Конфигурация
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
REGISTRY="${DOCKER_REGISTRY:-docker.io/yourusername}"
VERSION="${VERSION:-v1.0.0}"
ENVIRONMENT="${ENVIRONMENT:-prod}"

# Функции
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Проверка зависимостей
check_dependencies() {
    log_info "Проверка зависимостей..."
    
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl не найден. Установите kubectl."
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "docker не найден. Установите Docker."
        exit 1
    fi
    
    log_info "✓ Все зависимости установлены"
}

# Сборка Docker образов
build_images() {
    log_info "Сборка Docker образов..."
    
    # Backend
    log_info "Сборка backend..."
    docker build -t "${REGISTRY}/road-monitor-backend:${VERSION}" "${PROJECT_ROOT}/backend"
    
    # Frontend
    log_info "Сборка frontend..."
    docker build -t "${REGISTRY}/road-monitor-frontend:${VERSION}" "${PROJECT_ROOT}/frontend"
    
    log_info "✓ Образы собраны"
}

# Push образов в registry
push_images() {
    log_info "Push образов в registry..."
    
    docker push "${REGISTRY}/road-monitor-backend:${VERSION}"
    docker push "${REGISTRY}/road-monitor-frontend:${VERSION}"
    
    log_info "✓ Образы загружены в registry"
}

# Обновление манифестов
update_manifests() {
    log_info "Обновление манифестов..."
    
    # Создать временную копию kustomization.yaml
    KUSTOMIZE_FILE="${PROJECT_ROOT}/k8s/overlays/${ENVIRONMENT}/kustomization.yaml"
    
    if [ ! -f "${KUSTOMIZE_FILE}" ]; then
        log_error "Файл ${KUSTOMIZE_FILE} не найден"
        exit 1
    fi
    
    # Обновить образы в kustomization.yaml
    sed -i.bak "s|newName:.*road-monitor-backend.*|newName: ${REGISTRY}/road-monitor-backend|g" "${KUSTOMIZE_FILE}"
    sed -i.bak "s|newTag:.*# backend|newTag: ${VERSION} # backend|g" "${KUSTOMIZE_FILE}"
    sed -i.bak "s|newName:.*road-monitor-frontend.*|newName: ${REGISTRY}/road-monitor-frontend|g" "${KUSTOMIZE_FILE}"
    sed -i.bak "s|newTag:.*# frontend|newTag: ${VERSION} # frontend|g" "${KUSTOMIZE_FILE}"
    
    log_info "✓ Манифесты обновлены"
}

# Деплой в Kubernetes
deploy_to_k8s() {
    log_info "Деплой в Kubernetes (${ENVIRONMENT})..."
    
    # Применить манифесты
    kubectl apply -k "${PROJECT_ROOT}/k8s/overlays/${ENVIRONMENT}"
    
    log_info "✓ Манифесты применены"
    
    # Ждать готовности deployment'ов
    log_info "Ожидание готовности deployments..."
    
    NAMESPACE="road-monitor"
    if [ "${ENVIRONMENT}" = "dev" ]; then
        NAMESPACE="road-monitor-dev"
    fi
    
    kubectl wait --for=condition=available --timeout=300s \
        deployment/backend -n "${NAMESPACE}" || true
    kubectl wait --for=condition=available --timeout=300s \
        deployment/frontend -n "${NAMESPACE}" || true
    
    log_info "✓ Деплой завершен"
}

# Показать статус
show_status() {
    NAMESPACE="road-monitor"
    if [ "${ENVIRONMENT}" = "dev" ]; then
        NAMESPACE="road-monitor-dev"
    fi
    
    log_info "Статус приложения:"
    echo ""
    kubectl get all -n "${NAMESPACE}"
    echo ""
    log_info "Ingress:"
    kubectl get ingress -n "${NAMESPACE}"
}

# Главная функция
main() {
    echo "═══════════════════════════════════════════"
    echo "  Road Monitor - Kubernetes Deployment"
    echo "═══════════════════════════════════════════"
    echo "Registry: ${REGISTRY}"
    echo "Version:  ${VERSION}"
    echo "Environment: ${ENVIRONMENT}"
    echo "═══════════════════════════════════════════"
    echo ""
    
    check_dependencies
    
    # Опции
    BUILD=${BUILD:-true}
    PUSH=${PUSH:-true}
    DEPLOY=${DEPLOY:-true}
    
    if [ "${BUILD}" = "true" ]; then
        build_images
    fi
    
    if [ "${PUSH}" = "true" ]; then
        push_images
    fi
    
    if [ "${DEPLOY}" = "true" ]; then
        update_manifests
        deploy_to_k8s
        show_status
    fi
    
    log_info "🎉 Готово!"
}

# Обработка аргументов
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build)
            BUILD=false
            shift
            ;;
        --skip-push)
            PUSH=false
            shift
            ;;
        --skip-deploy)
            DEPLOY=false
            shift
            ;;
        --environment|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --version|-v)
            VERSION="$2"
            shift 2
            ;;
        --registry|-r)
            REGISTRY="$2"
            shift 2
            ;;
        --help|-h)
            echo "Использование: $0 [OPTIONS]"
            echo ""
            echo "Опции:"
            echo "  --skip-build          Пропустить сборку образов"
            echo "  --skip-push           Пропустить push в registry"
            echo "  --skip-deploy         Пропустить деплой в k8s"
            echo "  -e, --environment ENV Окружение (dev/prod, по умолчанию: prod)"
            echo "  -v, --version VER     Версия (по умолчанию: v1.0.0)"
            echo "  -r, --registry REG    Docker registry (по умолчанию: docker.io/yourusername)"
            echo "  -h, --help            Показать эту справку"
            echo ""
            echo "Примеры:"
            echo "  $0                                    # Полный деплой в prod"
            echo "  $0 -e dev                             # Деплой в dev"
            echo "  $0 -v v1.2.0 -r gcr.io/myproject      # Указать версию и registry"
            echo "  $0 --skip-build --skip-push           # Только деплой (образы уже есть)"
            exit 0
            ;;
        *)
            log_error "Неизвестная опция: $1"
            echo "Используйте --help для справки"
            exit 1
            ;;
    esac
done

main