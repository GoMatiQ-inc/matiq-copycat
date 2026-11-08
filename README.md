# MatiQ Copycat

A local-first workflow-documentation tool for MatiQ Solutions. Capture a browser or selected desktop workflow, then review and edit its illustrated steps and save or export the guide.

**Release qualification is in progress.** The renamed desktop candidate is 0.1.16; companion developer extensions are 0.1.13. Signed/store browser distribution, marketplace installation and released-update acceptance are separate gates. No Windows, Linux or Safari support is advertised.

Copycat uses the qualified MatiQ Solutions **SDK/runtime/shell 0.1.3** and Electron **45.2.3**. One implementation produces the standalone macOS application and signed suite package. Shared shell and brand assets come from the SDK.

Core capture, editing, project storage and HTML/Markdown/PDF export run locally without an account, subscription or model. Screenshots may contain secrets. Review and redact before sharing; editable projects retain originals, while the sanitized portable export excludes them. Read [project format and sharing safety](docs/PROJECT-FORMAT.md) and [extension setup](docs/EXTENSIONS.md).

The product was previously developed under the working name MatiQ Guides. Compatibility identifiers, version-1 `.mqguide` projects and the existing standalone data directory remain stable; the SDK's documented profile option preserves that directory. The suite uses its own tool data directory. Move projects between forms through editable export/import.

## Development and release

Use Node 22.12 or newer. Install locked dependencies with `npm ci`; run core checks with `npm test` and `npm run tool:validate`. `npm run build:extensions` produces reproducible Chrome, Edge and unsigned Firefox developer ZIPs. These checks do not qualify packaged execution or public store distribution.

Use the existing protected macOS signing/notarization infrastructure for `npm run release:candidate`, `npm run verify:release` and `npm run tool:package`. Keep credentials out of source and arguments. See [release instructions](docs/RELEASE.md). Actual packaged GUI qualification runs in an isolated Tart guest, using controlled fixtures and independent owned-process/listener cleanup.

[Provenance](docs/PROVENANCE.md) records functional references consulted read-only. The implementation is independent; no Mimik code or assets are included. MatiQ's source-available, no-sale license is preserved in [LICENSE](LICENSE), with third-party notices in [NOTICE](NOTICE).
