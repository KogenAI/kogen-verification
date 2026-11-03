//go:build linux

package verify

import (
	"bytes"
	"os"
	"strconv"
	"syscall"
)

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
