# MatiQ Guides

Local illustrated workflow documentation, using the MatiQ Solutions desktop SDK **0.1.3** and its qualified Electron **45.2.3** runtime. One adapter runs in standalone and suite forms. Source-available under the no-sale license in LICENSE; third-party components retain their notices.

## Delivery state

Unpublished macOS arm64 development candidates. Current signed/notarized desktop **0.1.5**, source **62b074a**, preserves reviewed wording in redacted exports and retains capture warnings without consuming the description limit. A saved-revision review is required for sharing when redactions/warnings exist; edits or new saves invalidate it. Sanitized projects omit originals, original step notes, source/capture context and interaction times, with warnings retained as manual review notes. Thirty-four core checks pass. Every export holds destination ownership and provides visible cleanup retry. Actual packaged standalone/suite export ownership, cross-form editing and independent documentation checks pass. The signed candidate suite update 0.1.4 → 0.1.5 also passes; released updates remain pending.

With extension **0.1.4**, actual Chrome, Edge and Firefox controlled capture journeys pass in both standalone and suite forms, including Chrome/TextEdit mixed capture and Chrome/Edge rapid controls. Native pressure, editing/save/reopen, ownership handoff, cross-form projects and independent HTML/Markdown/PDF inspection pass. Actual keyboard review, stale-approval rejection and preserved safe wording are verified in both signed forms. A real signed candidate suite-tool update **0.1.3 → 0.1.4** preserves mixed work through an actual restart in unchanged suite 0.1.1. This is not a released marketplace update.

Full acceptance remains incomplete: fresh OS permissions, broader browser/recovery/offline and writer cases, marketplace installation, independently released updates, standalone updater implementation and signed extension distribution remain open. No public availability is claimed.

## Develop

Node >=22.12. `npm ci`, `npm test`, `npm start`. See docs/EXTENSIONS.md for browser development, scope, bridge setup and evidence limits; docs/DESKTOP-CAPTURE.md covers selected-window capture and its qualification limits. Follow applicable storage/lifecycle controls before installs, tests, desktop sessions or builds. Dependency URLs pin the immutable sdk-v0.1.3 SDK/runtime/shell archives. Do not substitute platform-feature SDKs or upgrade Electron independently.

The adapter loads src/index.html in host.view.webContents, prefixes renderer commands with com.matiq.guides, uses host.window only as a native-dialog parent and stores the library under host.dataDir/guides. Native permissions are separate from manifest capabilities. The SDK runtime supplies sandboxing, trusted-frame checks, shell styling and compatible tool ownership leases.

## Projects and sharing

See docs/PROJECT-FORMAT.md. Save locally before switching or exporting. A portable `.mqguide` contains the editable guide and embedded screenshot assets. Import preserves stable identities and rejects an existing guide ID rather than overwriting work; duplicate explicitly for a distinct copy.

Editable projects retain originals. HTML, Markdown/images and PDF burn crop/annotations/redactions into pixels and preserve reviewed instructions and notes. If a guide has redactions or capture warnings, review its saved sharing text before export; every edit or new save invalidates that review. Sanitized sharing projects retain reviewed instructions but discard original step notes, original screenshots, source/capture context and interaction timestamps. Capture warnings become explicit manual review-note steps. Always manually inspect text and visible pixels before sharing. No masking guarantee is made.

## Release contract

Build/sign/notarize the standalone through the existing native release infrastructure and SDK credential helpers. Then use `matiq-tool pack-app --resources ... --extra native --target darwin-arm64 --output ... --url ...` against those same resources to produce the signed `.mqt` and matching `.release.json`. Signing keys belong only in the protected release environment. No release should be published before actual standalone/suite, capture, export, marketplace and update acceptance passes.

The current manifest limits the first intended target to darwin-arm64; it is not a qualification claim. No other platform is advertised. See docs/PROVENANCE.md for reference boundaries.
