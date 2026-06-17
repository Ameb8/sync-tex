# Privacy Policy

**Effective Date:** June 11, 2026  
**Last Updated:** June 11, 2026  
**Service:** SyncTeX — Collaborative LaTeX Editor  
**Website:** https://sync-tex.com  
**Contact:** alexmeb81@outlook.com

---

## 1. Introduction

SyncTeX ("we," "us," or "our") operates a self-hosted collaborative LaTeX editing platform at sync-tex.com. This Privacy Policy explains what personal information we collect, how we use it, how it is stored, and your rights regarding that information.

By creating an account or using SyncTeX, you acknowledge the practices described in this policy.

---

## 2. Information We Collect

### 2.1 Account Information

When you sign in or register, we collect:

- **Email address** — used to identify your account and communicate with you
- **Display name / username** — shown to collaborators on shared projects
- **Password** — if you register with email/password rather than OAuth; stored as a secure hash and never stored or transmitted in plain text

### 2.2 OAuth Sign-In (Google and GitHub)

If you sign in via Google or GitHub, we receive the following from their OAuth flow:

- Your email address
- Your display name
- Provider-specific account identifiers needed to link your OAuth sign-in to your SyncTeX account
- Email verification status, where provided by the provider

For Google Sign-In, SyncTeX requests the `openid`, `email`, and `profile` scopes. These scopes may make basic profile fields available from Google, but SyncTeX currently stores only the account identity fields needed for sign-in: email address, Google account identifier, email verification status, and display name.

For GitHub sign-in, SyncTeX requests the `user:email` scope so it can obtain an email address for account creation and sign-in. We do not access your Google Drive, Gmail, GitHub repositories, or any other account data beyond the basic identity fields described above.

### 2.3 User-Generated Content

SyncTeX stores content you create or upload through the platform:

- **LaTeX documents and project files** — created or uploaded via the editor
- **Project and file metadata** — names, creation timestamps, and structure
- **Collaboration membership** — which users are members of shared projects
- **Invite metadata** — project invite links, roles, inviter identifiers, and timestamps

### 2.4 AI Assistant Data

SyncTeX includes an optional AI chat assistant. If you use this feature:

- **Chat history** is stored on our servers and associated with your account
- **Chat messages** are sent to the active third-party AI provider to generate responses. The current chat provider exposed by SyncTeX is Google Gemini
- **Context data** such as the active file name may be sent with a chat request. If you enable document-context or auto-context features, relevant document text or chunks from your project may be sent to third-party providers in order to generate embeddings or provide assistant context
- **AI usage records** such as provider, model, token estimates, operation type, project identifier, and timestamps may be stored for budgeting, diagnostics, and service operation
- You are responsible for reviewing the privacy policy of any AI provider you choose to use through SyncTeX

Current third-party AI-related providers include Google Gemini for chat responses and Voyage AI for document embeddings used by auto-context features. If SyncTeX adds additional providers such as OpenAI or Anthropic, this policy will be updated before those providers are made available for production use.

### 2.5 Third-Party API Keys (BYOK)

If you supply your own API keys for AI providers:

- Keys are encrypted at rest using **AES-256-GCM** before storage
- Keys are not intentionally logged and are not returned to the client after storage
- Keys are decrypted in server memory only when needed to make requests to the intended provider on your behalf
- Keys are not used outside of your own assistant sessions

### 2.6 Usage Data

We may collect basic operational data such as server access logs, IP address, request paths, timestamps, error logs, service availability metrics, and diagnostic metadata. This data is used to maintain service reliability and security. Operational logs are not intended to contain document content, but may contain account, project, file, request, or URL identifiers.

---

## 3. How We Use Your Information

We use the information we collect to:

- Create and maintain your account
- Authenticate you when you sign in
- Display your name and email address to collaborators on projects you have joined or shared
- Store and serve your LaTeX documents and project files
- Provide the AI assistant feature when you choose to use it
- Generate document embeddings and retrieve project context if you enable auto-context features
- Respond to support requests or account deletion requests sent to our contact email

We do not use your data for advertising, profiling, or any purpose beyond operating the service.

---

## 4. How Your Information Is Shared

### 4.1 Collaborators

When you join or share a project, other members of that project can see:

- Your display name and email address
- The names and full content of files within the shared project
- Your project role and collaboration metadata, such as when you joined or were invited

You control which projects you share and with whom.

### 4.2 AI Providers

When you use the AI assistant, your chat messages and relevant context are transmitted to the active third-party AI provider. When auto-context features are enabled, relevant document chunks may be transmitted to an embeddings provider. Each provider's own privacy policy governs how they handle that data.

Current third-party AI-related providers include:

- Google Gemini for assistant chat responses
- Voyage AI for document embeddings used by auto-context features

### 4.3 OAuth Providers

When you sign in with Google or GitHub, those providers process your OAuth sign-in according to their own policies. SyncTeX uses the resulting identity information only to create, link, and authenticate your SyncTeX account.

### 4.4 No Sale of Personal Information

We do not sell or rent your personal information. SyncTeX is operated on self-hosted infrastructure, except for the third-party OAuth and AI-related providers described in this policy and any disclosures required for security, legal compliance, or protecting the service.

---

## 5. Data Storage and Security

- All data is stored on privately operated, self-hosted infrastructure
- Passwords are stored as secure hashes
- Third-party API keys are encrypted at rest using AES-256-GCM
- Access to the server and data is restricted to the service operator
- All connections to sync-tex.com are encrypted via HTTPS/TLS

While we take reasonable technical precautions, no system can guarantee absolute security. You use SyncTeX at your own risk and should avoid storing highly sensitive content in your documents.

---

## 6. Data Retention

Your account data is retained for as long as your account is active, unless you request deletion. Project files, chat history, stored API keys, usage records, and auto-context records are retained while needed to provide the service.

You may request account deletion using the process in Section 8. Account deletion is currently handled manually by the service operator. We will respond within 30 days and will remove or anonymize personal information and associated active-service data where technically feasible. Some information may remain for a limited time in backups, operational logs, collaborator copies, exported files, or records we must retain for security, abuse prevention, or legal reasons.

---

## 7. Cookies and Local Storage

SyncTeX uses JWT session tokens to keep you signed in. The current web app stores these tokens in browser local storage and sends them in Authorization headers when calling SyncTeX services. During OAuth sign-in, the token is returned to the web app through the OAuth callback URL and then stored in local storage.

SyncTeX also uses local storage for preferences such as theme selection and OAuth redirect state. We do not use tracking cookies or third-party analytics.

---

## 8. Your Rights and Choices

You have the right to:

- **Access** the personal information we hold about you
- **Correct** inaccurate information by contacting us
- **Delete** your account by emailing alexmeb81@outlook.com with the subject line "Account Deletion Request"
- **Withdraw consent** for OAuth access by revoking SyncTeX's permissions in your Google or GitHub account settings at any time

We will respond to deletion and access requests within 30 days.

---

## 9. Children's Privacy

SyncTeX is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe a child has created an account, please contact us at alexmeb81@outlook.com and we will delete it promptly.

---

## 10. Changes to This Policy

We may update this Privacy Policy as the service evolves. When we do, we will update the "Last Updated" date at the top of this page. Continued use of SyncTeX after changes are posted constitutes acceptance of the updated policy. For significant changes, we will make reasonable efforts to notify active users.

---

## 11. Contact

For questions, data requests, or deletion requests:

**Email:** alexmeb81@outlook.com  
**Website:** https://sync-tex.com
