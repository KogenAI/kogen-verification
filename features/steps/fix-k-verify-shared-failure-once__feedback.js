const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

// The driver calls the real exported Pass.Feedback for one named case and prints its result.
const source = `package main

import (
	"fmt"
	"os"
	"strings"

	v "github.com/KogenAI/kogen-verification/verify"
)

// big is one failing problem of 300 lines that does not fit the 16,384-byte budget.
func big() string {
	lines := make([]string, 300)
	for i := range lines {
		lines[i] = fmt.Sprintf("row %03d ", i+1) + strings.Repeat("x", 92)
	}
	return strings.Join(lines, "\\n")
}

func scenarios(names, details []string) v.Pass {
	a := &v.Acceptance{Status: 1}
	for i, name := range names {
		d := details[i]
		a.Scenarios = append(a.Scenarios, v.ScenarioResult{Name: name, Line: i + 1, Status: "failed", Detail: &d})
		a.Problems = append(a.Problems, fmt.Sprintf("failed: %s (line %d): %s", name, i+1, d))
		a.Failed++
	}
	return v.Pass{N: 1, Acceptance: a}
}

func main() {
	var p v.Pass
	switch os.Args[1] {
	case "empty":
		p = v.Pass{N: 1, Model: v.ModelResult{State: "failed", Problems: []string{big(), ""}}}
	case "whitespace":
		p = v.Pass{N: 1, Model: v.ModelResult{State: "failed", Problems: []string{big(), " \\n\\t "}}}
	case "adjacent-scenarios":
		p = scenarios([]string{"a", "b"}, []string{"a a has data", "b b has data"})
	case "adjacent-checks":
		p = v.Pass{N: 1, Model: v.ModelResult{State: "ok"}, Checks: []v.CommandResult{
			{Name: "one", Command: "make one", Status: 1, Output: "one one: has data"},
			{Name: "two", Command: "make two", Status: 1, Output: "two two: has data"},
		}}
	default:
		fmt.Fprintln(os.Stderr, "unknown case", os.Args[1])
		os.Exit(2)
	}
	fmt.Print(p.Feedback("stub", ""))
}
`;

function checkLastLine(feedback, expected) {
  const size = Buffer.byteLength(feedback);
  assert.ok(size <= 16384, `feedback is ${size} bytes, more than 16384`);
  const last = feedback.slice(feedback.lastIndexOf('\n') + 1);
  assert.equal(last, expected, `last feedback line`);
}

function checkFeedback(feedback, expected) {
  assert.equal(feedback, expected, 'rendered feedback');
}

if (require.main === module) {
  // Observer controls: known-good feedback must be accepted, every known-bad one rejected.
  const header = 'Verification pass 1 is not green. Fix the implementation (the approved acceptance files cannot change), then call finish again.';
  const kept = header + '\nmodel: failed\n' + '  row 001 xxx\n'.repeat(3);
  const scenarioGood = header + '\nacceptance (stub): failed, exit status 1\n  has data\n  2 scenarios: a, b';
  const checkGood = header + '\n  : has data\n  2 checks: one, two';
  const good = [
    () => checkLastLine(kept + 'left out 2 items, 14731 bytes', 'left out 2 items, 14731 bytes'),
    () => checkLastLine(kept + 'left out 2 items, 14737 bytes', 'left out 2 items, 14737 bytes'),
    () => checkFeedback(scenarioGood, scenarioGood),
    () => checkFeedback(checkGood, checkGood),
  ];
  const bad = [
    () => checkLastLine(kept + 'left out 1 items, 14731 bytes', 'left out 2 items, 14731 bytes'),
    () => checkLastLine(kept + 'left out 1 items, 14737 bytes', 'left out 2 items, 14737 bytes'),
    () => checkLastLine('x'.repeat(16400) + '\nleft out 2 items, 14731 bytes', 'left out 2 items, 14731 bytes'),
    () => checkFeedback(header + '\nacceptance (stub): failed, exit status 1\n  failed: a (line 1): a a has data\n  failed: b (line 2): b b has data', scenarioGood),
    () => checkFeedback(header + '\ncheck one (make one): failed, exit status 1\n  one one: has data\ncheck two (make two): failed, exit status 1\n  two two: has data', checkGood),
  ];
  const fails = (f) => { try { f(); return false; } catch (_) { return true; } };
  if (process.argv[2] === '--control' && process.argv[3] === 'good') {
    if (good.some(fails)) { console.log('rejected'); process.exitCode = 1; } else console.log('accepted');
  } else if (process.argv[2] === '--control' && process.argv[3] === 'bad') {
    if (bad.every(fails)) { console.log('rejected'); process.exitCode = 1; } else console.log('accepted');
  } else {
    console.log('usage: --control good|bad');
    process.exitCode = 2;
  }
} else {
  const { When, Then } = require('@cucumber/cucumber');
  const run = promisify(execFile);
  let built;
  // Builds the driver once per run, on first use, and reuses the binary afterwards.
  function driver() {
    if (!built) {
      built = (async () => {
        const src = fs.mkdtempSync(path.join(process.cwd(), '.fix-k-verify-shared-failure-once-driver-'));
        const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fix-k-verify-shared-failure-once-')), 'driver');
        try {
          fs.writeFileSync(path.join(src, 'main.go'), source);
          await run('go', ['build', '-o', bin, './' + path.basename(src)], { timeout: 100000 });
        } finally {
          fs.rmSync(src, { recursive: true, force: true });
        }
        return bin;
      })();
    }
    return built;
  }

  When('fix-k-verify-shared-failure-once: the feedback for case {string} is rendered', async function (name) {
    const { stdout } = await run(await driver(), [name], { timeout: 30000 });
    this.feedback = stdout;
  });

  Then('fix-k-verify-shared-failure-once: the feedback is at most 16384 bytes and its last line is {string}', function (expected) {
    checkLastLine(this.feedback, expected);
  });

  Then('fix-k-verify-shared-failure-once: the feedback is:', function (expected) {
    checkFeedback(this.feedback, expected);
  });
}
