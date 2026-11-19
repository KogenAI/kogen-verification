'use strict';

// Steps of verify-export-check-reuse-key. Nothing runs when this file is loaded. The
// first step that needs the Go test writes the Go source below to a temporary folder and runs
// `go test` on package ./verify with a -overlay that adds it to the package as
// verify/zz_export_reuse_key_acceptance_test.go, so no file of the checkout is written. The run happens
// once; every scenario then reads that run's `-v` output. The child process is asynchronous.
// `node <this file> good|bad` runs the observer controls declared in the Intent's Feasibility.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'verify-export-check-reuse-key: ';
const TEST = 'TestExportReuseKeyAcceptance';

const driver = String.raw`package verify

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-loop/sys"
)

type exportKeyLog struct{ events []map[string]any }

func (l *exportKeyLog) Log(e map[string]any) { l.events = append(l.events, e) }

const exportKeyCommand = "go build ./..."

// exportKeyEvent logs one command event through the identity and returns it.
func exportKeyEvent(id checkIdentity) map[string]any {
	log := &exportKeyLog{}
	(&identityLogger{inner: log, identity: id}).Log(map[string]any{"event": "command", "command": exportKeyCommand})
	return log.events[0]
}

// exportKeyOf takes the key from the exported snapshot in a fresh empty scratch dir.
func exportKeyOf(t *testing.T, tree, command string, env ...string) string {
	t.Helper()
	dir := t.TempDir()
	return exportSnapshotKeys(t, sys.NewWith(env, dir), Tools{}, tree, dir, command)[0]
}

func TestExportReuseKeyAcceptance(t *testing.T) {
	const bin = "PATH=/nonexistent-reuse-key-bin"
	t.Run("key_equals_logged_reuse_sha256", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "go.sum"), []byte("example.com/m v1.0.0 h1:abc=\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		env := []string{bin, "KEEP=same", "KL_LOOP=one"}
		keys := exportSnapshotKeys(t, sys.NewWith(env, dir), Tools{}, "tree-1", dir, exportKeyCommand, "go vet ./...")
		id := snapshotIdentity(sys.NewWith(env, dir), Tools{}, "tree-1", dir)
		if len(id.Lockfiles) != 1 || id.Lockfiles[0].Path != "go.sum" {
			t.Fatalf("fixture has no go.sum lockfile: %v", id.Lockfiles)
		}
		logged, ok := exportKeyEvent(id)["reuse_sha256"].(string)
		if !ok || len(logged) != 64 {
			t.Fatalf("command event has no 64-character reuse_sha256: %v", exportKeyEvent(id))
		}
		if keys[0] != logged {
			t.Fatalf("snapshot key %s differs from logged reuse_sha256 %s", keys[0], logged)
		}
		if keys[1] == keys[0] {
			t.Fatal("one snapshot gave equal keys for two commands")
		}
	})
	t.Run("attempt_variables_do_not_change_the_key", func(t *testing.T) {
		a := exportKeyOf(t, "tree-1", exportKeyCommand, bin, "KOGEN_ATTEMPT_ID=attempt-1", "KOGEN_GENERATION=1", "KL_LOOP=one", "KEEP=same")
		b := exportKeyOf(t, "tree-1", exportKeyCommand, bin, "KOGEN_ATTEMPT_ID=attempt-2", "KOGEN_GENERATION=2", "KL_LOOP=two", "KL_ONLY_B=y", "KEEP=same")
		if a != b {
			t.Fatalf("key differs with only per-attempt variables changed: %s vs %s", a, b)
		}
	})
	t.Run("command_tree_and_path_each_change_the_key", func(t *testing.T) {
		base := exportKeyOf(t, "tree-1", exportKeyCommand, bin)
		for name, other := range map[string]string{
			"command": exportKeyOf(t, "tree-1", "go vet ./...", bin),
			"tree":    exportKeyOf(t, "tree-2", exportKeyCommand, bin),
			"PATH":    exportKeyOf(t, "tree-1", exportKeyCommand, "PATH=/nonexistent-reuse-key-other"),
		} {
			if other == base {
				t.Errorf("key equal when only the %s differs: %s", name, base)
			}
		}
	})
	t.Run("identity_and_reuse_hashes_equal_recorded_literals", func(t *testing.T) {
		dir := t.TempDir()
		env := []string{bin, "KOGEN_ATTEMPT_ID=attempt-7", "KOGEN_GENERATION=3", "KL_LOOP=x", "KEEP=same"}
		id := snapshotIdentity(sys.NewWith(env, dir), Tools{}, "tree-1", dir)
		if logged, key := exportKeyEvent(id)["reuse_sha256"], exportSnapshotKeys(t, sys.NewWith(env, dir), Tools{}, "tree-1", dir, exportKeyCommand)[0]; logged != key {
			t.Errorf("logged reuse_sha256 %v differs from the exported key %s on this host", logged, key)
		}
		id.Host = identityHost{Arch: "amd64", OS: "linux"}
		event := exportKeyEvent(id)
		const wantIdentity = "8137b72363f3231a101ef79eeb7c3fb2cc8eda5ac992c394fe0b0659c419c30e"
		const wantReuse = "8a176cc44f9d2de5655b24a04057290ae0133603c84475b715917c73cbd66914"
		if got := event["identity_sha256"]; got != wantIdentity {
			t.Errorf("identity_sha256 = %v, want the unchanged value %s", got, wantIdentity)
		}
		if got := event["reuse_sha256"]; got != wantReuse {
			t.Errorf("reuse_sha256 = %v, want the recorded value %s", got, wantReuse)
		}
		if len(id.event()) != 6 {
			t.Errorf("check_identity event has %d fields, want its 6 unchanged fields: %v", len(id.event()), id.event())
		}
	})
}
`;

