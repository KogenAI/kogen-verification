package verify

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

type identityTool struct {
	Name    string  `json:"name"`
	Path    *string `json:"path"`
	Status  string  `json:"status"`
	Version *string `json:"version"`
}
type identityLock struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type identityEnvironment struct {
	Names  []string `json:"names"`
	SHA256 string   `json:"sha256"`
}
type identityHost struct {
	Arch string `json:"arch"`
	OS   string `json:"os"`
}
type checkIdentity struct {
	Tree        string
	Tools       []identityTool
	Lockfiles   []identityLock
	Environment identityEnvironment
	Host        identityHost
	// reuseEnvironment is the sorted [name, value] pairs left after dropping the per-attempt
	// variables; it is set by snapshotIdentity and read by identityLogger.Log for reuse_sha256.
	reuseEnvironment [][2]string
}

func canonicalJSON(v any) []byte {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	_ = e.Encode(v)
	// encoding/json escapes these two characters even with HTML escaping disabled.
	out := bytes.TrimSuffix(b.Bytes(), []byte("\n"))
	var decoded []byte
	for i := 0; i < len(out); {
		if out[i] == '\\' && i+1 < len(out) {
			if i+6 <= len(out) && (string(out[i:i+6]) == `\u2028` || string(out[i:i+6]) == `\u2029`) {
				if out[i+5] == '8' {
					decoded = append(decoded, []byte("\u2028")...)
				} else {
					decoded = append(decoded, []byte("\u2029")...)
				}
				i += 6
			} else {
				decoded = append(decoded, out[i], out[i+1])
				i += 2
			}
		} else {
			decoded = append(decoded, out[i])
			i++
		}
	}
	out = decoded
	return out
}
func identityHash(v any) string {
	h := sha256.Sum256(canonicalJSON(v))
	return hex.EncodeToString(h[:])
}
func bytesHash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func environmentValues(s *sys.Session, tools Tools) map[string]string {
	values := map[string]string{}
	for _, e := range s.Env {
		if k, v, ok := strings.Cut(e, "="); ok {
			values[k] = v
		}
	}
	for k, v := range tools.env() {
		values[k] = v
	}
	for _, k := range []string{"KOGEN_STEP_RUN", "KOGEN_ACCEPTANCE_RUN", "KOGEN_CHECK_REPORT", "KOGEN_ACCEPTANCE_REPORT"} {
		delete(values, k)
	}
	return values
}

// perAttemptVariable reports whether the loop sets name differently for each attempt.
func perAttemptVariable(name string) bool {
	return strings.HasPrefix(name, "KL_") || name == "KOGEN_ATTEMPT_ID" || name == "KOGEN_GENERATION"
}

// reuseEnvironment lists the sorted [name, value] pairs without the per-attempt variables.
func reuseEnvironment(values map[string]string) [][2]string {
	names := make([]string, 0, len(values))
	for k := range values {
		if !perAttemptVariable(k) {
			names = append(names, k)
		}
	}
	sort.Strings(names)
	pairs := make([][2]string, 0, len(names))
	for _, k := range names {
		pairs = append(pairs, [2]string{k, values[k]})
	}
	return pairs
}

func stableEnvironment(s *sys.Session, tools Tools) (identityEnvironment, []string, string) {
	env, processEnv, path, _ := stableEnvironmentValues(s, tools)
	return env, processEnv, path
}

func stableEnvironmentValues(s *sys.Session, tools Tools) (identityEnvironment, []string, string, [][2]string) {
	values := environmentValues(s, tools)
	path := values["PATH"]
	names := make([]string, 0, len(values))
	for k := range values {
		names = append(names, k)
	}
	sort.Strings(names)
	pairs := make([][2]string, 0, len(names))
	env := make([]string, 0, len(names))
	for _, k := range names {
		pairs = append(pairs, [2]string{k, values[k]})
		env = append(env, k+"="+values[k])
	}
	return identityEnvironment{names, identityHash(pairs)}, env, path, reuseEnvironment(values)
}

type limitedOutput struct{ b []byte }

func (l *limitedOutput) Write(p []byte) (int, error) {
	n := len(p)
	if len(l.b) < 4096 {
		count := min(len(p), 4096-len(l.b))
		l.b = append(l.b, p[:count]...)
	}
	return n, nil
}
func resolveIdentityTool(name, path, dir string) string {
	for _, p := range filepath.SplitList(path) {
		if p == "" {
			p = "."
		}
		if !filepath.IsAbs(p) {
			p = filepath.Join(dir, p)
		}
		candidate := filepath.Join(p, name)
		st, err := os.Stat(candidate)
		if err == nil && st.Mode().IsRegular() && st.Mode()&0111 != 0 {
			abs, err := filepath.Abs(candidate)
			if err == nil && len(abs) <= 4096 {
				return abs
			}
		}
	}
	return ""
}

