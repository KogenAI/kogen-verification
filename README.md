# kogen-verification

Kogen's deterministic verification: running checks, scenarios and models, and recording the evidence.

It is a component of [Kogen](https://github.com/KogenAI/kogen), which pins an exact version of it and assembles the `kogen` program.

## Packages

- `verify`: verification passes, readiness and feasibility checks, probes, the Cucumber and Quint tools, reports and evidence.

## Testing

Go 1.27.2 and Node.js with npm are required. Some tests run the real Cucumber and Quint. Install them once:

```sh
npm ci --prefix testdata/tools/cucumber
npm ci --prefix testdata/tools/quint
```

Then run:

```sh
go build ./... && go vet ./... && go test -race -count=1 ./...
```

For inquiries, contact contact@kogen.dev.

### Goldens

`verify/testdata/golden` holds five JSON files (`accounts.json`, `feasibility.json`, `passes.json`, `readiness.json`, `text.json`). Each records fixed inputs and the outputs the verification code must produce for them; the tests whose names contain `Elixir` compare the code's actual output with them and fail on any drift. Each of those test files has a comment naming its golden and saying what is input and what is output.

To regenerate the recorded outputs, run the Go test flag `-update`:

```sh
go test ./... -update
```

Use it after a deliberate change to a recorded output, or to settle a merge or cherry-pick conflict in a golden by regenerating it on the combined tree. Then run the full checks without the flag and review `git diff verify/testdata/golden`: it shows exactly the values that changed. A golden whose outputs already match is not touched.

The flag rewrites only recorded outputs that differ, and only those values: every other byte of the file stays as recorded. It never rewrites recorded inputs or historical records (for example `record_text` in `readiness.json` and the legacy `pass` records in `passes.json`), and it must not be used to silence an unexplained failure. The flag exists only in the tests of package `verify`; no program has it.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
