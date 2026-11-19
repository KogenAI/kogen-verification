'use strict';

// Steps of verify-check-reuse-key-ignores-attempt-env. Nothing runs when this file is loaded. The
// first step that needs the Go test writes the Go source below to a temporary folder and runs
// `go test` on package ./verify with a -overlay that adds it to the package as
// verify/zz_reuse_key_acceptance_test.go, so no file of the checkout is written. The run happens
// once; every scenario then reads that run's `-v` output. The child process is asynchronous.
// `node <this file> good|bad` runs the observer controls declared in the Intent's Feasibility.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'verify-check-reuse-key-ignores-attempt-env: ';
const TEST = 'TestReuseKeyAcceptance';

const driver = String.raw`package verify

import (
	"testing"

	"github.com/KogenAI/kogen-loop/sys"
)

type reuseKeyLog struct{ events []map[string]any }

func (l *reuseKeyLog) Log(e map[string]any) { l.events = append(l.events, e) }

// reuseKeyIdentity snapshots an identity for a PATH with no tools (every probe is absent) in an
// empty folder, so the identity is deterministic.
func reuseKeyIdentity(t *testing.T, tree string, env ...string) checkIdentity {
	t.Helper()
	dir := t.TempDir()
	return snapshotIdentity(sys.NewWith(env, dir), Tools{}, tree, dir)
}

// reuseKeyCommand logs one command event through the identity and returns it.
func reuseKeyCommand(id checkIdentity) map[string]any {
	log := &reuseKeyLog{}
	(&identityLogger{inner: log, identity: id}).Log(map[string]any{"event": "command", "command": "go build ./..."})
	return log.events[0]
}

func reuseKeyOf(t *testing.T, id checkIdentity) string {
	t.Helper()
	got, ok := reuseKeyCommand(id)["reuse_sha256"].(string)
	if !ok || len(got) != 64 {
		t.Fatalf("command event has no 64-character reuse_sha256: %v", reuseKeyCommand(id))
	}
	return got
}

func TestReuseKeyAcceptance(t *testing.T) {
	const bin = "PATH=/nonexistent-reuse-key-bin"
	t.Run("attempt_variables_do_not_change_the_key", func(t *testing.T) {
		a := reuseKeyIdentity(t, "tree-1", bin, "KOGEN_ATTEMPT_ID=attempt-1", "KOGEN_GENERATION=1", "KL_LOOP=one", "KL_ONLY_A=x", "KEEP=same")
		b := reuseKeyIdentity(t, "tree-1", bin, "KOGEN_ATTEMPT_ID=attempt-2", "KOGEN_GENERATION=2", "KL_LOOP=two", "KEEP=same")
		if reuseKeyOf(t, a) != reuseKeyOf(t, b) {
			t.Fatalf("reuse_sha256 differs: %s vs %s", reuseKeyOf(t, a), reuseKeyOf(t, b))
		}
	})
	t.Run("tree_changes_the_key", func(t *testing.T) {
		a := reuseKeyIdentity(t, "tree-1", bin)
		b := reuseKeyIdentity(t, "tree-2", bin)
		if reuseKeyOf(t, a) == reuseKeyOf(t, b) {
			t.Fatalf("reuse_sha256 equal for different trees: %s", reuseKeyOf(t, a))
		}
	})
	t.Run("tools_lockfiles_and_host_change_the_key", func(t *testing.T) {
		version, other := "go version go1.27.2", "go version go1.27.3"
		fresh := func() checkIdentity {
			id := reuseKeyIdentity(t, "tree-1", bin)
			id.Tools[0].Status, id.Tools[0].Version = "ok", &version
			id.Lockfiles = []identityLock{{Path: "go.sum", SHA256: "a"}}
			id.Host = identityHost{Arch: "amd64", OS: "linux"}
			return id
		}
		for name, change := range map[string]func(*checkIdentity){
			"tool version": func(id *checkIdentity) { id.Tools[0].Version = &other },
			"lockfile":     func(id *checkIdentity) { id.Lockfiles[0].SHA256 = "b" },
			"host arch":    func(id *checkIdentity) { id.Host.Arch = "arm64" },
		} {
			a, b := fresh(), fresh()
			change(&b)
			if reuseKeyOf(t, a) == reuseKeyOf(t, b) {
				t.Errorf("reuse_sha256 equal when only the %s differs: %s", name, reuseKeyOf(t, a))
			}
		}
	})
	t.Run("path_changes_the_key_and_identity_hash_is_unchanged", func(t *testing.T) {
		c := reuseKeyIdentity(t, "tree-1", bin, "KOGEN_ATTEMPT_ID=attempt-7", "KOGEN_GENERATION=3", "KL_LOOP=x")
		c.Host = identityHost{Arch: "amd64", OS: "linux"}
		const want = "a8f685a51ac98727f8c6203de8a3c95b23376354d861a423610800c19e223fd3"
		if got := reuseKeyCommand(c)["identity_sha256"]; got != want {
			t.Errorf("identity_sha256 = %v, want the unchanged value %s", got, want)
		}
		if len(c.event()) != 6 {
			t.Errorf("check_identity event has %d fields, want its 6 unchanged fields: %v", len(c.event()), c.event())
		}
		a := reuseKeyIdentity(t, "tree-1", "PATH=/nonexistent-reuse-key-a")
		b := reuseKeyIdentity(t, "tree-1", "PATH=/nonexistent-reuse-key-b")
		if reuseKeyOf(t, a) == reuseKeyOf(t, b) {
			t.Errorf("reuse_sha256 equal for different PATH: %s", reuseKeyOf(t, a))
		}
	})
}
`;