// The helper below is the only code that names the exported API. It is a separate file so that the
// test runs, and its subtests fail with a clear message, on a tree that does not export it yet.
const snapshotReal = String.raw`package verify

import (
	"testing"

	"github.com/KogenAI/kogen-loop/sys"
)

func exportSnapshotKeys(t *testing.T, s *sys.Session, tools Tools, tree, dir string, commands ...string) []string {
	t.Helper()
	snap := NewReuseSnapshot(s, tools, tree, dir)
	keys := make([]string, 0, len(commands))
	for _, c := range commands {
		keys = append(keys, snap.Key(c))
	}
	return keys
}
`;

const snapshotMissing = String.raw`package verify

import (
	"testing"

	"github.com/KogenAI/kogen-loop/sys"
)

func exportSnapshotKeys(t *testing.T, s *sys.Session, tools Tools, tree, dir string, commands ...string) []string {
	t.Helper()
	t.Fatalf("package verify does not declare func NewReuseSnapshot yet")
	return nil
}
`;

// exportsSnapshot reports whether a non-test file of package verify declares NewReuseSnapshot.
function exportsSnapshot(root) {
  const dir = path.join(root, 'verify');
  return fs.readdirSync(dir).some((f) => f.endsWith('.go') && !f.endsWith('_test.go') &&
    /^func NewReuseSnapshot\(/m.test(fs.readFileSync(path.join(dir, f), 'utf8')));
}

// Judges the output of `go test -v -run ^TestExportReuseKeyAcceptance$ ./verify` for one subtest.
function judge(output, sub) {
  const re = new RegExp('^\\s*--- (PASS|FAIL|SKIP): ' + TEST + '/' + sub + ' \\(', 'm');
  const m = re.exec(output);
  assert.ok(m, `go test -run ^${TEST}$ ./verify did not report the subtest ${TEST}/${sub} (compile failure or test absent). Output:\n${output}`);
  assert.equal(m[1], 'PASS', `go test -run ^${TEST}$ ./verify: subtest ${TEST}/${sub} is ${m[1]}. Output:\n${output}`);
}

// The wording below is a real `go test -v` run of the driver on a correct implementation.
const GOOD = [
  '=== RUN   TestExportReuseKeyAcceptance',
  '=== RUN   TestExportReuseKeyAcceptance/key_equals_logged_reuse_sha256',
  '=== RUN   TestExportReuseKeyAcceptance/attempt_variables_do_not_change_the_key',
  '=== RUN   TestExportReuseKeyAcceptance/command_tree_and_path_each_change_the_key',
  '=== RUN   TestExportReuseKeyAcceptance/identity_and_reuse_hashes_equal_recorded_literals',
  '--- PASS: TestExportReuseKeyAcceptance (0.00s)',
  '    --- PASS: TestExportReuseKeyAcceptance/key_equals_logged_reuse_sha256 (0.00s)',
  '    --- PASS: TestExportReuseKeyAcceptance/attempt_variables_do_not_change_the_key (0.00s)',
  '    --- PASS: TestExportReuseKeyAcceptance/command_tree_and_path_each_change_the_key (0.00s)',
  '    --- PASS: TestExportReuseKeyAcceptance/identity_and_reuse_hashes_equal_recorded_literals (0.00s)',
  'PASS',
  'ok  \tgithub.com/KogenAI/kogen-verification/verify\t0.011s',
  '',
].join('\n');

const subs = ['key_equals_logged_reuse_sha256', 'attempt_variables_do_not_change_the_key', 'command_tree_and_path_each_change_the_key', 'identity_and_reuse_hashes_equal_recorded_literals'];

function controls(bad) {
  if (!bad) {
    subs.forEach((x) => judge(GOOD, x));
    return;
  }
  const failed = GOOD.replace('--- PASS: TestExportReuseKeyAcceptance/command_tree_and_path_each_change_the_key', '--- FAIL: TestExportReuseKeyAcceptance/command_tree_and_path_each_change_the_key');
  const missing = GOOD.replace(/^.*command_tree_and_path_each_change_the_key.*$/gm, '');
  const mutations = [
    () => judge(failed, 'command_tree_and_path_each_change_the_key'),
    () => judge(missing, 'command_tree_and_path_each_change_the_key'),
    () => judge('# github.com/KogenAI/kogen-verification/verify\nFAIL\tgithub.com/KogenAI/kogen-verification/verify [build failed]\n', 'command_tree_and_path_each_change_the_key'),
  ];
  mutations.forEach((m, n) => assert.throws(m, `bad control ${n + 1} was accepted`));
  throw new Error('every bad control was rejected');
}

if (require.main === module) {
  const bad = process.argv[2] === 'bad';
  try {
    controls(bad);
    console.log('accepted');
  } catch (e) {
    if (bad && e.message !== 'every bad control was rejected') {
      console.log(`accepted bad control: ${e.message}`);
    } else {
      console.log('rejected');
      process.exitCode = 1;
    }
  }
} else {
  const { AfterAll, When, Then } = require('@cucumber/cucumber');

  let tmp;
  let run;

  function goTest() {
    if (!run) {
      run = new Promise((resolve) => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-reuse-key-'));
        const source = path.join(tmp, 'export_reuse_key_test.go');
        fs.writeFileSync(source, driver);
        const target = path.join(process.cwd(), 'verify', 'zz_export_reuse_key_acceptance_test.go');
        const helper = path.join(tmp, 'export_reuse_key_snapshot_test.go');
        fs.writeFileSync(helper, exportsSnapshot(process.cwd()) ? snapshotReal : snapshotMissing);
        const helperTarget = path.join(process.cwd(), 'verify', 'zz_export_reuse_key_snapshot_test.go');
        const overlay = path.join(tmp, 'overlay.json');
        fs.writeFileSync(overlay, JSON.stringify({ Replace: { [target]: source, [helperTarget]: helper } }));
        execFile('go', ['test', '-overlay=' + overlay, '-count=1', '-v', '-timeout=100s', '-run', '^' + TEST + '$', './verify'],
          { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024, timeout: 110000 },
          (error, stdout, stderr) => resolve(stdout + stderr + (error ? `\n(go test: ${error.message})` : '')));
      });
    }
    return run;
  }

  AfterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  When(P + 'the Go acceptance test runs in package verify', { timeout: 115000 }, async function () {
    this.goOutput = await goTest();
  });

  Then(P + 'the Go acceptance subtest {string} passes', function (sub) {
    judge(this.goOutput, sub);
  });
}
