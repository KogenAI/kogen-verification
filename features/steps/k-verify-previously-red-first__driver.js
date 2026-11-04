// Acceptance-only Go overlay; not linked into production.
module.exports = String.raw`package verify
import (
 "context"
 "encoding/json"
 "os"
 "reflect"
 "testing"
 "time"
 "github.com/KogenAI/kogen-coordinator/project"
)
func TestPreviousRedAcceptanceDriver(t *testing.T) {
 p := newProj(t)
 mode := os.Getenv("PREVIOUS_RED_CASE")
 p.Config.Checks = []project.Check{
  {Name:"A", Run:appendTo(p.trace("order"),"A")+"; sleep 0.2"},
  {Name:"B", Run:appendTo(p.trace("order"),"B")+"; sleep 1"},
  {Name:"C", Run:appendTo(p.trace("order"),"C")+"; sleep 0.05"},
 }
 if mode == "red" || mode == "default" || mode == "unknown" { p.Config.Checks[2].Run += "; exit 7" }
 if mode == "b-red" { p.Config.Checks[1].Run += "; exit 9" }
 if mode == "setup" { p.Config.Setup = []string{appendTo(p.trace("order"),"setup-1")} }
 in := p.input(1)
 set := func(name string, value any) { f:=reflect.ValueOf(&in).Elem().FieldByName(name); if f.IsValid() && f.CanSet() { f.Set(reflect.ValueOf(value)) } }
 if mode != "default" { names:=[]string{"C"}; if mode=="unknown" {names=[]string{"missing"}}; set("PreviousRed",names) }
 if mode=="setup" {set("Dependencies",map[string][]string{"C":{"setup-1"}})}
 s,_ := p.session()
 start:=time.Now()
 pass,err:=Verify(context.Background(),s,in)
 elapsed:=time.Since(start).Seconds()
 if err!=nil {t.Fatal(err)}
 raw,err:=json.Marshal(pass); if err!=nil {t.Fatal(err)}
 var record map[string]any; if err=json.Unmarshal(raw,&record);err!=nil {t.Fatal(err)}
 checks:=[]string{}; for _,c:=range pass.Checks {checks=append(checks,c.Name)}
 result:=map[string]any{"trace":p.ran("order"),"green":pass.Green,"failing":pass.Failing,"checks":checks,"complete":pass.Complete(p.Config,mustScenarios(t),nil),"record":record,"elapsed":elapsed}
 if mode=="unknown" || mode=="default" {
  // Same candidate, input, commands, report and pass number: only the optional list differs.
  set("PreviousRed",[]string(nil))
  control,e:=Verify(context.Background(),s,in); if e!=nil {t.Fatal(e)}
  b,e:=json.Marshal(control);if e!=nil {t.Fatal(e)}
  result["identical"]=string(b)==string(raw)
 }
 b,err:=json.Marshal(result);if err!=nil {t.Fatal(err)}
 if err=os.WriteFile(os.Getenv("PREVIOUS_RED_REPORT"),b,0600);err!=nil {t.Fatal(err)}
}
`;
