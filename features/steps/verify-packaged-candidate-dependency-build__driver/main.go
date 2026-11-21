//go:build kogendriver

// Command driver stands in for the packaged kogen candidate in acceptance. `kogen verify
// candidate <args>` runs verify.RunCandidate and exits with its result. Any other first argument
// is a candidate phase (shape, build, build --resume, restore, land) that the verifier runs in
// its working directory: shape fails unless the dependency was installed, and `build --resume`
// fails when the file stand-in-mode holds lose-restore-flag. The build tag keeps it out of
// `go build ./...`; the acceptance steps build it with `-tags kogendriver`.
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/KogenAI/kogen-verification/verify"
)

func main() {
	args := os.Args[1:]
	if len(args) >= 2 && args[0] == "verify" && args[1] == "candidate" {
		os.Exit(verify.RunCandidate(args[2:], os.Stdout, os.Stderr))
	}
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: kogen verify candidate --project <dir>")
		os.Exit(64)
	}
	switch args[0] {
	case "shape":
		if st, err := os.Stat("node_modules/mirrordep"); err != nil || !st.IsDir() {
			fmt.Fprintln(os.Stderr, "dependency not installed")
			os.Exit(1)
		}
	case "build":
		mode, _ := os.ReadFile("stand-in-mode")
		if len(args) > 1 && args[1] == "--resume" && strings.TrimSpace(string(mode)) == "lose-restore-flag" {
			fmt.Fprintln(os.Stderr, "restore flag lost on resume")
			os.Exit(1)
		}
	case "restore", "land":
	default:
		fmt.Fprintln(os.Stderr, "unknown phase "+args[0])
		os.Exit(1)
	}
}
