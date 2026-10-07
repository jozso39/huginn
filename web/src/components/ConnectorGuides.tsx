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
                — or in GitLab click your avatar → <strong>Edit profile</strong>, then in the left
                bar <strong>Access → Personal access tokens</strong>.
              </>
            ) : (
              <>
                In GitLab click your avatar → <strong>Edit profile</strong>, then in the left bar{' '}
                <strong>Access → Personal access tokens</strong>. (Fill in the GitLab URL below and
                this becomes a link.)
              </>
            )}
          </li>
          <li>
            <strong>Generate token → Legacy token.</strong> GitLab&apos;s fine-grained tokens do not
            cover comments yet, so replying from Huginn would fail.
          </li>
          <li>
            Name it <em>Huginn</em> and tick the scope <code>api</code>: Huginn reads your to-dos,
            marks them done and comments as you. Set the expiry as late as GitLab allows.
          </li>
          <li>
            <strong>Generate token</strong>, copy it right away (GitLab shows it only once) and
            paste it under <em>Personal access token</em> below.
          </li>
        </ol>
        <p className="muted small">
          When the token expires, the connection says so: make a new one the same way and paste it
          with Edit.
        </p>
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
            </a>{' '}
            — or in ClickUp click your avatar → <strong>Settings</strong> → <strong>Apps</strong>.
          </li>
          <li>
            Under <strong>API Token</strong> click <strong>Generate</strong>. If there already is
            one that something else uses, click <strong>Copy</strong> instead: regenerating stops
            the old one.
          </li>
          <li>
            Paste it under <em>Personal API token</em> below. It starts with <code>pk_</code> and
            does not expire.
          </li>
        </ol>
        <p className="muted small">
          Leave <em>Workspace ID</em> empty: if your token sees several workspaces, the connection
          lists them and you pick one with Edit.
        </p>
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
            <strong>Sign in with Google</strong> opens your browser: pick the mailbox, work or
            personal.
          </li>
          <li>
            If Google warns that it has not verified the app, click{' '}
            <strong>Advanced → Go to Huginn</strong>: it is the sign-in app you or your team set up.
          </li>
          <li>
            Allow access to Gmail. Huginn reads unread inbox mail, replies, saves drafts and marks
            mail read; it cannot delete mail for good.
          </li>
          <li>Come back here: the new connection opens for its category and colour.</li>
        </ol>
      </SetupGuide>
    );
  }

  if (kind === 'LinkedIn') {
    return (
      <SetupGuide title="Connecting LinkedIn">
        <ol>
          <li>
            LinkedIn has no API, so Huginn reads its e-mails. In LinkedIn open{' '}
            <strong>Settings → Communications → Email</strong> and switch on{' '}
            <strong>Conversations → Messages</strong> (InMail, invitations and mentions too, if you
            want them).
          </li>
          <li>
            <strong>Sign in with Google</strong> with the Gmail account LinkedIn writes to.
          </li>
          <li>
            On that account&apos;s Gmail connection, <strong>Edit → Leave out mail from</strong>{' '}
            <code>linkedin.com</code>, so the same mail does not come in twice.
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
            <strong>Sign in with Slack</strong> opens your browser: check the workspace (top right)
            and click <strong>Allow</strong>. If your workspace approves apps first, Slack lets you
            ask for it.
          </li>
          <li>
            Come back here: the connection opens to choose which channel messages come in, its
            category and colour.
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
        Huginn becomes a linked device of your Signal account, like Signal Desktop: it sees your
        messages and answers and reacts as you. Your phone stays the main device.
      </li>
      <li>
        <strong>Link my phone</strong> shows a QR code. On your phone open{' '}
        <strong>Signal → Settings → Linked devices → +</strong> and scan it.
      </li>
      <li>
        The connection appears here once the phone confirms, with its settings open for the category
        and colour. You can unlink Huginn on the phone any time.
      </li>
    </ol>
  </SetupGuide>
);
