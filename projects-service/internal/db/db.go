package db

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"

	sqlc "projects-service/db/sqlc"
)


// New creates new database instance
func New(databaseURL string) (*pgxpool.Pool, *sqlc.Queries, error) {
	// Create database connection pool
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	// Attempt database ping
	if err := pool.Ping(context.Background()); err != nil {
		return nil, nil, fmt.Errorf("unable to ping database: %w", err)
	}

	log.Println("Connected to database successfully")
	return pool, sqlc.New(pool), nil
}

// Close database
func Close(pool *pgxpool.Pool) {
	if pool != nil {
		pool.Close()
	}
}