// identityProbeTimeout bounds one tool's version probe. It is generous because a working tool
// can take seconds to answer on a heavily loaded machine, and must not be reported as failed.
var identityProbeTimeout = 30 * time.Second

func probeIdentityTool(name, path, dir string, env []string) identityTool {
	t := identityTool{Name: name, Status: "absent"}
	resolved := resolveIdentityTool(name, path, dir)
	if resolved == "" {
		return t
	}
	recorded := resolved
	// A path under dir is recorded relative to it: dir is a random scratch folder.
	if rel, err := filepath.Rel(dir, resolved); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		recorded = rel
	}
	t.Path = &recorded
	t.Status = "error"
	args := []string{"--version"}
	if name == "go" {
		args = []string{"version"}
	}
	if name == "erl" {
		args = []string{"-noshell", "-eval", `io:format("~s~n", [erlang:system_info(otp_release)]), halt().`}
	}
	ctx, cancel := context.WithTimeout(context.Background(), identityProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, resolved, args...)
	cmd.Dir = dir
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = time.Second
	var output limitedOutput
	cmd.Stdout = &output
	cmd.Stderr = &output
	err := cmd.Run()
	if ctx.Err() != nil {
		t.Status = "timed_out"
		return t
	}
	if err != nil {
		return t
	}
	t.Status = "ok"
	line := ""
	for _, s := range strings.Split(string(output.b), "\n") {
		s = strings.TrimSuffix(s, "\r")
		if strings.TrimSpace(s) != "" {
			line = s
			break
		}
	}
	if len(line) > 512 {
		line = line[:512]
	}
	t.Version = &line
	return t
}
func snapshotIdentity(s *sys.Session, tools Tools, tree, dir string) checkIdentity {
	env, processEnv, path, reuseEnv := stableEnvironmentValues(s, tools)
	id := checkIdentity{Tree: tree, Tools: []identityTool{}, Lockfiles: []identityLock{}, Environment: env, Host: identityHost{runtime.GOARCH, runtime.GOOS}, reuseEnvironment: reuseEnv}
	for _, name := range []string{"go", "node", "npm", "ruby", "bundle", "python3", "elixir", "erl", "mix", "git", "quint"} {
		id.Tools = append(id.Tools, probeIdentityTool(name, path, dir, processEnv))
	}
	for _, name := range []string{"go.sum", "go.mod", "mix.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Gemfile.lock", "poetry.lock", "requirements.txt"} {
		if b, err := os.ReadFile(filepath.Join(dir, name)); err == nil {
			id.Lockfiles = append(id.Lockfiles, identityLock{name, bytesHash(b)})
		}
	}
	return id
}

// ReuseSnapshot holds what the check reuse key hashes besides the command: the tree, the tool
// probes, the lockfile hashes, the environment pairs without the per-attempt variables and the
// host. Make it once per tree with NewReuseSnapshot; Key then only hashes.
type ReuseSnapshot struct {
	tree        string
	tools       []identityTool
	lockfiles   []identityLock
	environment [][2]string
	host        identityHost
}

// NewReuseSnapshot probes the tools and lockfiles once, exactly as the verification identity does.
func NewReuseSnapshot(s *sys.Session, tools Tools, tree, dir string) ReuseSnapshot {
	return snapshotIdentity(s, tools, tree, dir).reuseSnapshot()
}

// Key is the reuse_sha256 a command event carries for command. It runs no probe and reads no file.
func (r ReuseSnapshot) Key(command string) string {
	return identityHash([]any{command, r.tree, r.tools, r.lockfiles, r.environment, r.host})
}

func (id checkIdentity) reuseSnapshot() ReuseSnapshot {
	return ReuseSnapshot{tree: id.Tree, tools: id.Tools, lockfiles: id.Lockfiles, environment: id.reuseEnvironment, host: id.Host}
}

type identityLogger struct {
	inner    Logger
	identity checkIdentity
}

func (l *identityLogger) Log(e map[string]any) {
	if e["event"] == "command" {
		command, _ := e["command"].(string)
		e["identity_sha256"] = identityHash([]any{e["command"], l.identity.Tree, l.identity.Tools, l.identity.Lockfiles, l.identity.Environment, l.identity.Host})
		e["reuse_sha256"] = l.identity.reuseSnapshot().Key(command)
	}
	l.inner.Log(e)
}
func (id checkIdentity) event() map[string]any {
	return map[string]any{"event": "check_identity", "tree": id.Tree, "tools": id.Tools, "lockfiles": id.Lockfiles, "environment": id.Environment, "host": id.Host}
}
