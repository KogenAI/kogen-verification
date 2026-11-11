package verify

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHostLoadFormats(t *testing.T) {
	for _, tc := range []struct {
		platform, text string
		want           *hostLoad
	}{
		{"linux", "0.07 0.33 1.97 1/188 1283753", &hostLoad{0.07, 0.33}},
		{"darwin", "{ 16.00 31.00 2.00 }", &hostLoad{16, 31}},
		{"linux", "bad 1 2", nil}, {"darwin", "{ 1 NaN 2 }", nil},
		{"linux", "-1 2 3", nil}, {"darwin", "1 2 3", nil},
		{"other", "1 2 3", nil},
	} {
		got := parseHostLoad(tc.platform, tc.text)
		if (got == nil) != (tc.want == nil) || got != nil && *got != *tc.want {
			t.Errorf("%s %q: got %v want %v", tc.platform, tc.text, got, tc.want)
		}
	}
	if readHostLoad("unsupported") != nil {
		t.Fatal("unsupported load should be unavailable")
	}
	// A missing sysctl executable is an unavailable reading, not an error.
	t.Setenv("PATH", filepath.Join(t.TempDir(), "missing"))
	if readHostLoad("darwin") != nil {
		t.Fatal("missing sysctl should be unavailable")
	}
}

func TestTimeoutLoadBoundaries(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		start, end *hostLoad
		want       []string
	}{
		{&hostLoad{16, 31}, &hostLoad{17, 30}, []string{"start: 1-minute 16.00, 5-minute 31.00", "end: 1-minute 17.00, 5-minute 30.00"}},
		{nil, &hostLoad{17, 30}, []string{"start: unavailable", "end: 1-minute 17.00"}},
		{&hostLoad{16, 31}, nil, []string{"start: 1-minute 16.00", "end: unavailable"}},
	} {
		text := timeoutLoad(&AttemptStep{LoadStart: tc.start, LoadEnd: tc.end})
		for _, want := range append(tc.want, "does not establish the cause") {
			if !strings.Contains(text, want) {
				t.Errorf("%q lacks %q", text, want)
			}
		}
	}
}

func TestAttemptPassEvidencePrivate(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	a := NewAttempt(root, "demo", nil)
	if err := a.Observe("snapshot", "git", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	a.retainPass()
	a.retainPass()
	paths, err := filepath.Glob(filepath.Join(attemptsDir(root), "*", "attempt.json"))
	if err != nil || len(paths) != 2 {
		t.Fatalf("paths %v: %v", paths, err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var rec map[string]any
		if err := json.Unmarshal(data, &rec); err != nil {
			t.Fatal(err)
		}
		_, failure := rec["failure"]
		if rec["outcome"] != "passed" || failure || len(rec["not_run"].([]any)) != 0 {
			t.Fatalf("record: %s", data)
		}
		for p, mode := range map[string]os.FileMode{path: 0600, filepath.Dir(path): 0700, attemptsDir(root): 0700} {
			st, err := os.Stat(p)
			if err != nil || st.Mode().Perm() != mode {
				t.Fatalf("mode %s: %v %v", p, st, err)
			}
		}
	}
}
