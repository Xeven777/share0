# share0-cli (npm wrapper)

Share files from your machine, without uploading them anywhere. Full docs at [Xeven777/share0](https://github.com/Xeven777/share0#readme).

This package downloads the prebuilt `share0` binary for your platform from [GitHub Releases](https://github.com/Xeven777/share0/releases) on install (~80MB), verifies its sha256 checksum, and caches it under `~/.cache/share0/`.

```bash
npm i -g share0-cli
share0 send ./file.txt
```

The installed command is still `share0`. Only the package name carries the `-cli` suffix (the bare `share0` name is blocked by npm's similarity filter).

Version-pinned: npm `share0-cli@x.y.z` always fetches GitHub tag `vx.y.z`.
