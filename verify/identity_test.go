package verify

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func TestIdentityEnvironmentAndHash(t *testing.T) {
	t.Parallel()
	s := sys.NewWith([]string{"Z=old", "PATH=/bin", "Z=new", "KOGEN_STEP_RUN=random", "KOGEN_NODE=old", "SECRET=<value>"}, "")
	env, _, _ := stableEnvironment(s, Tools{Node: "/node"})
	if strings.Join(env.Names, ",") != "KOGEN_NODE,PATH,SECRET,Z" {
		t.Fatal(env.Names)
	}
	if env.SHA256 != identityHash([][2]string{{"KOGEN_NODE", "/node"}, {"PATH", "/bin"}, {"SECRET", "<value>"}, {"Z", "new"}}) {
		t.Fatal(env)
	}
	if got := string(canonicalJSON([]any{"<x>", identityHost{Arch: "amd64", OS: "linux"}})); got != `["<x>",{"arch":"amd64","os":"linux"}]` {
		t.Fatal(got)
	}
	base := []any{"command", "tree", []identityTool{{Name: "node", Status: "ok"}}, []identityLock{{Path: "go.sum", SHA256: "a"}}, env, identityHost{Arch: "amd64", OS: "linux"}}
	original := identityHash(base)
	for i, v := range []any{"other", "other", []identityTool{{Name: "node", Status: "error"}}, []identityLock{{Path: "go.sum", SHA256: "b"}}, identityEnvironment{Names: env.Names, SHA256: "changed"}} {
		copyBase := append([]any(nil), base...)
		copyBase[i] = v
		if identityHash(copyBase) == original {
			t.Fatalf("unchanged at %d", i)
		}
	}
}

func TestIdentitySnapshotFilesAndProbes(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	for name, script := range map[string]string{"node": "printf '\\nfirst\\nsecond\\n'", "npm": "exit 1", "ruby": "sleep 600"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\n"+script+"\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "nested", "go.sum"), []byte("ignored"), 0600)
	// sleep must resolve under the isolated PATH.
	os.Symlink("/bin/sleep", filepath.Join(bin, "sleep"))
	defer func(d time.Duration) { identityProbeTimeout = d }(identityProbeTimeout)
	identityProbeTimeout = 3 * time.Second
	id := snapshotIdentity(sys.NewWith([]string{"PATH=" + bin}, dir), Tools{}, "tree", dir)
	if len(id.Lockfiles) != 1 || id.Lockfiles[0] != (identityLock{"go.mod", bytesHash([]byte("test"))}) {
		t.Fatal(id.Lockfiles)
	}
	if id.Tools[0].Status != "absent" || id.Tools[1].Status != "ok" || *id.Tools[1].Version != "first" || id.Tools[2].Status != "error" || id.Tools[3].Status != "timed_out" {
		t.Fatal(id.Tools)
	}
}

// A slow but working tool (answering after the old fixed 1-second limit) is still reported ok.
func TestIdentitySlowToolIsNotReportedMissing(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "node"), []byte("#!/bin/sh\nsleep 1.5\necho v1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	os.Symlink("/bin/sleep", filepath.Join(bin, "sleep"))
	got := probeIdentityTool("node", bin, dir, []string{"PATH=" + bin})
	if got.Status != "ok" || got.Version == nil || *got.Version != "v1" {
		t.Fatalf("slow tool probe = %+v, want ok with version v1", got)
	}
}

func TestIdentityVerifyStage(t *testing.T) {
	t.Parallel()
	p := newProj(t)
	s, _ := p.session()
	in := p.input(1)
	in.Stage = &Stage{ID: "empty"}
	log := &memLog{}
	in.Log = log
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	events := log.named("check_identity")
	if len(events) != 1 || events[0]["tree"] != pass.Tree || len(log.named("command")) != 0 {
		t.Fatal(log.events)
	}
	in.Stage.Checks = []string{":", ": # next"}
	log = &memLog{}
	in.Log = log
	pass, err = Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	if !pass.Green {
		t.Fatal(pass)
	}
	if len(log.named("check_identity")) != 1 || len(log.named("command")) != 2 {
		t.Fatal(log.events)
	}
	for _, event := range log.named("command") {
		if len(event["identity_sha256"].(string)) != 64 {
			t.Fatal(event)
		}
	}
}