// Judges the output of `go test -v -run ^TestReuseKeyAcceptance$ ./verify` for one subtest.
function judge(output, sub) {
  const re = new RegExp('^\\s*--- (PASS|FAIL|SKIP): ' + TEST + '/' + sub + ' \\(', 'm');
  const m = re.exec(output);
  assert.ok(m, `go test -run ^${TEST}$ ./verify did not report the subtest ${TEST}/${sub} (compile failure or test absent). Output:\n${output}`);
  assert.equal(m[1], 'PASS', `go test -run ^${TEST}$ ./verify: subtest ${TEST}/${sub} is ${m[1]}. Output:\n${output}`);
}

const GOOD = [
  '=== RUN   TestReuseKeyAcceptance',
  '=== RUN   TestReuseKeyAcceptance/attempt_variables_do_not_change_the_key',
  '=== RUN   TestReuseKeyAcceptance/tree_changes_the_key',
  '--- PASS: TestReuseKeyAcceptance (0.01s)',
  '    --- PASS: TestReuseKeyAcceptance/attempt_variables_do_not_change_the_key (0.00s)',
  '    --- PASS: TestReuseKeyAcceptance/tree_changes_the_key (0.00s)',
  'PASS',
  'ok  \tgithub.com/KogenAI/kogen-verification/verify\t0.006s',
  '',
].join('\n');

function controls(bad) {
  if (!bad) {
    judge(GOOD, 'attempt_variables_do_not_change_the_key');
    judge(GOOD, 'tree_changes_the_key');
    return;
  }
  const failed = GOOD.replace('--- PASS: TestReuseKeyAcceptance/tree_changes_the_key', '--- FAIL: TestReuseKeyAcceptance/tree_changes_the_key');
  const missing = GOOD.replace(/^.*tree_changes_the_key.*$/gm, '');
  const mutations = [
    () => judge(failed, 'tree_changes_the_key'),
    () => judge(missing, 'tree_changes_the_key'),
    () => judge('# github.com/KogenAI/kogen-verification/verify\nFAIL\tgithub.com/KogenAI/kogen-verification/verify [build failed]\n', 'tree_changes_the_key'),
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
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reuse-key-'));
        const source = path.join(tmp, 'reuse_key_test.go');
        fs.writeFileSync(source, driver);
        const target = path.join(process.cwd(), 'verify', 'zz_reuse_key_acceptance_test.go');
        const overlay = path.join(tmp, 'overlay.json');
        fs.writeFileSync(overlay, JSON.stringify({ Replace: { [target]: source } }));
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
