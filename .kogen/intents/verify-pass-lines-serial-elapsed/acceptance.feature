Feature: A serial verification pass prints a line when each setup command or check ends

  Scenario: A serial pass reports the commands that ran in order and none that did not
    When verify-pass-lines-serial-elapsed: the serial verification passes of fake commands have run
    Then verify-pass-lines-serial-elapsed: the "serial" pass progress lines match:
      """
      {"commands":[{"name":"setup-1","setup":"true","status":0},{"name":"ca","status":0},{"name":"cb","status":3}],"absent":["cc"]}
      """

  Scenario: Seconds are the recorded wall time rounded half up
    When verify-pass-lines-serial-elapsed: the serial verification passes of fake commands have run
    Then verify-pass-lines-serial-elapsed: the "timed" pass progress lines match:
      """
      {"commands":[{"name":"setup-1","setup":"sleep 0.6","status":0},{"name":"setup-2","setup":"true","status":0},{"name":"slow","status":0},{"name":"quick","status":0},{"name":"gone","status":127}],"absent":["never"],"atLeastSeconds":{"slow":2}}
      """

  Scenario: A failing setup command is reported with its exit status and stops the pass
    When verify-pass-lines-serial-elapsed: the serial verification passes of fake commands have run
    Then verify-pass-lines-serial-elapsed: the "setup-red" pass progress lines match:
      """
      {"commands":[{"name":"setup-1","setup":"exit 127","status":127}],"absent":["setup-2","ca"]}
      """
