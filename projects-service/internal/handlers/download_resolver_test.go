package handlers

import (
	"errors"
	"testing"

	db "projects-service/db/sqlc"
	"projects-service/internal/download"
)

func TestPersistedDownloadClassification(t *testing.T) {
	cases := []struct {
		typ  db.FileType
		want string
	}{
		{db.FileTypeCollaborativeText, download.ClassificationCollaborativeText},
		{db.FileTypeTex, download.ClassificationCollaborativeText},
		{db.FileTypeImage, download.ClassificationRaw},
		{db.FileTypePdf, download.ClassificationRaw},
	}
	for _, tt := range cases {
		got, err := persistedDownloadClassification(tt.typ)
		if err != nil || got != tt.want {
			t.Fatalf("%q: %q, %v", tt.typ, got, err)
		}
	}
	if _, err := persistedDownloadClassification(db.FileTypeOther); !errors.Is(err, download.ErrInconsistentClassification) {
		t.Fatalf("other accepted: %v", err)
	}
}
