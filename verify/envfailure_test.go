package verify

import "testing"

func TestEnvFailure(t *testing.T) {
	timedOut := "ok  \tkogen/verify\t1.204s\npanic: test timed out after 10m0s\n\trunning tests:\n\t\tTestSlow (10m0s)\n\nFAIL\tkogen/build\t600.214s\nFAIL\n"
	for _, c := range []struct {
		name   string
		result CommandResult
		want   string
	}{
		{"timed out go test", CommandResult{Name: "go-test", Status: 1, Output: timedOut}, "panic: test timed out after 10m0s"},
		{"indented line, first of two", CommandResult{Status: 2, Output: "x\n  \tpanic: test timed out after 1s \r\npanic: test timed out after 2s\n"}, "panic: test timed out after 1s"},
		{"disk exhaustion", CommandResult{Status: 1, Output: "  write /x: no space left on device  \n"}, "write /x: no space left on device"},
		{"allocation failure", CommandResult{Status: 1, Output: "fork/exec: cannot allocate memory"}, "fork/exec: cannot allocate memory"},
		{"out of memory", CommandResult{Status: 1, Output: "runtime: out of memory"}, "runtime: out of memory"},
		{"linux memory kill", CommandResult{Status: 1, Output: "kernel: Out of memory: Killed process 123 (go)"}, "kernel: Out of memory: Killed process 123 (go)"},
		{"file limit", CommandResult{Status: 1, Output: "open /x: too many open files"}, "open /x: too many open files"},
		{"zero disk", CommandResult{Status: 0, Output: "no space left on device"}, ""},
		{"zero allocation", CommandResult{Status: 0, Output: "cannot allocate memory"}, ""},
		{"zero memory", CommandResult{Status: 0, Output: "out of memory"}, ""},
		{"zero memory kill", CommandResult{Status: 0, Output: "Out of memory: Killed process 123 (go)"}, ""},
		{"zero file limit", CommandResult{Status: 0, Output: "too many open files"}, ""},
		{"port conflict", CommandResult{Status: 1, Output: "address already in use"}, ""},
		{"missing file", CommandResult{Status: 1, Output: "no such file or directory"}, ""},
		{"generic kill", CommandResult{Status: 1, Output: "Killed"}, ""},
		{"timeout before resource", CommandResult{Status: 2, Output: "  panic: test timed out after 1s \nno space left on device"}, "panic: test timed out after 1s"},
		{"resource before timeout", CommandResult{Status: 1, Output: "ordinary failure\n too many open files \npanic: test timed out after 1s"}, "too many open files"},
		{"first resource", CommandResult{Status: 1, Output: "cannot allocate memory\nno space left on device"}, "cannot allocate memory"},
		{"ordinary failure", CommandResult{Status: 1, Output: "--- FAIL: TestAppIsReady (0.00s)\nFAIL\n"}, ""},
		{"zero status", CommandResult{Status: 0, Output: timedOut}, ""},
		{"not at the line start", CommandResult{Status: 1, Output: "log: panic: test timed out after 10m0s\n"}, ""},
	} {
		got, ok := EnvFailure(c.result)
		if got != c.want || ok != (c.want != "") {
			t.Errorf("%s: EnvFailure = %q, %v; want %q", c.name, got, ok, c.want)
		}
	}
}
