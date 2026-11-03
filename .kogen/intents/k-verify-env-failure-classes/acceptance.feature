Feature: Classify host resource check failures
  Scenario Outline: Classify a command result through EnvFailure
    When EnvFailure receives status <status> and output <output>
    Then its environment failure is <matched> with line <line>

    Examples:
      | status | output | matched | line |
      | 1 | "  write /x: no space left on device  \n" | true | "write /x: no space left on device" |
      | 1 | "fork/exec: cannot allocate memory" | true | "fork/exec: cannot allocate memory" |
      | 1 | "open /x: too many open files" | true | "open /x: too many open files" |
      | 1 | "runtime: out of memory" | true | "runtime: out of memory" |
      | 1 | "kernel: Out of memory: Killed process 123 (go)" | true | "kernel: Out of memory: Killed process 123 (go)" |
      | 0 | "write /x: no space left on device" | false | "" |
      | 0 | "fork/exec: cannot allocate memory" | false | "" |
      | 0 | "too many open files" | false | "" |
      | 0 | "out of memory" | false | "" |
      | 0 | "Out of memory: Killed process 123 (go)" | false | "" |
      | 1 | "address already in use" | false | "" |
      | 1 | "no such file or directory" | false | "" |
      | 1 | "Killed" | false | "" |
      | 1 | "ok\n  panic: test timed out after 10m0s  \nFAIL" | true | "panic: test timed out after 10m0s" |
      | 0 | "panic: test timed out after 10m0s" | false | "" |
      | 1 | "log: panic: test timed out after 10m0s" | false | "" |
      | 2 | "  panic: test timed out after 1s \nno space left on device" | true | "panic: test timed out after 1s" |
      | 1 | "ordinary failure\n too many open files \npanic: test timed out after 1s" | true | "too many open files" |
      | 1 | "cannot allocate memory\nno space left on device" | true | "cannot allocate memory" |
