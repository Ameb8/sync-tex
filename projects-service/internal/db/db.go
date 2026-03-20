package db

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"

	sqlc "projects-service/db/sqlc"
)

// Database connection pool
var pool *pgxpool.Pool

// New creates new database instance
func New(databaseURL string) (*sqlc.Queries, error) {
	var err error
	pool, err = pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	log.Println("Connected to database successfully")
	return sqlc.New(pool), nil
}

// Close database
func Close() {
	if pool != nil {
		pool.Close()
	}
}