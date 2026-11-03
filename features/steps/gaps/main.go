// Command gaps exposes real verification entry points to independent acceptance.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/sys"
)

func main() {
	if err := runGaps(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}
func runGaps() error {
	a := os.Args[1:]
	if len(a) != 3 {
		return fmt.Errorf("usage: gaps account|model root input")
	}
	if a[0] == "account" {
		b, err := os.ReadFile(a[1] + "/acceptance.feature")
		if err != nil {
			return err
		}
		expected, err := project.ParseGherkin(string(b))
		if err != nil {
			return err
		}
		r := verify.Account(a[1], "acceptance.feature", expected, a[2], 0, "")
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"Scenarios": r.Scenarios, "Problems": r.Problems, "Passed": r.Passed})
	}
	if a[0] == "model" {
		m := &project.ModelSpec{Path: a[2], Invariants: []string{"Safe"}, Seed: "7", Samples: "1", Steps: "1"}
		result, err := verify.CheckModel(context.Background(), sys.New(), a[1], verify.Tools{Node: os.Getenv("KOGEN_NODE"), Quint: os.Getenv("KOGEN_QUINT")}, m, nil, nil)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	return fmt.Errorf("unknown mode %q", a[0])
}
