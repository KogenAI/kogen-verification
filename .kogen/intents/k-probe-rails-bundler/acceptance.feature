Feature: Probes keep the caller's installed mise tools and packages
  Scenario Outline: Fresh home does not select an empty installation tree
    When an installed mise fixture uses "<discovery>" data discovery in a real probe
    Then both installed-tool runs print "installed rails package" and the probe retains isolation

    Examples:
      | discovery |
      | default   |
      | explicit  |
      | xdg       |
