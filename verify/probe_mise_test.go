package verify

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-loop/sys"
)

func TestProbeKeepsInstalledMiseData(t *testing.T) {
	base := t.TempDir()
	home := filepath.Join(base, "home")
	xdg := filepath.Join(base, "xdg")
	explicit := filepath.Join(base, "explicit")
	root := t.TempDir()
	for _, tc := range []struct {
		name, data string
		env        []string
	}{
		{"default", filepath.Join(home, ".local/share/mise"), []string{"MISE_DATA_DIR=", "XDG_DATA_HOME="}},
		{"xdg", filepath.Join(xdg, "mise"), []string{"MISE_DATA_DIR=", "XDG_DATA_HOME=" + xdg}},
		{"explicit", explicit, []string{"MISE_DATA_DIR=" + explicit, "XDG_DATA_HOME=" + xdg}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := filepath.Join(tc.data, "installs/ruby/3.4.8")
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "package"), []byte("installed rails package\n"), 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "run"), []byte("#!/bin/sh\ncat \"$(dirname \"$0\")/package\"\n"), 0755); err != nil {
				t.Fatal(err)
			}
			env := append([]string{"HOME=" + home, "PROBE_SECRET=secret", "GEM_HOME=wrong", "GEM_PATH=wrong", "BUNDLE_PATH=wrong"}, tc.env...)
			command := `test -z "${XDG_DATA_HOME:-}${PROBE_SECRET:-}${GEM_HOME:-}${GEM_PATH:-}${BUNDLE_PATH:-}" && test ! -e "$HOME/marker" && "$MISE_DATA_DIR/installs/ruby/3.4.8/run"`
			if err := os.WriteFile(filepath.Join(home, "marker"), []byte("private"), 0600); err != nil {
				t.Fatal(err)
			}
			got, err := (Probe{Root: root, Command: command}).Run(context.Background(), sys.NewWith(testEnv(env...), root))
			if err != nil || got.Status != 0 || got.Output != "installed rails package\n" {
				t.Fatalf("probe = %+v, err %v", got, err)
			}
		})
	}
}