func TestIdentityConcurrentCommands(t *testing.T) {
	t.Parallel()
	p := newProj(t)
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "go"), []byte("#!/bin/sh\necho stub\n"), 0700); err != nil {
		t.Fatal(err)
	}
	p.Env = append(p.Env, "PATH="+bin+":"+os.Getenv("PATH"))
	p.Config.Checks = []project.Check{{Name: "build", Run: "go build ./..."}, {Name: "vet", Run: "go vet ./..."}}
	s := sys.NewWith(p.Env, p.Root)
	in := p.input(1)
	log := &memLog{}
	in.Log = log
	pass, err := Verify(context.Background(), s, in)
	if err != nil || !pass.Green {
		t.Fatalf("pass: %+v %v", pass, err)
	}
	ids := log.named("check_identity")
	if len(ids) != 1 {
		t.Fatal(ids)
	}
	id := ids[0]
	commands := log.named("command")
	if len(commands) != 3 {
		t.Fatal(commands)
	}
	for _, e := range commands {
		want := identityHash([]any{e["command"], id["tree"], id["tools"], id["lockfiles"], id["environment"], id["host"]})
		if e["identity_sha256"] != want {
			t.Fatal(e)
		}
	}
}

func TestIdentityOutputAndEmptyEnvironment(t *testing.T) {
	t.Parallel()
	env, _, _ := stableEnvironment(sys.NewWith(nil, ""), Tools{})
	if len(env.Names) != 0 || env.SHA256 != bytesHash([]byte("[]")) {
		t.Fatal(env)
	}
	var output limitedOutput
	if n, err := output.Write([]byte(strings.Repeat("x", 5000))); err != nil || n != 5000 || len(output.b) != 4096 {
		t.Fatal(n, err, len(output.b))
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "node"), []byte("#!/bin/sh\nprintf '"+strings.Repeat("x", 600)+"\\nignored\\n'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	tool := probeIdentityTool("node", dir, dir, []string{"PATH=" + dir})
	if tool.Status != "ok" || tool.Version == nil || *tool.Version != strings.Repeat("x", 512) {
		t.Fatal(tool)
	}
}

func identityToolPath(t *testing.T, tools any, name string) any {
	t.Helper()
	for _, tool := range tools.([]identityTool) {
		if tool.Name == name {
			if tool.Path == nil {
				return nil
			}
			return *tool.Path
		}
	}
	t.Fatalf("no tool %s in %v", name, tools)
	return nil
}

func TestIdentityEmptyPathEntryIsRelativeAndStable(t *testing.T) {
	t.Parallel()
	p := newProj(t)
	bin := t.TempDir()
	for _, name := range []string{"sh", "grep", "cp", "git"} {
		src, err := exec.LookPath(name)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(src, filepath.Join(bin, name)); err != nil {
			t.Fatal(err)
		}
	}
	p.write("node", "#!/bin/sh\necho stub node v1\n")
	if err := os.Chmod(filepath.Join(p.Root, "node"), 0755); err != nil {
		t.Fatal(err)
	}
	p.commit("node stub")
	p.Env = append(slices.DeleteFunc(p.Env, func(kv string) bool { return strings.HasPrefix(kv, "PATH=") }), "PATH="+bin+":")
	s := sys.NewWith(p.Env, p.Root)
	hashes := map[string][]any{}
	for range 2 {
		log := &memLog{}
		in := p.input(1)
		in.Log = log
		pass, err := Verify(context.Background(), s, in)
		if err != nil || !pass.Green {
			t.Fatalf("pass: %+v %v", pass, err)
		}
		ids := log.named("check_identity")
		if len(ids) != 1 {
			t.Fatal(ids)
		}
		if got := identityToolPath(t, ids[0]["tools"], "node"); got != "node" {
			t.Fatalf("node path %v", got)
		}
		if got := identityToolPath(t, ids[0]["tools"], "git"); got != filepath.Join(bin, "git") {
			t.Fatalf("git path %v", got)
		}
		for _, e := range log.named("command") {
			hashes[e["command"].(string)] = append(hashes[e["command"].(string)], e["identity_sha256"])
		}
	}
	if len(hashes) == 0 {
		t.Fatal("no commands")
	}
	for command, h := range hashes {
		if len(h) != 2 || h[0] != h[1] {
			t.Fatalf("%s: %v", command, h)
		}
	}
}

func TestIdentityRelativePathEntryRecordsPathUnderDir(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "tools"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(dir, "tools", "node"), filepath.Join(outside, "git")} {
		if err := os.WriteFile(path, []byte("#!/bin/sh\necho stub\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	id := snapshotIdentity(sys.NewWith([]string{"PATH=" + outside + ":tools"}, dir), Tools{}, "tree", dir)
	var node, git identityTool
	for _, tool := range id.Tools {
		switch tool.Name {
		case "node":
			node = tool
		case "git":
			git = tool
		}
	}
	if node.Path == nil || *node.Path != "tools/node" || node.Status != "ok" {
		t.Fatal(node)
	}
	if git.Path == nil || *git.Path != filepath.Join(outside, "git") {
		t.Fatal(git)
	}
}

func TestIdentityVersionLineCapBoundary(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "node"), []byte("#!/bin/sh\nprintf '"+strings.Repeat("y", 513)+"\\n'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	tool := probeIdentityTool("node", dir, dir, []string{"PATH=" + dir})
	if tool.Version == nil || *tool.Version != strings.Repeat("y", 512) {
		t.Fatal(tool)
	}
}

type reuseTestLog struct{ events []map[string]any }

func (l *reuseTestLog) Log(e map[string]any) { l.events = append(l.events, e) }

func reuseTestIdentity(tree string, env ...string) checkIdentity {
	dir := os.TempDir()
	id := snapshotIdentity(sys.NewWith(append([]string{"PATH=/nonexistent-reuse-bin"}, env...), dir), Tools{}, tree, dir)
	id.Lockfiles = []identityLock{{Path: "go.sum", SHA256: "a"}}
	id.Host = identityHost{Arch: "amd64", OS: "linux"}
	return id
}

func reuseTestEvent(id checkIdentity) map[string]any {
	log := &reuseTestLog{}
	(&identityLogger{inner: log, identity: id}).Log(map[string]any{"event": "command", "command": "go build ./..."})
	return log.events[0]
}

func reuseTestKey(t *testing.T, id checkIdentity) string {
	t.Helper()
	key, ok := reuseTestEvent(id)["reuse_sha256"].(string)
	if !ok || len(key) != 64 || strings.ToLower(key) != key {
		t.Fatalf("reuse_sha256 = %v", reuseTestEvent(id)["reuse_sha256"])
	}
	return key
}

func TestReuseKeyIgnoresAttemptVariables(t *testing.T) {
	t.Parallel()
	a := reuseTestIdentity("tree", "KOGEN_ATTEMPT_ID=1", "KOGEN_GENERATION=1", "KL_LOOP=a", "KL_ONLY_A=x", "KEEP=same")
	b := reuseTestIdentity("tree", "KOGEN_ATTEMPT_ID=2", "KOGEN_GENERATION=2", "KL_LOOP=b", "KEEP=same")
	if reuseTestKey(t, a) != reuseTestKey(t, b) {
		t.Fatal("per-attempt variables changed reuse_sha256")
	}
	if reuseTestEvent(a)["identity_sha256"] == reuseTestEvent(b)["identity_sha256"] {
		t.Fatal("identity_sha256 should still see the per-attempt variables")
	}
	for _, other := range []string{"KEEP=different", "KOGEN_OTHER=x", "KOGEN_ATTEMPT_ID_X=x"} {
		if reuseTestKey(t, reuseTestIdentity("tree", "KEEP=same")) == reuseTestKey(t, reuseTestIdentity("tree", other)) {
			t.Fatalf("%s did not change reuse_sha256", other)
		}
	}
}

func TestReuseKeyEnvironmentIsSortedPairs(t *testing.T) {
	t.Parallel()
	id := reuseTestIdentity("tree", "Z=1", "KL_X=1", "A=2")
	want := identityHash([]any{"go build ./...", id.Tree, id.Tools, id.Lockfiles, [][2]string{{"A", "2"}, {"PATH", "/nonexistent-reuse-bin"}, {"Z", "1"}}, id.Host})
	if got := reuseTestKey(t, id); got != want {
		t.Fatalf("reuse_sha256 = %s, want %s", got, want)
	}
	empty := snapshotIdentity(sys.NewWith([]string{"KL_X=1", "KOGEN_ATTEMPT_ID=1", "KOGEN_GENERATION=1"}, ""), Tools{}, "tree", t.TempDir())
	want = identityHash([]any{"go build ./...", empty.Tree, empty.Tools, empty.Lockfiles, []any{}, empty.Host})
	if got := reuseTestKey(t, empty); got != want {
		t.Fatalf("empty environment: reuse_sha256 = %s, want %s", got, want)
	}
}

func TestReuseKeyChangesWithTreeToolsLockfilesHostAndPath(t *testing.T) {
	t.Parallel()
	version, other := "go version go1.27.2", "go version go1.27.3"
	fresh := func() checkIdentity {
		id := reuseTestIdentity("tree")
		id.Tools[0].Status, id.Tools[0].Version = "ok", &version
		return id
	}
	for name, change := range map[string]func(*checkIdentity){
		"tree":         func(id *checkIdentity) { id.Tree = "other" },
		"tool version": func(id *checkIdentity) { id.Tools[0].Version = &other },
		"lockfile":     func(id *checkIdentity) { id.Lockfiles[0].SHA256 = "b" },
		"host arch":    func(id *checkIdentity) { id.Host.Arch = "arm64" },
	} {
		b := fresh()
		change(&b)
		if reuseTestKey(t, fresh()) == reuseTestKey(t, b) {
			t.Errorf("reuse_sha256 unchanged when only the %s differs", name)
		}
	}
	a := snapshotIdentity(sys.NewWith([]string{"PATH=/nonexistent-a"}, ""), Tools{}, "tree", t.TempDir())
	b := snapshotIdentity(sys.NewWith([]string{"PATH=/nonexistent-b"}, ""), Tools{}, "tree", t.TempDir())
	if reuseTestKey(t, a) == reuseTestKey(t, b) {
		t.Error("reuse_sha256 unchanged when only PATH differs")
	}
}

func TestIdentityEventKeepsSixFieldsAndOldHash(t *testing.T) {
	t.Parallel()
	id := reuseTestIdentity("tree", "KOGEN_ATTEMPT_ID=7", "KL_LOOP=x")
	if len(id.event()) != 6 {
		t.Fatal(id.event())
	}
	if got, want := reuseTestEvent(id)["identity_sha256"], identityHash([]any{"go build ./...", id.Tree, id.Tools, id.Lockfiles, id.Environment, id.Host}); got != want {
		t.Fatalf("identity_sha256 = %v, want %s", got, want)
	}
}

func TestReuseSnapshotKeyEqualsLoggedReuseHash(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.sum"), []byte("example.com/m v1.0.0 h1:abc=\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := []string{"PATH=/nonexistent-reuse-bin", "KEEP=same", "KL_LOOP=one"}
	snap := NewReuseSnapshot(sys.NewWith(env, dir), Tools{}, "tree", dir)
	id := snapshotIdentity(sys.NewWith(env, dir), Tools{}, "tree", dir)
	if len(id.Lockfiles) != 1 {
		t.Fatalf("lockfiles = %v", id.Lockfiles)
	}
	if got, want := snap.Key("go build ./..."), reuseTestKey(t, id); got != want {
		t.Fatalf("Key = %s, logged reuse_sha256 = %s", got, want)
	}
	if snap.Key("go build ./...") == snap.Key("go vet ./...") {
		t.Fatal("Key ignores the command")
	}
}

func TestReuseSnapshotKeyIgnoresAttemptVariablesAndSeesCommandTreePath(t *testing.T) {
	t.Parallel()
	key := func(tree, command string, env ...string) string {
		dir := t.TempDir()
		return NewReuseSnapshot(sys.NewWith(env, dir), Tools{}, tree, dir).Key(command)
	}
	const bin = "PATH=/nonexistent-reuse-bin"
	base := key("tree", "go build ./...", bin, "KEEP=same")
	if got := key("tree", "go build ./...", bin, "KEEP=same", "KOGEN_ATTEMPT_ID=9", "KOGEN_GENERATION=4", "KL_LOOP=z"); got != base {
		t.Fatal("per-attempt variables changed the key")
	}
	for name, other := range map[string]string{
		"command": key("tree", "go vet ./...", bin, "KEEP=same"),
		"tree":    key("other", "go build ./...", bin, "KEEP=same"),
		"PATH":    key("tree", "go build ./...", "PATH=/nonexistent-other", "KEEP=same"),
	} {
		if other == base {
			t.Errorf("key unchanged when only the %s differs", name)
		}
	}
}

func TestReuseAndIdentityHashesEqualRecordedLiterals(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	env := []string{"PATH=/nonexistent-reuse-key-bin", "KOGEN_ATTEMPT_ID=attempt-7", "KOGEN_GENERATION=3", "KL_LOOP=x", "KEEP=same"}
	id := snapshotIdentity(sys.NewWith(env, dir), Tools{}, "tree-1", dir)
	id.Host = identityHost{Arch: "amd64", OS: "linux"}
	event := reuseTestEvent(id)
	if got, want := event["identity_sha256"], "8137b72363f3231a101ef79eeb7c3fb2cc8eda5ac992c394fe0b0659c419c30e"; got != want {
		t.Errorf("identity_sha256 = %v, want %s", got, want)
	}
	if got, want := event["reuse_sha256"], "8a176cc44f9d2de5655b24a04057290ae0133603c84475b715917c73cbd66914"; got != want {
		t.Errorf("reuse_sha256 = %v, want %s", got, want)
	}
}
