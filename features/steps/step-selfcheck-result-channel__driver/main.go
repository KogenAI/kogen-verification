package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/KogenAI/kogen-verification/verify"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	var in struct {
		Source string `json:"source"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		return err
	}
	root, err := os.MkdirTemp("", "step-result-channel-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	if err := os.WriteFile(filepath.Join(root, "candidate.js"), []byte(in.Source), 0600); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	node := os.Getenv("KOGEN_NODE")
	if node == "" {
		node = "node"
	}
	cucumber := os.Getenv("KOGEN_CUCUMBER")
	if cucumber == "" {
		cucumber, err = filepath.Abs("testdata/tools/cucumber/node_modules")
		if err != nil {
			return err
		}
	}
	raw, loaded, runErr := verify.RunStepScript(ctx, node, cucumber, root, os.Environ(), []string{"candidate.js"}, []string{"actual step"})
	message := ""
	if runErr != nil {
		message = runErr.Error()
	}
	return json.NewEncoder(os.Stdout).Encode(struct {
		Raw    verify.StepRaw `json:"raw"`
		Loaded bool           `json:"loaded"`
		Error  string         `json:"error"`
	}{raw, loaded, message})
}
