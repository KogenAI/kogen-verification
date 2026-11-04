package verify

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func TestIdentityEnvironmentAndHash(t *testing.T) {
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
	for name, script := range map[string]string{"node": "printf '\\nfirst\\nsecond\\n'", "npm": "exit 1", "ruby": "sleep 5"} {
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
	id := snapshotIdentity(sys.NewWith([]string{"PATH=" + bin}, dir), Tools{}, "tree", dir)
	if len(id.Lockfiles) != 1 || id.Lockfiles[0] != (identityLock{"go.mod", bytesHash([]byte("test"))}) {
		t.Fatal(id.Lockfiles)
	}
	if id.Tools[0].Status != "absent" || id.Tools[1].Status != "ok" || *id.Tools[1].Version != "first" || id.Tools[2].Status != "error" || id.Tools[3].Status != "timed_out" {
		t.Fatal(id.Tools)
	}
}

func TestIdentityVerifyStage(t *testing.T) {
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
