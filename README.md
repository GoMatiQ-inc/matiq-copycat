# MatiQ Guides

Local illustrated workflow documentation, using the MatiQ Solutions desktop SDK **0.1.3** and its qualified Electron **45.2.3** runtime. One adapter runs in standalone and suite forms. Source-available under the no-sale license in LICENSE; third-party components retain their notices.

## Delivery state

Unpublished signed/notarized macOS arm64 candidate **0.1.7**, source **9418ca7**, using qualified SDK/runtime/shell **0.1.3** and Electron **45.2.3**. Thirty-nine core checks pass. Current actual packaged standalone/suite evidence covers cross-form editing, annotations/redaction, stable identities/assets, independent HTML/Markdown/PDF, revision-bound sharing review, destination ownership and cleanup retry.

Actual signed **0.1.6 → 0.1.7** native application update passes checksum rejection, busy quit and unsaved-restart refusal, native signature staging, real installer replacement/relaunch and preserved editable mixed-guide content/assets. Native helpers, registration, staging and listeners are independently cleaned. The real signed suite candidate **0.1.6 → 0.1.7** update also passes staging/restart and retained work in unchanged suite **0.1.1**. These use controlled local candidate feeds/SDK installation, not a published marketplace or release endpoint. See docs/UPDATES.md.

With developer extension **0.1.4**, all six real Chrome, Edge and Firefox capture journeys pass against both signed 0.1.7 forms. Chrome includes actual TextEdit mixed capture. The successor also quarantines rejected authentication/protocol connections before later queued actions reach the guide owner. Earlier native pressure and ownership-handoff evidence is retained with its original versions.

Full acceptance remains incomplete: fresh OS permissions, broader browser/native/recovery/offline and writer cases, marketplace installation, independently published updates, shared bridge lifecycle and signed extension distribution remain open. No public availability is claimed.

## Develop

Node >=22.12. `npm ci`, `npm test`, `npm start`. See docs/EXTENSIONS.md for browser development, scope, bridge setup and evidence limits; docs/DESKTOP-CAPTURE.md covers selected-window capture and its qualification limits. Follow applicable storage/lifecycle controls before installs, tests, desktop sessions or builds. Dependency URLs pin the immutable sdk-v0.1.3 SDK/runtime/shell archives. Do not substitute platform-feature SDKs or upgrade Electron independently.

The adapter loads src/index.html in host.view.webContents, prefixes renderer commands with com.matiq.guides, uses host.window only as a native-dialog parent and stores the library under host.dataDir/guides. Native permissions are separate from manifest capabilities. The SDK runtime supplies sandboxing, trusted-frame checks, shell styling and compatible tool ownership leases.

## Projects and sharing

See docs/PROJECT-FORMAT.md. Save locally before switching or exporting. A portable `.mqguide` contains the editable guide and embedded screenshot assets. Import preserves stable identities and rejects an existing guide ID rather than overwriting work; duplicate explicitly for a distinct copy.

Editable projects retain originals. HTML, Markdown/images and PDF burn crop/annotations/redactions into pixels and preserve reviewed instructions and notes. If a guide has redactions or capture warnings, review its saved sharing text before export; every edit or new save invalidates that review. Sanitized sharing projects retain reviewed instructions but discard original step notes, original screenshots, source/capture context and interaction timestamps. Capture warnings become explicit manual review-note steps. Always manually inspect text and visible pixels before sharing. No masking guarantee is made.

## Release contract

Build/sign/notarize the standalone through the existing native release infrastructure and SDK credential helpers. Then use `matiq-tool pack-app --resources ... --extra native --target darwin-arm64 --output ... --url ...` against those same resources to produce the signed `.mqt` and matching `.release.json`. Signing keys belong only in the protected release environment. General availability requires the full standalone/suite, capture, export, marketplace and update acceptance evidence. Candidate publication and catalog metadata must follow the existing reviewed release process.

The current manifest limits the first intended target to darwin-arm64; it is not a qualification claim. No other platform is advertised. See docs/PROVENANCE.md for reference boundaries.
