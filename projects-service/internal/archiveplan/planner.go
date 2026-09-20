// Package archiveplan turns authoritative project metadata into safe ZIP entry
// names. It intentionally neither opens objects nor writes ZIP bytes.
//
// Archive-path equivalence is deliberately stricter than ZIP's byte-oriented
// names: each component is NFC-normalized, Unicode case-folded, and has trailing
// spaces and periods removed for its conflict key. The latter matches Windows
// filename equivalence; NFC and case folding cover common macOS and
// case-insensitive extraction targets. Entries with equal keys are ambiguous and
// are rejected rather than relying on an extractor's behaviour.
package archiveplan

import (
	"errors"
	"fmt"
	"net/url"
	"path"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

var (
	ErrConflict = errors.New("archive path conflict")
	ErrCorrupt  = errors.New("corrupt archive metadata")
	ErrUnsafe   = errors.New("unsafe archive path")
)

// ConflictError identifies two metadata records that map to the same archive
// path under the documented equivalence rule.
type ConflictError struct{ Path string }

func (e *ConflictError) Error() string { return fmt.Sprintf("%s: %s", ErrConflict, e.Path) }
func (e *ConflictError) Unwrap() error { return ErrConflict }

// CorruptMetadataError describes relationships which cannot safely be exported.
// Detail is suitable for diagnostics but contains no storage key or object body.
type CorruptMetadataError struct{ Detail string }

func (e *CorruptMetadataError) Error() string { return fmt.Sprintf("%s: %s", ErrCorrupt, e.Detail) }
func (e *CorruptMetadataError) Unwrap() error { return ErrCorrupt }

// UnsafePathError means a user-visible name cannot be a single ZIP component.
type UnsafePathError struct{ Name string }

func (e *UnsafePathError) Error() string { return fmt.Sprintf("%s: invalid name", ErrUnsafe) }
func (e *UnsafePathError) Unwrap() error { return ErrUnsafe }

// Directory and File are a snapshot of database metadata. IDs are opaque; the
// planner never derives a path from StorageKey.
type Directory struct{ ID, ProjectID, ParentID, Name string }
type File struct {
	ID, ProjectID, DirectoryID, Filename, StorageKey, Classification string
}

// Metadata must be loaded from the authoritative directories and files tables
// for the requested project before invoking a planner function.
type Metadata struct {
	Directories []Directory
	Files       []File
}

// Entry is a ZIP entry in write order. A directory Entry has IsDirectory true
// and a trailing slash in Path. File metadata is retained so a writer can select
// its source and compression without querying hierarchy state again.
type Entry struct {
	Path        string
	IsDirectory bool
	File        File
}

// Plan is immutable to callers: Entries returns a copy.
type Plan struct{ entries []Entry }

func (p Plan) Entries() []Entry { return append([]Entry(nil), p.entries...) }

// DirectoryPlan creates an archive whose one top-level directory is selectedID.
func DirectoryPlan(projectID, selectedID string, metadata Metadata) (Plan, error) {
	dirs, files, err := index(projectID, metadata)
	if err != nil {
		return Plan{}, err
	}
	root, ok := dirs[selectedID]
	if !ok {
		return Plan{}, &CorruptMetadataError{"selected directory is missing or belongs to another project"}
	}
	if err := validateAncestry(projectID, root, dirs); err != nil {
		return Plan{}, err
	}
	return build(projectID, root, dirs, files, true)
}

// ProjectPlan creates paths relative to the project's sole database root. That
// root is structural metadata and is never emitted as an archive directory.
func ProjectPlan(projectID string, metadata Metadata) (Plan, error) {
	dirs, files, err := index(projectID, metadata)
	if err != nil {
		return Plan{}, err
	}
	var roots []Directory
	for _, d := range dirs {
		if d.ProjectID == projectID && d.ParentID == "" {
			roots = append(roots, d)
		}
	}
	if len(roots) != 1 {
		return Plan{}, &CorruptMetadataError{"project must have exactly one root directory"}
	}
	return build(projectID, roots[0], dirs, files, false)
}

func index(projectID string, metadata Metadata) (map[string]Directory, []File, error) {
	if projectID == "" {
		return nil, nil, &CorruptMetadataError{"missing project ID"}
	}
	dirs := make(map[string]Directory, len(metadata.Directories))
	for _, d := range metadata.Directories {
		if d.ID == "" {
			return nil, nil, &CorruptMetadataError{"directory has no ID"}
		}
		if _, exists := dirs[d.ID]; exists {
			return nil, nil, &CorruptMetadataError{"duplicate directory ID"}
		}
		dirs[d.ID] = d
	}
	// Retain every file so a file attached to an included directory can have its
	// project ownership checked rather than being silently filtered out.
	return dirs, append([]File(nil), metadata.Files...), nil
}

// validateAncestry prevents a selected child of a broken project tree from
// becoming a plausible-looking standalone archive.
func validateAncestry(projectID string, start Directory, dirs map[string]Directory) error {
	seen := map[string]bool{}
	for d := start; ; {
		if d.ProjectID != projectID {
			return &CorruptMetadataError{"directory belongs to another project"}
		}
		if seen[d.ID] {
			return &CorruptMetadataError{"directory cycle"}
		}
		seen[d.ID] = true
		if d.ParentID == "" {
			return nil
		}
		parent, ok := dirs[d.ParentID]
		if !ok {
			return &CorruptMetadataError{"directory parent is missing"}
		}
		d = parent
	}
}

func build(projectID string, root Directory, dirs map[string]Directory, files []File, includeRoot bool) (Plan, error) {
	children := make(map[string][]Directory)
	for _, d := range dirs {
		if d.ID == root.ID {
			continue
		}
		if d.ParentID == "" {
			continue
		}
		children[d.ParentID] = append(children[d.ParentID], d)
	}
	for parent := range children {
		sort.Slice(children[parent], func(i, j int) bool { return children[parent][i].ID < children[parent][j].ID })
	}

	filesByDir := make(map[string][]File)
	for _, f := range files {
		filesByDir[f.DirectoryID] = append(filesByDir[f.DirectoryID], f)
	}
	for id := range filesByDir {
		sort.Slice(filesByDir[id], func(i, j int) bool { return filesByDir[id][i].ID < filesByDir[id][j].ID })
	}

	var result []Entry
	seen := make(map[string]struct{})
	visiting, visited := map[string]bool{}, map[string]bool{}
	var walk func(Directory, []string) error
	walk = func(d Directory, components []string) error {
		if visiting[d.ID] {
			return &CorruptMetadataError{"directory cycle"}
		}
		if visited[d.ID] {
			return &CorruptMetadataError{"directory has multiple paths"}
		}
		if d.ProjectID != projectID {
			return &CorruptMetadataError{"directory belongs to another project"}
		}
		if d.ID != root.ID {
			parent, ok := dirs[d.ParentID]
			if !ok {
				return &CorruptMetadataError{"directory parent is missing"}
			}
			if parent.ProjectID != projectID {
				return &CorruptMetadataError{"directory parent belongs to another project"}
			}
		}
		visiting[d.ID] = true
		defer delete(visiting, d.ID)
		visited[d.ID] = true

		current := components
		if includeRoot || d.ID != root.ID {
			if err := validateComponent(d.Name); err != nil {
				return err
			}
			current = append(append([]string(nil), components...), d.Name)
			entryPath := strings.Join(current, "/") + "/"
			if err := add(seen, entryPath); err != nil {
				return err
			}
			result = append(result, Entry{Path: entryPath, IsDirectory: true})
		}
		for _, f := range filesByDir[d.ID] {
			if f.ProjectID != projectID {
				return &CorruptMetadataError{"file belongs to another project"}
			}
			if err := validateComponent(f.Filename); err != nil {
				return err
			}
			entryPath := strings.Join(append(append([]string(nil), current...), f.Filename), "/")
			if err := add(seen, entryPath); err != nil {
				return err
			}
			result = append(result, Entry{Path: entryPath, File: f})
		}
		for _, child := range children[d.ID] {
			if err := walk(child, current); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(root, nil); err != nil {
		return Plan{}, err
	}
	if !includeRoot {
		for _, d := range dirs {
			if d.ProjectID == projectID && !visited[d.ID] {
				return Plan{}, &CorruptMetadataError{"directory is unreachable from project root"}
			}
		}
	}
	// For a whole-project plan, a file attached to a nonexistent/unreachable
	// directory is corrupt rather than an omitted archive member. A selected
	// directory may legitimately have project siblings outside its subtree.
	if !includeRoot {
		for _, f := range files {
			if f.ProjectID == projectID && !visited[f.DirectoryID] {
				return Plan{}, &CorruptMetadataError{"file directory is missing or unreachable"}
			}
		}
	}
	return Plan{entries: result}, nil
}

func add(seen map[string]struct{}, entryPath string) error {
	key := equivalenceKey(strings.TrimSuffix(entryPath, "/"))
	if _, exists := seen[key]; exists {
		return &ConflictError{Path: entryPath}
	}
	seen[key] = struct{}{}
	return nil
}

func validateComponent(name string) error {
	if name == "" || !utf8.ValidString(name) || name == "." || name == ".." || strings.ContainsAny(name, "/\\") || strings.HasPrefix(name, "/") || isDriveName(name) {
		return &UnsafePathError{Name: name}
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return &UnsafePathError{Name: name}
		}
	}
	decoded := name
	for range 4 {
		next, err := url.PathUnescape(decoded)
		if err != nil || next == decoded {
			break
		}
		decoded = next
	}
	if decoded != name && (decoded == "." || decoded == ".." || strings.ContainsAny(decoded, "/\\") || isDriveName(decoded)) {
		return &UnsafePathError{Name: name}
	}
	// path.Clean is a final defense against future changes in path construction.
	if path.Clean("root/"+name) != "root/"+name {
		return &UnsafePathError{Name: name}
	}
	return nil
}

func isDriveName(name string) bool {
	return len(name) >= 2 && ((name[0] >= 'A' && name[0] <= 'Z') || (name[0] >= 'a' && name[0] <= 'z')) && name[1] == ':'
}
func equivalenceKey(p string) string {
	parts := strings.Split(p, "/")
	for i, part := range parts {
		parts[i] = strings.TrimRight(cases.Fold().String(norm.NFC.String(part)), ". ")
	}
	return strings.Join(parts, "/")
}
