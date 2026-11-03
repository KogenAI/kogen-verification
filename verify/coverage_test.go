package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestCoverageVerifyAndSerialization(t *testing.T) {
	for _, mode := range []string{"partial", "strict", "silent", "all", "stopped", "none", "missing"} {
		t.Run(mode, func(t *testing.T) {
			p := newProj(t)
			p.write("suite/b.feature", fixtureFeature)
			p.write("suite/a.feature", fixtureFeature)
			p.commit("suite")
			report := `printf '%s' '{"executed_features":["suite/b.feature","suite/b.feature"]}' > "$KOGEN_CHECK_REPORT"`
			switch mode {
			case "silent":
				report = "true"
			case "all":
				report = `printf '%s' '{"executed_features":["suite/a.feature","suite/b.feature"]}' > "$KOGEN_CHECK_REPORT"`
			case "stopped":
				p.Config.Checks = []project.Check{{Name: "fail", Run: "false"}}
			}
			p.Config.Checks = append(p.Config.Checks, project.Check{Name: "report", Run: report})
			in := p.input(1)
			if mode != "none" {
				in.AcceptanceSuite = &AcceptanceSuite{Location: "suite/", RequireFullCoverage: mode == "strict"}
			}
			if mode == "missing" {
				in.AcceptanceSuite.Location = "missing-features/"
			}
			s, _ := p.session()
			pass, err := Verify(context.Background(), s, in)
			if mode == "missing" {
				if err == nil || !strings.Contains(err.Error(), "missing-features/") {
					t.Fatalf("error %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var want []string
			switch mode {
			case "partial", "strict":
				want = []string{"suite/a.feature"}
			case "all":
				want = []string{}
			case "silent", "stopped":
				want = []string{"suite/a.feature", "suite/b.feature"}
			}
			if !reflect.DeepEqual(pass.UncoveredAcceptance, want) {
				t.Fatalf("coverage %#v want %#v", pass.UncoveredAcceptance, want)
			}
			if mode == "strict" && (pass.Green || !strings.Contains(pass.Feedback("", ""), "suite/a.feature") || pass.Complete(p.Config, nil, nil)) {
				t.Fatal("strict pass reused")
			}
			b, err := json.Marshal(pass)
			if err != nil {
				t.Fatal(err)
			}
			var decoded Pass
			if err = json.Unmarshal(b, &decoded); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(decoded.UncoveredAcceptance, want) {
				t.Fatalf("round trip %s", b)
			}
			if mode == "none" && (strings.Contains(string(b), "uncovered_acceptance") || strings.Contains(pass.Feedback("", ""), "Acceptance coverage:")) {
				t.Fatal(string(b))
			}
		})
	}
}
func TestCoverageLineBoundaries(t *testing.T) {
	for _, size := range []int{511, 512, 513} {
		prefix := len("Acceptance coverage: 1 uncovered: ")
		line := coverageLine([]string{strings.Repeat("a", size-prefix)})
		if len(line) > 512 || (size <= 512 && len(line) != size) {
			t.Fatalf("size %d: %d", size, len(line))
		}
	}
	if coverageLine(nil) != "" {
		t.Fatal("empty line")
	}
	line := coverageLine([]string{"a", "b", "c", "d"})
	if !strings.Contains(line, "a, b, c") || !strings.Contains(line, "omitted") {
		t.Fatal(line)
	}
}
func TestCoverageReportCompletedCases(t *testing.T) {
	root := t.TempDir()
	report := filepath.Join(root, "report")
	data := `{"gherkinDocument":{"uri":"document.feature"}}
{"pickle":{"id":"p","uri":"suite/a.feature"}}
{"testCase":{"id":"c","pickleId":"p"}}
{"testCaseStarted":{"id":"s","testCaseId":"c"}}
{"testCaseFinished":{"testCaseStartedId":"s"}}
`
	if err := os.WriteFile(report, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	acceptanceCoverage(root, report, got)
	if !reflect.DeepEqual(got, map[string]bool{"suite/a.feature": true}) {
		t.Fatal(fmt.Sprint(got))
	}
}

func TestVerifyAcceptanceAndMaintainedReports(t *testing.T) {
	for _, maintained := range []bool{false, true} {
		t.Run(fmt.Sprint(maintained), func(t *testing.T) {
			p := newProj(t)
			p.write("suite/a.feature", fixtureFeature)
			p.write("suite/b.feature", fixtureFeature)
			p.commit("suite")
			expected, err := project.ParseGherkin(fixtureFeature)
			if err != nil {
				t.Fatal(err)
			}
			extra := simpleMessages("suite/a.feature", expected, reportOpts{prefix: "extra"})
			extra = append(extra, obj{"gherkinDocument": obj{"uri": "suite/b.feature"}})
			path := writeReport(t, p.Aux, "extra.ndjson", extra)
			if maintained {
				p.Config.Acceptance.Run += `; if test "$KOGEN_ACCEPTANCE_FEATURES" = suite/a.feature; then cat ` + shellQuote(path) + ` >> "$KOGEN_ACCEPTANCE_REPORT"; fi`
			} else {
				p.Config.Acceptance.Run += "; cat " + shellQuote(path) + ` >> "$KOGEN_ACCEPTANCE_REPORT"`
			}
			in := p.input(1)
			in.AcceptanceSuite = &AcceptanceSuite{Location: "suite/*.feature"}
			if maintained {
				in.MaintainedFeatures = []string{"suite/a.feature"}
			}
			s, _ := p.session()
			pass, err := Verify(context.Background(), s, in)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(pass.UncoveredAcceptance, []string{"suite/b.feature"}) {
				t.Fatal(pass.UncoveredAcceptance)
			}
		})
	}
}
