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
