package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/sys"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "checker" {
		args := os.Args[2:]
		f, err := os.OpenFile(os.Getenv("ARGV_FILE"), os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
		must(err)
		must(json.NewEncoder(f).Encode(args))
		must(f.Close())
		for i, a := range args {
			if a == "--invariant" && i+1 < len(args) && args[i+1] == os.Getenv("VIOLATE") {
				fmt.Println("[violation]")
				os.Exit(1)
			}
		}
		return
	}
	var in struct {
		Names   []string
		Violate string
	}
	must(json.NewDecoder(os.Stdin).Decode(&in))
	dir, err := os.MkdirTemp("", "invariant-driver-")
	must(err)
	defer os.RemoveAll(dir)
	must(os.WriteFile(filepath.Join(dir, "model.qnt"), []byte("module model { val A = true val B = true val C = true }"), 0600))
	exe, err := os.Executable()
	must(err)
	env := append(os.Environ(), "ARGV_FILE="+filepath.Join(dir, "argv"), "VIOLATE="+in.Violate)
	result, err := verify.CheckModel(context.Background(), sys.NewWith(env, dir), dir, verify.Tools{Node: exe, Quint: "checker"}, &project.ModelSpec{Path: "model.qnt", Invariants: in.Names, Seed: "17", Samples: "1", Steps: "1"}, nil, nil)
	must(err)
	calls := [][]string{}
	if f, err := os.Open(filepath.Join(dir, "argv")); err == nil {
		defer f.Close()
		d := json.NewDecoder(f)
		for {
			var a []string
			if err := d.Decode(&a); err != nil {
				break
			}
			calls = append(calls, a)
		}
	}
	must(json.NewEncoder(os.Stdout).Encode(map[string]any{"calls": calls, "state": result.State, "problems": result.Problems}))
}
