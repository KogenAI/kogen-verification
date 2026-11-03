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
	inTest := false
	for _, raw := range strings.Split(r.Output, "\n") {
		raw = strings.TrimSuffix(raw, "\r")
		if strings.HasPrefix(raw, "--- ") {
			inTest = strings.HasPrefix(raw, "--- FAIL:")
		} else if raw == "FAIL" || strings.HasPrefix(raw, "FAIL\t") || raw == "exit status 1" {
			inTest = false
		}
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, goTestTimeoutPanic) {
			return line, true
		}
		if inTest {
			continue
		}
		if strings.Contains(line, "no space left on device") ||
			strings.Contains(line, "cannot allocate memory") ||
			strings.Contains(line, "out of memory") ||
			strings.Contains(line, "Out of memory: Killed process") ||
			strings.Contains(line, "too many open files") {
			return line, true
		}
	}
	return "", false
}
