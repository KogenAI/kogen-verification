// Command sweepdriver is the acceptance harness of the acceptance sweep. It runs one fixture
// acceptance command through verify.RunAcceptance, the way Kogen runs a project's acceptance
// command, and prints one JSON object with what the run returned and which processes are still
// running 1.5 seconds after it returned.
//
//	sweepdriver run <pattern>   start a background server the way pattern says (see patterns)
//	sweepdriver same <command>  the run's status and output next to those of /bin/sh -c command
//	sweepdriver spawn [-setsid] [-clearenv] [-closefds] <pidfile> <program> [args...]
//
// run exits 0 when the server is stopped, the three processes the run did not start are
// running and the run returned status 3 and fixtureOutput; 1 otherwise; 2 when the harness
// itself failed. same exits 0 unless the harness failed. spawn is the launcher the fixtures
// use: it starts program with its standard streams on /dev/null, in a new session with
// -setsid and with an empty environment with -clearenv, writes the program's pid to pidfile
// and exits without waiting, so the program is reparented. It passes every inherited
// descriptor on to program, unless -closefds: then program receives only its standard streams.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-verification/verify"
)

// patterns are the fixture acceptance commands, one per way a background server is started,
// and the controls of this harness. {driver} is this program, {sleep} is sleep, {python} is
// python3 running popenDetach, {pidfile} the file that receives the server's pid and {before}
// the pid file of the process started before the run. Every pattern but the last control then
// runs fixtureTail.
var patterns = map[string]string{
	"plain &":                              `{sleep} 300 >/dev/null 2>&1 & echo $! > {pidfile}`,
	"nohup":                                `nohup {sleep} 300 >/dev/null 2>&1 & echo $! > {pidfile}`,
	"setsid, env kept":                     `{driver} spawn -setsid {pidfile} {sleep} 300`,
	"env -i, same group":                   `env -i {sleep} 300 >/dev/null 2>&1 & echo $! > {pidfile}`,
	"(env -i x &), same group":             `(env -i {sleep} 300 >/dev/null 2>&1 & echo $! > {pidfile})`,
	"env cleared, setsid, launcher exited": `{driver} spawn -setsid -clearenv {pidfile} {sleep} 300`,

	// Launchers that close inherited descriptors, so the server holds no marker descriptor.
	"python Popen, env cleared, new session, launcher exited":  `{python} {pidfile} {sleep}`,
	"descriptors closed, env cleared, setsid, launcher exited": `{driver} spawn -setsid -clearenv -closefds {pidfile} {sleep} 300`,

	// Controls: a server that ends by itself (accepted), one that the run did not start and
	// that keeps running, a run that stops a process it did not start, and a run with another
	// status and output (all three rejected).
	"control: server exits by itself":                   `{sleep} 0 >/dev/null 2>&1 & echo $! > {pidfile}`,
	"control: server started outside the run":           `cat {before} > {pidfile}`,
	"control: the run stops a process it did not start": `kill -9 "$(cat {before})"; {sleep} 0 >/dev/null 2>&1 & echo $! > {pidfile}`,
	"control: other exit status and output":             `{sleep} 0 >/dev/null 2>&1 & echo $! > {pidfile}; printf 'other output\n'; sleep 1; exit 4`,
}

// popenDetach is the reported launcher: Python's subprocess.Popen with its default close_fds,
// an empty environment and a new session. It writes the server's pid to argv[1] and exits.
const popenDetach = `import subprocess, sys
p = subprocess.Popen([sys.argv[2], "300"], env={}, start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
open(sys.argv[1], "w").write(str(p.pid))
`

// fixtureTail prints to both streams, keeps the run going for a second (the process started
// during the run starts then) and exits 3.
const fixtureTail = `; printf 'fixture output\n'; printf 'fixture error\n' >&2; sleep 1; exit 3`

const fixtureOutput = "fixture output\nfixture error\n"

// cleanup holds the processes to SIGKILL however this program ends.
var cleanup []int

func main() {
	if len(os.Args) < 2 {
		fail("usage: sweepdriver run <pattern> | same <command> | spawn ...")
	}
	switch os.Args[1] {
	case "spawn":
		spawn(os.Args[2:])
	case "run":
		if len(os.Args) != 3 {
			fail("usage: sweepdriver run <pattern>")
		}
		os.Exit(run(os.Args[2]))
	case "same":
		if len(os.Args) != 3 {
			fail("usage: sweepdriver same <command>")
		}
		same(os.Args[2])
	default:
		fail("unknown mode " + os.Args[1])
	}
}

func stop() {
	for _, pid := range cleanup {
		syscall.Kill(pid, syscall.SIGKILL)
	}
}

func fail(msg string) {
	stop()
	fmt.Fprintln(os.Stderr, "sweepdriver: "+msg)
	os.Exit(2)
}

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func spawn(args []string) {
	setsid, clearenv, closefds := false, false, false
	for ; len(args) > 0 && strings.HasPrefix(args[0], "-"); args = args[1:] {
		switch args[0] {
		case "-setsid":
			setsid = true
		case "-clearenv":
			clearenv = true
		case "-closefds":
			closefds = true
		default:
			fail("unknown spawn flag " + args[0])
		}
	}
	if len(args) < 2 {
		fail("usage: sweepdriver spawn [-setsid] [-clearenv] [-closefds] <pidfile> <program> [args...]")
	}
	if closefds {
		// Mark every descriptor above the standard streams close-on-exec, so program
		// inherits none of them.
		for fd := 3; fd < 1024; fd++ {
			syscall.CloseOnExec(fd)
		}
	}
	cmd := exec.Command(args[1], args[2:]...)
	if clearenv {
		cmd.Env = []string{}
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: setsid}
	if err := cmd.Start(); err != nil {
		fail(err.Error())
	}
	if err := os.WriteFile(args[0], []byte(strconv.Itoa(cmd.Process.Pid)), 0o644); err != nil {
		cmd.Process.Kill()
		fail(err.Error())
	}
}

