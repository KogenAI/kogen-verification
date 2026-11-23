package verify

import "strings"

// goTestTimeoutPanic begins the line the Go test binary prints when its own timeout fires.
const goTestTimeoutPanic = "panic: test timed out after "

// modelAuthPhrase is the text printed when the model command-line tool a check calls is
// not authenticated in the verification environment.
const modelAuthPhrase = "Check authentication and model access"

// EnvFailure reports the first timeout, host resource or unauthenticated model tool
// failure line from a nonzero check result, trimmed of surrounding whitespace. Zero
// status or no match is none.
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
		// The Go test binary prints its own timeout panic unindented; an indented
		// timeout-looking line inside a failing test is text the test logged.
		if strings.HasPrefix(raw, goTestTimeoutPanic) || (!inTest && strings.HasPrefix(line, goTestTimeoutPanic)) {
			return line, true
		}
		if inTest {
			continue
		}
		if strings.Contains(line, "no space left on device") ||
			strings.Contains(line, "cannot allocate memory") ||
			strings.Contains(line, "out of memory") ||
			strings.Contains(line, "Out of memory: Killed process") ||
			strings.Contains(line, "too many open files") ||
			strings.Contains(line, modelAuthPhrase) {
			return line, true
		}
	}
	return "", false
}
