package config

import (
	"os"
	"strconv"
	"strings"
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
		ProjectsServiceURL: normalizeProjectsServiceURL(getEnv("PROJECTS_SERVICE_URL", "http://projects-service:8003")),
		InternalSecret:     getEnv("INTERNAL_SECRET", "dev-secret"),
		SaveDebounceDelay:  getDuration("SAVE_DEBOUNCE_MS", 5000),
	}
}

func normalizeProjectsServiceURL(rawURL string) string {
	baseURL := strings.TrimRight(rawURL, "/")
	for _, suffix := range []string{"/projects/internal/v1", "/projects/v1", "/projects"} {
		if strings.HasSuffix(baseURL, suffix) {
			return strings.TrimSuffix(baseURL, suffix)
		}
	}
	return baseURL
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
