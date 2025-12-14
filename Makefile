# Makefile для Road Monitor System

.PHONY: help setup start stop restart logs clean build test

# Цвета для вывода
RED=\033[0;31m
GREEN=\033[0;32m
YELLOW=\033[1;33m
NC=\033[0m # No Color

help: ## Показать эту справку
	@echo "${GREEN}Road Monitor System - Команды${NC}"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  ${YELLOW}%-15s${NC} %s\n", $$1, $$2}'

setup: ## Первоначальная настройка проекта
	@echo "${GREEN}Настройка проекта...${NC}"
	@cp backend/.env.example backend/.env 2>/dev/null || echo "backend/.env уже существует"
	@cp frontend/.env.example frontend/.env 2>/dev/null || echo "frontend/.env уже существует"
	@echo "${GREEN}✓ Файлы .env созданы${NC}"
	@echo "${YELLOW}! Отредактируйте .env файлы при необходимости${NC}"

start: ## Запустить все сервисы
	@echo "${GREEN}Запуск сервисов...${NC}"
	docker-compose up -d
	@echo "${GREEN}✓ Сервисы запущены${NC}"
	@make status

start-dev: ## Запустить в режиме разработки
	@echo "${GREEN}Запуск в режиме разработки...${NC}"
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

stop: ## Остановить все сервисы
	@echo "${YELLOW}Остановка сервисов...${NC}"
	docker-compose stop
	@echo "${GREEN}✓ Сервисы остановлены${NC}"

down: ## Остановить и удалить контейнеры
	@echo "${RED}Остановка и удаление контейнеров...${NC}"
	docker-compose down
	@echo "${GREEN}✓ Контейнеры удалены${NC}"

restart: ## Перезапустить все сервисы
	@echo "${YELLOW}Перезапуск сервисов...${NC}"
	docker-compose restart
	@echo "${GREEN}✓ Сервисы перезапущены${NC}"

logs: ## Показать логи всех сервисов
	docker-compose logs -f

logs-backend: ## Показать логи backend
	docker-compose logs -f backend

logs-frontend: ## Показать логи frontend
	docker-compose logs -f frontend

logs-mongodb: ## Показать логи MongoDB
	docker-compose logs -f mongodb

status: ## Показать статус сервисов
	@echo "${GREEN}Статус сервисов:${NC}"
	@docker-compose ps
	@echo ""
	@echo "${GREEN}Доступ к сервисам:${NC}"
	@echo "  Frontend:     ${YELLOW}http://localhost:3000${NC}"
	@echo "  Backend API:  ${YELLOW}http://localhost:8001${NC}"
	@echo "  API Docs:     ${YELLOW}http://localhost:8001/docs${NC}"
	@echo "  Expo DevTools:${YELLOW}http://localhost:19002${NC}"
	@echo "  MongoDB:      ${YELLOW}mongodb://localhost:27017${NC}"

build: ## Пересобрать все образы
	@echo "${GREEN}Сборка образов...${NC}"
	docker-compose build
	@echo "${GREEN}✓ Образы собраны${NC}"

rebuild: ## Пересобрать и перезапустить
	@echo "${GREEN}Пересборка и перезапуск...${NC}"
	docker-compose up -d --build
	@echo "${GREEN}✓ Готово${NC}"

clean: ## Очистить все (включая volumes!)
	@echo "${RED}⚠ ВНИМАНИЕ: Это удалит все данные!${NC}"
	@read -p "Продолжить? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker-compose down -v; \
		echo "${GREEN}✓ Все очищено${NC}"; \
	fi

shell-backend: ## Войти в контейнер backend
	docker-compose exec backend bash

shell-frontend: ## Войти в контейнер frontend
	docker-compose exec frontend sh

shell-mongodb: ## Войти в MongoDB shell
	docker-compose exec mongodb mongosh road_monitor

backup: ## Создать бэкап базы данных
	@echo "${GREEN}Создание бэкапа...${NC}"
	@mkdir -p ./backups
	docker-compose exec mongodb mongodump --out=/data/backup
	docker cp road-monitor-mongodb:/data/backup ./backups/mongodb-backup-$$(date +%Y%m%d-%H%M%S)
	@echo "${GREEN}✓ Бэкап создан в ./backups/${NC}"

restore: ## Восстановить базу данных из последнего бэкапа
	@echo "${YELLOW}Восстановление из бэкапа...${NC}"
	@LATEST=$$(ls -t backups/ | head -1); \
	if [ -z "$$LATEST" ]; then \
		echo "${RED}Бэкапы не найдены${NC}"; \
		exit 1; \
	fi; \
	echo "Восстановление из: $$LATEST"; \
	docker cp ./backups/$$LATEST road-monitor-mongodb:/data/backup; \
	docker-compose exec mongodb mongorestore /data/backup
	@echo "${GREEN}✓ База данных восстановлена${NC}"

test-backend: ## Запустить тесты backend
	docker-compose exec backend pytest

test-connection: ## Проверить подключение к сервисам
	@echo "${GREEN}Проверка подключений...${NC}"
	@curl -f http://localhost:8001/health && echo "${GREEN}✓ Backend OK${NC}" || echo "${RED}✗ Backend FAIL${NC}"
	@curl -f http://localhost:3000 > /dev/null 2>&1 && echo "${GREEN}✓ Frontend OK${NC}" || echo "${RED}✗ Frontend FAIL${NC}"

stats: ## Показать использование ресурсов
	docker stats --no-stream

prune: ## Очистить неиспользуемые Docker ресурсы
	@echo "${YELLOW}Очистка неиспользуемых ресурсов...${NC}"
	docker system prune -f
	@echo "${GREEN}✓ Очищено${NC}"

update: ## Обновить проект
	@echo "${GREEN}Обновление проекта...${NC}"
	git pull
	@make rebuild
	@echo "${GREEN}✓ Проект обновлён${NC}"

dev: setup start-dev ## Быстрый старт для разработки

prod: setup build start ## Быстрый старт для production