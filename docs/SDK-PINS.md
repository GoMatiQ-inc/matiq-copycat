# Qualified shared artifacts

SDK/runtime/shell version: 0.1.3. Immutable SDK tag commit: `9c799aeecd1bf4ef20c7e882963d7154fed0d84b`. Electron: exactly `45.2.3`. Node >=22.12.0 is a build-tool requirement, not an end-user dependency.

The dependency URLs reference the sdk-v0.1.3 GitHub release; package-lock.json additionally binds integrity. SHA-256 values inspected at task bootstrap:

| Artifact | SHA-256 |
|---|---|
| matiq-solutions-sdk-0.1.3.tgz | da46bef15196ef349d24b5f3cf5321b78550b953707a0eb75c172610658e286b |
| matiq-solutions-runtime-0.1.3.tgz | d78e186a4ff89168a1b227ae97a314f4060693527fc1a6039d0c894bcd2d9e92 |
| matiq-solutions-shell-0.1.3.tgz | 51d96da34fe4b26b16638845e071673e0485720259ce3f1cea8a7e4bacdcd78b |

Use the SDK pack-app flow against the already signed standalone Resources directory, with `--extra native`, to include the same signed bridge bytes in the `.mqt`. The suite repository receives release metadata, never a copy of Copycat implementation code. No runtime or SDK upgrade is implied by a tool patch release.
