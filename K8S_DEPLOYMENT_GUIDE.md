# ☸️ Kubernetes Deployment Guide - Road Monitor System

## 📋 Требования

### Минимальные требования кластера:
- **Kubernetes**: 1.24+
- **kubectl**: установлен и настроен
- **Узлы**: минимум 3 worker nodes
- **CPU**: минимум 4 cores доступно
- **RAM**: минимум 8GB доступно
- **Storage**: 20GB+ (для PersistentVolumes)

### Дополнительные компоненты (рекомендуется):
- **NGINX Ingress Controller**
- **cert-manager** (для SSL сертификатов)
- **Metrics Server** (для HPA)
- **Kustomize** v4+ (встроен в kubectl 1.14+)

## 🏗️ Структура проекта

```
k8s/
├── base/                           # Базовые манифесты
│   ├── namespace.yaml              # Namespace road-monitor
│   ├── mongodb-pvc.yaml            # PersistentVolumeClaim для MongoDB
│   ├── mongodb-deployment.yaml     # Deployment MongoDB
│   ├── mongodb-service.yaml        # Service MongoDB
│   ├── backend-configmap.yaml      # ConfigMap для backend
│   ├── backend-deployment.yaml     # Deployment backend
│   ├── backend-service.yaml        # Service backend
│   ├── backend-hpa.yaml            # HorizontalPodAutoscaler backend
│   ├── frontend-configmap.yaml     # ConfigMap для frontend
│   ├── frontend-deployment.yaml    # Deployment frontend
│   ├── frontend-service.yaml       # Service frontend
│   ├── frontend-hpa.yaml           # HorizontalPodAutoscaler frontend
│   ├── ingress.yaml                # Ingress для внешнего доступа
│   └── kustomization.yaml          # Kustomize config
└── overlays/
    ├── dev/                        # Development окружение
    │   ├── kustomization.yaml
    │   ├── backend-patch.yaml
    │   └── frontend-patch.yaml
    └── prod/                       # Production окружение
        ├── kustomization.yaml
        └── mongodb-patch.yaml
```

## 🚀 Быстрый старт

### Шаг 1: Подготовка образов Docker

```bash
# Собрать образы
cd /app
docker build -t road-monitor-backend:v1.0.0 ./backend
docker build -t road-monitor-frontend:v1.0.0 ./frontend

# Пометить и запушить в registry (замените на ваш registry)
docker tag road-monitor-backend:v1.0.0 your-registry/road-monitor-backend:v1.0.0
docker tag road-monitor-frontend:v1.0.0 your-registry/road-monitor-frontend:v1.0.0

docker push your-registry/road-monitor-backend:v1.0.0
docker push your-registry/road-monitor-frontend:v1.0.0
```

### Шаг 2: Настройка манифестов

Отредактируйте файлы конфигурации под ваше окружение:

**Ingress** (`k8s/base/ingress.yaml`):
```yaml
spec:
  tls:
  - hosts:
    - your-domain.com        # ← Замените
    - api.your-domain.com    # ← Замените
```

**Образы** (`k8s/overlays/prod/kustomization.yaml`):
```yaml
images:
  - name: road-monitor-backend
    newName: your-registry/road-monitor-backend  # ← Замените
    newTag: v1.0.0
  - name: road-monitor-frontend
    newName: your-registry/road-monitor-frontend # ← Замените
    newTag: v1.0.0
```

### Шаг 3: Деплой

#### Вариант A: Production деплой

```bash
# Применить все манифесты
kubectl apply -k k8s/overlays/prod

# Проверить статус
kubectl get all -n road-monitor
```

#### Вариант B: Development деплой

```bash
# Применить dev конфигурацию
kubectl apply -k k8s/overlays/dev

# Проверить статус
kubectl get all -n road-monitor-dev
```

#### Вариант C: Базовая конфигурация

```bash
# Применить базовые манифесты
kubectl apply -k k8s/base

# Проверить статус
kubectl get all -n road-monitor
```

### Шаг 4: Проверка деплоя

```bash
# Проверить поды
kubectl get pods -n road-monitor

# Проверить сервисы
kubectl get svc -n road-monitor

# Проверить ingress
kubectl get ingress -n road-monitor

# Логи backend
kubectl logs -f -n road-monitor -l app=backend

# Логи frontend
kubectl logs -f -n road-monitor -l app=frontend

# Логи mongodb
kubectl logs -f -n road-monitor -l app=mongodb
```

