// Command driver runs verify.RequireRunner for the acceptance command given as its only
// argument in an empty temporary directory and prints the refusal as JSON.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-verification/verify"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: driver <acceptance command>")
		os.Exit(2)
	}
	root, err := os.MkdirTemp("", "runner-refusal-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	defer os.RemoveAll(root)
	s := sys.NewWith(os.Environ(), root)
	cfg := &project.Config{Acceptance: &project.Acceptance{Run: os.Args[1]}}
	err = verify.RequireRunner(context.Background(), s, verify.Tools{}, root, cfg)
	e, ok := sys.AsError(err)
	if !ok {
		fmt.Fprintf(os.Stderr, "RequireRunner returned %v, not a refusal\n", err)
		os.Exit(2)
	}
	lines := e.Lines
	if lines == nil {
		lines = []string{}
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"class": e.Class, "reason": e.Reason, "detail": e.Detail, "exit": e.Exit, "lines": lines})
}
