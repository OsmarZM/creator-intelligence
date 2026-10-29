export type DesktopUpdateState = {
  phase:
    | "idle"
    | "checking"
    | "available"
    | "current"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error"
    | "unavailable";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};
