# Accepted Access MFA methods

Recorded on 2026-10-20 following the owner's explicit authorization:

> I authorize authenticator-app codes as an alternative to Security key and/or Biometrics MFA

This amends the Access authentication requirement in `05-security.md` for the admin and private-preview applications. Cloudflare Access must still enforce its own Independent MFA after identity-provider login. Allowed methods may include authenticator-app codes (TOTP), security keys and platform biometrics. A TOTP challenge performed only by the identity provider does not satisfy that independent check.

The owner confirmed that the existing flow is GitHub login followed by a separate Cloudflare Access authenticator-app challenge. The private preview then returned `{"ready":false,"release":null}`, proving authenticated access to the empty bootstrap. With the authorized method change, that reported flow satisfies the Access MFA requirement. TOTP is not claimed to provide the phishing resistance of WebAuthn security keys or platform authenticators.

The existing shared Auth policy and GitHub identity provider remain valid. The origin still verifies the Access token's signature, issuer, audience, expiry and approved owner email independently. No new login form, credential store, allowlist or policy bypass is introduced. Recent-login checks remain required for sensitive operations. This decision changes the permitted Access MFA methods; it does not change the separate account-security requirements for GitHub, Cloudflare, the registrar or email accounts.

The owner's existing edits to `05-security.md` are preserved. Read this explicit decision together with that brief and the publishing activation handoff in `21-publishing-activation.md`. Cloudflare documents the supported independent methods in its [Independent MFA guide](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/).
