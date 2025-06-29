export interface SignInResult {
  userCode: string;
  command: {
    command: string;
    arguments: unknown[];
    title: string;
  };
}

export interface StatusNotification {
  message: string;
  kind: 'Normal' | 'Error' | 'Warning' | 'Inactive';
  busy?: boolean;
}
