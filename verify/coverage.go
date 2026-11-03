package verify

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// AcceptanceSuite declares the files whose execution is reported for a pass.
type AcceptanceSuite struct {
	Location            string
	RequireFullCoverage bool
}

func suiteFiles(root, location string) ([]string, error) {
	var paths []string
	if strings.ContainsAny(location, "*?[") {
		matches, err := filepath.Glob(filepath.Join(root, location))
		if err != nil {
			return nil, err
		}
		paths = matches
	} else {
		dir := filepath.Join(root, location)
		err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.Type().IsRegular() && filepath.Ext(path) == ".feature" {
				paths = append(paths, path)
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("acceptance suite %s: %w", location, err)
		}
	}
	out := []string{}
	for _, path := range paths {
		info, err := os.Lstat(path)
		if err == nil && info.Mode().IsRegular() && filepath.Ext(path) == ".feature" {
			out = append(out, candidatePath(root, path))
		}
	}
	slices.Sort(out)
	return slices.Compact(out), nil
}
func candidatePath(root, path string) string {
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(rel)
}
func checkCoverage(root, path string, executed map[string]bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var report struct {
		Executed []string `json:"executed_features"`
	}
	if json.Unmarshal(b, &report) != nil {
		return
	}
	for _, p := range report.Executed {
		executed[candidatePath(root, p)] = true
	}
}
func acceptanceCoverage(root, path string, executed map[string]bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	pickles := map[string]string{}
	cases := map[string]string{}
	starts := map[string]string{}
	var finished []string
	for _, line := range strings.Split(string(b), "\n") {
		var m struct {
			Pickle *struct{ ID, URI string } `json:"pickle"`
			Case   *struct {
				ID, PickleID string `json:"-"`
			} `json:"-"`
			TestCase *struct {
				ID       string `json:"id"`
				PickleID string `json:"pickleId"`
			} `json:"testCase"`
			Started *struct {
				ID     string `json:"id"`
				CaseID string `json:"testCaseId"`
			} `json:"testCaseStarted"`
			Finished *struct {
				StartedID string `json:"testCaseStartedId"`
			} `json:"testCaseFinished"`
		}
		if json.Unmarshal([]byte(line), &m) != nil {
			continue
		}
		if m.Pickle != nil {
			pickles[m.Pickle.ID] = m.Pickle.URI
		}
		if m.TestCase != nil {
			cases[m.TestCase.ID] = m.TestCase.PickleID
		}
		if m.Started != nil {
			starts[m.Started.ID] = m.Started.CaseID
		}
		if m.Finished != nil {
			finished = append(finished, m.Finished.StartedID)
		}
	}
	for _, id := range finished {
		if uri := pickles[cases[starts[id]]]; uri != "" {
			executed[candidatePath(root, uri)] = true
		}
	}
}
func coverageLine(paths []string) string {
	if len(paths) == 0 {
		return ""
	}
	prefix := fmt.Sprintf("Acceptance coverage: %d uncovered: ", len(paths))
	n := min(3, len(paths))
	suffix := ""
	if len(paths) > n {
		suffix = fmt.Sprintf(" (+%d omitted)", len(paths)-n)
	}
	var parts []string
	for i := 0; i < n; i++ {
		parts = append(parts, strings.ReplaceAll(strings.ReplaceAll(paths[i], "\n", "\\n"), "\r", "\\r"))
	}
	text := strings.Join(parts, ", ")
	limit := 512 - len(prefix) - len(suffix)
	if len(text) > limit {
		text = validPrefix(text[:limit-3]) + "..."
	}
	return prefix + text + suffix
}
