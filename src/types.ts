export interface SignInResult {
  userCode: string;
  command: {
    command: string;
    arguments: any[];
    title: string;
  };
}

export interface StatusNotification {
  message: string;
  kind: 'Normal' | 'Error' | 'Warning' | 'Inactive';
  busy?: boolean;
}