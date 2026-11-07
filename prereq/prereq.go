// Package prereq looks up the tools the tests of this module and of its consumers need, and
// fails the test with one message that names the missing prerequisite and the command that
// installs it.
package prereq

import (
	"os"
	"path/filepath"
	"testing"
)

// SetupCommand installs what the tests need; run it in the module root.
const SetupCommand = "go run github.com/KogenAI/kogen-verification/cmd/setup-tools"

// CucumberMissing is the message of the test that needs Cucumber and cannot find it.
const CucumberMissing = "missing prerequisite: Cucumber is not installed; run the setup command: " + SetupCommand

const cucumberBin = "@cucumber/cucumber/bin/cucumber.js"

// Cucumber returns the node_modules folder that holds @cucumber/cucumber/bin/cucumber.js: the
// folder named by KOGEN_CUCUMBER when it holds that file, otherwise
// testdata/tools/cucumber/node_modules under the nearest folder at or above the working
// directory that holds a go.mod. When neither holds it, the test fails with CucumberMissing.
func Cucumber(t testing.TB) string {
	t.Helper()
	if dir := os.Getenv("KOGEN_CUCUMBER"); dir != "" && isRegular(filepath.Join(dir, cucumberBin)) {
		return dir
	}
	if root := moduleRoot(); root != "" {
		dir := filepath.Join(root, "testdata", "tools", "cucumber", "node_modules")
		if isRegular(filepath.Join(dir, cucumberBin)) {
			return dir
		}
	}
	t.Fatal(CucumberMissing)
	return ""
}

// moduleRoot is the nearest folder at or above the working directory that holds a go.mod, or ""
// when there is none.
func moduleRoot() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		if isRegular(filepath.Join(dir, "go.mod")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func isRegular(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
