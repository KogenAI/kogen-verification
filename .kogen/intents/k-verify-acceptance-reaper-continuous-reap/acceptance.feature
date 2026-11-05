Feature: k-verify-acceptance-reaper-continuous-reap: the Linux acceptance helper reaps adopted children while the check runs

  On Linux every check runs as `exec <kogen-linked binary> --kogen-verification-acceptance-reaper '<script>'`:
  a helper that is a child subreaper and runs the script with /bin/sh -c. The helper reaps every child
  that exits while the shell runs, so an adopted orphan never lingers as a zombie; it signals nothing
  while the shell runs; once the shell has exited it stops and reaps the children it still has, and it
  returns the shell's own status (the exit code, or 128+n for a signal n).

  Each script runs through `/bin/sh -c "exec <helper> --kogen-verification-acceptance-reaper '<script>'"`
  in a fresh working directory, where <helper> is a program built from a main package that links
  package verify. The script's environment is the run's, plus FIXTURE_NODE (this Node) and
  FIXTURE_HARNESS (that same program, whose `launch <file>` mode is the Go launcher of a detached
  server). Linux only.

  Scenario: A process-group member adopted by the helper and killed while the shell runs is gone at once
    When k-verify-acceptance-reaper-continuous-reap: the helper runs the script:
      """
      ( setsid /bin/sleep 300 </dev/null >/dev/null 2>&1 & echo $! > member )
      member=$(cat member)
      i=0
      while [ "$(cut -d' ' -f5 /proc/$member/stat)" != "$member" ] && [ $i -lt 500 ]; do sleep 0.01; i=$((i+1)); done
      if [ "$(cut -d' ' -f4 /proc/$member/stat)" = "$PPID" ]; then echo "member adopted by the helper"; fi
      start=$(date +%s%N)
      kill -TERM -$member
      while kill -0 $member 2>/dev/null && [ $(( $(date +%s%N) - start )) -lt 5000000000 ]; do sleep 0.05; done
      echo $(( ($(date +%s%N) - start) / 1000000 )) > elapsed-ms
      if kill -0 $member 2>/dev/null; then echo "still present"; echo "state $(cut -d' ' -f3 /proc/$member/stat)" >&2; else echo gone; fi
      """
    Then k-verify-acceptance-reaper-continuous-reap: the helper exits 0 with the output:
      """
      member adopted by the helper
      gone
      """
    And k-verify-acceptance-reaper-continuous-reap: the file "elapsed-ms" holds a number of milliseconds of at most 500

  Scenario: The helper still returns the shell's exit code and 128+n for a signal
    When k-verify-acceptance-reaper-continuous-reap: the helper runs each of these scripts:
      | script          | exit | output |
      | echo hi; exit 4 | 4    | hi     |
      | kill -TERM $$   | 143  |        |
    Then k-verify-acceptance-reaper-continuous-reap: each script exits and prints exactly as listed

  Scenario: Detached servers of python, node, perl and go keep running while the shell runs and are stopped before the helper returns
    When k-verify-acceptance-reaper-continuous-reap: the helper runs the script:
      """
      python3 -c 'import subprocess
      p = subprocess.Popen(["/bin/sleep", "300"], env={}, start_new_session=True, close_fds=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
      open("python.pid", "w").write(str(p.pid))'
      "$FIXTURE_NODE" -e 'const c = require("child_process").spawn("/bin/sleep", ["300"], { detached: true, env: {}, stdio: "ignore" }); require("fs").writeFileSync("node.pid", String(c.pid)); c.unref();'
      perl -MPOSIX -e 'my $pid = fork() // die "fork: $!"; if ($pid == 0) { POSIX::setsid(); POSIX::close($_) for 3 .. 255; open(STDIN, "<", "/dev/null"); open(STDOUT, ">", "/dev/null"); open(STDERR, ">", "/dev/null"); %ENV = (); exec("/bin/sleep", "300"); POSIX::_exit(127); } open(my $f, ">", "perl.pid") or die "perl.pid: $!"; print $f $pid; close($f);'
      "$FIXTURE_HARNESS" launch go.pid
      sleep 0.5
      for lang in python node perl go; do
        pid=$(cat $lang.pid)
        if [ "$(cut -d' ' -f3 /proc/$pid/stat)" = S ] && [ "$(cut -d' ' -f4 /proc/$pid/stat)" = "$PPID" ] && [ "$(cut -d' ' -f6 /proc/$pid/stat)" = "$pid" ]; then echo "$lang running in its own session, adopted by the helper"; else echo "$lang: $(cat /proc/$pid/stat)"; fi
      done
      """
    Then k-verify-acceptance-reaper-continuous-reap: the helper exits 0 with the output:
      """
      python running in its own session, adopted by the helper
      node running in its own session, adopted by the helper
      perl running in its own session, adopted by the helper
      go running in its own session, adopted by the helper
      """
    And k-verify-acceptance-reaper-continuous-reap: none of the processes whose pids the files "python.pid node.pid perl.pid go.pid" hold is running

  Scenario: Children that exit before the shell do not change the helper's status
    When k-verify-acceptance-reaper-continuous-reap: the helper runs the script:
      """
      sh -c 'sleep 0.2; exit 9' &
      ( sh -c 'sleep 0.2; exit 9' & )
      ( sh -c 'sleep 0.2; kill -KILL $$' & )
      sleep 1
      echo shell done
      exit 7
      """
    Then k-verify-acceptance-reaper-continuous-reap: the helper exits 7 with the output:
      """
      shell done
      """

  Scenario: A Go test that kills a process group and waits for it to be gone passes as the check under the helper
    Given k-verify-acceptance-reaper-continuous-reap: a Go module whose test TestGroupGone kills a process group and waits at most 5 seconds for its member to be gone
    When k-verify-acceptance-reaper-continuous-reap: the helper runs the script:
      """
      go test -count=1 -run '^TestGroupGone$' -v .
      """
    Then k-verify-acceptance-reaper-continuous-reap: the Go test run passes TestGroupGone
