package verify

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
)

// MaintainedSpecs names the maintained specifications and the implementation they describe.
type MaintainedSpecs struct {
	Specs          []string // repository-relative files or directories
	Implementation []string // repository-relative files or directories
	RequireUpdate  bool     // the project setting "require spec update"
}

func (m *MaintainedSpecs) declared() bool {
	return m != nil && len(m.Specs)+len(m.Implementation) > 0
}

// implementationListBound is how many changed implementation files a record lists.
const implementationListBound = 20

// SpecUpdate is the informational record of which implementation and maintained
// specification files the candidate changed against the commit it started from.
type SpecUpdate struct {
	ImplementationChangedCount int      `json:"implementation_changed_count"`
	ImplementationChanged      []string `json:"implementation_changed"`
	SpecsChangedCount          int      `json:"specs_changed_count"`
	SpecsChanged               []string `json:"specs_changed"`
	SpecsUnchanged             []string `json:"specs_unchanged"`
	SpecsNotUpdated            bool     `json:"specs_not_updated"`
}

// matchesDeclared is whether file equals the cleaned declared path, lies under it, or the
// declared path is ".".
func matchesDeclared(file, declared string) bool {
	d := path.Clean(declared)
	return d == "." || file == d || strings.HasPrefix(file, d+"/")
}

func matchesAny(file string, declared []string) bool {
	return slices.ContainsFunc(declared, func(d string) bool { return matchesDeclared(file, d) })
}

// classifySpecUpdate sorts the changed files into specification and implementation files
// (a specification path wins when a file matches both kinds; a file under neither is ignored).
func classifySpecUpdate(changed []string, m *MaintainedSpecs) *SpecUpdate {
	var impl, specs []string
	for _, file := range changed {
		switch {
		case matchesAny(file, m.Specs):
			specs = append(specs, file)
		case matchesAny(file, m.Implementation):
			impl = append(impl, file)
		}
	}
	slices.Sort(impl)
	slices.Sort(specs)
	u := &SpecUpdate{ImplementationChangedCount: len(impl), SpecsChangedCount: len(specs), SpecsChanged: nonNil(specs), SpecsUnchanged: []string{}}
	u.ImplementationChanged = nonNil(impl[:min(len(impl), implementationListBound)])
	for _, s := range m.Specs {
		if !slices.ContainsFunc(changed, func(file string) bool { return matchesDeclared(file, s) }) {
			u.SpecsUnchanged = append(u.SpecsUnchanged, s)
		}
	}
	u.SpecsNotUpdated = u.ImplementationChangedCount > 0 && u.SpecsChangedCount == 0
	return u
}

// Notice is the one line that shows a "specs not updated" flag.
func (u SpecUpdate) Notice() string {
	files := strings.Join(u.ImplementationChanged, ", ")
	if more := u.ImplementationChangedCount - len(u.ImplementationChanged); more > 0 {
		files += fmt.Sprintf(", and %d more", more)
	}
	return fmt.Sprintf("specs not updated: implementation files changed: %d (%s); maintained specifications unchanged: %s",
		u.ImplementationChangedCount, files, strings.Join(u.SpecsUnchanged, ", "))
}

// notice is the flag line, or "" when the pass carries no flag.
func (p Pass) specNotice() string {
	if p.SpecUpdate == nil || !p.SpecUpdate.SpecsNotUpdated {
		return ""
	}
	return p.SpecUpdate.Notice()
}

// checkDeclaredExist refuses the first declared path (specifications first) that is neither
// a file nor a directory holding a file in the materialized candidate at root.
func checkDeclaredExist(root string, m *MaintainedSpecs) error {
	for _, group := range []struct {
		paths []string
		what  string
	}{{m.Specs, "maintained specification path"}, {m.Implementation, "implementation path"}} {
		for _, p := range group.paths {
			if !holdsFile(root, p) {
				return fmt.Errorf("%s does not exist in the candidate: %s", group.what, p)
			}
		}
	}
	return nil
}

func holdsFile(root, declared string) bool {
	d := path.Clean(declared)
	if d == ".." || strings.HasPrefix(d, "../") || path.IsAbs(d) {
		return false
	}
	full := filepath.Join(root, filepath.FromSlash(d))
	info, err := os.Lstat(full)
	if err != nil {
		return false
	}
	if !info.IsDir() {
		return true
	}
	found := false
	filepath.WalkDir(full, func(p string, e os.DirEntry, err error) error {
		if err != nil || found {
			return filepath.SkipAll
		}
		if !e.IsDir() {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}
