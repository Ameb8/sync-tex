package archiveplan

import (
	"errors"
	"reflect"
	"testing"
)

const project = "project"

func dir(id, parent, name string) Directory {
	return Directory{ID: id, ProjectID: project, ParentID: parent, Name: name}
}
func file(id, directory, name string) File {
	return File{ID: id, ProjectID: project, DirectoryID: directory, Filename: name, StorageKey: "not-a-path", Classification: "raw"}
}

func paths(p Plan) []string {
	entries := p.Entries()
	result := make([]string, len(entries))
	for i, e := range entries {
		result[i] = e.Path
	}
	return result
}

func TestComponentValidation(t *testing.T) {
	valid := []string{"résumé.tex", "100%", "normal name", "a.b"}
	for _, name := range valid {
		if err := validateComponent(name); err != nil {
			t.Errorf("%q rejected: %v", name, err)
		}
	}
	invalid := []string{"", ".", "..", "/etc", `a/b`, `a\\b`, `C:foo`, `C:\\foo`, `\\server\\share`, "nul\x00", "line\nfeed", "%2e%2e", "%252fetc"}
	for _, name := range invalid {
		if err := validateComponent(name); !errors.Is(err, ErrUnsafe) {
			t.Errorf("%q: got %v, want unsafe", name, err)
		}
	}
}

func TestDirectoryPlanDeepEmptyAndStable(t *testing.T) {
	metadata := Metadata{
		Directories: []Directory{dir("root", "", "project metadata"), dir("chapter", "root", "chapters"), dir("empty", "chapter", "empty"), dir("deep", "chapter", "deep")},
		Files:       []File{file("z", "deep", "z.tex"), file("a", "chapter", "a.tex")},
	}
	plan, err := DirectoryPlan(project, "chapter", metadata)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"chapters/", "chapters/a.tex", "chapters/deep/", "chapters/deep/z.tex", "chapters/empty/"}
	if got := paths(plan); !reflect.DeepEqual(got, want) {
		t.Fatalf("paths = %#v, want %#v", got, want)
	}
	// The plan's private slice cannot be modified by callers through Entries.
	copy := plan.Entries()
	copy[0].Path = "modified"
	if got := paths(plan)[0]; got != "chapters/" {
		t.Fatalf("plan was mutable: %q", got)
	}
}

func TestProjectPlanOmitsStructuralRoot(t *testing.T) {
	metadata := Metadata{Directories: []Directory{dir("root", "", "My Project"), dir("src", "root", "src"), dir("empty", "root", "empty")}, Files: []File{file("main", "root", "main.tex"), file("x", "src", "x.tex")}}
	plan, err := ProjectPlan(project, metadata)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"main.tex", "empty/", "src/", "src/x.tex"}
	if got := paths(plan); !reflect.DeepEqual(got, want) {
		t.Fatalf("paths = %#v, want %#v", got, want)
	}
}

func TestConflicts(t *testing.T) {
	cases := []struct {
		name  string
		dirs  []Directory
		files []File
	}{
		{"duplicate files", []Directory{dir("root", "", "root")}, []File{file("a", "root", "same"), file("b", "root", "same")}},
		{"duplicate directories", []Directory{dir("root", "", "root"), dir("a", "root", "same"), dir("b", "root", "same")}, nil},
		{"file directory", []Directory{dir("root", "", "root"), dir("a", "root", "same")}, []File{file("f", "root", "same")}},
		{"unicode nfc", []Directory{dir("root", "", "root")}, []File{file("a", "root", "é"), file("b", "root", "e\u0301")}},
		{"windows equivalent", []Directory{dir("root", "", "root")}, []File{file("a", "root", "readme"), file("b", "root", "README. ")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ProjectPlan(project, Metadata{Directories: tc.dirs, Files: tc.files})
			if !errors.Is(err, ErrConflict) {
				t.Fatalf("got %v, want conflict", err)
			}
		})
	}
}

func TestCorruptMetadata(t *testing.T) {
	other := Directory{ID: "foreign", ProjectID: "other", ParentID: "root", Name: "foreign"}
	cases := []struct {
		name     string
		metadata Metadata
	}{
		{"cross project directory", Metadata{Directories: []Directory{dir("root", "", "root"), other}}},
		{"cross project file", Metadata{Directories: []Directory{dir("root", "", "root")}, Files: []File{{ID: "f", ProjectID: "other", DirectoryID: "root", Filename: "x"}}}},
		{"cycle", Metadata{Directories: []Directory{dir("root", "", "root"), dir("a", "b", "a"), dir("b", "a", "b")}}},
		{"missing parent", Metadata{Directories: []Directory{dir("root", "", "root"), dir("a", "gone", "a")}}},
		{"unreachable file", Metadata{Directories: []Directory{dir("root", "", "root")}, Files: []File{file("f", "gone", "x")}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ProjectPlan(project, tc.metadata)
			if !errors.Is(err, ErrCorrupt) {
				t.Fatalf("got %v, want corrupt", err)
			}
		})
	}
}

func TestDirectoryPlanOnlyIncludesRequestedSubtree(t *testing.T) {
	metadata := Metadata{Directories: []Directory{dir("root", "", "root"), dir("selected", "root", "chapters"), dir("other", "root", "other"), dir("deep", "selected", "deep")}, Files: []File{file("f", "deep", "x.tex"), file("ignored", "other", "no.tex")}}
	plan, err := DirectoryPlan(project, "selected", metadata)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := paths(plan), []string{"chapters/", "chapters/deep/", "chapters/deep/x.tex"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("paths = %#v", got)
	}
}
