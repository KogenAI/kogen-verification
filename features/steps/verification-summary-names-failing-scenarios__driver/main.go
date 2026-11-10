package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/KogenAI/kogen-verification/verify"
)

func main() {
	var p verify.Pass
	if err := json.NewDecoder(os.Stdin).Decode(&p); err != nil {
		panic(err)
	}
	fmt.Print(p.Summary())
}
