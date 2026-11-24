# Copycat setup prototype

Uses the real `src/` renderer, the exact shared desktop shell, and a simulated
bridge. The shared `setup-preview.js` helper renders tool-owned setup steps
in both standalone and hosted modes. Permission checks never change OS access.
Production setup is pending explicit owner review; feedback is not approval.

Build with the current Solutions source SDK and its shell, registering this
checkout with `prototype register --suite <suite>` and then `prototype build`.
Generated output and local paths are ignored.
