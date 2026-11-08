# Selected-window desktop capture

Desktop0.1.18 passes selected-window and mixed-source workflows in BOTH signed standalone and suite forms on macOS15.7.7arm64, SDK/runtime/shell0.1.3 and Electron45.2.3. Full acceptance remains incomplete for the specific limits below. A macOS14.2 linking target does not qualify untested OS versions.

## Scope and setup

Create and save a guide. Choose **Choose desktop window**. Copycat explains why Screen Recording permission is needed before listing available windows. Select the intended application/window, then choose **Start / resume selected window** and approve recording. Accessibility permission supplies control context. Denial is an actionable error, never a successful empty capture.

Window titles are used transiently to make selection understandable. They are not retained as guide source context or logged. The process identity must still match when recording starts. Windows without reliable OS application identity are excluded from selection. Desktop 0.1.2 uses the OS localized application name or bundle identity when ScreenCaptureKit returns an empty application name. Browser windows from the supported browsers use the extension instead; browser and desktop sessions cannot record concurrently into the guide. Stop one capture before appending from the other source.

Only left mouse actions within the selected foreground window are supported initially. Menus, sheets, child dialogs, other windows, keyboard-only actions and drags are outside this capture scope. Scroll to an action and click it to capture the resulting window context. A different application or another window in the same application is not captured. There is no raw typing, clipboard or keyboard-event observer.

A short-lived native helper uses ScreenCaptureKit window screenshots and Accessibility hit testing. It reads recognized control roles and bounded button/control titles or Accessibility descriptions, never AXValue, selected text or document URLs. Unknown controls produce an editable generic instruction. Screenshots are bounded to 2,000 pixels on their longest edge and 700 KB JPEG payloads; oversized source windows or images fail visibly. Form values can still appear in screenshot pixels; review and redact before sharing.

## Lifecycle and failure behavior

Recording status is visible in Copycat. Pause, stop and cancel close and await the owned helper; resume explicitly selects a window again. The private pipe closes when its parent disappears, stopping the helper. In-flight screenshots that cannot finish before a stop create a review warning. Step delivery already emitted before a stop is drained before the guide transition.

Window movement recalculates screenshot scale and target coordinates per action. The helper is designed to stop and visibly pause capture on a display configuration change, sleep/lock, application/window closure, permission revocation, capture failure or overload. Actual application closure, overload, a real display resolution change and normal-launch Accessibility and Screen Recording revocation in both forms are qualified. Display attachment/removal and sleep/lock still need real execution evidence. Actions faster than the single pending screenshot can be handled produce a warning instead of silently dropped steps. Retained screenshots use the same canonical guide assets, atomic persistence, annotations, redaction and exports as browser/manual steps.

Native pending delivery is limited to four steps or 3 MiB. Storage pressure stops the mouse observer, drains already accepted steps, and saves a warning that additional actions may be missing. The status shows pending delivery and the limit; explicitly resume after reviewing saved steps.

Cleanup failures remain actionable and can be retried. No native capture listener is installed at application launch, while paused, or after the helper exits. The SDK owns application shutdown; a close acknowledgement is not used as proof that the process exited.

## Released selected-window movement qualification

With `GUIDES_NATIVE_TEST_VM=tart`, `GUIDES_TEST_WINDOW_MOVE=1` and the actual packaged executable/package/proof variables, run `npm run test:native-app` under the native storage guard once per form. The selected fixture window changes screen position while recording is active; the next click on the same button must create the next illustrated step with a matching screenshot-relative highlight. The test retains a rendered preview privately and restores the first selection before the existing edit/save/reopen checks.

Released0.1.16 passes in BOTH forms at harness3586c4b on macOS15.7.7arm64. The actual control moved from screen position270,288 to390,228; target coordinates remain identical and both rendered highlights were visually inspected around the actual button. Normal stop, save/reopen, cancel, selected-application closure and independent owned-process cleanup also pass. [Exact movement receipts](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.16/native-window-movement-qualification-0.1.16.json) contain versions and limits; fixture screenshots stay private. This qualifies movement between actions, not moving during an in-flight screenshot, display changes, sleep/lock, live OS permission revocation or fresh final-version OS-profile setup. Application approval choices are controlled; OS capture and packaged execution are real.

