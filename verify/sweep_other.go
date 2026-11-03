//go:build !linux && !darwin

package verify

import "errors"

// Acceptance processes can be attributed on Linux and macOS only.
func listProcs() ([]procEntry, error) {
	return nil, errors.New("process table unsupported on this platform")
}

func procMarked(pid int, entry string) bool { return false }

func procHoldsFile(pid int, dev, ino uint64) bool { return false }

// acceptanceReaped returns script unchanged: only Linux has a child subreaper.
func acceptanceReaped(script string) string { return script }
