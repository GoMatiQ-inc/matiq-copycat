# Native candidate build and release contract

The current qualified SDK/runtime/shell is 0.1.3; Electron is 45.2.3. The intended first target is darwin-arm64. No other target is qualified by these scripts.

Reconcile the exact committed source on the authorized native release host. Use the machine's storage guard for dependency installation, native tests, candidate builds and verification. Use one compatible installation per host/lockfile; do not transfer Linux node_modules to macOS.

## Candidate artifacts

Run `npm ci --no-audit --no-fund`. With the existing company signing credentials loaded through the protected launcher, run `npm run release:candidate`. The script validates the build before opening SDK `withMacKeychain` and nested `withNotaryProfile` wrappers, then builds/signs/notarizes the DMG and ZIP without publishing. The disk image is signed, submitted and stapled inside the same SDK credential wrappers, then its blockmap and update metadata are regenerated from the final bytes. P12 and Apple passwords must never enter command arguments, source, logs or retained plaintext files. The SDK wrappers restore and remove their owned keychains in finally blocks.

The output app is `dist/mac-arm64/MatiQ Guides.app`. Both native helpers are extra resources in that same app. `npm run verify:release` checks company signatures, hardened runtime, helper signatures, safe entitlements, stapled tickets, Gatekeeper and the app extracted from the ZIP. It writes compact `dist/mac-signature.json` with exact source and artifact hashes.

With the existing tool signing key loaded through the protected launcher, run `npm run tool:package`. This invokes SDK `pack-app --extra native` on the same already-built app resources, producing `MatiQ-Guides-VERSION-darwin-arm64.mqt` and matching `.mqt.release.json`. The signed metadata's URL names the intended immutable version release; it is not evidence that the release exists or is available.

## Qualification and publication

Candidate signature verification is not installed-application acceptance. Test the actual app in standalone and suite forms with the actual Chrome, Edge and Firefox integrations, scoped native capture, mixed-source guides, all editing/export/portability/recovery/offline journeys and owned-resource cleanup. Exercise a real independently versioned N to N+1 update and preserved work before declaring delivery complete.

Only reviewed, qualified artifact bytes may enter the immutable release and marketplace metadata. Marketplace availability must not install the tool automatically. Do not replace published assets, expand targets, upgrade the runtime or raise dataVersion to make a failed qualification appear to pass. Preserve user work and existing authorized integration consumers through update and uninstall.

The scripts build reviewable candidates only. No public release, signed browser distribution, marketplace installation or updater qualification is implied by their presence.

## Packaged project and documentation qualification

With the actual installed standalone and suite executable paths in `GUIDES_EXECUTABLE_PATH` and `GUIDES_SUITE_EXECUTABLE_PATH`, the real signed tool package in `GUIDES_SUITE_PACKAGE` and its candidate receipt in `GUIDES_CANDIDATE_PROOF`, run `npm run test:packaged-project` through the native storage guard. It uses isolated canonical profiles and real signed SDK package installation, not a mocked marketplace. The test exports from standalone, edits in the suite and imports back into a fresh standalone profile. It checks stable identities, embedded assets, ordering, annotations and crop, then opens HTML in an independent installed Chrome process and uses PDFKit to inspect/render PDF and test-only local Vision OCR to verify rendered safe text when PDFKit glyph extraction reorders characters. No OCR or model dependency is added to the shipped tool. Test-controlled file dialogs choose destinations; public marketplace and OS capture permission qualification remain separate. Core editing/export runs with HTTP(S) requests cancelled in these owned profiles. The test has a finite watchdog and verifies owned process/listener cleanup.
