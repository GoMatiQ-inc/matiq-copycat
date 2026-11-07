# MatiQ Guides

Local illustrated workflow documentation, using the MatiQ Solutions desktop SDK **0.1.3** and its qualified Electron **45.2.3** runtime. One adapter runs in standalone and suite forms. Source-available under the no-sale license in LICENSE; third-party components retain their notices.

## Delivery state

Unpublished macOS arm64 development candidates. Current signed/notarized desktop **0.1.3**, source **ed1e3a5**, preserves warnings across capture sessions and reports invalid JSON without quoting project contents; 28 core checks pass. With extension **0.1.4**, actual Chrome, Edge and Firefox controlled capture journeys pass in both standalone and suite forms. Chrome/Edge rapid desktop Pause/Stop retains warnings for interrupted actions; precise Firefox timing remains open. Both forms pass real Chrome/TextEdit mixed capture, native slow-storage pressure, editing/redaction/save/reopen and independent documentation inspection. Actual captured mixed guides round-trip across both forms with stable identities, warning history and image bytes.

Actual simultaneous forms refuse a competing tool owner and hand off safely after standalone exit. A real signed candidate suite-tool update **0.1.2 → 0.1.3** refuses unsaved restart, relaunches the unchanged suite and preserves editable mixed work. This is not a released marketplace update. Full acceptance remains incomplete: fresh OS permissions, broader browser/recovery/offline and writer cases, marketplace installation, independently released updates, standalone updater implementation and signed extension distribution remain open. No public availability is claimed.

## Develop

Node >=22.12. `npm ci`, `npm test`, `npm start`. See docs/EXTENSIONS.md for browser development, scope, bridge setup and evidence limits; docs/DESKTOP-CAPTURE.md covers selected-window capture and its qualification limits. Follow applicable storage/lifecycle controls before installs, tests, desktop sessions or builds. Dependency URLs pin the immutable sdk-v0.1.3 SDK/runtime/shell archives. Do not substitute platform-feature SDKs or upgrade Electron independently.

The adapter loads src/index.html in host.view.webContents, prefixes renderer commands with com.matiq.guides, uses host.window only as a native-dialog parent and stores the library under host.dataDir/guides. Native permissions are separate from manifest capabilities. The SDK runtime supplies sandboxing, trusted-frame checks, shell styling and compatible tool ownership leases.

## Projects and sharing

See docs/PROJECT-FORMAT.md. Save locally before switching or exporting. A portable `.mqguide` contains the editable guide and embedded screenshot assets. Import preserves stable identities and rejects an existing guide ID rather than overwriting work; duplicate explicitly for a distinct copy.

Editable projects retain originals. HTML, Markdown/images and PDF burn crop/annotations/redactions into pixels and preserve reviewed instructions and notes. If a guide has redactions or capture warnings, review its saved sharing text before export; every edit or new save invalidates that review. Sanitized sharing projects retain reviewed instructions but discard original step notes, original screenshots, source/capture context and interaction timestamps. Capture warnings become explicit manual review-note steps. Always manually inspect text and visible pixels before sharing. No masking guarantee is made.

## Release contract

Build/sign/notarize the standalone through the existing native release infrastructure and SDK credential helpers. Then use `matiq-tool pack-app --resources ... --extra native --target darwin-arm64 --output ... --url ...` against those same resources to produce the signed `.mqt` and matching `.release.json`. Signing keys belong only in the protected release environment. No release should be published before actual standalone/suite, capture, export, marketplace and update acceptance passes.

The current manifest limits the first intended target to darwin-arm64; it is not a qualification claim. No other platform is advertised. See docs/PROVENANCE.md for reference boundaries.
