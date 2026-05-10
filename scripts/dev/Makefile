.PHONY: dev db check-db

# If .env.local exists at the project root, hand it to docker-compose so it can
# interpolate POSTGRES_PORT etc. from the same source the app already uses.
ENV_FILE = .env.local
COMPOSE_ENV_ARG = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
COMPOSE = docker-compose $(COMPOSE_ENV_ARG) -f ./containers/database/docker-compose.yml

# Start both database and Next.js development server
dev: db check-db
	next dev -p 3001

# Start Docker Compose in detached mode
db:
	$(COMPOSE) up -d

# Check if database container is healthy
check-db:
	@echo "Waiting for database to be ready..."
	@until $(COMPOSE) ps | grep "healthy"; do \
		echo "Waiting for database..."; \
		sleep 1; \
	done
	@echo "Database is ready!"
