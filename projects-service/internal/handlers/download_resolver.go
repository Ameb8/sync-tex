package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"

	db "projects-service/db/sqlc"
	"projects-service/internal/download"
)

type handlerMaterializer struct{ h *Handler }

func (m handlerMaterializer) EnsureText(ctx context.Context, file download.File) error {
	fileID, err := stringToPgUUID(file.ID)
	if err != nil {
		return err
	}
	dbFile, err := m.h.queries.GetFile(ctx, fileID)
	if err != nil {
		return fmt.Errorf("load file for materialization: %w", err)
	}
	if dbFile.StorageKey != file.StorageKey {
		return fmt.Errorf("file metadata changed during resolution")
	}
	return m.h.ensureTextUpToDate(ctx, dbFile)
}

// ResolveDownloadContent is the handler-facing bridge for future individual
// download and ZIP handlers. Authorization and response writing stay outside.
func (h *Handler) ResolveDownloadContent(ctx context.Context, file db.File) (download.Resolved, error) {
	if h.downloadResolver == nil {
		return download.Resolved{}, fmt.Errorf("%w: resolver unavailable", download.ErrStorage)
	}
	classification, err := persistedDownloadClassification(file.FileType)
	if err != nil {
		logDownloadResolutionFailure(file, err)
		return download.Resolved{}, err
	}
	resolved, err := h.downloadResolver.Resolve(ctx, download.File{
		ProjectID: pgUUIDToString(file.ProjectID), ID: pgUUIDToString(file.ID), Filename: file.Filename,
		StorageKey: file.StorageKey, Classification: classification,
	})
	if err != nil {
		logDownloadResolutionFailure(file, err)
	}
	return resolved, err
}

func logDownloadResolutionFailure(file db.File, err error) {
	category := "storage"
	switch {
	case errors.Is(err, download.ErrMissingObject):
		category = "missing_object"
	case errors.Is(err, download.ErrMaterialization):
		category = "materialization"
	case errors.Is(err, download.ErrInconsistentClassification):
		category = "classification"
	}
	// Do not log provider errors, presigned URLs, or storage keys.
	log.Printf("download content resolution failed project_id=%s file_id=%s category=%s", pgUUIDToString(file.ProjectID), pgUUIDToString(file.ID), category)
}

func persistedDownloadClassification(fileType db.FileType) (string, error) {
	switch fileType {
	case db.FileTypeCollaborativeText, db.FileTypeTex:
		return download.ClassificationCollaborativeText, nil
	case db.FileTypeImage, db.FileTypePdf:
		return download.ClassificationRaw, nil
	default:
		return "", fmt.Errorf("%w: persisted file_type %q", download.ErrInconsistentClassification, fileType)
	}
}
