const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const P = 'setup-tools-rejects-directory-pins: ';
const root = process.cwd();

// A Go test driver compiled with the real cmd/setup-tools/main.go in a scratch module. It lays out the
// entries named by DRIVER_SPEC in a fresh working directory, puts a fake npm that touches a marker first
// on PATH, calls run(), and prints one RESULT line of JSON.
const driverSource = String.raw`package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type Entry struct {
	Path    string
	Kind    string
	Content string
}

type Seen struct {
	Kind    string
	Content string
}

func TestDriver(t *testing.T) {
	var entries []Entry
	if err := json.Unmarshal([]byte(os.Getenv("DRIVER_SPEC")), &entries); err != nil {
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
	for _, e := range entries {
		if err := os.MkdirAll(filepath.Dir(e.Path), 0o755); err != nil {
			t.Fatal(err)
		}
		var err error
		if e.Kind == "dir" {
			err = os.Mkdir(e.Path, 0o755)
		} else {
			err = os.WriteFile(e.Path, []byte(e.Content), 0o644)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	runErr := run()
	out := struct {
		Err   *string
		Npm   bool
		Files map[string]Seen
	}{Files: map[string]Seen{}}
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
				out.Files[p] = Seen{Kind: "absent"}
			case info.IsDir():
				out.Files[p] = Seen{Kind: "dir"}
			case info.Mode().IsRegular():
				b, _ := os.ReadFile(p)
				out.Files[p] = Seen{Kind: "file", Content: string(b)}
			default:
				out.Files[p] = Seen{Kind: "other"}
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
      const mod = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-tools-pins-driver-'));
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

Given(P + 'an empty working directory', function () {
  this.entries = [];
});

Given(P + 'a directory at {string}', function (file) {
  this.entries.push({ path: file, kind: 'dir' });
});

Given(P + 'a regular file {string} containing {string}', function (file, content) {
  this.entries.push({ path: file, kind: 'file', content });
});

When(P + 'setup runs', async function () {
  const bin = await build();
  const r = await run(bin, ['-test.v', '-test.run', '^TestDriver$'], {
    env: { ...process.env, DRIVER_SPEC: JSON.stringify(this.entries) },
  });
  assert.equal(r.code, 0, 'driver binary exited ' + r.code + ': ' + r.stdout + r.stderr);
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, 'driver printed no RESULT line: ' + r.stdout + r.stderr);
  this.result = JSON.parse(line.slice('RESULT '.length));
});

Then(P + 'setup fails with an error naming {string}', function (target) {
  assert.notEqual(this.result.Err, null, 'setup succeeded although ' + target + ' is not a regular file');
  assert.ok(this.result.Err.includes(target), 'error does not name ' + target + ': ' + this.result.Err);
});

Then(P + 'npm was not invoked', function () {
  assert.equal(this.result.Npm, false, 'npm was invoked although a pinned file is not a regular file');
});

Then(P + 'npm was invoked', function () {
  assert.equal(this.result.Npm, true, 'npm was not invoked after a successful setup');
});

Then(P + '{string} is still a directory', function (target) {
  assert.equal(this.result.Files[target].Kind, 'dir', 'unexpected entry at ' + target);
});

Then(P + 'setup succeeds', function () {
  assert.equal(this.result.Err, null, 'setup failed: ' + this.result.Err);
});

Then(P + 'the file {string} still contains {string}', function (file, content) {
  assert.deepEqual(this.result.Files[file], { Kind: 'file', Content: content });
});

Then(P + 'the file {string} equals the pinned file of the repository', function (file) {
  const expected = fs.readFileSync(path.join(root, file), 'utf8');
  assert.deepEqual(this.result.Files[file], { Kind: 'file', Content: expected });
});
