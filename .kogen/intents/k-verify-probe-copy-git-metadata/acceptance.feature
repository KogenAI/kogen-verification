Feature: Probe copies carry the source checkout's git metadata
  A probe's scratch copy gets a repository of its own whose HEAD, branch history and objects are
  the source's, with the index matching HEAD, the copied working tree left as it is, hooks
  disabled, no local config or remotes from the source, and nothing reaching the source checkout.
  Sources the copy cannot carry and probes that never call git behave as before.

  Scenario: A declared git observer's good and bad controls give their expected results
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    And k-verify-probe-copy-git-metadata: the uncommitted fixture observer "observer.cjs" in the project
    When k-verify-probe-copy-git-metadata: the probe runs '"$KOGEN_NODE" observer.cjs src/main.txt'
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output line "observer good"
    When k-verify-probe-copy-git-metadata: the probe runs '"$KOGEN_NODE" observer.cjs README.md'
    Then k-verify-probe-copy-git-metadata: the probe exits 1 with the output line "observer bad rejected"
    When k-verify-probe-copy-git-metadata: the declared observer "observer.cjs" with the good check '"$KOGEN_NODE" observer.cjs src/main.txt' expecting exit 0 and the output line "observer good" and the bad check '"$KOGEN_NODE" observer.cjs README.md' expecting exit 1 and the output line "observer bad rejected" is executed for the project
    Then k-verify-probe-copy-git-metadata: the declared evidence is met

  Scenario: Older commits and the branch history of the source are readable in the probe
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    And k-verify-probe-copy-git-metadata: a second commit "second" that changes src/main.txt to the line "Usage: main --verbose"
    When k-verify-probe-copy-git-metadata: the probe runs "git show {first}:src/main.txt"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output line "Usage: main [file]"
    When k-verify-probe-copy-git-metadata: the probe runs "git show HEAD:src/main.txt"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output line "Usage: main --verbose"
    When k-verify-probe-copy-git-metadata: the probe runs "git rev-parse --abbrev-ref HEAD; git rev-parse HEAD; git log --format=%s"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output:
      """
      main
      {head}
      second
      baseline
      """

  Scenario: Git writes and hooks in the probe never reach the source checkout
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    And k-verify-probe-copy-git-metadata: a post-commit hook in the source that writes the file "hook-marker" in the source
    When k-verify-probe-copy-git-metadata: the source repository state is recorded
    And k-verify-probe-copy-git-metadata: the probe runs "touch scratch-only; git config probe.sentinel changed; git add -A; git -c user.name=P -c user.email=p@example.invalid commit -qm x; git branch probe-only; git log -1 --format=%s; git config --get probe.sentinel"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output:
      """
      x
      changed
      """
    And k-verify-probe-copy-git-metadata: the source repository state is unchanged
    And k-verify-probe-copy-git-metadata: the source has no file "scratch-only"
    And k-verify-probe-copy-git-metadata: the source has no file "hook-marker"

  Scenario: The source's local git config and remotes are not carried into the copy
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    When k-verify-probe-copy-git-metadata: the probe runs "git rev-parse --is-inside-work-tree; git remote; git config --local --get user.name; git config --local --get user.email; git config --local --get remote.origin.url; git config --local --get probe.sentinel; echo done"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output:
      """
      true
      done
      """

  Scenario: An uncommitted shaped file shows as a change in the probe
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    And k-verify-probe-copy-git-metadata: the uncommitted file "shaped.txt" containing "shaped" in the project
    When k-verify-probe-copy-git-metadata: the probe runs "git status --short"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output line "?? shaped.txt"

  Scenario: The copy's index matches HEAD, not the source's index
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    And k-verify-probe-copy-git-metadata: the tracked file "README.md" is changed without committing
    And k-verify-probe-copy-git-metadata: the new file "staged.txt" is staged but not committed
    And k-verify-probe-copy-git-metadata: the uncommitted file "shaped.txt" containing "shaped" in the project
    When k-verify-probe-copy-git-metadata: the probe runs "git status --short"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output:
      """
       M README.md
      ?? shaped.txt
      ?? staged.txt
      """

  Scenario: A linked worktree source is carried with its own branch
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    And k-verify-probe-copy-git-metadata: a linked worktree of the project on the new branch "feature" is the probed source
    When k-verify-probe-copy-git-metadata: the source repository state is recorded
    And k-verify-probe-copy-git-metadata: the probe runs "git rev-parse --abbrev-ref HEAD; git show HEAD:src/main.txt; git status --short; git -c user.name=P -c user.email=p@example.invalid commit -q --allow-empty -m y; git log -1 --format=%s"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output:
      """
      feature
      Usage: main [file]
      y
      """
    And k-verify-probe-copy-git-metadata: the source repository state is unchanged

  Scenario: A directory that is not a git checkout keeps the existing explanation
    Given k-verify-probe-copy-git-metadata: a directory that is not a git checkout containing README.md and src/main.txt
    When k-verify-probe-copy-git-metadata: the probe runs "git status"
    Then k-verify-probe-copy-git-metadata: the probe exits 128 with output containing "fatal: not a git repository" and ending with the line "probe copy has no git metadata: scratch-copy isolation, not evidence that the source project lacks a repository"

  Scenario: A source repository without a commit runs the probe as today
    Given k-verify-probe-copy-git-metadata: a git project whose repository has no commit
    When k-verify-probe-copy-git-metadata: the probe runs "git status --short"
    Then k-verify-probe-copy-git-metadata: the probe exits 128 with output containing "fatal: not a git repository" and ending with the line "probe copy has no git metadata: scratch-copy isolation, not evidence that the source project lacks a repository"
    When k-verify-probe-copy-git-metadata: the probe runs "echo unchanged"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output line "unchanged"

  Scenario: A source whose HEAD names a missing commit runs the probe as today
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    And k-verify-probe-copy-git-metadata: the project's branch names a commit that does not exist
    When k-verify-probe-copy-git-metadata: the probe runs "git status --short"
    Then k-verify-probe-copy-git-metadata: the probe exits 128 with output containing "fatal: not a git repository" and ending with the line "probe copy has no git metadata: scratch-copy isolation, not evidence that the source project lacks a repository"
    When k-verify-probe-copy-git-metadata: the probe runs "echo unchanged"
    Then k-verify-probe-copy-git-metadata: the probe exits 0 with the output line "unchanged"

  Scenario: Ten probes that never call git behave exactly as before
    Given k-verify-probe-copy-git-metadata: a git project with one baseline commit containing README.md and src/main.txt
    And k-verify-probe-copy-git-metadata: the uncommitted file "notes.txt" containing "notes" in the project
    When k-verify-probe-copy-git-metadata: each of these commands runs as a probe of the project and of a copy of the project without git metadata:
      | command                                   | exit | output                                        |
      | echo unchanged                            | 0    | unchanged\n                                   |
      | printf done                               | 0    | done                                          |
      | echo failing >&2; exit 3                  | 3    | failing\n                                     |
      | cat src/main.txt                          | 0    | Usage: main [file]\n                          |
      | ls src                                    | 0    | main.txt\n                                    |
      | "$KOGEN_NODE" -e "console.log(6 * 7)"     | 0    | 42\n                                          |
      | "$KOGEN_NODE" -e "process.exitCode = 4"   | 4    |                                               |
      | test -e notes.txt && echo present         | 0    | present\n                                     |
      | cat missing.txt                           | 1    | cat: missing.txt: No such file or directory\n |
      | true                                      | 0    |                                               |
    Then k-verify-probe-copy-git-metadata: every command exits and prints exactly as listed, in both runs
