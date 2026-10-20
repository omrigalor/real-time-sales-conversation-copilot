# Local macOS signing

The previous package script used `codesign --sign -`. Its designated requirement
was the build's cdhash, so updating app resources changed the identity Keychain
had authorized. A desktop shortcut rename does not fix that.

Run `node scripts/setup-local-signing.js --repair-installed` from a normal macOS
Terminal after quitting SalesCopilot. The Desktop `Fix SalesCopilot Keychain.command`
invokes this command. The restricted coding workspace cannot create keychains.

The setup creates a dedicated signing keychain under
`~/.local/share/salescopilot-signing`, with a random password and owner-only
permissions. The signing private key is imported as non-extractable, restricted
to Apple signing tools; temporary key/export files are deleted after import.
The certificate has code-signing usage only. Its user-level trust is restricted
to the code-signing policy, not TLS or system-wide trust. macOS may ask the user
to authorize this one-time setup. Existing login-keychain credentials are not
read, exported, deleted, or given broader access.

Before installing, the helper signs two small probe bundles with different
versions/resources and checks that their certificate-backed designated
requirements match. It then stages and verifies a signed copy of the app,
preserves the previous app as a backup, and atomically replaces it. The saved
`openai.enc`, user data path, app name, and bundle identifier remain unchanged.
One final Keychain Always Allow may be needed to authorize the new identity.

Future `npm run package` builds reuse that certificate. Missing/expired identity
fails the build rather than silently reverting to ad-hoc signing. Preserve this
directory across updates. The explicit `--pending-signing-repair` packaging flag
is a transitional escape hatch, not a completed Keychain fix.

This is local signing, not Apple Developer ID signing or notarization for public
distribution. No GUI Keychain consent or post-repair reopen has been verified by
the restricted workspace. The helper reports failures and preserves the old app.

References:
- https://github.com/electron/electron/blob/v44.4.5/docs/api/safe-storage.md
- https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
