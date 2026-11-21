package verify

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// candidatePhase is one fixed phase of RunCandidate: its name in the receipt and the command
// it runs in the working copy of the fixture ("" program: the packaged candidate binary).
type candidatePhase struct {
	name string
	prog string
	args []string
}

// candidatePhaseTimeout bounds one phase so that a hung candidate cannot hang the qualification.
const candidatePhaseTimeout = 10 * time.Minute

// candidateReceipt is the receipt line printed after `candidate-build: landed`.
type candidateReceipt struct {
	BinarySHA256   string   `json:"binary_sha256"`
	Project        string   `json:"project"`
	Phases         []string `json:"phases"`
	ElapsedSeconds float64  `json:"elapsed_seconds"`
}

// RunCandidate implements `kogen verify candidate --project <fixture directory>`; args are the
// arguments after `verify candidate`. It runs the packaged candidate (the running executable)
// against a temporary copy of the fixture project, with KOGEN_PROVIDER=scripted, through the
// phases install, shape, build, resume, restore and land, and returns the exit code: 0 after
// `candidate-build: landed` and the receipt, 1 after `candidate-build: failed <phase>`, 2 after
// `candidate-build: unavailable` (no readable fixture directory or binary). The output of the
// phases goes to stderr, so stdout holds only the result lines.
func RunCandidate(args []string, stdout, stderr io.Writer) int {
	start := time.Now()
	unavailable := func(why string) int {
		fmt.Fprintln(stderr, "candidate-build: "+why)
		fmt.Fprintln(stdout, "candidate-build: unavailable")
		return 2
	}
	project, ok := candidateProjectArg(args)
	if !ok {
		return unavailable("--project <fixture directory> is required")
	}
	if st, err := os.Stat(project); err != nil || !st.IsDir() {
		return unavailable("fixture directory " + project + " is not a readable directory")
	}
	exe, err := os.Executable()
	if err != nil {
		return unavailable("the packaged binary cannot be located: " + err.Error())
	}
	sum, err := fileSHA256(exe)
	if err != nil {
		return unavailable("the packaged binary is unreadable: " + err.Error())
	}
	work, err := os.MkdirTemp("", "kogen-candidate-")
	if err != nil {
		return unavailable("no temporary working directory: " + err.Error())
	}
	defer os.RemoveAll(work)
	if err := copyTree(project, work); err != nil {
		return unavailable("the fixture directory cannot be copied: " + err.Error())
	}

	phases := []candidatePhase{
		{"install", "npm", []string{"install", "--offline", "--no-audit", "--no-fund", "--ignore-scripts"}},
		{"shape", exe, []string{"shape"}},
		{"build", exe, []string{"build"}},
		{"resume", exe, []string{"build", "--resume"}},
		{"restore", exe, []string{"restore"}},
		{"land", exe, []string{"land"}},
	}
	done := []string{}
	for _, p := range phases {
		if err := runCandidatePhase(work, p, stderr); err != nil {
			fmt.Fprintf(stderr, "candidate-build: phase %s: %v\n", p.name, err)
			fmt.Fprintln(stdout, "candidate-build: failed "+p.name)
			return 1
		}
		done = append(done, p.name)
	}
	line, err := json.Marshal(candidateReceipt{
		BinarySHA256:   sum,
		Project:        project,
		Phases:         done,
		ElapsedSeconds: time.Since(start).Seconds(),
	})
	if err != nil {
		fmt.Fprintln(stderr, "candidate-build: receipt: "+err.Error())
		fmt.Fprintln(stdout, "candidate-build: failed land")
		return 1
	}
	fmt.Fprintln(stdout, "candidate-build: landed")
	fmt.Fprintln(stdout, string(line))
	return 0
}

// candidateProjectArg returns the value of --project (`--project dir` or `--project=dir`).
func candidateProjectArg(args []string) (string, bool) {
	for i, a := range args {
		if v, ok := strings.CutPrefix(a, "--project="); ok {
			return v, v != ""
		}
		if a == "--project" {
			if i+1 < len(args) && args[i+1] != "" {
				return args[i+1], true
			}
			return "", false
		}
	}
	return "", false
}

func runCandidatePhase(dir string, p candidatePhase, stderr io.Writer) error {
	ctx, cancel := context.WithTimeout(context.Background(), candidatePhaseTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, p.prog, p.args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "KOGEN_PROVIDER=scripted")
	cmd.Stdout = stderr
	cmd.Stderr = stderr
	cmd.WaitDelay = 5 * time.Second
	return cmd.Run()
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// copyTree copies the directory src into the existing directory dst: directories, regular
// files (with their permission bits) and symbolic links.
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		switch {
		case d.IsDir():
			return os.MkdirAll(target, 0o755)
		case d.Type()&fs.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		case d.Type().IsRegular():
			info, err := d.Info()
			if err != nil {
				return err
			}
			in, err := os.Open(path)
			if err != nil {
				return err
			}
			defer in.Close()
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_EXCL, info.Mode().Perm())
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, in); err != nil {
				out.Close()
				return err
			}
			return out.Close()
		}
		return nil
	})
}
