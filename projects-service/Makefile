# Make commands
.PHONY: sqlc migrate-up migrate-down migrate-create db-start db-stop

# Directory containing .proto definitions
PROTO_DIR := ../proto

# Generate sqlc code
sqlc:
	sqlc generate

# Run migrations up using Docker
migrate-up:
	docker run --rm -v $(PWD)/db/migrations:/migrations --network host \
		migrate/migrate -path=/migrations/ \
		-database "postgres://postgres:postgres@localhost:5433/projects_db?sslmode=disable" up

# Run migrations down using Docker
migrate-down:
	docker run --rm -v $(PWD)/db/migrations:/migrations --network host \
		migrate/migrate -path=/migrations/ \
		-database "postgres://postgres:postgres@localhost:5433/projects_db?sslmode=disable" down 1

# Create new migration
migrate-create:
	@read -p "Enter migration name: " name; \
	docker run --rm -v $(PWD)/db/migrations:/migrations \
		migrate/migrate create -ext sql -dir /migrations -seq $$name

# Start database only
db-start:
	docker-compose up -d postgres-projects

# Stop database
db-stop:
	docker-compose stop postgres-projects

# Run all
dev: db-start
	@sleep 3
	@$(MAKE) migrate-up
	go run cmd/server/main.go

# Generate Go code with Protocol Buffers compiler
proto:
	protoc \
		--proto_path=$(PROTO_DIR) \
		--go_out=./proto \
		--go-grpc_out=./proto \
		$(PROTO_DIR)/compaction.proto

