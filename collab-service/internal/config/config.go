package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port               string
	ProjectsServiceURL string
	InternalSecret     string
	SaveDebounceDelay  time.Duration
	SaveACKTimeout     time.Duration
	SaveMaxRetries     int
}

func Load() *Config {
	return &Config{
		Port:               getEnv("PORT", "8080"),
		ProjectsServiceURL: getEnv("PROJECTS_SERVICE_URL", "http://projects-service:8000"),
		InternalSecret:     getEnv("INTERNAL_SECRET", "dev-secret"),
		SaveDebounceDelay:  getDuration("SAVE_DEBOUNCE_MS", 5000),
		SaveACKTimeout:     getDuration("SAVE_ACK_TIMEOUT_MS", 3000),
		SaveMaxRetries:     getInt("SAVE_MAX_RETRIES", 3),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getDuration(key string, fallbackMs int) time.Duration {
	if v := os.Getenv(key); v != "" {
		if ms, err := strconv.Atoi(v); err == nil {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return time.Duration(fallbackMs) * time.Millisecond
}

func getInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}