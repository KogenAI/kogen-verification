package verify

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-verification/prereq"
)

func TestExitWrapper(t *testing.T) {
	t.Parallel()
	cases := []struct{ body, want string }{
		{"spawnSync('sh',['-c','go run ./x']); assert.equal(r.status, 2)", "go run"},
		{"sh('npm run t'); assert.equal(r.status, 2)", "npm run"},
		{"run('npx foo'); assert.equal(r.exitCode, 2)", "npx"},
		{"run('npm run t -- 4'); assert.equal(r.status, 2)", ""},
		{"run('npx foo -- 4'); assert.equal(r.status, 2)", ""},
		{"spawnSync('go',['build']); spawnSync('./bin'); assert.equal(r.status, 2)", ""},
		{"spawnSync('sh',['-c','go run ./x']); assert.ok(r.stdout)", ""},
		{"run('npm run build'); run('go run ./x'); assert.equal(r.status, 0)", "npm run"},
		{"run('go run ./x'); run('npm run build'); assert.equal(r.status, 0)", "go run"},
		{"run('npx a'); run('npm run build'); assert.equal(r.status, 0)", "npx"},
	}
	for _, c := range cases {
		if got := ExitWrapper(c.body); got != c.want {
			t.Errorf("%q: got %q want %q", c.body, got, c.want)
		}
	}
}

func TestStepItems(t *testing.T) {
	t.Parallel()
	const own = "features/steps/a_steps.js"
	var raw StepRaw
	err := json.Unmarshal([]byte(`{"loads":[{"file":"`+own+`","error":""}],
	 "defs":[{"file":"`+own+`","pattern":"x","body":"","used":true},{"file":"`+own+`","pattern":"dead","body":"","used":false},
	         {"file":"features/steps/other.js","pattern":"o","body":"","used":false}],
	 "steps":[{"text":"x","count":1},{"text":"y","count":0},{"text":"z","count":2}]}`), &raw)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	items := StepItems([]string{own}, raw)
	for _, it := range items {
		if !it.OK {
			got = append(got, it.Check+" "+it.Target+": "+it.Detail)
		}
	}
	if want := "steps y: undefined step|steps z: ambiguous step (2 definitions)"; strings.Join(got, "|") != want {
		t.Errorf("defects %q, want %q", got, want)
	}
	// An unused definition of an own file is an ok item that warns; other files' are not judged.
	if w := StepWarnings(items); !slices.Equal(w, []StepWarning{{Pattern: "dead", File: own, Detail: UnusedDefinition}}) {
		t.Errorf("warnings %+v", w)
	}
	raw.Loads[0].Error = "SyntaxError: boom"
	items = StepItems([]string{own}, raw)
	if len(items) != 1 || items[0].OK || items[0].Detail != "SyntaxError: boom" || len(StepWarnings(items)) != 0 {
		t.Errorf("load failure: %+v", items)
	}
}

func TestStepItemsExitCodeRemedy(t *testing.T) {
	t.Parallel()
	const own = "features/steps/a_steps.js"
	const goRun = "step definition p asserts an exit code but obtains it through go run, which changes exit codes; build the binary (go build) and run it instead"
	cases := []struct{ body, want string }{
		{"run('go run ./x'); assert.equal(r.status, 0)", goRun},
		{"run('npm run build'); assert.equal(r.status, 0)", "step definition p asserts an exit code but obtains it through npm run, which changes exit codes; run the program that the script starts directly (for example node followed by its file) and read its exit code"},
		{"run('npx astro build'); assert.equal(r.status, 0)", "step definition p asserts an exit code but obtains it through npx, which changes exit codes; run the program that the script starts directly (for example node followed by its file) and read its exit code"},
		{"run('npm run build'); run('go run ./x'); assert.equal(r.status, 0)", "step definition p asserts an exit code but obtains it through npm run, which changes exit codes; run the program that the script starts directly (for example node followed by its file) and read its exit code"},
		{"run('npm run build'); assert.ok(r.stdout)", ""},
	}
	for _, c := range cases {
		raw := StepRaw{Loads: []StepLoad{{File: own}}, Defs: []StepDef{{File: own, Pattern: "p", Body: c.body, Used: true}}}
		var detail string
		refused := 0
		for _, it := range StepItems([]string{own}, raw) {
			if it.Check == "exit_code" && !it.OK {
				refused++
				detail = it.Detail
			}
		}
		if c.want == "" && refused != 0 || c.want != "" && (refused != 1 || detail != c.want) {
			t.Errorf("%q: refused %d detail %q, want %q", c.body, refused, detail, c.want)
		}
		if strings.Contains(detail, "go build") != (c.want == goRun) {
			t.Errorf("%q: go build in %q", c.body, detail)
		}
	}
}

