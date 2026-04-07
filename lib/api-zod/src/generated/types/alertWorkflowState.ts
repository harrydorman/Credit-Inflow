import type { AlertWorkflowAction } from "./alertWorkflowAction";

export interface AlertWorkflowState {
  id: number;
  alertEventId: number;
  organizationId: string;
  userId?: string | null;
  action: AlertWorkflowAction;
  createdAt: Date;
  updatedAt: Date;
}
