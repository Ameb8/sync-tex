// Package download resolves the user-facing representation of project files.
// It deliberately knows nothing about HTTP, authorization, or archive paths.
package download

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"strings"
)

var (
	// ErrMissingObject means metadata refers to an object that is no longer in storage.
	ErrMissingObject = errors.New("download object not found")
	// ErrStorage means object storage could not complete an operation.
	ErrStorage = errors.New("download storage failure")
	// ErrMaterialization means the collaborative document could not be exported as text.
	ErrMaterialization = errors.New("download text materialization failure")
	// ErrInconsistentClassification means persisted metadata is not a supported class.
	ErrInconsistentClassification = errors.New("inconsistent file classification")
)

const (
	ClassificationCollaborativeText = "collaborative_text"
	ClassificationRaw               = "raw"
)

// File is the minimal persisted metadata required to resolve content. StorageKey
// is intentionally not returned by Resolve and therefore cannot leak to consumers.
type File struct {
	ProjectID      string
	ID             string
	Filename       string
	StorageKey     string
	Classification string
}

// ObjectInfo is metadata obtained from object storage when opening an object.
type ObjectInfo struct {
	ContentType string
}

// Store opens an object as a stream. The returned reader is owned by the caller
// and must be closed, including when copying to a client or ZIP writer fails.
// Implementations must wrap missing objects with ErrMissingObject and all other
// provider failures with ErrStorage.
type Store interface {
	Open(ctx context.Context, bucket, key string) (io.ReadCloser, ObjectInfo, error)
}

// Materializer ensures the text object represents the latest persisted Yjs
// sources. It must honor ctx and never substitute Yjs bytes for text bytes.
type Materializer interface {
	EnsureText(ctx context.Context, file File) error
}

// Resolved is the stream and presentation metadata for one user-visible file.
// Close transfers ownership of Reader to the caller.
type Resolved struct {
	Reader      io.ReadCloser
	Filename    string
	ContentType string
	Deflate     bool
}

func (r Resolved) Close() error {
	if r.Reader == nil {
		return nil
	}
	return r.Reader.Close()
}

type Resolver struct {
	store        Store
	materializer Materializer
}

func NewResolver(store Store, materializer Materializer) *Resolver {
	return &Resolver{store: store, materializer: materializer}
}

// Resolve opens the canonical raw object or the materialized text object. It
// never reads object content itself, keeping memory bounded by the consumer's
// copy buffer.
func (r *Resolver) Resolve(ctx context.Context, file File) (Resolved, error) {
	if err := ctx.Err(); err != nil {
		return Resolved{}, err
	}
	if r.store == nil || file.Filename == "" || file.StorageKey == "" {
		return Resolved{}, fmt.Errorf("%w: incomplete file metadata", ErrInconsistentClassification)
	}

	switch file.Classification {
	case ClassificationRaw:
		reader, info, err := r.store.Open(ctx, "uploads", file.StorageKey)
		if err != nil {
			return Resolved{}, err
		}
		return Resolved{Reader: reader, Filename: file.Filename, ContentType: safeRawContentType(info.ContentType)}, nil
	case ClassificationCollaborativeText:
		if r.materializer == nil {
			return Resolved{}, fmt.Errorf("%w: no text materializer", ErrMaterialization)
		}
		if err := r.materializer.EnsureText(ctx, file); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return Resolved{}, err
			}
			return Resolved{}, fmt.Errorf("%w: %v", ErrMaterialization, err)
		}
		if err := ctx.Err(); err != nil {
			return Resolved{}, err
		}
		reader, _, err := r.store.Open(ctx, "text", file.StorageKey)
		if err != nil {
			return Resolved{}, err
		}
		return Resolved{Reader: reader, Filename: file.Filename, ContentType: "text/plain; charset=utf-8", Deflate: true}, nil
	default:
		return Resolved{}, fmt.Errorf("%w: %q", ErrInconsistentClassification, file.Classification)
	}
}

func safeRawContentType(value string) string {
	mediaType, params, err := mime.ParseMediaType(value)
	if err != nil || mediaType == "" || strings.ContainsAny(mediaType, "\r\n") {
		return "application/octet-stream"
	}
	return mime.FormatMediaType(mediaType, params)
}
