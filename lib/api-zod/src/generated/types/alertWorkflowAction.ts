export type AlertWorkflowAction = (typeof AlertWorkflowAction)[keyof typeof AlertWorkflowAction];

export const AlertWorkflowAction = {
  investigate: "investigate",
  monitor: "monitor",
  ignore: "ignore",
} as const;
