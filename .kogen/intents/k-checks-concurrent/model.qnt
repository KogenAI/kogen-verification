module concurrent {
 var cheap: int
 var a: int
 var b: int
 var stop: int
 var ended: bool
 action init = all {cheap'=0,a'=0,b'=0,stop'=0,ended'=false}
 action prerequisites = { nondet r = Set(-1,1).oneOf(); all {
  cheap==0, cheap'=r,a'=a,b'=b,stop'=stop,ended'=(r == -1)
 }}
 action launch = all {cheap==1,a==0,b==0,not(ended),a'=1,b'=1,cheap'=cheap,stop'=stop,ended'=ended}
 action finishA = {nondet r=Set(2,3).oneOf(); all {a==1,a'=r,b'=b,cheap'=cheap,stop'=stop,ended'=ended}}
 action finishB = {nondet r=Set(2,3).oneOf(); all {b==1,b'=r,a'=a,cheap'=cheap,stop'=stop,ended'=ended}}
 action settleFirst = all {a==3,not(ended),stop'=1,b'=(if(b==1) 4 else b),a'=a,cheap'=cheap,ended'=true}
 action settleSecond = all {a==2,b==3,not(ended),stop'=2,a'=a,b'=b,cheap'=cheap,ended'=true}
 action green = all {a==2,b==2,not(ended),ended'=true,a'=a,b'=b,cheap'=cheap,stop'=stop}
 action stay = all {ended,cheap'=cheap,a'=a,b'=b,stop'=stop,ended'=ended}
 action step = any {prerequisites,launch,finishA,finishB,settleFirst,settleSecond,green,stay}
 val Prerequisite = (a!=0 or b!=0) implies cheap==1
 val OrderedStop = (stop==1 implies a==3) and (stop==2 implies (a==2 and b==3))
 val CancelOnlyLater = b==4 implies (stop==1 and a==3)
 val EndedNoRunning = ended implies (a!=1 and b!=1)
}
