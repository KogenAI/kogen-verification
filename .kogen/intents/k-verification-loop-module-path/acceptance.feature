Feature: Canonical verification loop module wiring
  Scenario: Pin migrated upstream components without replacement or workspace
    Then k-verification-loop-module-path: this command exits 0:
      """
      set -eu
      test ! -e go.work
      test -z "$(go env GOWORK)"
      test -s go.sum
      test "$(go list -m -f '{{.Version}}' github.com/KogenAI/kogen-loop)" = v0.0.0-20261104002337-25d87c2177c3
      test "$(go list -m -f '{{.Version}}' github.com/KogenAI/kogen-coordinator)" = v0.0.0-20261104010828-f15509472852
      test -z "$(go list -m -f '{{if .Replace}}{{.Path}}{{end}}' all)"
      if go list -m -f '{{.Path}}' all | grep -qx kogen-loop; then exit 1; fi
      go mod tidy -diff
      """

  Scenario: Remove bare loop imports throughout source and compiled dependencies
    Then k-verification-loop-module-path: this command exits 1:
      """
      grep -rn '"kogen-loop/' --include='*.go' .
      """
    Then k-verification-loop-module-path: this command exits 0:
      """
      set -eu
      imports=$(go list -deps -test -f '{{range .Imports}}{{println .}}{{end}}' ./...)
      if printf '%s\n' "$imports" | grep -E '^kogen-loop(/|$)'; then exit 1; fi
      """

  Scenario: Preserve existing behavior through real project checks
    Then k-verification-loop-module-path: this command exits 0:
      """
      test "$(go list -m -f '{{.Version}}' github.com/KogenAI/kogen-loop)" = v0.0.0-20261104002337-25d87c2177c3
      """
    Then k-verification-loop-module-path: this command exits 0:
      """
      go build ./... && go vet ./... && go test ./...
      """
