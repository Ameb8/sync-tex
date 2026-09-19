package storage

import (
	"context"
	"errors"
	"io"

	"github.com/minio/minio-go/v7"
	"projects-service/internal/download"
)

// ObjectStore adapts MinIO to the small streaming contract used by downloads.
type ObjectStore struct{ client *minio.Client }

func NewObjectStore(client *minio.Client) *ObjectStore { return &ObjectStore{client: client} }

func (s *ObjectStore) Open(ctx context.Context, bucket, key string) (io.ReadCloser, download.ObjectInfo, error) {
	if err := ctx.Err(); err != nil {
		return nil, download.ObjectInfo{}, err
	}
	info, err := s.client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return nil, download.ObjectInfo{}, wrapObjectError(err)
	}
	object, err := s.client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, download.ObjectInfo{}, wrapObjectError(err)
	}
	return objectReader{ReadCloser: object}, download.ObjectInfo{ContentType: info.ContentType}, nil
}

type objectReader struct{ io.ReadCloser }

func (r objectReader) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if err != nil && !errors.Is(err, io.EOF) {
		err = wrapObjectError(err)
	}
	return n, err
}

func wrapObjectError(err error) error {
	code := minio.ToErrorResponse(err).Code
	if code == "NoSuchKey" || code == "NoSuchObject" || code == "NotFound" {
		return errors.Join(download.ErrMissingObject, err)
	}
	return errors.Join(download.ErrStorage, err)
}
