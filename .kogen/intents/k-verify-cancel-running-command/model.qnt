module cancel_command {
  var phase: str
  var canceled: bool
  var interrupted: bool
  var alive: bool
  var result: str
  var bystander: bool
  var illegalLaunch: bool

  action init = all {
    phase' = "idle", canceled' = false, interrupted' = false,
    alive' = false, result' = "", bystander' = true, illegalLaunch' = false,
  }
  action cancel = all {
    phase != "returned", canceled' = true, phase' = phase,
    interrupted' = interrupted, alive' = alive, result' = result,
    bystander' = bystander, illegalLaunch' = illegalLaunch,
  }
  action interrupt = all {
    phase != "returned", interrupted' = true, phase' = phase,
    canceled' = canceled, alive' = alive, result' = result,
    bystander' = bystander, illegalLaunch' = illegalLaunch,
  }
  action launch = all {
    phase == "idle", not(canceled), not(interrupted),
    phase' = "starting", alive' = true, canceled' = canceled,
    interrupted' = interrupted, result' = result, bystander' = bystander,
    illegalLaunch' = (canceled or interrupted),
  }
  action register = all {
    phase == "starting", phase' = "running", alive' = alive,
    canceled' = canceled, interrupted' = interrupted, result' = result,
    bystander' = bystander, illegalLaunch' = illegalLaunch,
  }
  action join = all {
    phase != "returned", canceled or interrupted or phase == "running",
    phase' = "joined", alive' = false, canceled' = canceled,
    interrupted' = interrupted, result' = result, bystander' = bystander,
    illegalLaunch' = illegalLaunch,
  }
  action returnResult = all {
    phase == "joined", phase' = "returned", alive' = alive,
    result' = if (interrupted) "interrupt" else if (canceled) "canceled" else "original",
    canceled' = canceled, interrupted' = interrupted,
    bystander' = bystander, illegalLaunch' = illegalLaunch,
  }
  action stay = all {
    phase == "returned", phase' = phase, canceled' = canceled,
    interrupted' = interrupted, alive' = alive, result' = result,
    bystander' = bystander, illegalLaunch' = illegalLaunch,
  }
  action step = any { cancel, interrupt, launch, register, join, returnResult, stay }
  val ReturnedClean = phase == "returned" implies not(alive)
  val NoCanceledLaunch = not(illegalLaunch)
  val InterruptWins = (phase == "returned" and interrupted) implies result == "interrupt"
  val BystanderLives = bystander
}
