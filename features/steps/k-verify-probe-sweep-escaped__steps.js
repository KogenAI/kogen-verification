'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
function judge(r,mode,output,limit){
 assert.equal(r.bystander,true);assert.equal(r.survivors,0);assert.equal(r.events.length,1);
 const e=r.events[0];assert.equal(e.event,'step_sweep');assert.equal(e.name,'probe');assert.ok(Number.isInteger(e.stopped)&&e.stopped>=0);assert.ok(Number.isInteger(e.ms)&&e.ms>=0);assert.ok(JSON.stringify(e).length<1024);
 if(mode==='normal'||mode==='quiet'){assert.equal(r.error,'');assert.equal(r.result.status,0);assert.equal(r.result.output,output);assert.equal(r.result.timed_out,false);assert.deepEqual(r.result.input_changes||[],[]);assert.ok(r.result.wall>=0);}
 if(mode==='timeout')assert.equal(r.result.timed_out,true);
 if(mode==='cancel')assert.ok(r.error.includes('cancel'));
 if(mode==='quiet'){assert.equal(e.stopped,0);assert.ok(r.extra_ms<limit);}
}
const driver=`package main
import("context";"encoding/json";"fmt";"os";"os/exec";"path/filepath";"reflect";"strconv";"strings";"syscall";"time";"github.com/KogenAI/kogen-loop/sys";"github.com/KogenAI/kogen-verification/verify")
type logger struct{ Events []map[string]any }
func(l *logger)Log(e map[string]any){l.Events=append(l.Events,e)}
func alive(pid int)bool{b,e:=exec.Command("ps","-o","stat=","-p",strconv.Itoa(pid)).Output();return e==nil&&strings.TrimSpace(string(b))!=""&&!strings.HasPrefix(strings.TrimSpace(string(b)),"Z")}
func pids(token string)[]int{b,e:=exec.Command("ps","-axo","pid=,stat=,args=").Output();if e!=nil{panic(e)};var ids []int;for _,line:=range strings.Split(string(b),"\\n"){f:=strings.Fields(line);if len(f)>2&&!strings.HasPrefix(f[1],"Z")&&strings.Contains(strings.Join(f[2:]," "),token){id,_:=strconv.Atoi(f[0]);if id!=os.Getpid(){ids=append(ids,id)}}};return ids}
func main(){mode,command:=os.Args[1],os.Args[2];root,e:=os.MkdirTemp("","probe-project-");if e!=nil{panic(e)};defer os.RemoveAll(root);os.WriteFile(filepath.Join(root,"input"),[]byte("stable"),0600)
by:=exec.Command("sleep","120");by.SysProcAttr=&syscall.SysProcAttr{Setsid:true};if e:=by.Start();e!=nil{panic(e)};defer func(){by.Process.Kill();by.Wait()}()
token:=fmt.Sprintf("probe-escaped-%d",os.Getpid());if mode!="quiet"{command=strings.Replace(command,"' &","' "+token+" &",1)}
defer func(){for _,pid:=range pids(token){syscall.Kill(pid,syscall.SIGKILL)}}()
ctx:=context.Background();var cancel context.CancelFunc;if mode=="cancel"{ctx,cancel=context.WithCancel(ctx);defer cancel();time.AfterFunc(1500*time.Millisecond,cancel)}
if mode=="timeout"{_,restore:=verify.ContractProbeDeadline(1500*time.Millisecond,nil);defer restore()}
l:=&logger{Events:[]map[string]any{}};pr:=verify.Probe{Root:root,Command:command};v:=reflect.ValueOf(&pr).Elem().FieldByName("Log");if v.IsValid()&&v.CanSet(){v.Set(reflect.ValueOf(l))}
start:=time.Now();r,err:=pr.Run(ctx,sys.New());elapsed:=time.Since(start);msg:="";if err!=nil{msg=err.Error()};left:=len(pids(token));extra:=float64(elapsed.Microseconds())/1000
if mode=="quiet"{s:=sys.New();start=time.Now();_,err:=s.Run(command,root,sys.Options{KillGroupOnExit:true});if err!=nil{panic(err)};extra-=float64(time.Since(start).Microseconds())/1000}
json.NewEncoder(os.Stdout).Encode(map[string]any{"result":r,"error":msg,"events":l.Events,"survivors":left,"bystander":alive(by.Process.Pid),"extra_ms":extra})}
`;
if(require.main===module){
 const good={bystander:true,survivors:0,events:[{event:'step_sweep',name:'probe',stopped:0,ms:1}],error:'',result:{status:0,output:'launched\n',timed_out:false,wall:1},extra_ms:1};
 for(const mode of ['normal','quiet','timeout','cancel']){const r=structuredClone(good);if(mode==='timeout')r.result.timed_out=true;if(mode==='cancel')r.error='context canceled';judge(r,mode,'launched\n',200);
 if(process.argv[2]==='bad')for(const mutate of [x=>x.survivors=1,x=>x.bystander=false,x=>x.events=[],x=>x.events.push(x.events[0]),x=>x.events[0].name='setup']){const b=structuredClone(r);mutate(b);assert.throws(()=>judge(b,mode,'launched\n',200));}}
 console.log(process.argv[2]==='bad'?'controls rejected':'controls accepted');process.exit(process.argv[2]==='bad'?1:0);
}else{
 const {When,Then}=require('@cucumber/cucumber');
 When('k-verify-probe-sweep-escaped: I run a {string} probe with command:',{timeout:120000},function(mode,command){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'probe-harness-'));
 try{const file=path.join(tmp,'main.go'),bin=path.join(tmp,'driver');fs.writeFileSync(file,driver);
 const build=cp.spawnSync('go',['build','-o',bin,file],{encoding:'utf8',timeout:90000});assert.equal(build.status,0,`go build probe harness: ${build.error||''}\n${build.stderr}`);
 const r=cp.spawnSync(bin,[mode,command],{encoding:'utf8',timeout:15000});assert.equal(r.status,0,`probe harness: ${r.error||''}\n${r.stderr}\n${r.stdout}`);this.probeSweep={mode,report:JSON.parse(r.stdout)};
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}});
 Then('k-verify-probe-sweep-escaped: it is swept safely with output {string} and overhead below {int} ms',function(output,limit){judge(this.probeSweep.report,this.probeSweep.mode,output.replace(/\\n/g,'\n'),limit);});
}
