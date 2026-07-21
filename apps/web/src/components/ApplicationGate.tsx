import { useState, type FormEvent, type PropsWithChildren } from 'react';
import { useApplication } from '../state/ApplicationProvider';

export function ApplicationGate({ children }: PropsWithChildren) {
  const application = useApplication();

  if (application.status === 'ready') {
    return <>{children}</>;
  }

  if (application.status === 'authentication-required') {
    return <AuthenticationGate />;
  }

  if (application.status === 'tenant-required') {
    return <TenantOnboardingGate />;
  }

  if (application.status === 'error') {
    return (
      <GateLayout eyebrow="Connection problem" title="The operating workspace could not be loaded">
        <p>{application.error?.problem.detail ?? application.error?.problem.title ?? 'Check the API and authentication configuration.'}</p>
        {application.error?.correlationId && <code className="correlation-code">{application.error.correlationId}</code>}
        <div className="gate-actions">
          <button className="primary-button" type="button" onClick={() => void application.retry()}>Retry connection</button>
          <button className="ghost-button" type="button" onClick={application.signOut}>Change authentication</button>
        </div>
      </GateLayout>
    );
  }

  return (
    <GateLayout eyebrow="Loading tenant workspace" title="Preparing your FMCG operating system">
      <div className="loading-stack" aria-live="polite">
        <span className="loading-spinner" aria-hidden="true" />
        <p>Resolving identity, company membership, modules, permissions and live operating data.</p>
      </div>
    </GateLayout>
  );
}

function AuthenticationGate() {
  const application = useApplication();
  const [subject, setSubject] = useState('local-admin');
  const [email, setEmail] = useState('alex@fmcgbyalex.com');
  const [displayName, setDisplayName] = useState('Alex de Vries');
  const [accessToken, setAccessToken] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (application.runtime.authenticationMode === 'development') {
      application.authenticateDevelopment({ subject, email, displayName });
    } else {
      application.authenticateOidc(accessToken);
    }
  }

  const development = application.runtime.authenticationMode === 'development';
  return (
    <GateLayout
      eyebrow={development ? 'Development identity' : 'Secure authentication'}
      title={development ? 'Choose the local operating identity' : 'Connect an OIDC access token'}
    >
      <p>
        {development
          ? 'Development headers are enabled only against a development Worker. Production and staging remain bearer-token only.'
          : 'The API validates issuer, audience, signature, expiry and membership before any tenant data is returned. The token is stored only for this browser session.'}
      </p>
      <form className="gate-form" onSubmit={submit}>
        {development ? (
          <>
            <label><span>Identity subject</span><input required minLength={2} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
            <label><span>Verified email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Display name</span><input required minLength={2} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          </>
        ) : (
          <label><span>OIDC bearer token</span><textarea required rows={6} autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Paste a short-lived JWT access token" /></label>
        )}
        <button className="primary-button" type="submit" disabled={development ? !subject.trim() || !email.trim() || !displayName.trim() : !accessToken.trim()}>
          Continue securely
        </button>
      </form>
    </GateLayout>
  );
}

function TenantOnboardingGate() {
  const application = useApplication();
  const development = application.runtime.authenticationMode === 'development';
  const [tenantName, setTenantName] = useState('Demo FMCG Group');
  const [tenantSlug, setTenantSlug] = useState('demo-fmcg-group');
  const [adminEmail, setAdminEmail] = useState('alex@fmcgbyalex.com');
  const [adminDisplayName, setAdminDisplayName] = useState('Alex de Vries');
  const [currency, setCurrency] = useState('EUR');
  const [locale, setLocale] = useState('en-NL');
  const [timezone, setTimezone] = useState('Europe/Amsterdam');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (development) {
        await application.bootstrapDevelopment({ tenantName, tenantSlug, adminEmail, adminDisplayName });
      } else {
        await application.onboardTenant({
          tenantName,
          tenantSlug,
          adminDisplayName,
          defaultCurrency: currency,
          defaultLocale: locale,
          defaultTimezone: timezone
        });
      }
    } catch {
      // The provider exposes the structured failure through its notice state.
    }
  }

  return (
    <GateLayout eyebrow="Company onboarding" title="Create the first tenant workspace">
      <p>No active company membership was found for this identity. Create a tenant without weakening the membership checks used by every later request.</p>
      <form className="gate-form two-column" onSubmit={(event) => void submit(event)}>
        <label><span>Company name</span><input required minLength={2} value={tenantName} onChange={(event) => setTenantName(event.target.value)} /></label>
        <label><span>Company slug</span><input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value.toLowerCase())} /></label>
        {development && <label><span>Administrator email</span><input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} /></label>}
        <label><span>Administrator name</span><input required minLength={2} value={adminDisplayName} onChange={(event) => setAdminDisplayName(event.target.value)} /></label>
        {!development && (
          <>
            <label><span>Currency</span><input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
            <label><span>Locale</span><input required value={locale} onChange={(event) => setLocale(event.target.value)} /></label>
            <label className="full-width"><span>Timezone</span><input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
          </>
        )}
        <div className="gate-actions full-width">
          <button className="primary-button" type="submit" disabled={application.busyAction !== null}>{application.busyAction ?? 'Create company workspace'}</button>
          <button className="ghost-button" type="button" onClick={application.signOut}>Use another identity</button>
        </div>
      </form>
      {application.notice?.tone === 'error' && <div className="inline-problem"><strong>{application.notice.title}</strong><span>{application.notice.detail}</span></div>}
    </GateLayout>
  );
}

function GateLayout({ eyebrow, title, children }: PropsWithChildren<{ eyebrow: string; title: string }>) {
  return (
    <main className="gate-shell">
      <section className="gate-card">
        <div className="gate-brand"><span className="brand-mark">FA</span><span><strong>FMCG by Alex</strong><small>SuperApp</small></span></div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children}
        <footer><span>API: {window.__FMCGBYALEX_RUNTIME__?.apiBaseUrl ?? 'http://localhost:8787'}</span><span>Fail-closed tenant access</span></footer>
      </section>
    </main>
  );
}
