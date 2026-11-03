Feature: Classify host resources outside quoted test evidence
  Scenario: Quoted memory assertion remains candidate red
    When EnvFailure receives status 1 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "out of memory", got nil\nFAIL\nexit status 1\nFAIL	example.com/m	0.002s\n'
    Then its environment failure is false with line ''

  Scenario: Quoted file assertion remains candidate red
    When EnvFailure receives status 1 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "too many open files", got nil\nFAIL\nexit status 1\nFAIL	example.com/m	0.002s\n'
    Then its environment failure is false with line ''

  Scenario: Logged OS error remains candidate red
    When EnvFailure receives status 1 and output '--- FAIL: TestOpen (0.00s)\n    open_test.go:20: open /tmp/x: too many open files\nFAIL\nexit status 1\nFAIL	example.com/m	0.003s\n'
    Then its environment failure is false with line ''

  Scenario: Fatal memory outside a test is host evidence
    When EnvFailure receives status 2 and output 'fatal error: runtime: out of memory\nexit status 2\nFAIL	example.com/m	0.120s\n'
    Then its environment failure is true with line 'fatal error: runtime: out of memory'

  Scenario: Tool allocation failure is host evidence
    When EnvFailure receives status 1 and output 'go: fork/exec /usr/bin/x: cannot allocate memory\n'
    Then its environment failure is true with line 'go: fork/exec /usr/bin/x: cannot allocate memory'

  Scenario: Disk failure is host evidence
    When EnvFailure receives status 1 and output 'write /tmp/x: no space left on device\n'
    Then its environment failure is true with line 'write /tmp/x: no space left on device'

  Scenario: Separate host line wins over an earlier quote
    When EnvFailure receives status 1 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "out of memory", got nil\nFAIL\nexit status 1\nFAIL	example.com/m	0.002s\nfatal error: runtime: out of memory\n'
    Then its environment failure is true with line 'fatal error: runtime: out of memory'

  Scenario: Plain failure remains candidate red
    When EnvFailure receives status 1 and output '--- FAIL: TestValue (0.00s)\n    value_test.go:12: want 1, got 0\nFAIL\nexit status 1\nFAIL	example.com/m	0.001s\n'
    Then its environment failure is false with line ''

  Scenario: All supplied reports are non-host at zero status
    When EnvFailure receives status 0 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "out of memory", got nil\nFAIL\nexit status 1\nFAIL	example.com/m	0.002s\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 0 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "too many open files", got nil\nFAIL\nexit status 1\nFAIL	example.com/m	0.002s\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 0 and output '--- FAIL: TestOpen (0.00s)\n    open_test.go:20: open /tmp/x: too many open files\nFAIL\nexit status 1\nFAIL	example.com/m	0.003s\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 0 and output 'fatal error: runtime: out of memory\nexit status 2\nFAIL	example.com/m	0.120s\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 0 and output 'go: fork/exec /usr/bin/x: cannot allocate memory\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 0 and output 'write /tmp/x: no space left on device\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 0 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "out of memory", got nil\nFAIL\nexit status 1\nFAIL	example.com/m	0.002s\nfatal error: runtime: out of memory\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 0 and output '--- FAIL: TestValue (0.00s)\n    value_test.go:12: want 1, got 0\nFAIL\nexit status 1\nFAIL	example.com/m	0.001s\n'
    Then its environment failure is false with line ''

  Scenario: Runtime open and timeout diagnostics retain classification
    When EnvFailure receives status 2 and output 'runtime: out of memory\n'
    Then its environment failure is true with line 'runtime: out of memory'
    When EnvFailure receives status 1 and output 'open /tmp/x: too many open files\n'
    Then its environment failure is true with line 'open /tmp/x: too many open files'
    When EnvFailure receives status 2 and output 'panic: test timed out after 1s\n'
    Then its environment failure is true with line 'panic: test timed out after 1s'
    When EnvFailure receives status 0 and output 'panic: test timed out after 1s\n'
    Then its environment failure is false with line ''

  Scenario: OS-like logged text is still inside the block
    When EnvFailure receives status 1 and output '--- FAIL: TestLog (0.00s)\n    fatal error: runtime: out of memory\nFAIL\nexit status 1\nFAIL	example.com/m	0.001s\n'
    Then its environment failure is false with line ''

  Scenario: Unindented logged text is still inside the block
    When EnvFailure receives status 1 and output '--- FAIL: TestLog (0.00s)\nfatal error: runtime: out of memory\nFAIL\nexit status 1\nFAIL	example.com/m	0.001s\n'
    Then its environment failure is false with line ''

  Scenario: The next header ends the failing test block
    When EnvFailure receives status 1 and output '--- FAIL: TestLog (0.00s)\n    out of memory\n--- PASS: TestOther (0.00s)\nopen /tmp/x: too many open files\nFAIL\nexit status 1\nFAIL	example.com/m	0.001s\n'
    Then its environment failure is true with line 'open /tmp/x: too many open files'

  Scenario: Two candidate-red passes remain repairable before the repaired test succeeds
    When EnvFailure receives status 1 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "out of memory", got nil\nFAIL\nexit status 1\nFAIL	example.com/m	0.002s\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 1 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "out of memory", got nil\nFAIL\nexit status 1\nFAIL	example.com/m	0.002s\n'
    Then its environment failure is false with line ''
    When EnvFailure receives status 0 and output 'ok	example.com/m	0.002s\n'
    Then its environment failure is false with line ''
