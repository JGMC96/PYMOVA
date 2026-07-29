/**
 * Public URL of the published app. Invitation links must point here:
 * the editor preview origins are temporary and no external user can open them.
 */
export const PUBLIC_APP_URL = "https://cogent-business-os.lovable.app";

const isPublicOrigin = () => {
  const host = window.location.hostname;
  return !host.includes("lovableproject.com") && !host.includes("localhost") && host !== "127.0.0.1";
};

/** Absolute, shareable invitation link for a given token. */
export const buildInviteLink = (token: string) => {
  const base = isPublicOrigin() ? window.location.origin : PUBLIC_APP_URL;
  return `${base}/invite/${token}`;
};

const PENDING_INVITE_KEY = "pymova_pending_invite";

export const setPendingInvite = (token: string) => {
  sessionStorage.setItem(PENDING_INVITE_KEY, token);
  localStorage.setItem(PENDING_INVITE_KEY, token);
};

export const getPendingInvite = () =>
  sessionStorage.getItem(PENDING_INVITE_KEY) ?? localStorage.getItem(PENDING_INVITE_KEY);

export const clearPendingInvite = () => {
  sessionStorage.removeItem(PENDING_INVITE_KEY);
  localStorage.removeItem(PENDING_INVITE_KEY);
};