## 🔧 Детальная настройка

### 1. Установка NGINX Ingress Controller

Если еще не установлен:

```bash
# Helm
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install nginx-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace

# Или через манифест
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml
```

### 2. Установка cert-manager (для SSL)

```bash
# Установить cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Создать ClusterIssuer для Let's Encrypt
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

### 3. Установка Metrics Server (для HPA)

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### 4. Настройка PersistentVolume

Если ваш кластер не поддерживает динамическое provisioning:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolume
metadata:
  name: mongodb-pv
  labels:
    type: local
spec:
  storageClassName: standard
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  hostPath:
    path: "/mnt/data/mongodb"
EOF
```

## 📊 Масштабирование

### Horizontal Pod Autoscaler (HPA)

HPA уже настроен для backend и frontend:

**Backend HPA:**
- Min replicas: 2
- Max replicas: 10
- CPU threshold: 70%
- Memory threshold: 80%

**Frontend HPA:**
- Min replicas: 2
- Max replicas: 5
- CPU threshold: 70%
- Memory threshold: 80%

### Ручное масштабирование

```bash
# Масштабировать backend
kubectl scale deployment backend -n road-monitor --replicas=5

# Масштабировать frontend
kubectl scale deployment frontend -n road-monitor --replicas=3
```

### Проверка автомасштабирования

```bash
# Статус HPA
kubectl get hpa -n road-monitor

# Детали HPA
kubectl describe hpa backend-hpa -n road-monitor
```

## 🔄 Обновление приложения

### Rolling Update

```bash
# Обновить образ backend
kubectl set image deployment/backend backend=your-registry/road-monitor-backend:v1.1.0 -n road-monitor

# Обновить образ frontend
kubectl set image deployment/frontend frontend=your-registry/road-monitor-frontend:v1.1.0 -n road-monitor

# Проверить статус rollout
kubectl rollout status deployment/backend -n road-monitor
kubectl rollout status deployment/frontend -n road-monitor
```

### Откат (Rollback)

```bash
# Откатить backend
kubectl rollout undo deployment/backend -n road-monitor

# Откатить frontend
kubectl rollout undo deployment/frontend -n road-monitor

# Откатить на конкретную ревизию
kubectl rollout undo deployment/backend -n road-monitor --to-revision=2
```

### История деплоев

```bash
# Посмотреть историю
kubectl rollout history deployment/backend -n road-monitor

# Детали ревизии
kubectl rollout history deployment/backend -n road-monitor --revision=3
```

## 🔐 Secrets Management

Создайте секреты для чувствительных данных:

```bash
# Создать secret для MongoDB (если требуется аутентификация)
kubectl create secret generic mongodb-secret \
  -n road-monitor \
  --from-literal=username=admin \
  --from-literal=password=your-secure-password

# Создать secret для backend API keys (если нужно)
kubectl create secret generic backend-secrets \
  -n road-monitor \
  --from-literal=api-key=your-api-key
```

Затем обновите deployment для использования секретов:

```yaml
env:
- name: MONGO_USERNAME
  valueFrom:
    secretKeyRef:
      name: mongodb-secret
      key: username
```

## 🗄️ Backup и Restore MongoDB

### Создание backup

```bash
# Получить имя пода MongoDB
MONGO_POD=$(kubectl get pod -n road-monitor -l app=mongodb -o jsonpath="{.items[0].metadata.name}")

# Создать backup
kubectl exec -n road-monitor $MONGO_POD -- mongodump --out /tmp/backup

# Скопировать backup на локальную машину
kubectl cp road-monitor/$MONGO_POD:/tmp/backup ./mongodb-backup-$(date +%Y%m%d-%H%M%S)
```

### Восстановление из backup

```bash
# Скопировать backup в pod
kubectl cp ./mongodb-backup-20240101-120000 road-monitor/$MONGO_POD:/tmp/backup

# Восстановить
kubectl exec -n road-monitor $MONGO_POD -- mongorestore /tmp/backup
```

### Автоматический backup (CronJob)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mongodb-backup
  namespace: road-monitor
spec:
  schedule: "0 2 * * *"  # Каждый день в 2:00
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: mongo:7.0
            command:
            - /bin/sh
            - -c
            - mongodump --host=mongodb --out=/backup/$(date +%Y%m%d-%H%M%S)
            volumeMounts:
            - name: backup
              mountPath: /backup
          volumes:
          - name: backup
            persistentVolumeClaim:
              claimName: mongodb-backup-pvc
          restartPolicy: OnFailure
