export class BrowserPlatform {
  constructor(windowRef = window, documentRef = document) {
    this.window = windowRef;
    this.document = documentRef;
    this.location = windowRef.location;
    this.WebSocket = windowRef.WebSocket;
  }

  now() { return performance.now(); }
  random() { return Math.random(); }
  requestAnimationFrame(callback) { return this.window.requestAnimationFrame(callback); }
  cancelAnimationFrame(id) { this.window.cancelAnimationFrame(id); }
  setTimeout(callback, delay) { return this.window.setTimeout(callback, delay); }
  clearTimeout(id) { this.window.clearTimeout(id); }
  matchMedia(query) { return this.window.matchMedia(query); }
  createWebSocket(url) { return new this.WebSocket(url); }
}
