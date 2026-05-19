export class NoUpdateAvailableError extends Error {}

export class UpdateHelper {
  static async createNoUpdateAvailableDirectiveAsync() {
    return { type: 'noUpdateAvailable' };
  }
}
