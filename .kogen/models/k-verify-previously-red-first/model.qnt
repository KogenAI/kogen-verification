module previousRed {
 var done: Set[int]
 var stopped: bool
 var green: bool
 val Complete = green implies (done == Set(0, 1, 2, 3) and not(stopped))
 val Prerequisite = done.contains(3) implies done.contains(0)
 action init = all { done' = Set(), stopped' = false, green' = false }
 action step = any {
  all { not(stopped), not(green), not(done.contains(0)), done' = done.union(Set(0)), stopped' = false, green' = false },
  all { not(stopped), not(green), done.contains(0), not(done.contains(3)), done' = done.union(Set(3)), stopped' = false, green' = false },
  all { not(stopped), not(green), done.contains(3), not(done.contains(1)), done' = done.union(Set(1)), stopped' = false, green' = false },
  all { not(stopped), not(green), done.contains(1), not(done.contains(2)), done' = done.union(Set(2)), stopped' = false, green' = true },
  all { not(green), done' = done, stopped' = true, green' = false },
  all { stopped or green, done' = done, stopped' = stopped, green' = green }
 }
}
