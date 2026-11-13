# Installing a custom firmware build on the NanoKVM

This describes how to install a locally built firmware package (e.g.
`build/release/nanokvm_2.5.90.tar.gz` from the `swede` branch) onto the device.

## Build output

A successful build (`scripts/build-in-container.sh` followed by
`scripts/package.sh <x.y.z>`) produces:

- `build/release/nanokvm_<version>.tar.gz` — the firmware package
- `build/release/latest.json` — manifest with the base64 SHA-512 checksum

The archive contains a single root directory `nanokvm_<version>/` whose
contents mirror `/kvmapp` on the device.

## Install over SSH (recommended)

The device runs as root. From the repo root:

```sh
scp build/release/nanokvm_2.5.90.tar.gz root@<kvm-ip>:/tmp/
ssh root@<kvm-ip>
```

Then on the device:

```sh
cd /tmp
tar xzf nanokvm_2.5.90.tar.gz
/etc/init.d/S95nanokvm stop
cp -r nanokvm_2.5.90/* /kvmapp/
chmod -R 755 /kvmapp
/etc/init.d/S95nanokvm restart
```

The web UI is back after a few seconds. Verify the version in
Settings → About (it should report the custom version, e.g. `2.5.90`).

## Notes

- **Version numbering:** use a version above the current official release
  (e.g. `2.5.90` vs official `2.5.1`) so the device reports the custom build
  distinctly. The on-device updater will not offer official OTA updates until
  the official version number passes yours.
- **Going back to stock:** install an official release package the same way,
  or let OTA update once upstream overtakes your version number.
- **Offline update via web UI:** the updater accepts uploaded packages but
  restricts filenames to `[a-zA-Z0-9._-]` and verifies the SHA-512 from
  `latest.json`; the SSH method above skips the checksum plumbing and is
  simpler for self-built packages.
