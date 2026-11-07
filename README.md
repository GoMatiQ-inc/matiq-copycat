# MatiQ Guides

Local illustrated workflow documentation, using the MatiQ Solutions desktop SDK **0.1.3** and its qualified Electron **45.2.3** runtime. One adapter runs in standalone and suite forms. Source-available under the no-sale license in LICENSE; third-party components retain their notices.

## Delivery state

Development implementation. No target, capture adapter, extension, signed release, marketplace installation or update journey is qualified yet. The current implementation includes local manual editing, export paths and a shared browser companion/native bridge. A real Chromium development journey and the compiled macOS bridge component have passed targeted checks; packaged browser/native workflows remain unqualified. Native desktop capture is not connected yet. Do not infer product readiness from unit tests or the SDK-generated foundation.

## Develop

Node >=22.12. `npm ci`, `npm test`, `npm start`. See docs/EXTENSIONS.md for browser development, scope, bridge setup and evidence limits. Follow applicable storage/lifecycle controls before installs, tests, desktop sessions or builds. Dependency URLs pin the immutable sdk-v0.1.3 SDK/runtime/shell archives. Do not substitute platform-feature SDKs or upgrade Electron independently.

The adapter loads src/index.html in host.view.webContents, prefixes renderer commands with com.matiq.guides, uses host.window only as a native-dialog parent and stores the library under host.dataDir/guides. Native permissions are separate from manifest capabilities. The SDK runtime supplies sandboxing, trusted-frame checks, shell styling and compatible tool ownership leases.

## Projects and sharing

See docs/PROJECT-FORMAT.md. Save locally before switching or exporting. A portable `.mqguide` contains the editable guide and embedded screenshot assets. Import preserves stable identities and rejects an existing guide ID rather than overwriting work; duplicate explicitly for a distinct copy.

Editable projects retain originals. HTML, Markdown/images and PDF export use rasterized crop/annotations/redactions. Sanitized sharing projects discard originals, source and notes, and replace redacted-step instructions for review. Always manually inspect text and visible pixels before sharing. No masking guarantee is made.

## Release contract

Build/sign/notarize the standalone through the existing native release infrastructure and SDK credential helpers. Then use `matiq-tool pack-app --resources ... --target darwin-arm64 --output ... --url ...` against those same resources to produce the signed `.mqt` and matching `.release.json`. Signing keys belong only in the protected release environment. No release should be published before actual standalone/suite, capture, export, marketplace and update acceptance passes.

The current manifest limits the first intended target to darwin-arm64; it is not a qualification claim. No other platform is advertised. See docs/PROVENANCE.md for reference boundaries.
