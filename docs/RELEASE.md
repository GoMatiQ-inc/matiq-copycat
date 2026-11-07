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


`node scripts/mixed-project-test.cjs` imports the actual captured project named by `GUIDES_PROJECT_INPUT` into the signed form selected by the existing packaged executable variables, edits its native step, saves, quits/reopens and re-exports. Its checks compare the full project, including real captured image bytes and stable identities. Feed the suite export back to standalone to verify the return journey. Outputs under `.validation` contain controlled fixture screenshots, including retained originals; they are private test artifacts, not sanitized documentation.

## Competing packaged forms

With both signed executables, package and candidate proof supplied as above, plus `GUIDES_MIXED_PROJECT` naming an actual captured browser/native portable project, run `node scripts/competing-forms-test.cjs` through the native storage guard. At harness adf85ee, desktop 0.1.2/source d582c20 and suite 0.1.1 pass on macOS 27.0.1 arm64: actual suite Open visibly refuses the live standalone owner; SDK lease, bridge receiver and saved project bytes remain unchanged; no second workspace starts. After normal standalone exit and independent cleanup, suite retry acquires a new owner nonce and imports the intact mixed guide into its distinct data root. Both forms then exit normally and owned processes/listeners are absent. This covers the standalone-first direction with controlled import dialogs. Reverse-direction launch and explicit external-project writer cases remain separate evidence.

## Signed candidate tool-update qualification

`node scripts/suite-update-test.cjs` uses the installed signed suite, the older real signed package/proof in `GUIDES_SUITE_PACKAGE` / `GUIDES_CANDIDATE_PROOF`, the newer real signed package/proof in `GUIDES_UPDATE_PACKAGE` / `GUIDES_UPDATE_PROOF`, and an actual captured mixed portable project in `GUIDES_MIXED_PROJECT`. Run it through the native storage guard. At harness af9b10c, signed Guides 0.1.2/source d582c20 → 0.1.3/source ed1e3a5 passes in unchanged suite 0.1.1 on macOS 27.0.1 arm64, SDK/runtime/shell 0.1.3, Electron 45.2.3.

The real SDK verifies and stages the production-signed candidate in a separate immutable directory while the old tool remains active. Actual suite restart UI refuses unsaved work and preserves edits in the hidden tool. After save, actual app.relaunch exits the original process and starts a distinct owned suite process; startup activates the new tool, retains the previous package and preserves the mixed guide, stable identities and image assets. The new tool opens and edits existing work. The suite application archive hash is unchanged. Normal quit and independent process/listener absence pass. The test keeps the original process handle separate from the closed Playwright application wrapper; two earlier harness cleanup failures were retained as failed attempts, then their owned fixtures were safely removed.

This is real signed **candidate** update execution through SDK staging and actual suite restart. It is not a released marketplace download, reviewed catalog publication or completion of A12. Controlled file dialogs choose the fixture project. Existing unrelated suite processes are excluded from ownership and preserved. Test-owned inspector/CDP listeners remain loopback-only under a finite watchdog and cleanup.

## Reviewed sharing in candidate 0.1.4

Signed product source deedee4 passes actual standalone/suite sharing qualification at harness d32ac7a on macOS 27.0.1 arm64, SDK/runtime/shell 0.1.3 and Electron 45.2.3. Unreviewed sharing is rejected before choosing a destination, including direct desktop IPC. The actual disclosure/checkbox works with Enter, Tab and Space; later editing/save invalidates the earlier revision. Reviewed instructions and notes survive independent HTML/Markdown/PDF inspection, while redactions are burned into pixels and hidden originals are absent. Both PDF pages were visually inspected. Sanitized projects clear original notes/source/capture metadata/timestamps. Thirty core checks and the actual Linux SDK desktop journey additionally verify long descriptions/warning lists, editable warning review and undo/redo.

Remaining real browser/native/mixed/ownership qualification and a signed 0.1.3 → 0.1.4 suite candidate update pass at harness 93c78f2. The suite application remains 0.1.1 with unchanged archive bytes; preserved existing mixed work is editable after actual relaunch. An earlier Edge cleanup attempt failed on a closed Playwright wrapper and is retained as a failure. After observing normal native exit, fixtures now verify captured process/listener snapshots directly rather than reusing a closed wrapper; owned cleanup passes. This is not a released marketplace install/update or standalone-updater qualification.
