Feature: Sweep all probe command processes
  Scenario: Escaped fork and setsid child with unchanged output
    When k-verify-probe-sweep-escaped: I run a "normal" probe with command:
      """
      python3 -c 'import os,time
      if os.fork()==0:
       os.setsid(); time.sleep(120)' & sleep 1; echo launched
      """
    Then k-verify-probe-sweep-escaped: it is swept safely with output "launched\n" and overhead below 200 ms

  Scenario: Timed out probe
    When k-verify-probe-sweep-escaped: I run a "timeout" probe with command:
      """
      python3 -c 'import os,time
      if os.fork()==0:
       os.setsid(); time.sleep(120)' & sleep 1; echo launched; sleep 120
      """
    Then k-verify-probe-sweep-escaped: it is swept safely with output "launched\n" and overhead below 200 ms

  Scenario: Caller cancelled probe
    When k-verify-probe-sweep-escaped: I run a "cancel" probe with command:
      """
      python3 -c 'import os,time
      if os.fork()==0:
       os.setsid(); time.sleep(120)' & sleep 1; echo launched; sleep 120
      """
    Then k-verify-probe-sweep-escaped: it is swept safely with output "launched\n" and overhead below 200 ms

  Scenario: Quiet probe has bounded sweep overhead
    When k-verify-probe-sweep-escaped: I run a "quiet" probe with command:
      """
      echo launched
      """
    Then k-verify-probe-sweep-escaped: it is swept safely with output "launched\n" and overhead below 200 ms
