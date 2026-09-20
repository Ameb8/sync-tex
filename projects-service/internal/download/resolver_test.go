package download

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
)

type readCloser struct {
	io.Reader
	closed bool
	reads  int
}

func (r *readCloser) Read(p []byte) (int, error) { r.reads++; return r.Reader.Read(p) }
func (r *readCloser) Close() error               { r.closed = true; return nil }

type storeCall struct{ bucket, key string }
type fakeStore struct {
	calls    []storeCall
	reader   *readCloser
	info     ObjectInfo
	err      error
	noReader bool
}

func (s *fakeStore) Open(_ context.Context, bucket, key string) (io.ReadCloser, ObjectInfo, error) {
	s.calls = append(s.calls, storeCall{bucket, key})
	if s.noReader {
		return nil, s.info, s.err
	}
	return s.reader, s.info, s.err
}

type fakeMaterializer struct {
	calls int
	err   error
}

func (m *fakeMaterializer) EnsureText(_ context.Context, _ File) error { m.calls++; return m.err }

func rawFile() File {
	return File{ProjectID: "project", ID: "file", Filename: "diagram.bin", StorageKey: "project/file", Classification: ClassificationRaw}
}

func TestResolveRawStreamsUnchangedBytes(t *testing.T) {
	original := []byte{0, 255, 1, 2, 3}
	reader := &readCloser{Reader: bytes.NewReader(original)}
	store := &fakeStore{reader: reader, info: ObjectInfo{ContentType: "image/png"}}
	materializer := &fakeMaterializer{}
	resolved, err := NewResolver(store, materializer).Resolve(context.Background(), rawFile())
	if err != nil {
		t.Fatal(err)
	}
	// Resolving must not pre-read or buffer the object; archive and HTTP callers
	// can choose their own bounded copy buffer.
	if reader.reads != 0 {
		t.Fatalf("Resolve read %d times before the consumer requested bytes", reader.reads)
	}
	got, err := io.ReadAll(resolved.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, original) {
		t.Fatalf("bytes changed: %v", got)
	}
	if materializer.calls != 0 || len(store.calls) != 1 || store.calls[0].bucket != "uploads" {
		t.Fatalf("wrong raw resolution: %#v, materializations=%d", store.calls, materializer.calls)
	}
	if err := resolved.Close(); err != nil || !reader.closed {
		t.Fatalf("reader not closed: %v", err)
	}
}

func TestResolveCollaborativeUsesTextObject(t *testing.T) {
	reader := &readCloser{Reader: stringsReader("rendered text")}
	store := &fakeStore{reader: reader}
	materializer := &fakeMaterializer{}
	file := rawFile()
	file.Filename = "main.tex"
	file.Classification = ClassificationCollaborativeText
	resolved, err := NewResolver(store, materializer).Resolve(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	if materializer.calls != 1 || len(store.calls) != 1 || store.calls[0].bucket != "text" {
		t.Fatalf("wrong text resolution: %#v, materializations=%d", store.calls, materializer.calls)
	}
	if resolved.ContentType != "text/plain; charset=utf-8" || !resolved.Deflate {
		t.Fatalf("metadata: %#v", resolved)
	}
	_ = resolved.Close()
}

func TestResolveErrorsAndCancellation(t *testing.T) {
	cases := []struct {
		name                     string
		ctx                      context.Context
		file                     File
		storeErr, materializeErr error
		want                     error
	}{
		{"missing", context.Background(), rawFile(), ErrMissingObject, nil, ErrMissingObject},
		{"storage", context.Background(), rawFile(), ErrStorage, nil, ErrStorage},
		{"materialization", context.Background(), File{Filename: "x", StorageKey: "k", Classification: ClassificationCollaborativeText}, nil, errors.New("rpc"), ErrMaterialization},
		{"classification", context.Background(), File{Filename: "x", StorageKey: "k", Classification: "tex"}, nil, nil, ErrInconsistentClassification},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewResolver(&fakeStore{err: tt.storeErr}, &fakeMaterializer{err: tt.materializeErr}).Resolve(tt.ctx, tt.file)
			if !errors.Is(err, tt.want) {
				t.Fatalf("%v does not wrap %v", err, tt.want)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	store := &fakeStore{}
	_, err := NewResolver(store, &fakeMaterializer{}).Resolve(ctx, rawFile())
	if !errors.Is(err, context.Canceled) || len(store.calls) != 0 {
		t.Fatalf("cancellation ignored: %v, %#v", err, store.calls)
	}
}

func TestResolveRejectsSuccessfulOpenWithoutAStream(t *testing.T) {
	_, err := NewResolver(&fakeStore{noReader: true}, &fakeMaterializer{}).Resolve(context.Background(), rawFile())
	if !errors.Is(err, ErrStorage) {
		t.Fatalf("%v does not wrap storage error", err)
	}
}

func TestSafeRawContentType(t *testing.T) {
	if got := safeRawContentType("image/png"); got != "image/png" {
		t.Fatal(got)
	}
	if got := safeRawContentType("bad\nvalue"); got != "application/octet-stream" {
		t.Fatal(got)
	}
}

func stringsReader(s string) io.Reader { return bytes.NewBufferString(s) }
