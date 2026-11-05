//go:build linux

package verify

import (
	"bytes"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

// acceptanceReaperFlag is the argument that makes a Kogen-linked binary the per-run helper.
const acceptanceReaperFlag = "--kogen-verification-acceptance-reaper"

// prSetChildSubreaper is prctl option PR_SET_CHILD_SUBREAPER.
const prSetChildSubreaper = 36

// acceptanceReaped runs script under a dedicated per-run helper, which is a child subreaper:
// every descendant of the command whose parent dies is reparented to the helper. The helper
// reaps the children that exit while the command runs, and stops and reaps the rest once the
// command's shell has ended. If this program cannot be named, script
// is returned unchanged and the marker sweep alone applies.
func acceptanceReaped(script string) string {
	self, err := os.Executable()
	if err != nil {
		return script
	}
	return "exec " + shellQuote(self) + " " + acceptanceReaperFlag + " " + shellQuote(script)
}

// init turns the process into the acceptance helper when, and only when, it was started as
// acceptanceReaped arranges. Any other process returns at once and keeps its adoption policy.
func init() {
	if len(os.Args) != 3 || os.Args[1] != acceptanceReaperFlag {
		return
	}
	os.Exit(runAcceptanceReaper(os.Args[2]))
}

// runAcceptanceReaper runs /bin/sh -c script as a child subreaper. While the shell runs it reaps
// every child that exits, so an adopted orphan never lingers as a zombie, and signals nothing.
// Once the shell has ended it stops and reaps every child it still has, and returns the shell's
// exit status (128+n for a signal n), whatever other children were reaped before it.
func runAcceptanceReaper(script string) int {
	argv := []string{"/bin/sh", "-c", script}
	if _, _, errno := syscall.Syscall(syscall.SYS_PRCTL, prSetChildSubreaper, 1, 0); errno != 0 {
		// Without a subreaper this is today's behavior: the marker sweep applies.
		syscall.Exec("/bin/sh", argv, os.Environ())
		return 127
	}
	// Catch the group signals instead of ignoring them: the command keeps default dispositions
	// and the helper outlives them to clean up. sys owns cancellation, timeout and interrupt.
	sigs := make(chan os.Signal, 8)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		for range sigs {
		}
	}()
	attr := &os.ProcAttr{Files: []*os.File{os.Stdin, os.Stdout, os.Stderr}, Env: os.Environ()}
	proc, err := os.StartProcess("/bin/sh", argv, attr)
	if err != nil {
		return 127
	}
	// Wait for any child, not only the shell: an adopted orphan that exits is reaped at once.
	// The shell's own status is kept; every other status is discarded.
	var ws syscall.WaitStatus
	for {
		pid, err := syscall.Wait4(-1, &ws, 0, nil)
		if err == syscall.EINTR {
			continue
		}
		if err != nil {
			return 127
		}
		if pid == proc.Pid {
			break
		}
	}
	stopAdoptedChildren()
	if ws.Signaled() {
		return 128 + int(ws.Signal())
	}
	return ws.ExitStatus()
}

// stopAdoptedChildren reaps and stops this process's children until a snapshot shows none:
// SIGTERM once to each during the grace, SIGKILL on every pass after it. Killing a parent makes
// its surviving descendants children on the next pass. Children of another user, and those that
// refused a signal, are left alone. A process table that cannot be read leaves the rest to the
// marker sweep.
func stopAdoptedChildren() {
	uid, self := os.Getuid(), os.Getpid()
	graceEnds := time.Now().Add(sweepGrace)
	refused := map[int]bool{}
	termed := map[int]bool{}
	for {
		// Reaping only here keeps a pid from being recycled between snapshot and signal.
		for {
			pid, err := syscall.Wait4(-1, nil, syscall.WNOHANG, nil)
			if err == syscall.EINTR || pid > 0 {
				continue
			}
			break
		}
		procs, err := listProcs()
		if err != nil {
			return
		}
		remaining := false
		for _, p := range procs {
			if p.ppid != self || p.uid != uid || refused[p.pid] {
				continue
			}
			remaining = true
			if p.zombie {
				continue // reaped on the next pass
			}
			sig := syscall.SIGKILL
			if time.Now().Before(graceEnds) {
				if termed[p.pid] {
					continue
				}
				termed[p.pid] = true
				sig = syscall.SIGTERM
			}
			if syscall.Kill(p.pid, sig) == syscall.EPERM {
				refused[p.pid] = true
			}
		}
		if !remaining {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// listProcs reads the process table from /proc/<pid>/stat (parent pid, state) and the owner
// of /proc/<pid>.
func listProcs() ([]procEntry, error) {
	dirs, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	var out []procEntry
	for _, d := range dirs {
		pid, err := strconv.Atoi(d.Name())
		if err != nil {
			continue
		}
		stat, err := os.ReadFile("/proc/" + d.Name() + "/stat")
		if err != nil {
			continue // gone since the listing
		}
		// pid (comm) state ppid ...; comm may hold spaces and parentheses.
		i := bytes.LastIndexByte(stat, ')')
		if i < 0 {
			continue
		}
		fields := bytes.Fields(stat[i+1:])
		if len(fields) < 2 {
			continue
		}
		ppid, err := strconv.Atoi(string(fields[1]))
		if err != nil {
			continue
		}
		info, err := os.Stat("/proc/" + d.Name())
		if err != nil {
			continue
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok {
			continue
		}
		state := string(fields[0])
		out = append(out, procEntry{pid: pid, ppid: ppid, uid: int(st.Uid), zombie: state == "Z" || state == "X"})
	}
	return out, nil
}

// procMarked reports whether pid's initial environment holds exactly entry. An environment
// that cannot be read does not match.
func procMarked(pid int, entry string) bool {
	env, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/environ")
	if err != nil {
		return false
	}
	want := []byte(entry)
	for _, kv := range bytes.Split(env, []byte{0}) {
		if bytes.Equal(kv, want) {
			return true
		}
	}
	return false
}

// procHoldsFile reports whether pid has an open descriptor, with any number, on the file with
// this device and inode. A descriptor table that cannot be read does not match.
func procHoldsFile(pid int, dev, ino uint64) bool {
	dir := "/proc/" + strconv.Itoa(pid) + "/fd"
	fds, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, fd := range fds {
		info, err := os.Stat(dir + "/" + fd.Name())
		if err != nil {
			continue
		}
		if st, ok := info.Sys().(*syscall.Stat_t); ok && uint64(st.Dev) == dev && uint64(st.Ino) == ino {
			return true
		}
	}
	return false
}
