/**
 * Deterministic fixture traffic used by both the standalone fixture page and
 * the panel harness. Every action performs real browser network work so the
 * capture pipeline observes genuine timings, headers, and body states.
 */
const SECRETS = {
  apiKey: 'sk_live_exhibitE2eApiKeyCanary0001',
  authorization: 'Bearer exhibit.e2e.authorization.canary.0001',
  password: 'exhibit-e2e-password-canary-0001',
  queryToken: 'exhibit-e2e-query-token-canary-0001',
};

async function drain(response) {
  try {
    await response.arrayBuffer();
  } catch {
    // A cancelled or streamed body is still valid evidence.
  }
  return response;
}

async function xhr(method, url, body, headers) {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open(method, url, true);
    for (const [name, value] of Object.entries(headers ?? {})) {
      request.setRequestHeader(name, value);
    }
    request.onloadend = () => resolve(request.status);
    request.onerror = () => resolve(0);
    request.send(body ?? null);
  });
}

const actions = {
  async loadProfile() {
    return drain(
      await fetch('/api/profile', { headers: { accept: 'application/json' } }),
    );
  },

  async saveProfile(displayName = 'Ada') {
    return drain(
      await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: SECRETS.authorization,
        },
        body: JSON.stringify({ displayName, password: SECRETS.password }),
      }),
    );
  },

  async graphql() {
    return drain(
      await fetch('/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'query Profile { profile { id displayName } }',
          operationName: 'Profile',
          variables: { id: 'profile-0001' },
        }),
      }),
    );
  },

  async submitForm() {
    const body = new URLSearchParams({
      displayName: 'Ada',
      password: SECRETS.password,
    });
    return drain(
      await fetch('/api/form', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
    );
  },

  async upload() {
    const form = new FormData();
    form.append('displayName', 'Ada');
    form.append('avatar', new Blob(['fixture-bytes'], { type: 'text/plain' }), 'a.txt');
    return drain(await fetch('/api/upload', { method: 'POST', body: form }));
  },

  async xhrCall() {
    return xhr('GET', '/api/profile?source=xhr');
  },

  async redirect() {
    return drain(await fetch('/api/redirect'));
  },

  async failing() {
    return drain(await fetch('/api/error'));
  },

  async missing() {
    return drain(await fetch('/api/not-found'));
  },

  async slow() {
    return drain(await fetch('/api/slow'));
  },

  async cacheable() {
    await drain(await fetch('/api/cacheable'));
    return drain(await fetch('/api/cacheable'));
  },

  async serviceWorkerData() {
    return drain(await fetch('/api/service-worker-data'));
  },

  async stream() {
    const response = await fetch('/api/stream');
    const reader = response.body?.getReader();
    while (reader !== undefined) {
      const chunk = await reader.read();
      if (chunk.done) break;
    }
    return response;
  },

  async binary() {
    return drain(await fetch('/api/binary'));
  },

  async download() {
    return drain(await fetch('/api/download'));
  },

  async large() {
    return drain(await fetch('/api/large'));
  },

  async flight(partial = false) {
    return drain(await fetch(partial ? '/api/flight-partial' : '/api/flight'));
  },

  async secret() {
    return drain(
      await fetch(
        `/api/secret?access_token=${encodeURIComponent(SECRETS.queryToken)}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: SECRETS.authorization,
            'x-api-key': SECRETS.apiKey,
          },
          body: JSON.stringify({ password: SECRETS.password, apiKey: SECRETS.apiKey }),
        },
      ),
    );
  },

  async blockedCrossOrigin(origin) {
    try {
      return await drain(await fetch(`${origin}/api/profile`));
    } catch {
      return null;
    }
  },

  async cancelled() {
    const controller = new AbortController();
    const pending = fetch('/api/hang', { signal: controller.signal }).catch(() => null);
    setTimeout(() => controller.abort(), 30);
    return pending;
  },

  async repeated(times = 2) {
    for (let index = 0; index < times; index += 1) {
      await drain(
        await fetch('/api/profile', { headers: { accept: 'application/json' } }),
      );
    }
    return times;
  },

  async registerServiceWorker() {
    if (navigator.serviceWorker === undefined) return false;
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    await navigator.serviceWorker.ready;
    if (registration.active === null) return false;
    return true;
  },

  async unregisterServiceWorker() {
    if (navigator.serviceWorker === undefined) return false;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((entry) => entry.unregister()));
    return true;
  },
};

const CONTROLS = [
  ['load-profile', 'Load profile', () => actions.loadProfile()],
  ['save-profile', 'Save profile', () => actions.saveProfile()],
  ['graphql', 'GraphQL profile', () => actions.graphql()],
  ['submit-form', 'Submit form', () => actions.submitForm()],
  ['upload', 'Upload avatar', () => actions.upload()],
  ['xhr', 'XHR profile', () => actions.xhrCall()],
  ['redirect', 'Follow redirect', () => actions.redirect()],
  ['failing', 'Trigger failure', () => actions.failing()],
  ['slow', 'Trigger slow call', () => actions.slow()],
  ['cacheable', 'Repeat cacheable call', () => actions.cacheable()],
  ['service-worker-data', 'Service worker data', () => actions.serviceWorkerData()],
  ['stream', 'Stream events', () => actions.stream()],
  ['binary', 'Binary image', () => actions.binary()],
  ['large', 'Large payload', () => actions.large()],
  ['flight', 'Flight payload', () => actions.flight(false)],
  ['flight-partial', 'Partial flight payload', () => actions.flight(true)],
  ['secret', 'Send credentials', () => actions.secret()],
  ['cancelled', 'Cancel in-flight call', () => actions.cancelled()],
  ['repeated', 'Repeat profile call', () => actions.repeated(2)],
];

/** Renders the shared fixture controls used to trigger real interactions. */
function renderFixtureControls(container) {
  const form = document.createElement('form');
  form.className = 'fixture-controls';
  form.setAttribute('aria-label', 'Fixture traffic controls');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void actions.submitForm();
  });

  for (const [id, label, run] of CONTROLS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `fixture-${id}`;
    button.dataset.fixtureAction = id;
    button.textContent = label;
    button.addEventListener('click', () => {
      void Promise.resolve(run()).then(() => {
        button.dataset.fixtureDone = 'true';
      });
    });
    form.append(button);
  }

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.id = 'fixture-native-submit';
  submit.textContent = 'Native form submit';
  form.append(submit);

  container.append(form);
}

globalThis.fixtureActions = actions;
globalThis.renderFixtureControls = renderFixtureControls;
