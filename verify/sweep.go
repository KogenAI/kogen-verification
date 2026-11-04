package verify

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"slices"
	"syscall"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

// acceptanceMarker is the environment variable that names one acceptance run. Kogen adds it to
// the acceptance command with a fresh random value per run and never carries it itself.
const acceptanceMarker = "KOGEN_ACCEPTANCE_RUN"

// stepMarker is the same for every other verification step: one fresh value per step.
const stepMarker = "KOGEN_STEP_RUN"

// sweepGrace is how long a SIGTERMed process may take to leave before it gets SIGKILL; it
// matches the grace of sys.Terminate.
const sweepGrace = 5 * time.Second

func newAcceptanceRunID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// newAcceptanceMarkerFile creates the run's empty marker file, mode 0600, in Kogen's temporary
// area. It is not kept open here; the acceptance shell holds it on descriptor 9.
func newAcceptanceMarkerFile() (string, error) {
	path := sys.TmpPath("kogen-acceptance-marker")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

// acceptanceScript is the text run in place of command: the shell holds the marker file open
// on descriptor 9, then becomes an /bin/sh that receives command byte for byte.
func acceptanceScript(markerFile, command string) string {
	return "exec 9<" + shellQuote(markerFile) + "; exec /bin/sh -c " + shellQuote(command)
}

// procEntry is one row of a process table snapshot.
type procEntry struct {
	pid, ppid, uid int
	zombie         bool
}

// acceptanceTargets selects, from one snapshot, the processes of the current user that carry
// the run's marker (marked) and every process that descends from one of them by parent pid.
// Kogen's own process (self), its ancestors, zombies and processes of other users are never
// selected. marked is asked only about processes that could be selected.
func acceptanceTargets(procs []procEntry, uid, self int, marked func(pid int) bool) []int {
	byPID := make(map[int]procEntry, len(procs))
	children := map[int][]int{}
	for _, p := range procs {
		byPID[p.pid] = p
		children[p.ppid] = append(children[p.ppid], p.pid)
	}
	protected := map[int]bool{self: true}
	for pid, hops := byPID[self].ppid, 0; pid > 0 && !protected[pid] && hops <= len(procs); hops++ {
		protected[pid] = true
		pid = byPID[pid].ppid
	}
	seen := map[int]bool{}
	var out []int
	var visit func(pid int)
	visit = func(pid int) {
		if seen[pid] {
			return
		}
		seen[pid] = true
		p := byPID[pid]
		if !protected[pid] && !p.zombie && p.uid == uid {
			out = append(out, pid)
		}
		for _, c := range children[pid] {
			if !protected[c] {
				visit(c)
			}
		}
	}
	for _, p := range procs {
		if protected[p.pid] || p.zombie || p.uid != uid || seen[p.pid] {
			continue
		}
		if marked(p.pid) {
			visit(p.pid)
		}
	}
	slices.Sort(out)
	return out
}

// stopMarkedProcesses stops every process the step with this value started: SIGTERM to the
// processes carrying variable=value or holding an open descriptor on markerFile, and their
// descendants, SIGKILL to those still present after the grace, then SIGKILL for any newly
// matching process until a snapshot finds none. It returns how many distinct processes it
// signaled without EPERM. A process table that cannot be read ends the sweep without an error
// for the step; it is returned only so the caller can log it.
func stopMarkedProcesses(variable, value, markerFile string) (int, error) {
	uid, self := os.Getuid(), os.Getpid()
	marker := variable + "=" + value
	var dev, ino uint64
	haveFile := false
	if info, err := os.Stat(markerFile); err == nil {
		if st, ok := info.Sys().(*syscall.Stat_t); ok {
			dev, ino, haveFile = uint64(st.Dev), uint64(st.Ino), true
		}
	}
	snapshot := func() ([]int, error) {
		procs, err := listProcs()
		if err != nil {
			return nil, err
		}
		return acceptanceTargets(procs, uid, self, func(pid int) bool {
			return procMarked(pid, marker) || haveFile && procHoldsFile(pid, dev, ino)
		}), nil
	}
	targets, err := snapshot()
	if err != nil || len(targets) == 0 {
		return 0, err
	}
	// A process that cannot be signaled (it changed identity) is not waited for again.
	refused := map[int]bool{}
	signaled := map[int]bool{}
	signal := func(pids []int, sig syscall.Signal) {
		for _, pid := range pids {
			if err := syscall.Kill(pid, sig); err == syscall.EPERM {
				refused[pid] = true
			} else if err == nil {
				signaled[pid] = true
			}
		}
	}
	signal(targets, syscall.SIGTERM)
	for deadline := time.Now().Add(sweepGrace); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if len(present(targets, refused)) == 0 {
			break
		}
	}
	signal(present(targets, refused), syscall.SIGKILL)
	for {
		targets, err = snapshot()
		if err != nil {
			return len(signaled), err
		}
		targets = slices.DeleteFunc(targets, func(pid int) bool { return refused[pid] })
		if len(targets) == 0 {
			return len(signaled), nil
		}
		signal(targets, syscall.SIGKILL)
		time.Sleep(50 * time.Millisecond)
	}
}

// present returns those of pids that are still running (a zombie counts as gone).
func present(pids []int, skip map[int]bool) []int {
	procs, err := listProcs()
	if err != nil {
		return nil
	}
	running := map[int]bool{}
	for _, p := range procs {
		if !p.zombie {
			running[p.pid] = true
		}
	}
	var out []int
	for _, pid := range pids {
		if running[pid] && !skip[pid] {
			out = append(out, pid)
		}
	}
	return out
}
