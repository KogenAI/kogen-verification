# kogen-verification

Kogen's deterministic verification: running checks, scenarios and models, and recording the evidence.

It is a component of [Kogen](https://github.com/KogenAI/kogen), which pins an exact version of it and assembles the `kogen` program.

## Packages

- `verify`: verification passes, readiness and feasibility checks, probes, the Cucumber and Quint tools, reports and evidence.

## Testing

Some tests run the real Cucumber and Quint. Install them once:

```sh
npm ci --prefix testdata/tools/cucumber
npm ci --prefix testdata/tools/quint
```

Then run:

```sh
go build ./... && go vet ./... && go test -race -count=1 ./...
```

The module depends on private KogenAI modules: set `GOPRIVATE=github.com/KogenAI/*`.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
