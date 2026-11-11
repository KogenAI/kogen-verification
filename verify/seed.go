package verify

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// SeedIgnored copies the git-ignored paths of the checkout src (build outputs, dependency
// caches) into the fresh tree dst, so setup and compilation there are incremental. Copies are
// copy-on-write where the file system allows. Tracked content wins: a path already present in
// dst is never replaced. .git and .kogen, which Kogen itself writes, are never copied.
func SeedIgnored(src, dst string) error {
	cmd := exec.Command("git", "-C", src, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("listing ignored paths of %s: %v: %s", src, err, strings.TrimSpace(stderr.String()))
	}
	flags := []string{"-a", "--reflink=auto"}
	if runtime.GOOS == "darwin" {
		flags = []string{"-cRp"}
	}
	var seeded []string
	for _, rel := range strings.Split(string(out), "\x00") {
		rel = strings.TrimSuffix(rel, "/")
		if rel == "" || rel == ".git" || rel == ".kogen" || strings.HasPrefix(rel, ".git/") || strings.HasPrefix(rel, ".kogen/") {
			continue
		}
		to := filepath.Join(dst, rel)
		if _, err := os.Lstat(to); err == nil {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
			return err
		}
		from := filepath.Join(src, rel)
		args := append(append([]string{}, flags...), from, to)
		if b, err := exec.Command("cp", args...).CombinedOutput(); err != nil {
			if _, e := os.Lstat(from); e != nil {
				continue // vanished while building
			}
			// Fall back to a plain copy where cloning is unsupported.
			os.RemoveAll(to)
			if b2, err2 := exec.Command("cp", "-Rp", from, to).CombinedOutput(); err2 != nil {
				return fmt.Errorf("seeding %s: %s%s", rel, b, b2)
			}
		}
		seeded = append(seeded, rel)
	}
	return excludeSeeded(dst, seeded)
}

// excludeSeeded keeps the seeded paths ignored in a scratch repository, which does not share the
// checkout's local exclude rules, so they never read as files added there.
func excludeSeeded(dst string, seeded []string) error {
	if st, err := os.Stat(filepath.Join(dst, ".git")); err != nil || !st.IsDir() || len(seeded) == 0 {
		return nil
	}
	info := filepath.Join(dst, ".git", "info")
	if err := os.MkdirAll(info, 0o755); err != nil {
		return err
	}
	esc := strings.NewReplacer(`\`, `\\`, "*", `\*`, "?", `\?`, "[", `\[`, " ", `\ `, "#", `\#`, "!", `\!`)
	var b strings.Builder
	for _, rel := range seeded {
		b.WriteString("/" + esc.Replace(rel) + "\n")
	}
	f, err := os.OpenFile(filepath.Join(info, "exclude"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(b.String())
	return err
}
