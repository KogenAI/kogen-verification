// Command probetrust is the acceptance harness of the probe trust scenarios: it runs a
// command as a verify probe of a project, or executes one declared observer for it, with
// this process's environment as the caller's.
//
//	probetrust probe <root> <command>
//	probetrust execute <root> <id> <good-command> <good-output>
//
// probe prints the probe's result as one JSON object {"status","timed_out","output"}.
// execute declares an observer <id> whose good check runs <good-command> expecting exit 0
// and <good-output>, and whose bad check runs `exit 1` expecting exit 1 and no output, over
// the observer file features/steps/fixture_steps.js; it prints "met" or the refusal as
// rendered. Misuse and unexpected errors exit 2.
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
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "probetrust:", err)
		os.Exit(2)
	}
}

func run(args []string) error {
	switch {
	case len(args) == 3 && args[0] == "probe":
		r, err := verify.Probe{Root: args[1], Command: args[2]}.Run(context.Background(), sys.New())
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": r.Status, "timed_out": r.TimedOut, "output": r.Output})
	case len(args) == 5 && args[0] == "execute":
		return execute(args[1], args[2], args[3], args[4])
	}
	return fmt.Errorf("usage: probetrust probe <root> <command> | probetrust execute <root> <id> <good-command> <good-output>")
}

func execute(root, id, command, output string) error {
	observer := "features/steps/fixture_steps.js"
	decl, err := json.Marshal(map[string]any{"id": id, "kind": "observer", "inputs": []string{}, "observers": []string{observer},
		"checks": []map[string]any{
			{"name": "good", "command": command, "exit": 0, "output": output},
			{"name": "bad", "command": "exit 1", "exit": 1, "output": ""},
		}})
	if err != nil {
		return err
	}
	evidence, err := os.MkdirTemp("", "probetrust-evidence-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(evidence)
	intent := &project.Intent{Root: root, Slug: "fixture", Acceptance: []string{project.FeaturePath("fixture"), observer},
		Feasibility: []string{"- evidence: " + string(decl)}}
	_, err = verify.Execute(context.Background(), sys.New(), verify.Tools{}, root, intent, evidence, nil)
	if e, ok := sys.AsError(err); ok {
		fmt.Print(e.Render())
		return nil
	}
	if err != nil {
		return err
	}
	fmt.Println("met")
	return nil
}
