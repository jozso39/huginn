import type { ConnectorKind } from '../api.types';
import { SetupGuide } from './SetupGuide';

const external = { target: '_blank', rel: 'noreferrer' } as const;

/**
 * The page GitLab makes tokens on, with the name and scope filled in (GitLab ≥ 14.1
 * reads them from the URL). Null until the GitLab URL is a web address.
 */
const gitlabTokenPage = (baseUrl: string): string | null => {
  try {
    const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
      return null;
    }

    const page = new URL('-/user_settings/personal_access_tokens', base);

    page.searchParams.set('name', 'Huginn');
    page.searchParams.set('scopes', 'api');

    return page.toString();
  } catch {
    return null;
  }
};

interface TokenGuideProps {
  kind: ConnectorKind;
  /** The form's current settings: GitLab's link follows the GitLab URL typed in. */
  config: Readonly<Record<string, string>>;
  folded: boolean;
}

/** For connections made with a token the user creates at the source. */
export const TokenGuide = ({ kind, config, folded }: TokenGuideProps) => {
  if (kind === 'GitLab') {
    const tokenPage = gitlabTokenPage(config.baseUrl ?? '');
    const path = (
      <>
        avatar → <strong>Edit profile</strong> → <strong>Access → Personal access tokens</strong>
      </>
    );

    return (
      <SetupGuide title="Getting a GitLab access token" folded={folded}>
        <ol>
          <li>
            {tokenPage ? (
              <>
                Open{' '}
                <a href={tokenPage} {...external}>
                  your access tokens in GitLab
                </a>{' '}
                ({path}).
              </>
            ) : (
              <>In GitLab: {path}.</>
            )}
          </li>
          <li>
            <strong>Generate token → Legacy token</strong>.
          </li>
          <li>
            Name it <em>Huginn</em>, tick the scope <code>api</code> and click{' '}
            <strong>Generate token</strong>.
          </li>
          <li>Copy the token and paste it below.</li>
        </ol>
      </SetupGuide>
    );
  }

  if (kind === 'ClickUp') {
    return (
      <SetupGuide title="Getting your ClickUp API token" folded={folded}>
        <ol>
          <li>
            Open{' '}
            <a href="https://app.clickup.com/settings/apps" {...external}>
              ClickUp → Settings → Apps
            </a>
            .
          </li>
          <li>
            Under <strong>API Token</strong> click <strong>Generate</strong> (or{' '}
            <strong>Copy</strong>, if there is one).
          </li>
          <li>Paste it below.</li>
        </ol>
      </SetupGuide>
    );
  }

  return null;
};

/** For connections made by signing in at the provider, once its sign-in is set up. */
export const SignInGuide = ({ kind }: { kind: ConnectorKind }) => {
  if (kind === 'Gmail') {
    return (
      <SetupGuide title="Connecting a mailbox">
        <ol>
          <li>
            Click <strong>Sign in with Google</strong> and pick the mailbox.
          </li>
          <li>
            If Google says the app is not verified: <strong>Advanced → Go to Huginn</strong>.
          </li>
          <li>
            Click <strong>Allow</strong>.
          </li>
        </ol>
      </SetupGuide>
    );
  }

  if (kind === 'LinkedIn') {
    return (
      <SetupGuide title="Connecting LinkedIn">
        <ol>
          <li>
            In LinkedIn: <strong>Settings → Communications → Email</strong>, turn on{' '}
            <strong>Conversations → Messages</strong>.
          </li>
          <li>
            Click <strong>Sign in with Google</strong> with the Gmail account LinkedIn writes to.
          </li>
          <li>
            On that Gmail connection: <strong>Edit → Leave out mail from</strong>{' '}
            <code>linkedin.com</code>.
          </li>
        </ol>
      </SetupGuide>
    );
  }

  if (kind === 'Slack') {
    return (
      <SetupGuide title="Connecting Slack">
        <ol>
          <li>
            Click <strong>Sign in with Slack</strong>, check the workspace (top right) and click{' '}
            <strong>Allow</strong>.
          </li>
        </ol>
      </SetupGuide>
    );
  }

  return null;
};

/** For Signal, linked as a device of the phone. */
export const PairingGuide = () => (
  <SetupGuide title="Linking Signal">
    <ol>
      <li>
        Click <strong>Link my phone</strong>.
      </li>
      <li>
        On your phone: <strong>Signal → Settings → Linked devices → +</strong> and scan the code.
      </li>
    </ol>
  </SetupGuide>
);
