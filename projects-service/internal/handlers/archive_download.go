package handlers

import (
	"archive/zip"
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	db "projects-service/db/sqlc"
	"projects-service/internal/archiveplan"
	"projects-service/internal/download"
)

// DownloadDirectory streams a selected directory, including the selected
// directory itself, as a ZIP attachment.
func (h *Handler) DownloadDirectory(c *gin.Context) {
	h.downloadArchive(c, true)
}

// DownloadProject streams project-root contents (without an extra project
// directory) as a ZIP attachment.
func (h *Handler) DownloadProject(c *gin.Context) {
	h.downloadArchive(c, false)
}

func (h *Handler) downloadArchive(c *gin.Context, directory bool) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	projectID, err := stringToPgUUID(c.Param("projectID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}
	canRead, err := h.canReadForDownload(c.Request.Context(), projectID, userID)
	if err != nil || !canRead {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	project, err := h.getProjectForDownload(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}
	var selected db.Directory
	var directoryID pgtype.UUID
	if directory {
		directoryID, err = stringToPgUUID(c.Param("dirID"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid directory ID"})
			return
		}
		selected, err = h.getDirectoryForDownload(c.Request.Context(), directoryID)
		if err != nil || selected.ProjectID != projectID {
			c.JSON(http.StatusNotFound, gin.H{"error": "Directory not found"})
			return
		}
	}

	metadata, err := h.archiveMetadata(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Project export is temporarily unavailable"})
		return
	}
	var plan archiveplan.Plan
	if directory {
		plan, err = archiveplan.DirectoryPlan(pgUUIDToString(projectID), pgUUIDToString(directoryID), metadata)
	} else {
		plan, err = archiveplan.ProjectPlan(pgUUIDToString(projectID), metadata)
	}
	if err != nil {
		writeArchivePlanError(c, err)
		return
	}

	name := project.Name.String
	if directory {
		name = selected.Name
	}
	name = archiveAttachmentName(name)
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", attachmentDisposition(name+".zip"))
	c.Status(http.StatusOK)

	writer := zip.NewWriter(c.Writer)
	if err := h.writeArchive(c.Request.Context(), writer, plan); err != nil {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			log.Printf("archive download stream failed project_id=%s kind=%s", pgUUIDToString(projectID), archiveKind(directory))
		}
		return // response is a partial ZIP; never mix an error body into it.
	}
	if err := writer.Close(); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("archive download close failed project_id=%s kind=%s", pgUUIDToString(projectID), archiveKind(directory))
	}
}

func (h *Handler) writeArchive(ctx context.Context, writer *zip.Writer, plan archiveplan.Plan) error {
	for _, entry := range plan.Entries() {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDirectory {
			header := &zip.FileHeader{Name: entry.Path, Method: zip.Store}
			if _, err := writer.CreateHeader(header); err != nil {
				return err
			}
			continue
		}
		file, err := archiveEntryFile(entry.File)
		if err != nil {
			return err
		}
		resolved, err := h.resolveFileDownload(ctx, file)
		if err != nil {
			return err
		}
		if resolved.Reader == nil {
			return download.ErrStorage
		}
		header := &zip.FileHeader{Name: entry.Path, Method: download.ZIPMethod(entry.File.Filename, resolved.ContentType, resolved.Deflate)}
		entryWriter, createErr := writer.CreateHeader(header)
		if createErr != nil {
			resolved.Close()
			return createErr
		}
		_, copyErr := io.CopyBuffer(entryWriter, contextReader{ctx: ctx, reader: resolved.Reader}, make([]byte, downloadCopyBufferSize))
		closeErr := resolved.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func archiveEntryFile(f archiveplan.File) (db.File, error) {
	id, err := stringToPgUUID(f.ID)
	if err != nil {
		return db.File{}, err
	}
	projectID, err := stringToPgUUID(f.ProjectID)
	if err != nil {
		return db.File{}, err
	}
	directoryID, err := stringToPgUUID(f.DirectoryID)
	if err != nil {
		return db.File{}, err
	}
	var typ db.FileType
	switch f.Classification {
	case download.ClassificationRaw:
		typ = db.FileTypeImage
	case download.ClassificationCollaborativeText:
		typ = db.FileTypeCollaborativeText
	default:
		return db.File{}, download.ErrInconsistentClassification
	}
	return db.File{ID: id, ProjectID: projectID, DirectoryID: directoryID, Filename: f.Filename, StorageKey: f.StorageKey, FileType: typ}, nil
}

func (h *Handler) archiveMetadata(ctx context.Context, projectID pgtype.UUID) (archiveplan.Metadata, error) {
	dirs, err := h.listDirectoriesForDownload(ctx, projectID)
	if err != nil {
		return archiveplan.Metadata{}, err
	}
	files, err := h.listFilesForDownload(ctx, projectID)
	if err != nil {
		return archiveplan.Metadata{}, err
	}
	metadata := archiveplan.Metadata{Directories: make([]archiveplan.Directory, 0, len(dirs)), Files: make([]archiveplan.File, 0, len(files))}
	for _, d := range dirs {
		metadata.Directories = append(metadata.Directories, archiveplan.Directory{ID: pgUUIDToString(d.ID), ProjectID: pgUUIDToString(d.ProjectID), ParentID: pgUUIDToString(d.ParentID), Name: d.Name})
	}
	for _, f := range files {
		classification, err := persistedDownloadClassification(f.FileType)
		if err != nil {
			return archiveplan.Metadata{}, err
		}
		metadata.Files = append(metadata.Files, archiveplan.File{ID: pgUUIDToString(f.ID), ProjectID: pgUUIDToString(f.ProjectID), DirectoryID: pgUUIDToString(f.DirectoryID), Filename: f.Filename, StorageKey: f.StorageKey, Classification: classification})
	}
	return metadata, nil
}

func (h *Handler) getProjectForDownload(ctx context.Context, id pgtype.UUID) (db.Project, error) {
	if h.downloadGetProject != nil {
		return h.downloadGetProject(ctx, id)
	}
	return h.queries.GetProject(ctx, id)
}
func (h *Handler) getDirectoryForDownload(ctx context.Context, id pgtype.UUID) (db.Directory, error) {
	if h.downloadGetDirectory != nil {
		return h.downloadGetDirectory(ctx, id)
	}
	return h.queries.GetDirectory(ctx, id)
}
func (h *Handler) listDirectoriesForDownload(ctx context.Context, id pgtype.UUID) ([]db.Directory, error) {
	if h.downloadListDirectories != nil {
		return h.downloadListDirectories(ctx, id)
	}
	return h.queries.ListDirectoriesByProject(ctx, id)
}
func (h *Handler) listFilesForDownload(ctx context.Context, id pgtype.UUID) ([]db.File, error) {
	if h.downloadListFiles != nil {
		return h.downloadListFiles(ctx, id)
	}
	return h.queries.ListFilesByProject(ctx, id)
}

func writeArchivePlanError(c *gin.Context, err error) {
	if errors.Is(err, archiveplan.ErrConflict) || errors.Is(err, archiveplan.ErrUnsafe) || errors.Is(err, archiveplan.ErrCorrupt) {
		c.JSON(http.StatusConflict, gin.H{"error": "Project archive has conflicting paths"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Project archive unavailable"})
}
func archiveAttachmentName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "download"
	}
	return name
}
func archiveKind(directory bool) string {
	if directory {
		return "directory"
	}
	return "project"
}
