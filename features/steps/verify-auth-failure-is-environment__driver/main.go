package main

import (
	"encoding/json"
	"os"

	"github.com/KogenAI/kogen-verification/verify"
)

func main() {
	var input verify.CommandResult
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		panic(err)
	}
	line, matched := verify.EnvFailure(input)
	if err := json.NewEncoder(os.Stdout).Encode(struct {
		Line    string `json:"line"`
		Matched bool   `json:"matched"`
	}{line, matched}); err != nil {
		panic(err)
	}
}
