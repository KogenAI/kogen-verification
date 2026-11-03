//go:build darwin

package verify

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
)

// listProcs reads the process table with /bin/ps.
func listProcs() ([]procEntry, error) {
	out, err := exec.Command("/bin/ps", "-axo", "pid=,ppid=,uid=,stat=").Output()
	if err != nil {
		return nil, err
	}
	var procs []procEntry
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		pid, e1 := strconv.Atoi(f[0])
		ppid, e2 := strconv.Atoi(f[1])
		uid, e3 := strconv.Atoi(f[2])
		if e1 != nil || e2 != nil || e3 != nil {
			continue
		}
		procs = append(procs, procEntry{pid: pid, ppid: ppid, uid: uid, zombie: strings.HasPrefix(f[3], "Z")})
	}
	if len(procs) == 0 {
		return nil, fmt.Errorf("empty process table")
	}
	return procs, nil
}

// procargs2 returns the raw kern.procargs2 data of pid.
func procargs2(pid int) ([]byte, error) {
	mib := [3]int32{1 /* CTL_KERN */, 49 /* KERN_PROCARGS2 */, int32(pid)}
	query := func(data unsafe.Pointer, size *uintptr) error {
		_, _, errno := syscall.Syscall6(syscall.SYS___SYSCTL, uintptr(unsafe.Pointer(&mib[0])), 3, uintptr(data), uintptr(unsafe.Pointer(size)), 0, 0)
		if errno != 0 {
			return errno
		}
		return nil
	}
	var size uintptr
	if err := query(nil, &size); err != nil {
		return nil, err
	}
	for try := 0; try < 3; try++ {
		buf := make([]byte, size+4096)
		n := uintptr(len(buf))
		err := query(unsafe.Pointer(&buf[0]), &n)
		if err == nil {
			return buf[:n], nil
		}
		if err != syscall.ENOMEM {
			return nil, err
		}
		size = uintptr(len(buf)) * 2
	}
	return nil, syscall.ENOMEM
}

// procMarked reports whether pid's environment (kern.procargs2) holds exactly entry. An
// environment that cannot be read does not match.
func procMarked(pid int, entry string) bool {
	data, err := procargs2(pid)
	if err != nil || len(data) < 4 {
		return false
	}
	argc := int(int32(binary.LittleEndian.Uint32(data)))
	rest := data[4:]
	// The executable path, its padding NULs, then argc arguments, then the environment.
	i := bytes.IndexByte(rest, 0)
	if i < 0 {
		return false
	}
	rest = bytes.TrimLeft(rest[i:], "\x00")
	for ; argc > 0; argc-- {
		i := bytes.IndexByte(rest, 0)
		if i < 0 {
			return false
		}
		rest = rest[i+1:]
	}
	want := []byte(entry)
	for _, kv := range bytes.Split(rest, []byte{0}) {
		if bytes.Equal(kv, want) {
			return true
		}
	}
	return false
}

// procInfo calls proc_info(callnum, pid, flavor, arg, buffer, size) and returns the number of
// bytes it wrote to buf.
func procInfo(callnum, pid, flavor int, arg uint64, buf []byte) (int, error) {
	var p unsafe.Pointer
	if len(buf) > 0 {
		p = unsafe.Pointer(&buf[0])
	}
	n, _, errno := syscall.Syscall6(syscall.SYS_PROC_INFO, uintptr(callnum), uintptr(pid), uintptr(flavor), uintptr(arg), uintptr(p), uintptr(len(buf)))
	if errno != 0 {
		return 0, errno
	}
	return int(n), nil
}

// procHoldsFile reports whether pid has an open vnode descriptor, with any number, on the file
// with this device and inode. It uses proc_info, which also reads the descriptors of Apple
// platform binaries. A descriptor table that cannot be read does not match.
func procHoldsFile(pid int, dev, ino uint64) bool {
	const (
		callPidInfo   = 2   // PROC_INFO_CALL_PIDINFO
		callPidFDInfo = 3   // PROC_INFO_CALL_PIDFDINFO
		listFDs       = 1   // PROC_PIDLISTFDS
		fdVnodeInfo   = 1   // PROC_PIDFDVNODEINFO
		fdTypeVnode   = 1   // PROX_FDTYPE_VNODE
		fdInfoSize    = 8   // struct proc_fdinfo: int32 fd, uint32 type
		vnodeInfoSize = 176 // struct vnode_fdinfo
	)
	var list []byte
	for try := 0; try < 3; try++ {
		n, err := procInfo(callPidInfo, pid, listFDs, 0, nil)
		if err != nil || n <= 0 {
			return false
		}
		list = make([]byte, n+16*fdInfoSize)
		n, err = procInfo(callPidInfo, pid, listFDs, 0, list)
		if err != nil {
			return false
		}
		if n < len(list) {
			list = list[:n]
			break
		}
		list = nil // it may have been cut short: ask again
	}
	info := make([]byte, vnodeInfoSize)
	for ; len(list) >= fdInfoSize; list = list[fdInfoSize:] {
		fd := int32(binary.LittleEndian.Uint32(list))
		if binary.LittleEndian.Uint32(list[4:]) != fdTypeVnode {
			continue
		}
		n, err := procInfo(callPidFDInfo, pid, fdVnodeInfo, uint64(fd), info)
		if err != nil || n < vnodeInfoSize {
			continue
		}
		if uint64(binary.LittleEndian.Uint32(info[24:])) == uint64(uint32(dev)) && binary.LittleEndian.Uint64(info[32:]) == ino {
			return true
		}
	}
	return false
}

// acceptanceReaped returns script unchanged: only Linux has a child subreaper.
func acceptanceReaped(script string) string { return script }
