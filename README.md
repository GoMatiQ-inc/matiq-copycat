# MatiQ Copycat

A local-first workflow-documentation tool for MatiQ Solutions. Capture a browser or desktop workflow, then review and edit its illustrated steps and save or export the guide.

**Released 0.1.24** adds required first-run setup and safe recording Quit.
[Download the signed Apple Silicon Mac DMG](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.24/MatiQ-Copycat-0.1.24-mac-arm64.dmg),
or explicitly install Copycat in MatiQ Solutions Marketplace. Use **Solutions
0.1.3 or newer** for hosted recording Quit.

Click **Record desktop**, work across apps and browser windows, then stop, edit
and export. Desktop recording needs no extension, account, subscription or model.
Browser integrations remain optional. Setup reviews storage, scope, actual
Screen Recording/Accessibility access, privacy, optional extensions and updates.
**Finish later** saves progress; capture remains blocked until setup is complete.

Quit during recording offers **Keep recording** or **Stop, save, and quit**.
Confirmation stops capture, drains pending steps/screenshots and saves before
exit. Failed saves keep the app open with retryable work. Existing standalone
builds using SDK 0.1.3 reject a cross-SDK automatic update: install this DMG once,
keeping existing application data.

Signed standalone and suite qualification passes on macOS 15.7.7 arm64: native
recording Quit cancellation/save failure/retry, selected-window movement,
Chrome/TextEdit mixed capture, all six Chrome/Edge/Firefox and standalone/suite
journeys, portable project round trips, independent HTML/Markdown/PDF inspection,
redactions, interrupted-save recovery and owned process/listener cleanup.
[Exact source, harnesses and limits](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.24/packaged-qualification-0.1.24.json).
Application approval/file dialogs are controlled fixtures. Fresh OS grant/revoke
decisions, sleep/lock, display hotplug and public browser-store distribution
remain separate qualification. No Windows, Linux, Intel Mac or Safari support is
advertised by this release.

Copycat uses MatiQ Solutions **SDK/runtime/shell 0.1.7** and Electron **45.2.3**.
One implementation produces the standalone app and signed suite package.
Project dataVersion 1 and existing guide/image identities are preserved.

Core capture, editing, project storage and HTML/Markdown/PDF export run locally without an account, subscription or model. Screenshots may contain secrets. Review and redact before sharing; editable projects retain originals, while the sanitized portable export excludes them. Read [project format and sharing safety](docs/PROJECT-FORMAT.md) and [optional extension tools](docs/EXTENSIONS.md).

The product was previously developed under the working name MatiQ Guides. Compatibility identifiers, version-1 `.mqguide` projects and the existing standalone data directory remain stable; the SDK's documented profile option preserves that directory. The suite uses its own tool data directory. Move projects between forms through editable export/import.

## Development and release

Use Node 22.12 or newer. Install locked dependencies with `npm ci`; run core checks with `npm test` and `npm run tool:validate`. `npm run build:extensions` produces reproducible Chrome, Edge and unsigned Firefox developer ZIPs. These checks do not qualify packaged execution or public store distribution.

Use the existing protected macOS signing/notarization infrastructure for `npm run release:candidate`, `npm run verify:release` and `npm run tool:package`. Keep credentials out of source and arguments. See [release instructions](docs/RELEASE.md). Actual packaged GUI qualification runs in an isolated Tart guest, using controlled fixtures and independent owned-process/listener cleanup.

[Provenance](docs/PROVENANCE.md) records functional references consulted read-only. The implementation is independent; no Mimik code or assets are included. MatiQ's source-available, no-sale license is preserved in [LICENSE](LICENSE), with third-party notices in [NOTICE](NOTICE).
