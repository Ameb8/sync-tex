package handlers

import (
	"testing"

	db "projects-service/db/sqlc"
)

// The frontend's normal create-file action sends no file_type and immediately
// opens the result in Monaco/Yjs. This protects the persisted-classification
// invariant without relying on filename extensions.
func TestWebsiteCreationPathsPersistCollaborativeClassification(t *testing.T) {
	cases := []struct {
		name, requested string
		want            db.FileType
	}{
		{"new editor file", "", db.FileTypeCollaborativeText},
		{"legacy tex client", "tex", db.FileTypeCollaborativeText},
		{"explicit collaborative client", "collaborative_text", db.FileTypeCollaborativeText},
		{"image upload", "image", db.FileTypeImage},
		{"pdf upload", "pdf", db.FileTypePdf},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got, err := creationFileType(tt.requested)
			if err != nil || got != tt.want {
				t.Fatalf("creationFileType(%q) = %q, %v; want %q", tt.requested, got, err, tt.want)
			}
		})
	}

	if _, err := creationFileType("bib"); err == nil {
		t.Fatal("unrepresentable format must be rejected rather than ambiguously classified")
	}
}
