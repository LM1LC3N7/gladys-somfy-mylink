// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so the
// tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the lists of the bridge are published at each read; Scan
  // sends them again (and reads, at most once a minute).
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // Commands.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // Configuration screen button.
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // Configuration saved by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Connection lifecycle (also after every reconnection to Gladys): a
  // reconnection reads nothing and publishes the status, the Discovery and
  // the badges again. A configuration that cannot be read is tried again.
  gladys.on('connected', async () => {
    try {
      await app.connected(() => gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
