import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { PushSettings } from '../api.types';

type Support = 'ok' | 'needs-home-screen' | 'unsupported';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const support = (): Support => {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    return 'ok';
  }

  // iOS offers push only to web apps opened from the Home Screen.
  return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
};

/** "iPhone", "Mac · Chrome" — enough to tell devices apart in the list. */
const deviceLabel = (): string => {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Browser';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : 'Safari';

  return isIos() ? device : `${device} · ${browser}`;
};

const toKeyBytes = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};

/** Turns Important-item notifications on or off for this device; lists the others. */
export const NotificationsPanel = () => {
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const supported = support();

  const fetchState = useCallback(async () => {
    const [loaded, registration] = await Promise.all([
      api.push(),
      // Not `ready`: it never settles where no worker is registered, hiding the panel.
      supported === 'ok' ? navigator.serviceWorker.getRegistration() : Promise.resolve(undefined),
    ]);
    const subscription = registration ? await registration.pushManager.getSubscription() : null;

    return { loaded, current: subscription?.endpoint ?? null };
  }, [supported]);

  const apply = useCallback((state: { loaded: PushSettings; current: string | null }) => {
    setSettings(state.loaded);
    setEndpoint(state.current);
  }, []);

  const load = useCallback(async () => apply(await fetchState()), [fetchState, apply]);

  useEffect(() => {
    void fetchState()
      .then(apply)
      .catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)));
  }, [fetchState, apply]);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setNotice(null);

    try {
      setNotice(await work());
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOn = (publicKey: string) =>
    run(async () => {
      // Must run straight from the tap: iOS only asks for permission inside a user gesture.
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        return 'Notifications are blocked for Huginn. Allow them in the system settings, then try again.';
      }

      await navigator.serviceWorker.register('/sw.js');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toKeyBytes(publicKey),
      });

      await api.addPushDevice(subscription.toJSON(), deviceLabel());

      return 'On. Send a test to check.';
    });

  const turnOff = (current: string) =>
    run(async () => {
      const registration = await navigator.serviceWorker.getRegistration();

      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      await api.removePushDevice(current);

      return 'Off on this device.';
    });

  const sendTest = (current: string) =>
    run(async () =>
      (await api.testPush(current))
        ? 'Sent — it should arrive in a few seconds.'
        : 'Could not deliver. Turn notifications off and on again.'
    );

  const others = settings?.devices.filter((device) => device.endpoint !== endpoint) ?? [];
  const registered = settings?.devices.some((device) => device.endpoint === endpoint) ?? false;

  return (
    <section className="notifications">
      <h2>Notifications</h2>
      <p className="muted small">Only Important items are pushed, as they arrive.</p>

      {supported === 'needs-home-screen' && (
        <p>
          On iPhone, notifications work only in the Home Screen app: tap <strong>Share</strong> →{' '}
          <strong>Add to Home Screen</strong>, open Huginn from there and come back here.
        </p>
      )}
      {supported === 'unsupported' && <p>This browser cannot receive notifications.</p>}
      {supported === 'ok' && settings && !settings.publicKey && (
        <p>
          The server has no push keys yet: run <code>bun run vapid</code> and put the two lines in
          its <code>.env</code>.
        </p>
      )}
      {supported === 'ok' && settings?.publicKey && (
        <div className="notifications__row">
          <span>
            This device ({deviceLabel()}): <strong>{registered ? 'on' : 'off'}</strong>
          </span>
          <span className="spacer" />
          {registered && endpoint ? (
            <>
              <button type="button" disabled={busy} onClick={() => void sendTest(endpoint)}>
                Send test
              </button>
              <button type="button" disabled={busy} onClick={() => void turnOff(endpoint)}>
                Turn off
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void turnOn(settings.publicKey ?? '')}
            >
              Turn on
            </button>
          )}
        </div>
      )}
      {others.length > 0 && (
        <ul className="notifications__devices">
          {others.map((device) => (
            <li key={device.id}>
              <span>{device.label}</span>
              <span className="spacer" />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.removePushDevice(device.endpoint);

                    return `${device.label} will no longer get notifications.`;
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="small">{notice}</p>}
    </section>
  );
};