```

## 📈 Мониторинг

### Prometheus + Grafana (опционально)

```bash
# Установить Prometheus Stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace

# Настроить ServiceMonitor для мониторинга приложений
cat <<EOF | kubectl apply -f -
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: backend-monitor
  namespace: road-monitor
spec:
  selector:
    matchLabels:
      app: backend
  endpoints:
  - port: http
    path: /metrics
EOF
```

### Базовый мониторинг

```bash
# Использование ресурсов
kubectl top nodes
kubectl top pods -n road-monitor

# События
kubectl get events -n road-monitor --sort-by='.lastTimestamp'

# Логи всех подов
kubectl logs -n road-monitor --all-containers=true --tail=100
```

## 🐛 Troubleshooting

### Поды не запускаются

```bash
# Проверить статус подов
kubectl get pods -n road-monitor

# Описание пода (показывает ошибки)
kubectl describe pod <pod-name> -n road-monitor

# Логи пода
kubectl logs <pod-name> -n road-monitor

# Логи предыдущего контейнера (если pod перезапускался)
kubectl logs <pod-name> -n road-monitor --previous
```

### Проблемы с MongoDB

```bash
# Проверить PVC
kubectl get pvc -n road-monitor

# Проверить доступность MongoDB
MONGO_POD=$(kubectl get pod -n road-monitor -l app=mongodb -o jsonpath="{.items[0].metadata.name}")
kubectl exec -n road-monitor $MONGO_POD -- mongosh --eval "db.adminCommand('ping')"
```

### Проблемы с Ingress

```bash
# Проверить ingress
kubectl get ingress -n road-monitor
kubectl describe ingress road-monitor-ingress -n road-monitor

# Проверить NGINX Ingress Controller
kubectl get pods -n ingress-nginx
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller
```

### Проблемы с HPA

```bash
# Проверить metrics server
kubectl get apiservices | grep metrics

# Проверить метрики
kubectl top pods -n road-monitor

# Детали HPA
kubectl describe hpa -n road-monitor
```

## 🧹 Очистка

### Удалить приложение

```bash
# Удалить все ресурсы production
kubectl delete -k k8s/overlays/prod

# Или удалить namespace (удалит всё внутри)
kubectl delete namespace road-monitor

# Удалить PersistentVolume (если создавали вручную)
kubectl delete pv mongodb-pv
```

### Удалить только приложение, но сохранить данные

```bash
# Удалить deployments и services
kubectl delete deployment,service -n road-monitor --all

# PVC и данные останутся
kubectl get pvc -n road-monitor
```

## 📝 Полезные команды

```bash
# Войти в pod
kubectl exec -it <pod-name> -n road-monitor -- /bin/bash

# Port forward для локального доступа
kubectl port-forward -n road-monitor svc/backend 8001:8001
kubectl port-forward -n road-monitor svc/frontend 3000:3000

# Копировать файлы
kubectl cp <local-file> road-monitor/<pod-name>:/path/to/file
kubectl cp road-monitor/<pod-name>:/path/to/file <local-file>

# Проверить конфигурацию
kubectl get configmap backend-config -n road-monitor -o yaml

# Обновить ConfigMap
kubectl edit configmap backend-config -n road-monitor

# Перезапустить deployment после изменения ConfigMap
kubectl rollout restart deployment/backend -n road-monitor
```

## 🔗 Доступ к приложению

После успешного деплоя:

- **Frontend**: https://road-monitor.example.com
- **Backend API**: https://api.road-monitor.example.com
- **API Docs**: https://api.road-monitor.example.com/docs

Если Ingress не настроен, используйте port-forward:

```bash
# Frontend
kubectl port-forward -n road-monitor svc/frontend 3000:3000
# Доступ: http://localhost:3000

# Backend
kubectl port-forward -n road-monitor svc/backend 8001:8001
# Доступ: http://localhost:8001
```

## 📚 Дополнительные ресурсы

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Kustomize Documentation](https://kustomize.io/)
- [NGINX Ingress Controller](https://kubernetes.github.io/ingress-nginx/)
- [cert-manager](https://cert-manager.io/)
- [Helm](https://helm.sh/)

## 🆘 Поддержка

При возникновении проблем:

1. Проверьте логи подов
2. Проверьте события в namespace
3. Проверьте ресурсы (CPU, Memory)
4. Проверьте сетевые политики
5. Создайте issue с детальным описанием и логами