// project makes a directory whose Intent "sweep" has a one-scenario feature.
func project() string {
	dir, err := os.MkdirTemp("", "sweepdriver-")
	if err != nil {
		fail(err.Error())
	}
	feature := filepath.Join(dir, ".kogen/intents/sweep/acceptance.feature")
	if err := os.MkdirAll(filepath.Dir(feature), 0o755); err != nil {
		fail(err.Error())
	}
	if err := os.WriteFile(feature, []byte("Feature: sweep\n  Scenario: sweep\n    Then sweep\n"), 0o644); err != nil {
		fail(err.Error())
	}
	return dir
}

func acceptance(dir, command string) verify.Acceptance {
	s := sys.NewWith(os.Environ(), dir)
	a, err := verify.RunAcceptance(context.Background(), s, dir, verify.Tools{}, "sweep", command, filepath.Join(dir, "report.ndjson"), nil, nil)
	if err != nil {
		fail("RunAcceptance: " + err.Error())
	}
	return a
}

func readPID(file string, wait time.Duration) int {
	for deadline := time.Now().Add(wait); ; time.Sleep(20 * time.Millisecond) {
		if b, err := os.ReadFile(file); err == nil {
			if pid, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && pid > 0 {
				return pid
			}
		}
		if time.Now().After(deadline) {
			fail("no pid in " + file + " after " + wait.String())
		}
	}
}

// state is "running" for a live process and "stopped" for one that is gone or a zombie.
func state(pid int) string {
	out, err := exec.Command("ps", "-o", "stat=", "-p", strconv.Itoa(pid)).Output()
	if st := strings.TrimSpace(string(out)); err != nil || st == "" || strings.HasPrefix(st, "Z") {
		return "stopped"
	}
	return "running"
}

func run(pattern string) int {
	tmpl, ok := patterns[pattern]
	if !ok {
		fail("unknown pattern " + quote(pattern))
	}
	self, err := os.Executable()
	if err != nil {
		fail(err.Error())
	}
	sleep, err := exec.LookPath("sleep")
	if err != nil {
		fail(err.Error())
	}
	python := "python3"
	if strings.Contains(tmpl, "{python}") {
		if python, err = exec.LookPath("python3"); err != nil {
			fail(err.Error())
		}
	}
	dir := project()
	defer os.RemoveAll(dir)
	pidFile := func(name string) string { return filepath.Join(dir, name+".pid") }
	command := strings.NewReplacer("{driver}", quote(self), "{sleep}", quote(sleep), "{python}", quote(python)+" -c "+quote(popenDetach), "{pidfile}", quote(pidFile("server")),
		"{before}", quote(pidFile("before"))).Replace(tmpl)
	if pattern != "control: other exit status and output" {
		command += fixtureTail
	}

	// A detached, environment-cleared process like the leaked server, started by this
	// program and not by the run.
	detached := func(name string) int {
		if out, err := exec.Command(self, "spawn", "-setsid", "-clearenv", pidFile(name), sleep, "300").CombinedOutput(); err != nil {
			fail(name + ": " + err.Error() + ": " + string(out))
		}
		pid := readPID(pidFile(name), 5*time.Second)
		cleanup = append(cleanup, pid)
		return pid
	}
	before := detached("before")
	// A process carrying another run's value: a child of this program in its own session.
	other := exec.Command(sleep, "300")
	other.Env = append(os.Environ(), "KOGEN_ACCEPTANCE_RUN=0123456789abcdef0123456789abcdef")
	other.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := other.Start(); err != nil {
		fail(err.Error())
	}
	cleanup = append(cleanup, other.Process.Pid)
	defer stop()

	done := make(chan verify.Acceptance, 1)
	go func() { done <- acceptance(dir, command) }()
	server := readPID(pidFile("server"), 30*time.Second)
	cleanup = append(cleanup, server)
	during := detached("during")
	a := <-done
	time.Sleep(1500 * time.Millisecond)

	got := map[string]any{
		"status": a.Status,
		"output": a.Output,
		"server": state(server),
		"before": state(before),
		"other":  state(other.Process.Pid),
		"during": state(during),
	}
	report(got)
	if got["server"] == "stopped" && got["before"] == "running" && got["other"] == "running" && got["during"] == "running" &&
		a.Status == 3 && a.Output == fixtureOutput {
		return 0
	}
	return 1
}

func same(command string) {
	dir := project()
	defer os.RemoveAll(dir)
	a := acceptance(dir, command)
	direct := exec.Command("/bin/sh", "-c", command)
	direct.Dir = dir
	out, err := direct.CombinedOutput()
	if _, exited := err.(*exec.ExitError); err != nil && !exited {
		fail("/bin/sh -c: " + err.Error())
	}
	report(map[string]any{
		"status":        a.Status,
		"output":        a.Output,
		"direct_status": direct.ProcessState.ExitCode(),
		"direct_output": string(out),
	})
}

func report(v map[string]any) {
	b, err := json.Marshal(v)
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(b))
}
