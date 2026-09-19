package handlers

import "testing"

func TestMaterializationIdentityIncludesBothOptionalSources(t *testing.T) {
	base := materializationIdentity(
		materializationSource{present: true, etag: "snapshot-v1"},
		materializationSource{present: true, etag: "updates-v1"},
	)
	cases := []struct {
		name     string
		snapshot materializationSource
		pending  materializationSource
	}{
		{"snapshot changes", materializationSource{true, "snapshot-v2"}, materializationSource{true, "updates-v1"}},
		{"pending changes", materializationSource{true, "snapshot-v1"}, materializationSource{true, "updates-v2"}},
		{"pending disappears", materializationSource{true, "snapshot-v1"}, materializationSource{}},
		{"snapshot disappears", materializationSource{}, materializationSource{true, "updates-v1"}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := materializationIdentity(tt.snapshot, tt.pending); got == base {
				t.Fatalf("identity did not change: %q", got)
			}
		})
	}
}

func TestMaterializationIdentityIsDeterministicAndOpaqueETagSafe(t *testing.T) {
	source := materializationSource{present: true, etag: `etag;with=delimiters`}
	if got, want := materializationIdentity(source, materializationSource{}), materializationIdentity(source, materializationSource{}); got != want {
		t.Fatalf("identity is not deterministic: %q != %q", got, want)
	}
}
