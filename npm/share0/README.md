# share0 (npm wrapper)

Share files from your machine, without uploading them anywhere. Full docs at [Xeven777/share0](https://github.com/Xeven777/share0#readme).

This package downloads the prebuilt `share0` binary for your platform from [GitHub Releases](https://github.com/Xeven777/share0/releases) on install (~80MB), verifies its sha256 checksum, and caches it under `~/.cache/share0/`.

```bash
npm i -g share0
share0 send ./file.txt
```

Version-pinned: npm `share0@x.y.z` always fetches GitHub tag `vx.y.z`.
