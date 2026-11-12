package verify

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

// BuildCache keeps the ignored build outputs (compiled dependencies, build folders) that a
// readiness check left in its scratch tree, so a later fresh copy of the same package, lockfiles
// and toolchain in the same run is seeded with them instead of compiling everything again. It
// lives in a temporary directory of its own for one run and is removed by Close; nothing in it
// outlives the run. Entries are keyed by the Intent, the lockfiles and manifests of the tree
// and the versions of the toolchain that built them, so a different package, lockfile or
// toolchain never receives another's outputs. A nil *BuildCache keeps and seeds nothing.
type BuildCache struct {
	mu      sync.Mutex
	dir     string
	entries map[string]*cacheEntry
	tools   map[string]string // toolchain command -> its version output
}

type cacheEntry struct {
	dir    string   // holds the kept paths
	origin string   // the tree they were built in
	paths  []string // relative to origin
}

// NewBuildCache returns an empty cache; its directory is created when first used.
func NewBuildCache() *BuildCache {
	return &BuildCache{entries: map[string]*cacheEntry{}, tools: map[string]string{}}
}

// Close removes everything the cache holds.
func (c *BuildCache) Close() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = map[string]*cacheEntry{}
	if c.dir == "" {
		return nil
	}
	err := os.RemoveAll(c.dir)
	c.dir = ""
	return err
}

// cacheLocks are the lockfiles whose presence lets a tree share build outputs, with the
// commands that identify the toolchain compiling for them. A tree without one of these is never
// cached.
var cacheLocks = map[string][]string{
	"mix.lock":            {"elixir --version"},
	"package-lock.json":   {"node --version"},
	"npm-shrinkwrap.json": {"node --version"},
	"yarn.lock":           {"node --version"},
	"pnpm-lock.yaml":      {"node --version"},
	"go.sum":              {"go version"},
	"Cargo.lock":          {"rustc --version", "cargo --version"},
}

// cacheManifests are further files that shape what is built from the lockfiles.
var cacheManifests = []string{"mix.exs", "package.json", "go.mod", "Cargo.toml", ".tool-versions", ".mise.toml", ".nvmrc", ".node-version", ".go-version"}

// key identifies the build outputs a tree of the Intent slug produces: the content of its
// lockfiles and manifests at every depth plus the versions of the toolchains its lockfiles name.
// It is empty when the tree has no known lockfile or a toolchain version cannot be read.
func (c *BuildCache) key(s *sys.Session, dir, slug string, paths []string) string {
	var files []string
	commands := map[string]bool{}
	for _, p := range paths {
		base := path.Base(p)
		if cmds, ok := cacheLocks[base]; ok {
			for _, cmd := range cmds {
				commands[cmd] = true
			}
			files = append(files, p)
		} else {
			for _, m := range cacheManifests {
				if base == m {
					files = append(files, p)
					break
				}
			}
		}
	}
	if len(commands) == 0 {
		return ""
	}
	h := sha256.New()
	h.Write([]byte("kogen-build-cache-v1\x00" + slug + "\x00"))
	sort.Strings(files)
	for _, p := range files {
		b, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(p)))
		if err != nil {
			return ""
		}
		sum := sha256.Sum256(b)
		h.Write([]byte(p + "\x00" + hex.EncodeToString(sum[:]) + "\x00"))
	}
	var cmds []string
	for cmd := range commands {
		cmds = append(cmds, cmd)
	}
	sort.Strings(cmds)
	for _, cmd := range cmds {
		v, ok := c.toolchain(s, dir, cmd)
		if !ok {
			return ""
		}
		h.Write([]byte(cmd + "\x00" + v + "\x00"))
	}
	return hex.EncodeToString(h.Sum(nil))
}

func (c *BuildCache) toolchain(s *sys.Session, dir, cmd string) (string, bool) {
	c.mu.Lock()
	v, ok := c.tools[cmd]
	c.mu.Unlock()
	if ok {
		return v, v != ""
	}
	res, err := s.Run(cmd, dir, sys.Options{Timeout: 30 * time.Second, KillGroupOnExit: true})
	if err == nil && res.Status == 0 {
		v = strings.TrimSpace(res.Output)
	}
	c.mu.Lock()
	c.tools[cmd] = v
	c.mu.Unlock()
	return v, v != ""
}

// Seed copies the outputs kept under key into the fresh tree dst; paths dst already holds stay.
func (c *BuildCache) Seed(key, dst string) error {
	if c == nil || key == "" {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock() // a concurrent Keep must not remove the entry while it is copied
	e := c.entries[key]
	if e == nil {
		return nil
	}
	return seedPaths(e.dir, dst, e.paths, []string{e.origin})
}

// Keep moves the ignored paths of the scratch tree, about to be removed, into the cache under
// key, replacing what the key held. A failure only leaves the cache without them.
func (c *BuildCache) Keep(key, scratch string) {
	if c == nil || key == "" {
		return
	}
	rels, err := ignoredPaths(scratch)
	if err != nil || len(rels) == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.dir == "" {
		d, err := os.MkdirTemp("", "kogen-buildcache-")
		if err != nil {
			return
		}
		c.dir = d
	}
	if old := c.entries[key]; old != nil {
		os.RemoveAll(old.dir)
		delete(c.entries, key)
	}
	dir, err := os.MkdirTemp(c.dir, "entry-")
	if err != nil {
		return
	}
	e := &cacheEntry{dir: dir, origin: filepath.Clean(scratch)}
	for _, rel := range rels {
		to := filepath.Join(dir, rel)
		if os.MkdirAll(filepath.Dir(to), 0o755) != nil {
			continue
		}
		if err := os.Rename(filepath.Join(scratch, rel), to); err != nil {
			if _, e2 := os.Lstat(filepath.Join(scratch, rel)); e2 != nil {
				continue
			}
			os.RemoveAll(to)
			if exec.Command("cp", "-Rp", filepath.Join(scratch, rel), to).Run() != nil {
				os.RemoveAll(to)
				continue
			}
		}
		e.paths = append(e.paths, rel)
	}
	c.entries[key] = e
}

// cacheKey is the key of the materialized tree in dir (paths are its entries) for the Intent
// slug, or "" when its build outputs are not shared.
func (r *Readiness) cacheKey(s *sys.Session, dir, slug string, paths []string) string {
	if r.Cache == nil {
		return ""
	}
	return r.Cache.key(s, dir, slug, paths)
}

// KeepBuild keeps the ignored build outputs of the scratch tree in the run's cache (nothing
// without one).
func (r *Readiness) KeepBuild(key, scratch string) { r.Cache.Keep(key, scratch) }

// SeedBuild seeds the fresh tree dst, a copy of the tree whose paths are given, with the build
// outputs kept for the same Intent, lockfiles and toolchain. It reports the key to Keep with.
func (r *Readiness) SeedBuild(s *sys.Session, dst, slug string, paths []string) string {
	key := r.cacheKey(s, dst, slug, paths)
	if err := r.Cache.Seed(key, dst); err != nil {
		s.Progress("kogen: cached build outputs not reused: " + err.Error())
	}
	return key
}
