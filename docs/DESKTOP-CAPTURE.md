# Selected-window desktop capture

Development implementation, not a released or qualified packaged workflow. The intended first target is Apple Silicon macOS. A macOS 14.2 linking target does not qualify untested OS versions.

## Scope and setup

Create and save a guide. Choose **Choose desktop window**. Guides explains why Screen Recording permission is needed before listing available windows. Select the intended application/window, then choose **Start / resume selected window** and approve recording. Accessibility permission supplies control context. Denial is an actionable error, never a successful empty capture.

Window titles are used transiently to make selection understandable. They are not retained as guide source context or logged. The process identity must still match when recording starts. Browser windows from the supported browsers use the extension instead; browser and desktop sessions cannot record concurrently into the guide. Stop one capture before appending from the other source.

Only left mouse actions within the selected foreground window are supported initially. Menus, sheets, child dialogs, other windows, keyboard-only actions and drags are outside this capture scope. Scroll to an action and click it to capture the resulting window context. A different application or another window in the same application is not captured. There is no raw typing, clipboard or keyboard-event observer.

A short-lived native helper uses ScreenCaptureKit window screenshots and Accessibility hit testing. It reads recognized control roles and bounded button/control titles, never AXValue, selected text or document URLs. Unknown controls produce an editable generic instruction. Screenshots are bounded to 2,000 pixels on their longest edge and 700 KB JPEG payloads; oversized source windows or images fail visibly. Form values can still appear in screenshot pixels; review and redact before sharing.

## Lifecycle and failure behavior

Recording status is visible in Guides. Pause, stop and cancel close and await the owned helper; resume explicitly selects a window again. The private pipe closes when its parent disappears, stopping the helper. In-flight screenshots that cannot finish before a stop create a review warning. Step delivery already emitted before a stop is drained before the guide transition.

Window movement recalculates screenshot scale and target coordinates per action. A display configuration change, sleep/lock, application/window closure, permission revocation, capture failure or capture overload stops the helper and visibly pauses capture. Actions faster than the single pending screenshot can be handled produce a warning instead of silently dropped steps. Retained screenshots use the same canonical guide assets, atomic persistence, annotations, redaction and exports as browser/manual steps.

Cleanup failures remain actionable and can be retried. No native capture listener is installed at application launch, while paused, or after the helper exits. The SDK owns application shutdown; a close acknowledgement is not used as proof that the process exited.

## Reproduction and current evidence limits

On the authorized Mac, reserve storage and run:

- `npm run build:native` compiles both independently written native helpers.
- `npm run test:capture-native` compiles a controlled AppKit fixture, runs real mouse/Accessibility/ScreenCaptureKit checks and verifies owned process absence. It requires Screen Recording and Accessibility permissions for that development invocation.
- The compact result is `.validation/desktop-component-proof.json`.

The fixture contains only controlled data. It tests JPEG capture, real control labels without field values in event text, target alignment, window movement, selected process identity, exclusion of a second same-app window, explicit monitor stop/restart, parent-pipe closure and selected application closure. The fixture and test launcher are not packaged.

The native component evidence is from macOS 27.0.1 arm64, not from installed standalone/suite bundles. Fresh TCC attribution for signed bundles, complete mixed capture in both packaged forms, actual permission denial/revocation, physical display changes, sleep and all release/update acceptance remain outstanding. Do not infer those passes from this component fixture.
