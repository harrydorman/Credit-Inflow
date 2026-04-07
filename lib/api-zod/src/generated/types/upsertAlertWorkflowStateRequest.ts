import type { AlertWorkflowAction } from "./alertWorkflowAction";

export interface UpsertAlertWorkflowStateRequest {
  action: AlertWorkflowAction;
  userId?: string | null;
}
