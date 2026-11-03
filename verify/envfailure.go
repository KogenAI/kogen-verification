package verify

import "strings"

// goTestTimeoutPanic begins the line the Go test binary prints when its own timeout fires.
const goTestTimeoutPanic = "panic: test timed out after "

// EnvFailure reports the first timeout or host resource failure line from a nonzero
// check result, trimmed of surrounding whitespace. Zero status or no match is none.
func EnvFailure(r CommandResult) (string, bool) {
	if r.Status == 0 {
		return "", false
	}
	for _, line := range strings.Split(r.Output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, goTestTimeoutPanic) ||
			strings.Contains(line, "no space left on device") ||
			strings.Contains(line, "cannot allocate memory") ||
			strings.Contains(line, "out of memory") ||
			strings.Contains(line, "Out of memory: Killed process") ||
			strings.Contains(line, "too many open files") {
			return line, true
		}
	}
	return "", false
}
