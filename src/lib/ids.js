const DEVICE_KEY = "puroductive_device_id";

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "web-" + crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