## Released display resolution interruption qualification

Released **0.1.16/sourcebe5f88d** passes in BOTH forms with unchanged suite **0.1.1**, SDK/runtime/shell **0.1.3**, Electron **45.2.3** on macOS **15.7.7arm64**, harness **d76a80e**. The controlled native fixture uses CoreGraphics to apply a real **1024×768 → 1600×1200** display-mode change with [application-only lifetime](https://developer.apple.com/documentation/coregraphics/cgconfigureoption/forapponly). The shipped recorder reacts to the real OS display notification, exits, and leaves the saved capture visibly paused with its display-change warning. Guide steps and screenshot assets remain unchanged. The fixture restores the exact original mode after three seconds; an actual button click while paused adds no step. Explicit resume captures the next real action. Normal stop/exit and independent owned-process cleanup pass. [Exact receipts](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.16/display-change-qualification-0.1.16.json).

Reproduce under the native storage guard with `GUIDES_NATIVE_TEST_VM=tart`, `GUIDES_TEST_DISPLAY_CHANGE=1`, the existing packaged executable/package/proof variables and `npm run test:native-app`, once per form. Application approval choices are controlled; display configuration, capture, helper exit and persistence are real. The fixture's configuration is application-scoped and automatically reverts at process termination. This qualifies a resolution change on the existing VM display; hotplug, multiple displays, sleep/lock, effective permission revocation and motion during a pending screenshot remain unqualified.

## 0.1.18 pending-screenshot resize correction

Released0.1.16 can retain a target measured before a window resize while the screenshot reflects the resized window. A calibrated painted-button check reproduced a highlight outside its actual target. Keep native windows steady when using0.1.16.

Build0.1.18/source **aaf4b17e601c9cccc64b03b445f68dd6b39bdcc0** observes Accessibility move/resize notifications only while a screenshot request is pending and rechecks window geometry before emitting a step. A change stops the helper and visibly pauses capture with a review warning. If the window cannot be monitored reliably, its step omits the automatic highlight and retains a manual-review warning; instructions and screenshots remain editable. No raw typing or additional content is observed.

Both signed forms pass three actual resize attempts each on macOS15.7.7arm64, SDK/runtime/shell0.1.3, Electron45.2.3 and unchanged suite0.1.1. Every attempt pauses before retaining an inaccurate step; the helper exits before explicit resume, and resumed screenshot pixels agree with the target. Stable baseline and resumed target centers differ from the painted button by less than0.003 of image height. Normal cleanup independently confirms owned processes/listeners are absent. Real selected-window movement between actions, display resolution interruption, active-capture SIGKILL recovery and edit/redact/save/reopen also pass in both forms.

Run `node scripts/window-resize-test.cjs` in isolated Tart with `GUIDES_NATIVE_TEST_VM=tart`, `GUIDES_TEST_WINDOW_RESIZE=1` and the normal signed executable/package/proof variables under the storage guard, once per form. The painted button and repeated actual OS window resizes are controlled fixtures; capture and transport are real. The optional `GUIDES_CAPTURE_COMPONENT=1` development check is explicitly not packaged qualification. Effective OS permission revocation, sleep/lock, hotplug/multiple displays and arbitrary native applications remain outside this evidence. Project/dataVersion1 and extension/protocol compatibility are unchanged.

## Reproduction and current evidence limits

On the authorized Mac, reserve storage and run:

- `npm run build:native` compiles both independently written native helpers.
- `npm run test:capture-native` compiles a controlled AppKit fixture, runs real mouse/Accessibility/ScreenCaptureKit checks and verifies owned process absence. It requires Screen Recording and Accessibility permissions for that development invocation.
- The compact result is `.validation/desktop-component-proof.json`.

The fixture contains only controlled data. It tests JPEG capture, real control labels without field values in event text, target alignment, window movement, selected process identity, exclusion of a second same-app window, explicit monitor stop/restart, parent-pipe closure and selected application closure. The fixture and test launcher are not packaged.

That component receipt is from macOS 27.0.1 arm64 and does not by itself qualify an installed bundle. Signed application and mixed-capture evidence is recorded below. Fresh TCC setup/denial/revocation, physical display changes, sleep and full release/update acceptance remain outstanding.


## Signed mixed workflow and current candidate

Desktop 0.1.2, source d582c205a2d4537e5fad15ee0779d442b85494c4, passes actual mixed capture on macOS 27.0.1 arm64 in signed standalone and suite forms at harness 6fd182b. The suite shell is 0.1.1; SDK/runtime/shell remain 0.1.3 and Electron 45.2.3. The shared browser journey records seven Chrome steps, then launches a new TextEdit 1.21 instance with a controlled rich-text document, explicitly selects its window, and clicks the actual Bold control. The saved document must contain bold formatting. The signed helper appends exactly one native screenshot/target to the same guide, names the real control from its Accessibility description, and adds no step for keyboard Save. Editing the native instruction preserves its identity and earlier browser steps. Cancellation of a later browser session preserves all eight steps. The rendered native highlight is visually inspected. Native hooks, the owned TextEdit/driver/browser/Electron processes, positively identified browser crash helper and fixture listeners are independently absent; the test parent also exits normally.

The real TextEdit journey exposed an intermittent empty ScreenCaptureKit application name in 0.1.1, which failed visibly instead of producing a fake step. The 0.1.2 helper falls back to OS application metadata and uses a control description when its title is empty, without reading field values. The controlled pressure fixture now has a test-only app bundle identity; production scope checks remain unchanged by that fixture adjustment.

Use `GUIDES_MIXED_NATIVE=1` with the actual packaged executable/receipt variables and `npm run test:browser` under the native storage guard. `GUIDES_SWIFT_MODULE_CACHE` may point to an owned compatible macOS compiler cache. The TextEdit input driver is test-only and is not shipped. Application approval choices, file destinations and document content are controlled; OS capture and native application actions are real. Fresh TCC setup/denial/revocation, physical display changes, sleep and the complete acceptance matrix remain open. Native keyboard shortcuts, menus/dialogs and drags remain outside the supported scope and need manual instructions.

The captured mixed editable project has also passed actual suite import, native-step editing, save, normal exit/reopen and re-export, followed by the same journey back in standalone. Guide/step IDs, order, annotations and captured screenshot bytes remain intact across distinct data roots. This portability evidence used signed desktop 0.1.1 and harness d582c20; it is separate from native 0.1.2 capture qualification and does not qualify an updater.

## Desktop 0.1.3 candidate regression

Signed product source ed1e3a5, harness af9b10c, passes the real Chrome/TextEdit mixed journey in both forms, including the actual Bold control label and formatting outcome. Both forms also pass the selected-window native pressure, edit/redact/save/quit/reopen, cancellation and target-app closure journeys on macOS 27.0.1 arm64. Existing helper code is unchanged from 0.1.2; the canonical model now retains earlier capture warnings across later browser/native sessions and bounded overflow reports whole-guide review explicitly. The new actual mixed project round-trips through suite and fresh standalone, preserving its complete warning history, stable identities, annotations and image bytes. No data schema migration, SDK/runtime upgrade or extra platform qualification is implied. Fresh TCC setup, display/sleep/revocation cases and the other stated native scope limits remain open.


## Actual Accessibility revocation in both forms

Released0.1.18/source aaf4b17 passes normal Finder/LaunchServices capture and actual Accessibility revocation on macOS15.7.7 arm64 in Tart, SDK/runtime/shell0.1.3, Electron45.2.3. [Standalone receipt](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.18/accessibility-revocation-standalone-0.1.18.json) and [suite receipt](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.18/accessibility-revocation-suite-0.1.18.json) verify native Settings authorization, effective grant/deny/restoration records, visible pause, recorder exit before cleanup, preserved guide/assets and no later click step while paused.

The suite additionally stays paused with no recorder after restoration, then explicitly resumes and appends one real native screenshot while preserving the earlier step and asset. Suite0.1.1 application bytes remain unchanged. Install/open the qualified suite normally from Applications; if its permission entry is absent, use the native Add application picker to select that same signed app. Complete any owned native screen-capture approval and close the application picker before changing the intended grant. Preserve the initial permission state.

These are actual OS permission tests with renderer-only inspection. Direct test-runner launches are not a substitute for normal OS attribution. Screen Recording revocation, fresh OS-profile setup, display hotplug and sleep/lock remain separate.


## Actual Screen Recording revocation in both forms

The [Screen Recording qualification receipt](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.18/screen-recording-revocation-0.1.18.json) covers released 0.1.18/source aaf4b17 in standalone and suite forms on macOS 15.7.7 arm64, SDK/runtime/shell 0.1.3 and Electron 45.2.3. Native System Settings authorization changes each actual application grant from granted to denied and back; independent readback confirms the effective state.

A real native click after denial adds no screenshot or step. Capture visibly pauses with a warning, the recorder exits before fixture cleanup, and the earlier guide/assets remain unchanged. After restoration both forms remain paused with no recorder. The suite additionally explicitly resumes and appends one real screenshot while preserving the previous step/asset. Original Accessibility and Screen Recording grants, normal app/target/Settings exit and owned listener absence are independently verified.

The operator uses the actual Screen & System Audio Recording page, defers a native relaunch prompt when available, and waits for the permission state to settle. The app does not receive administrator credentials. This qualifies revocation of an existing grant, not first-use setup on a fresh OS profile or every display/sleep combination.


## First-use permission setup on 0.1.18

The [first-use receipt](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.18/first-use-permissions-0.1.18.json) covers both forms with fresh app data and supported bundle-scoped OS permission resets. It uses the existing macOS 15.7.7 arm64 Tart user, not a pristine/new macOS account. The other form's grants remain unchanged during each reset, and all original grants are restored afterward.

The actual Screen Recording Deny dialog produces an actionable error with no steps, assets or recorder. After a native Settings grant, the actual Accessibility Deny dialog produces an actionable error and paused capture, again with no steps, assets or recorder. Native grants do not automatically resume recording. Explicit Start captures the first real selected-window screenshot and control label; the same guide remains editable and saves. App, target, Settings and owned listener cleanup are independently verified.

The standalone is freshly installed from the exact released signed/notarized ZIP in an isolated Applications location. The suite starts with no installed tools, refreshes the actual signed marketplace, verifies listing/cancel do not install, then explicitly downloads and installs the released signed 0.1.18 package before the permission workflow. Declared capabilities and installation do not grant OS permissions.


## Actual 1x and 2x display scaling on 0.1.18

The [display-scale receipt](https://github.com/GoMatiQ-inc/matiq-copycat/releases/download/v0.1.18/display-scale-qualification-0.1.18.json) qualifies unchanged released source aaf4b17 in both signed packaged forms. Harness 9041275 runs on macOS 15.7.7 arm64 in Tart, SDK/runtime/shell 0.1.3, Electron 45.2.3 and suite 0.1.1.

The actual display changes from 2048×1536 pixels to 1024×768 pixels while keeping 1024×768 logical points, then restores its exact original mode. Each transition visibly pauses capture and stops the recorder before explicit resume. A paused click adds nothing. Actual screenshots at both densities pass the independent painted-control highlight oracle; prior steps and assets remain unchanged. Normal shutdown independently verifies owned process/listener absence. A separate CoreGraphics process verifies the original 2x mode after both jobs.

Reproduce in the isolated Tart guest under its storage guard using the existing packaged executable, candidate-proof and suite-package variables: set GUIDES_NATIVE_TEST_VM=tart, GUIDES_TEST_WINDOW_RESIZE=1, GUIDES_TEST_DISPLAY_SCALE=1 and a reusable GUIDES_SWIFT_MODULE_CACHE, then run node scripts/window-resize-test.cjs once per form. The fixture uses app-scoped OS display configuration and automatically restores it. Application capture approvals are controlled; display modes, capture pixels and persistence are real. This does not qualify multiple displays, attachment/removal or sleep/lock.
