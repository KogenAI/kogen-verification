Feature: On Linux an acceptance run leaves no process of its own tree alive

  Kogen runs the acceptance command through RunAcceptance. On Linux, once the command has
  returned, no process the run started is still alive, however the process was launched: also a
  server whose launcher cleared its environment, started a new session, closed the inherited
  descriptors (so the server holds no marker descriptor 9) and exited. Processes the run did not
  start keep running, and the run's exit status and output are what the command produced. macOS
  has no subreaper and keeps the marker sweep: there these servers are outside the guarantee.

  Scenario Outline: On Linux, a server whose launcher closed the inherited descriptors is stopped and nothing else is
    When the acceptance command starts a background server with "<pattern>"
    Then on Linux, 1.5 seconds after RunAcceptance returns, that server is stopped
    And the processes the run did not start are still running
    And the run returned exit status 3 and output "fixture output\nfixture error\n"

    Examples:
      | pattern                                                  |
      | python Popen, env cleared, new session, launcher exited  |
      | descriptors closed, env cleared, setsid, launcher exited |

  Scenario Outline: A server the marker sweep stops today, started with <pattern>, is still stopped and nothing else is
    When the acceptance command starts a background server with "<pattern>"
    Then 1.5 seconds after RunAcceptance returns, that server is stopped
    And the processes the run did not start are still running
    And the run returned exit status 3 and output "fixture output\nfixture error\n"

    Examples:
      | pattern                              |
      | plain &                              |
      | nohup                                |
      | setsid, env kept                     |
      | env -i, same group                   |
      | (env -i x &), same group             |
      | env cleared, setsid, launcher exited |

  Scenario: A command with a syntax error reports what sh reports
    When RunAcceptance runs this acceptance command:
      """
      echo start; fi
      """
    Then its exit status and output are those of the same command run directly with sh -c
    And its exit status is 2

  Scenario: A command's name, output and exit status are its own
    When RunAcceptance runs this acceptance command:
      """
      echo "$0"; echo out; echo err >&2; exit 4
      """
    Then its exit status and output are those of the same command run directly with sh -c
    And its exit status is 4 and its output is "/bin/sh\nout\nerr\n"

  Scenario: A command that SIGTERM ends reports status 143
    When RunAcceptance runs this acceptance command:
      """
      echo before; kill -TERM $$; echo after
      """
    Then its exit status is 143 and its output is "before\n"

  Scenario: A command that SIGKILL ends reports status 137
    When RunAcceptance runs this acceptance command:
      """
      echo before; kill -KILL $$; echo after
      """
    Then its exit status is 137 and its output is "before\n"

  Scenario: The Linux build of the module and its tests compiles and vets
    When the module is vetted for Linux
    Then go vet for Linux reported no problem