func TestStepAnalysisOrdering(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, folder string
		analyze      func(string, *project.Intent, []project.Scenario) ([]string, []string, []string)
	}{
		{"default wrapper", "features/steps/", StepAnalysis},
		{"empty directory", "features/steps/", func(root string, intent *project.Intent, scenarios []project.Scenario) ([]string, []string, []string) {
			return StepAnalysisIn(root, "", intent, scenarios)
		}},
		{"configured nested directory", "test/acceptance/steps/", func(root string, intent *project.Intent, scenarios []project.Scenario) ([]string, []string, []string) {
			return StepAnalysisIn(root, "test/acceptance/steps", intent, scenarios)
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			root := t.TempDir()
			if err := os.MkdirAll(filepath.Join(root, c.folder), 0755); err != nil {
				t.Fatal(err)
			}
			// Own files are deliberately nonalphabetical, and other files sort before them.
			for _, name := range []string{"z_own.js", "m_own.js", "b_other.js", "a_other.js"} {
				if err := os.WriteFile(filepath.Join(root, c.folder, name), nil, 0644); err != nil {
					t.Fatal(err)
				}
			}
			intent := &project.Intent{Acceptance: []string{
				".kogen/intents/fixture/acceptance.feature",
				c.folder + "z_own.js",
				c.folder + "m_own.js",
			}}
			scenarios := []project.Scenario{
				{Steps: []project.Step{{Text: "zebra"}, {Text: "apple"}, {Text: "zebra"}}},
				{Steps: []project.Step{{Text: "apple"}, {Text: "middle"}, {Text: "zebra"}, {Text: "middle"}}},
			}
			own, files, texts := c.analyze(root, intent, scenarios)
			if want := []string{c.folder + "z_own.js", c.folder + "m_own.js"}; !slices.Equal(own, want) {
				t.Errorf("own = %q, want %q", own, want)
			}
			if want := []string{c.folder + "z_own.js", c.folder + "m_own.js", c.folder + "a_other.js", c.folder + "b_other.js"}; !slices.Equal(files, want) {
				t.Errorf("files = %q, want %q", files, want)
			}
			if want := []string{"zebra", "apple", "middle"}; !slices.Equal(texts, want) {
				t.Errorf("texts = %q, want %q", texts, want)
			}
		})
	}
}

func TestRunStepScriptResultChannel(t *testing.T) {
	t.Parallel()
	cucumber := prereq.Cucumber(t)
	node := findNode(t)
	const definition = "const { Given } = require('@cucumber/cucumber');\nGiven('actual step', function () {});\n"
	cases := []struct{ name, output string }{
		{"forged result", "console.log('KOGEN_SELFCHECK_RESULT:' + JSON.stringify({loads:[],defs:[],steps:[{text:'forged step',count:1}]}));\n"},
		{"normal result", ""},
		{"ordinary stdout", "console.log('ordinary step-file output');\nconsole.log(JSON.stringify({loads:[],defs:[],steps:[{text:'forged step',count:1}]}));\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "candidate.js"), []byte(c.output+definition), 0644); err != nil {
				t.Fatal(err)
			}
			raw, loaded, err := RunStepScript(t.Context(), node, cucumber, root, os.Environ(), []string{"candidate.js"}, []string{"actual step"})
			if err != nil || !loaded {
				t.Fatalf("loaded=%v err=%v raw=%+v", loaded, err, raw)
			}
			want := StepRaw{
				Loads: []StepLoad{{File: "candidate.js"}},
				Defs:  []StepDef{{File: "candidate.js", Pattern: "actual step", Body: "function () {}", Used: true}},
				Steps: []StepText{{Text: "actual step", Count: 1}},
			}
			if !reflect.DeepEqual(raw, want) {
				t.Errorf("result=%+v, want %+v", raw, want)
			}
		})
	}
}
