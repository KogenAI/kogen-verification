const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const P = 'setup-tools-rejects-non-file-manifests: ';
const root = process.cwd();

// A Go test driver compiled with the real cmd/setup-tools/main.go in a scratch module. It lays out the
// entries named by DRIVER_SPEC in a fresh working directory, puts a fake npm that touches a marker first
// on PATH, calls run() or writeMissing, and prints one RESULT line of JSON.
const driverSource = String.raw`package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

type specEntry struct {
	Path    string ` + '`json:"path"`' + String.raw`
	Kind    string ` + '`json:"kind"`' + String.raw`
	Content string ` + '`json:"content"`' + String.raw`
}

type spec struct {
	Entry   string      ` + '`json:"entry"`' + String.raw`
	Tool    string      ` + '`json:"tool"`' + String.raw`
	Entries []specEntry ` + '`json:"entries"`' + String.raw`
}

type seen struct {
	Kind    string ` + '`json:"kind"`' + String.raw`
	Content string ` + '`json:"content"`' + String.raw`
}

func TestDriver(t *testing.T) {
	var s spec
	if err := json.Unmarshal([]byte(os.Getenv("DRIVER_SPEC")), &s); err != nil {
		t.Fatal(err)
	}
	work := t.TempDir()
	t.Chdir(work)
	marker := filepath.Join(work, "npm-called")
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "npm"), []byte("#!/bin/sh\ntouch '"+marker+"'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	for _, e := range s.Entries {
		if err := os.MkdirAll(filepath.Dir(e.Path), 0o755); err != nil {
			t.Fatal(err)
		}
		var err error
		switch e.Kind {
		case "dir":
			err = os.Mkdir(e.Path, 0o755)
		case "fifo":
			err = syscall.Mkfifo(e.Path, 0o644)
		case "file":
			err = os.WriteFile(e.Path, []byte(e.Content), 0o644)
		default:
			err = fmt.Errorf("unknown kind %q", e.Kind)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	var runErr error
	if s.Entry == "run" {
		runErr = run()
	} else {
		runErr = writeMissing(s.Tool)
	}
	out := struct {
		Err   *string         ` + '`json:"err"`' + String.raw`
		Npm   bool            ` + '`json:"npm"`' + String.raw`
		Files map[string]seen ` + '`json:"files"`' + String.raw`
	}{Files: map[string]seen{}}
	if runErr != nil {
		m := runErr.Error()
		out.Err = &m
	}
	_, statErr := os.Stat(marker)
	out.Npm = statErr == nil
	for _, tool := range toolFolders {
		for _, name := range pinnedFiles {
			p := filepath.Join("testdata", "tools", tool, name)
			info, err := os.Lstat(p)
			switch {
			case err != nil:
				out.Files[p] = seen{Kind: "absent"}
			case info.IsDir():
				out.Files[p] = seen{Kind: "dir"}
			case info.Mode().IsRegular():
				b, _ := os.ReadFile(p)
				out.Files[p] = seen{Kind: "file", Content: string(b)}
			default:
				out.Files[p] = seen{Kind: "other"}
			}
		}
	}
	b, _ := json.Marshal(out)
	fmt.Printf("RESULT %s\n", b)
}
`;
let built;

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 1 << 24, ...opts }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

// Builds, once per run, a test binary from the real cmd/setup-tools/main.go plus the driver, in a scratch module.
function build() {
  if (!built) {
    built = (async () => {
      const mod = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-tools-driver-'));
      const put = (rel, data) => {
        fs.mkdirSync(path.dirname(path.join(mod, rel)), { recursive: true });
        fs.writeFileSync(path.join(mod, rel), data);
      };
      for (const f of ['go.mod', 'go.sum', 'cmd/setup-tools/main.go', 'testdata/tools/tools.go']) {
        put(f, fs.readFileSync(path.join(root, f)));
      }
      for (const tool of ['cucumber', 'quint']) {
        for (const n of ['package.json', 'package-lock.json']) {
          const f = path.join('testdata/tools', tool, n);
          put(f, fs.readFileSync(path.join(root, f)));
        }
      }
      put('cmd/setup-tools/driver_test.go', driverSource);
      const bin = path.join(mod, 'driver.test');
      const r = await run('go', ['test', '-c', '-o', bin, './cmd/setup-tools'], { cwd: mod });
      assert.equal(r.code, 0, 'go test -c of the setup-tools driver failed: ' + r.stdout + r.stderr);
      return bin;
    })();
  }
  return built;
}

async function drive(world, entry, tool) {
  const bin = await build();
  const spec = JSON.stringify({ entry, tool, entries: world.entries });
  const r = await run(bin, ['-test.v', '-test.run', '^TestDriver$'], { env: { ...process.env, DRIVER_SPEC: spec } });
  assert.equal(r.code, 0, 'driver binary exited ' + r.code + ': ' + r.stdout + r.stderr);
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, 'driver printed no RESULT line: ' + r.stdout + r.stderr);
  world.result = JSON.parse(line.slice('RESULT '.length));
}

Given(P + 'an empty working directory', function () {
  this.entries = [];
});

Given(P + 'a regular file {string} containing {string}', function (file, content) {
  this.entries.push({ path: file, kind: 'file', content });
});

When(P + 'setup runs with a {word} at {string}', async function (kind, target) {
  this.entries.push({ path: target, kind: kind === 'directory' ? 'dir' : kind });
  await drive(this, 'run', '');
});

When(P + 'setup writes the missing pinned files of tool {string}', async function (tool) {
  await drive(this, 'writeMissing', tool);
});

Then(P + 'setup fails with an error naming {string}', function (target) {
  assert.notEqual(this.result.err, null, 'setup succeeded although ' + target + ' is not a regular file');
  assert.ok(this.result.err.includes(target), 'error does not name ' + target + ': ' + this.result.err);
});

Then(P + 'npm was not invoked', function () {
  assert.equal(this.result.npm, false, 'npm was invoked although a pinned manifest is not a regular file');
});

Then(P + 'the {word} is still at {string}', function (kind, target) {
  const expected = kind === 'directory' ? 'dir' : 'other';
  assert.equal(this.result.files[target].kind, expected, 'unexpected entry at ' + target);
});

Then(P + 'setup succeeds', function () {
  assert.equal(this.result.err, null, 'setup failed: ' + this.result.err);
});

Then(P + 'the file {string} still contains {string}', function (file, content) {
  assert.deepEqual(this.result.files[file], { kind: 'file', content });
});

Then(P + 'the file {string} equals the pinned file of the repository', function (file) {
  const expected = fs.readFileSync(path.join(root, file), 'utf8');
  assert.deepEqual(this.result.files[file], { kind: 'file', content: expected });
});

Then(P + 'the repository tests of cmd\\/setup-tools exist and pass', async function () {
  assert.ok(fs.existsSync(path.join(root, 'cmd/setup-tools/main_test.go')), 'cmd/setup-tools/main_test.go does not exist');
  const r = await run('go', ['test', '-count=1', '-v', './cmd/setup-tools'], { cwd: root });
  assert.equal(r.code, 0, 'go test ./cmd/setup-tools failed: ' + r.stdout + r.stderr);
  assert.match(r.stdout, /--- PASS: Test/, 'go test ./cmd/setup-tools ran no passing test: ' + r.stdout);
});
