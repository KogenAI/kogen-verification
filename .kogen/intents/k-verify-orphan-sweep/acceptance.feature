Feature: The acceptance sweep stops every process the run started

  Kogen runs the acceptance command through RunAcceptance. Once the command has returned, every
  process the run started is stopped, including a server that cleared its environment, started a
  new session and was reparented when its launcher exited. Processes the run did not start keep
  running, and the run's exit status and output are what the command produced.

  Scenario Outline: A server started with <pattern> is stopped and nothing else is
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
