import * as github from "@actions/github";
import { config } from "dotenv";
import { EmitterWebhookEvent as WebhookEvent, EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";

config();

export type SupportedEvents = "issues" | "pull_request";

export interface PluginInputs<T extends WebhookEventName = SupportedEvents> {
  stateId: string;
  eventName: T;
  eventPayload: WebhookEvent<T>["payload"];
  settings: string;
  authToken: string;
  ref: string;
}

const webhookPayload = github.context.payload.inputs;
const program: PluginInputs = {
  stateId: webhookPayload.stateId,
  eventName: webhookPayload.eventName,
  authToken: webhookPayload.authToken,
  ref: webhookPayload.ref,
  eventPayload: JSON.parse(webhookPayload.eventPayload),
  settings: JSON.parse(webhookPayload.settings),
};

export default program;
