package main

import (
	"log"
	"net/http"

	"github.com/ameb8/sync-tex/collab-service/internal/auth"
	"github.com/ameb8/sync-tex/collab-service/internal/config"
	"github.com/ameb8/sync-tex/collab-service/internal/handler"
	"github.com/ameb8/sync-tex/collab-service/internal/hub"
	"github.com/ameb8/sync-tex/collab-service/internal/persist"
	"github.com/ameb8/sync-tex/collab-service/internal/save"
)

func main() {
	cfg := config.Load()

	// auth.Checker validates JWTs against projects-service.
	checker := auth.NewChecker(cfg.ProjectsServiceURL, cfg.InternalSecret)

	// Factory functions let the hub create per-document dependencies without
	// importing the hub package from those packages (avoids circular imports).

	saveCoordFactory := func(docID string) *save.Coordinator {
		return save.NewCoordinator(docID, cfg.SaveDebounceDelay, cfg.SaveACKTimeout, cfg.SaveMaxRetries)
	}

	seederFactory := func(docID string) *persist.Seeder {
		return persist.NewSeeder(docID, cfg.ProjectsServiceURL, cfg.InternalSecret)
	}

	h := hub.New(saveCoordFactory, seederFactory)

	wsHandler := handler.NewWSHandler(h, checker)

	mux := http.NewServeMux()
	handler.Register(mux, wsHandler)

	addr := "0.0.0.0:" + cfg.Port
	log.Printf("collab-service listening on %s\n", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}