package verify

import "slices"

// schedule prioritizes the prerequisite closure of selected items, retaining ordinary
// order whenever prerequisites permit it.
func schedule(items []item, selected []string, deps map[string][]string) ([]item, []string) {
	byName := map[string]int{}
	for i, it := range items {
		byName[it.name] = i
	}
	prerequisites := make([][]int, len(items))
	for i, it := range items {
		for j, other := range items {
			if (other.kind == "setup" && (it.kind != "setup" || j < i)) || (it.kind == "check" && (other.kind == "model" || other.kind == "maintained")) {
				prerequisites[i] = append(prerequisites[i], j)
			}
		}
		for _, name := range deps[it.name] {
			if j, ok := byName[name]; ok {
				prerequisites[i] = append(prerequisites[i], j)
			}
		}
	}
	priority := make([]bool, len(items))
	var mark func(int)
	mark = func(i int) {
		if priority[i] {
			return
		}
		priority[i] = true
		for _, j := range prerequisites[i] {
			mark(j)
		}
	}
	for i, it := range items {
		if slices.Contains(selected, it.name) {
			mark(i)
		}
	}
	done := make([]bool, len(items))
	order := make([]item, 0, len(items))
	indices := make([]int, 0, len(items))
	for len(order) < len(items) {
		pick := -1
		for phase := 0; phase < 2 && pick < 0; phase++ {
			for i := range items {
				if done[i] || (phase == 0 && !priority[i]) {
					continue
				}
				ready := true
				for _, j := range prerequisites[i] {
					if !done[j] {
						ready = false
						break
					}
				}
				if ready {
					pick = i
					break
				}
			}
		}
		if pick < 0 {
			for i := range items {
				if !done[i] {
					order = append(order, items[i])
					indices = append(indices, i)
				}
			}
			break
		}
		done[pick] = true
		order = append(order, items[pick])
		indices = append(indices, pick)
	}
	var pulled []string
	ordinaryPositions := make(map[string]int)
	if len(selected) > 0 {
		ordinary, _ := schedule(items, nil, deps)
		for pos, it := range ordinary {
			ordinaryPositions[it.name] = pos
		}
	}
	for pos, i := range indices {
		if slices.Contains(selected, items[i].name) && pos < ordinaryPositions[items[i].name] {
			pulled = append(pulled, items[i].name)
		}
	}
	return order, pulled
}
