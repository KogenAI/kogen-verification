package verify

import (
	"reflect"
	"testing"
)

func TestPrioritySchedule(t *testing.T) {
	items := []item{{name: "setup-1", kind: "setup"}, {name: "setup-2", kind: "setup"}, {name: "acceptance", kind: "acceptance"}, {name: "model", kind: "model"}, {name: "A", kind: "check"}, {name: "B", kind: "check"}, {name: "C", kind: "check"}}
	cases := []struct {
		selected     []string
		deps         map[string][]string
		want, pulled []string
	}{
		{nil, nil, []string{"setup-1", "setup-2", "acceptance", "model", "A", "B", "C"}, nil},
		{[]string{"unknown"}, nil, []string{"setup-1", "setup-2", "acceptance", "model", "A", "B", "C"}, nil},
		{[]string{"C", "B"}, nil, []string{"setup-1", "setup-2", "model", "B", "C", "acceptance", "A"}, []string{"B", "C"}},
		{[]string{"C"}, map[string][]string{"C": {"B"}, "B": {"A"}}, []string{"setup-1", "setup-2", "model", "A", "B", "C", "acceptance"}, []string{"C"}},
	}
	for _, tc := range cases {
		got, pulled := schedule(items, tc.selected, tc.deps)
		var names []string
		for _, it := range got {
			names = append(names, it.name)
		}
		if !reflect.DeepEqual(names, tc.want) || !reflect.DeepEqual(pulled, tc.pulled) {
			t.Fatalf("selected %v: got %v / %v, want %v / %v", tc.selected, names, pulled, tc.want, tc.pulled)
		}
	}
}

func TestPulledForwardComparedWithDependencyOrder(t *testing.T) {
	items := []item{{name: "A", kind: "check"}, {name: "B", kind: "check"}, {name: "C", kind: "check"}}
	_, pulled := schedule(items, []string{"A"}, map[string][]string{"A": {"C"}})
	if !reflect.DeepEqual(pulled, []string{"A"}) {
		t.Fatalf("pulled = %v", pulled)
	}
}

func TestScheduleCycleAppendsLeftoversInInputOrder(t *testing.T) {
	items := []item{{name: "acceptance", kind: "acceptance"}, {name: "A", kind: "check"}, {name: "B", kind: "check"}, {name: "C", kind: "check"}}
	deps := map[string][]string{"A": {"B"}, "B": {"A"}}
	for _, selected := range [][]string{nil, {"B"}} {
		got, _ := schedule(items, selected, deps)
		var names []string
		for _, it := range got {
			names = append(names, it.name)
		}
		if want := []string{"acceptance", "C", "A", "B"}; !reflect.DeepEqual(names, want) {
			t.Fatalf("selected %v: got %v, want %v", selected, names, want)
		}
	}
}
