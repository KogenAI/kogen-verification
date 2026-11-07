// Command setup-tools prepares the npm tools the tests need, in the working directory (a module
// root): it writes the pinned package.json and package-lock.json of Cucumber and Quint where
// they are absent, then runs npm ci for each, Cucumber first.
//
//	go run github.com/KogenAI/kogen-verification/cmd/setup-tools
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"

	"github.com/KogenAI/kogen-verification/testdata/tools"
)

var toolFolders = []string{"cucumber", "quint"}

var pinnedFiles = []string{"package.json", "package-lock.json"}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	for _, tool := range toolFolders {
		if err := writeMissing(tool); err != nil {
			return fmt.Errorf("setup-tools: %w", err)
		}
	}
	for _, tool := range toolFolders {
		prefix := path.Join("testdata", "tools", tool)
		cmd := exec.Command("npm", "ci", "--prefix", prefix)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("setup-tools: npm ci --prefix %s failed: %w", prefix, err)
		}
	}
	return nil
}

// writeMissing writes the pinned files of one tool that the working directory does not have.
func writeMissing(tool string) error {
	dir := filepath.Join("testdata", "tools", tool)
	for _, name := range pinnedFiles {
		target := filepath.Join(dir, name)
		if _, err := os.Stat(target); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return err
		}
		data, err := tools.Files.ReadFile(path.Join(tool, name))
		if err != nil {
			return err
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}
