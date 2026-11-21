package main

import (
	"encoding/json"
	"os"

	"github.com/KogenAI/kogen-verification/verify"
)

const stepFile = "features/steps/candidate_steps.js"

// The driver reads {"body": "..."} from stdin, runs the step self-check over one step
// definition with that body and prints the exit_code refusals it produced.
func main() {
	var in struct {
		Body string `json:"body"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		panic(err)
	}
	raw := verify.StepRaw{
		Loads: []verify.StepLoad{{File: stepFile}},
		Defs:  []verify.StepDef{{File: stepFile, Pattern: "the candidate runs", Body: in.Body, Used: true}},
	}
	refusals := []string{}
	for _, it := range verify.StepItems([]string{stepFile}, raw) {
		if it.Check == "exit_code" && !it.OK {
			refusals = append(refusals, it.Detail)
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(struct {
		Refusals []string `json:"refusals"`
	}{refusals}); err != nil {
		panic(err)
	}
}
